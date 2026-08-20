-- ============================================================================
-- LIVREPAY — Schema core + segurança (fintech)
-- Padrões adotados:
--   * Dinheiro SEMPRE em centavos (bigint) — nunca float.
--   * RLS habilitado em TODAS as tabelas; sem policy = acesso negado.
--   * Roles em tabela separada (user_roles) + função SECURITY DEFINER has_role()
--     para evitar recursão de RLS e escalação de privilégio.
--   * Ledger (transactions) é append-only: cliente não insere/edita/apaga;
--     movimentação só via RPC atômica com lock de linha.
--   * Auditoria append-only em audit_log via triggers; leitura só para admin.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ENUMS
-- ----------------------------------------------------------------------------
create type public.app_role as enum ('admin', 'operator', 'viewer');
create type public.account_status as enum ('active', 'blocked', 'closed');
create type public.transaction_type as enum ('credit', 'debit');
create type public.charge_kind as enum ('link', 'boleto', 'pix', 'assinatura');
create type public.charge_status as enum ('draft', 'pending', 'paid', 'expired', 'cancelled');
create type public.payment_kind as enum ('transferencia', 'conta', 'folha');
create type public.payment_status as enum ('draft', 'scheduled', 'processing', 'completed', 'failed', 'cancelled');
create type public.receivable_status as enum ('scheduled', 'settled', 'advanced', 'overdue', 'cancelled');
create type public.policy_status as enum ('quote', 'active', 'expired', 'cancelled');
create type public.claim_status as enum ('open', 'analyzing', 'approved', 'denied', 'paid');
create type public.card_kind as enum ('virtual', 'physical');
create type public.card_status as enum ('active', 'blocked', 'cancelled');
create type public.alert_type as enum ('urgent', 'warning', 'info', 'success');

-- ----------------------------------------------------------------------------
-- 2. FUNÇÕES UTILITÁRIAS
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. PROFILES (1:1 com auth.users)
-- ----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  tax_id text, -- CPF/CNPJ (apenas dígitos)
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tax_id_digits check (tax_id is null or tax_id ~ '^[0-9]{11}$' or tax_id ~ '^[0-9]{14}$')
);

alter table public.profiles enable row level security;

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create policy "profiles: usuário lê o próprio"
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

create policy "profiles: usuário atualiza o próprio"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());
-- insert/delete: apenas via trigger handle_new_user / cascade — sem policy.

-- ----------------------------------------------------------------------------
-- 4. USER_ROLES + has_role() (padrão anti-escalação do Supabase)
-- ----------------------------------------------------------------------------
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  );
$$;

create policy "user_roles: usuário lê os próprios"
  on public.user_roles for select
  to authenticated
  using (user_id = auth.uid());

create policy "user_roles: admin gerencia"
  on public.user_roles for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- ----------------------------------------------------------------------------
-- 5. ACCOUNTS (saldo em centavos; cliente NÃO altera saldo diretamente)
-- ----------------------------------------------------------------------------
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Conta Principal',
  status public.account_status not null default 'active',
  currency char(3) not null default 'BRL',
  balance_cents bigint not null default 0 check (balance_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.accounts enable row level security;

create trigger accounts_updated_at
  before update on public.accounts
  for each row execute function public.set_updated_at();

create policy "accounts: usuário lê as próprias"
  on public.accounts for select
  to authenticated
  using (user_id = auth.uid());
-- Sem insert/update/delete para o cliente:
-- criação via handle_new_user; saldo via RPC process_transaction.

-- ----------------------------------------------------------------------------
-- 6. TRANSACTIONS (ledger imutável / append-only)
-- ----------------------------------------------------------------------------
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  -- Ordem canônica do ledger. NÃO usar created_at para ordenar: now() devolve o
  -- horário de início da transação, então lançamentos feitos na mesma transação
  -- teriam timestamps idênticos e ordem indefinida. `seq` garante ordem total.
  seq bigint generated always as identity,
  account_id uuid not null references public.accounts(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  type public.transaction_type not null,
  amount_cents bigint not null check (amount_cents > 0),
  balance_before_cents bigint not null,
  balance_after_cents bigint not null,
  description text not null,
  reference_table text,   -- ex: 'charges', 'payments'
  reference_id uuid,
  metadata jsonb not null default '{}',
  -- clock_timestamp(): horário real da linha, distinto dentro da mesma transação.
  created_at timestamptz not null default clock_timestamp()
);

create unique index transactions_seq_key on public.transactions (seq);
create index transactions_account_seq_idx on public.transactions (account_id, seq desc);
create index transactions_user_seq_idx on public.transactions (user_id, seq desc);

alter table public.transactions enable row level security;

create policy "transactions: usuário lê as próprias"
  on public.transactions for select
  to authenticated
  using (user_id = auth.uid());
-- Sem insert/update/delete: só a RPC (security definer) escreve.

-- Blindagem extra: proíbe UPDATE/DELETE mesmo para funções definer.
create or replace function public.forbid_change()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Registro imutável: % não permite %', tg_table_name, tg_op;
end;
$$;

create trigger transactions_immutable
  before update or delete on public.transactions
  for each row execute function public.forbid_change();

-- ----------------------------------------------------------------------------
-- 7. RPC ATÔMICA DE MOVIMENTAÇÃO (lock de linha + ledger + saldo)
-- ----------------------------------------------------------------------------
create or replace function public.process_transaction(
  _account_id uuid,
  _type public.transaction_type,
  _amount_cents bigint,
  _description text,
  _reference_table text default null,
  _reference_id uuid default null,
  _metadata jsonb default '{}'
)
returns public.transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  _account public.accounts%rowtype;
  _new_balance bigint;
  _tx public.transactions%rowtype;
begin
  if _amount_cents is null or _amount_cents <= 0 then
    raise exception 'Valor deve ser positivo (centavos)';
  end if;

  -- Lock pessimista na conta: serializa movimentações concorrentes.
  select * into _account
  from public.accounts
  where id = _account_id
    and user_id = auth.uid()   -- só o dono movimenta
  for update;

  if not found then
    raise exception 'Conta não encontrada ou sem permissão';
  end if;

  if _account.status <> 'active' then
    raise exception 'Conta % não está ativa', _account.id;
  end if;

  if _type = 'debit' then
    _new_balance := _account.balance_cents - _amount_cents;
    if _new_balance < 0 then
      raise exception 'Saldo insuficiente';
    end if;
  else
    _new_balance := _account.balance_cents + _amount_cents;
  end if;

  insert into public.transactions
    (account_id, user_id, type, amount_cents,
     balance_before_cents, balance_after_cents,
     description, reference_table, reference_id, metadata)
  values
    (_account.id, auth.uid(), _type, _amount_cents,
     _account.balance_cents, _new_balance,
     _description, _reference_table, _reference_id, coalesce(_metadata, '{}'))
  returning * into _tx;

  update public.accounts
  set balance_cents = _new_balance
  where id = _account.id;

  return _tx;
end;
$$;

revoke all on function public.process_transaction from public, anon;
grant execute on function public.process_transaction to authenticated;

-- ----------------------------------------------------------------------------
-- 8. CHARGES (Cobrança: links, boletos, PIX, assinaturas)
-- ----------------------------------------------------------------------------
create table public.charges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind public.charge_kind not null,
  status public.charge_status not null default 'draft',
  description text not null,
  amount_cents bigint not null check (amount_cents > 0),
  due_date date,
  customer_name text,
  customer_tax_id text,
  txid text,               -- TXID PIX / nosso número boleto
  payload jsonb not null default '{}',  -- copia-e-cola, linha digitável, url do link...
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index charges_user_status_idx on public.charges (user_id, status);

alter table public.charges enable row level security;

create trigger charges_updated_at
  before update on public.charges
  for each row execute function public.set_updated_at();

create policy "charges: usuário lê as próprias"
  on public.charges for select
  to authenticated
  using (user_id = auth.uid());

create policy "charges: usuário cria as próprias"
  on public.charges for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "charges: usuário edita não-finalizadas"
  on public.charges for update
  to authenticated
  using (user_id = auth.uid() and status in ('draft', 'pending'))
  with check (user_id = auth.uid());
-- Sem delete: cobrança se cancela (status), não se apaga (trilha de auditoria).

-- ----------------------------------------------------------------------------
-- 9. RECEBÍVEIS
-- ----------------------------------------------------------------------------
create table public.receivable_contracts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  acquirer text,           -- credenciadora/adquirente
  total_cents bigint not null default 0 check (total_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.receivable_contracts enable row level security;

create trigger receivable_contracts_updated_at
  before update on public.receivable_contracts
  for each row execute function public.set_updated_at();

create policy "receivable_contracts: dono CRUD"
  on public.receivable_contracts for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create table public.receivables (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contract_id uuid references public.receivable_contracts(id) on delete set null,
  gross_cents bigint not null check (gross_cents > 0),
  net_cents bigint not null check (net_cents > 0 and net_cents <= gross_cents),
  due_date date not null,
  status public.receivable_status not null default 'scheduled',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index receivables_user_due_idx on public.receivables (user_id, due_date);

alter table public.receivables enable row level security;

create trigger receivables_updated_at
  before update on public.receivables
  for each row execute function public.set_updated_at();

create policy "receivables: usuário lê os próprios"
  on public.receivables for select
  to authenticated
  using (user_id = auth.uid());

create policy "receivables: usuário cria os próprios"
  on public.receivables for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "receivables: usuário edita não-liquidados"
  on public.receivables for update
  to authenticated
  using (user_id = auth.uid() and status in ('scheduled', 'overdue'))
  with check (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 10. PAGAMENTOS (transferências, contas/tributos, folha)
-- ----------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind public.payment_kind not null,
  status public.payment_status not null default 'draft',
  amount_cents bigint not null check (amount_cents > 0),
  recipient_name text,
  recipient_tax_id text,
  recipient_key text,       -- chave PIX / linha digitável / dados bancários resumidos
  scheduled_for date,
  executed_at timestamptz,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index payments_user_status_idx on public.payments (user_id, status);

alter table public.payments enable row level security;

create trigger payments_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

create policy "payments: usuário lê os próprios"
  on public.payments for select
  to authenticated
  using (user_id = auth.uid());

create policy "payments: usuário cria os próprios"
  on public.payments for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "payments: usuário edita não-executados"
  on public.payments for update
  to authenticated
  using (user_id = auth.uid() and status in ('draft', 'scheduled'))
  with check (user_id = auth.uid());
-- Sem delete: pagamento se cancela, não se apaga.

-- ----------------------------------------------------------------------------
-- 11. SEGUROS
-- ----------------------------------------------------------------------------
create table public.insurance_policies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product text not null,
  insurer text,
  status public.policy_status not null default 'quote',
  premium_cents bigint not null default 0 check (premium_cents >= 0),
  coverage_cents bigint not null default 0 check (coverage_cents >= 0),
  starts_at date,
  ends_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint policy_period check (ends_at is null or starts_at is null or ends_at >= starts_at)
);

alter table public.insurance_policies enable row level security;

create trigger insurance_policies_updated_at
  before update on public.insurance_policies
  for each row execute function public.set_updated_at();

create policy "policies: dono CRUD"
  on public.insurance_policies for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create table public.insurance_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  policy_id uuid not null references public.insurance_policies(id) on delete cascade,
  status public.claim_status not null default 'open',
  amount_cents bigint check (amount_cents is null or amount_cents > 0),
  description text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.insurance_claims enable row level security;

create trigger insurance_claims_updated_at
  before update on public.insurance_claims
  for each row execute function public.set_updated_at();

create policy "claims: usuário lê os próprios"
  on public.insurance_claims for select
  to authenticated
  using (user_id = auth.uid());

create policy "claims: usuário abre os próprios"
  on public.insurance_claims for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "claims: usuário edita em aberto"
  on public.insurance_claims for update
  to authenticated
  using (user_id = auth.uid() and status in ('open', 'analyzing'))
  with check (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 12. CARTÕES
-- Nunca armazenar PAN completo/CVV (PCI DSS): apenas last4 + token do emissor.
-- ----------------------------------------------------------------------------
create table public.cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  holder_name text,
  kind public.card_kind not null default 'virtual',
  status public.card_status not null default 'active',
  last4 char(4) not null check (last4 ~ '^[0-9]{4}$'),
  issuer_token text,        -- token opaco do emissor; JAMAIS PAN/CVV
  limit_cents bigint not null default 0 check (limit_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.cards enable row level security;

create trigger cards_updated_at
  before update on public.cards
  for each row execute function public.set_updated_at();

create policy "cards: usuário lê os próprios"
  on public.cards for select
  to authenticated
  using (user_id = auth.uid());

create policy "cards: usuário cria os próprios"
  on public.cards for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "cards: usuário edita os próprios"
  on public.cards for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create table public.card_transactions (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,   -- ordem canônica (ver transactions.seq)
  card_id uuid not null references public.cards(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  merchant text not null,
  created_at timestamptz not null default clock_timestamp()
);

create index card_transactions_card_seq_idx on public.card_transactions (card_id, seq desc);

alter table public.card_transactions enable row level security;

create policy "card_transactions: usuário lê as próprias"
  on public.card_transactions for select
  to authenticated
  using (user_id = auth.uid());

create trigger card_transactions_immutable
  before update or delete on public.card_transactions
  for each row execute function public.forbid_change();

-- ----------------------------------------------------------------------------
-- 13. ALERTAS (notificações operacionais)
-- ----------------------------------------------------------------------------
create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type public.alert_type not null default 'info',
  title text not null,
  description text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index alerts_user_unread_idx on public.alerts (user_id) where not read;

alter table public.alerts enable row level security;

create policy "alerts: usuário lê os próprios"
  on public.alerts for select
  to authenticated
  using (user_id = auth.uid());

create policy "alerts: usuário marca como lido"
  on public.alerts for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
-- insert: só backend (service role / triggers) cria alertas.

-- ----------------------------------------------------------------------------
-- 14. AUDITORIA (append-only, leitura só para admin)
-- ----------------------------------------------------------------------------
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,                       -- quem fez (auth.uid() no momento)
  action text not null,               -- INSERT / UPDATE / DELETE
  table_name text not null,
  record_id uuid,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_table_record_idx on public.audit_log (table_name, record_id);

alter table public.audit_log enable row level security;

create policy "audit_log: apenas admin lê"
  on public.audit_log for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));
-- Sem insert/update/delete via API: escrita apenas pela trigger abaixo.

create trigger audit_log_immutable
  before update or delete on public.audit_log
  for each row execute function public.forbid_change();

create or replace function public.write_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log (user_id, action, table_name, record_id, old_data, new_data)
  values (
    auth.uid(),
    tg_op,
    tg_table_name,
    coalesce((case when tg_op = 'DELETE' then old.id else new.id end), null),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

-- Auditar as tabelas sensíveis:
create trigger audit_charges
  after insert or update or delete on public.charges
  for each row execute function public.write_audit();

create trigger audit_payments
  after insert or update or delete on public.payments
  for each row execute function public.write_audit();

create trigger audit_accounts
  after update on public.accounts
  for each row execute function public.write_audit();

create trigger audit_cards
  after insert or update or delete on public.cards
  for each row execute function public.write_audit();

create trigger audit_user_roles
  after insert or update or delete on public.user_roles
  for each row execute function public.write_audit();

-- ----------------------------------------------------------------------------
-- 15. ONBOARDING AUTOMÁTICO (novo usuário → profile + role + conta)
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email));

  insert into public.user_roles (user_id, role)
  values (new.id, 'viewer');   -- menor privilégio por padrão; admin promove depois

  insert into public.accounts (user_id, name)
  values (new.id, 'Conta Principal');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
