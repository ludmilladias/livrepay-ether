-- ============================================================================
-- LIVREPAY — Multi-tenant (tenant = marca/cliente-plataforma, ex.: VARKI)
--
-- Contexto: a VARKI passa a ter app próprio sobre o mesmo backend/banco, e a
-- equipe dela precisa operar SÓ os clientes dela. Hoje não existe a ideia de
-- tenant e os papéis admin/compliance (user_roles + has_role) são GLOBAIS.
--
-- Decisões:
--  * Equipe de tenant NÃO usa user_roles/has_role. Fica numa tabela própria
--    (tenant_staff). Assim has_role(), requireRole() e o router /admin (que usa
--    withService em vários pontos) continuam significando "plataforma" e uma
--    linha de tenant_staff nunca vira admin global por acidente.
--  * Autorização no banco (SECURITY DEFINER + guard interno), no mesmo padrão
--    de admin_list_users()/verify_receivable(): nada de policy ampla de staff em
--    tabela de uso pessoal (ver 20260906010000 e 20261006000000).
--  * O tenant do usuário vem do cadastro (profiles.tenant_id), é imutável para
--    qualquer role de aplicação e NUNCA é lido de header/corpo em consulta.
--  * Quem opera a plataforma (admin/compliance globais) continua vendo todos os
--    tenants. Dado existente fica no tenant 'livrepay'.
--
-- Concessão de equipe (manual, como o bootstrap de admin — ninguém se promove):
--   insert into public.tenant_staff (user_id, tenant_id, role)
--   select u.id, t.id, 'admin' from auth.users u, public.tenants t
--    where u.email = 'pessoa@varki.com.br' and t.slug = 'varki';
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. TENANTS
-- ----------------------------------------------------------------------------
create table public.tenants (
  id uuid primary key,
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  name text not null,
  created_at timestamptz not null default now()
);

alter table public.tenants enable row level security;

insert into public.tenants (id, slug, name) values
  ('00000000-0000-4000-8000-000000000001', 'livrepay', 'LivrePay'),
  ('00000000-0000-4000-8000-000000000002', 'varki', 'VARKI');

-- (a política de leitura desta tabela vem depois do profiles.tenant_id existir)

revoke all on public.tenants from public, anon, authenticated, service_role;
grant select on public.tenants to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. profiles.tenant_id (imutável para as roles da aplicação)
-- ----------------------------------------------------------------------------
alter table public.profiles
  add column tenant_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.tenants(id);

create index profiles_tenant_idx on public.profiles (tenant_id);

-- Cada usuário enxerga só o tenant a que pertence (via a própria linha de
-- profiles, que já é isolada por RLS).
create policy "tenants: membro le o proprio"
  on public.tenants for select
  to authenticated
  using (id in (select p.tenant_id from public.profiles p where p.id = auth.uid()));

-- Bloqueia authenticated, anon E service_role: mover alguém de tenant é decisão
-- manual (dono/doadmin), nunca de código de requisição. É o inverso do trigger
-- ether_* (20260906000000), que libera service_role: aqui nem o serviço muda.
create or replace function public.prevent_tenant_change()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.tenant_id is distinct from old.tenant_id
     and current_user in ('authenticated', 'anon', 'service_role') then
    raise exception 'tenant_id não pode ser alterado pela aplicação' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_prevent_tenant_change
  before update on public.profiles
  for each row execute function public.prevent_tenant_change();

-- Novo usuário: tenant vem de raw_user_meta_data.tenant_slug, que só a API grava
-- (a partir da origem do app). Slug desconhecido/ausente cai no tenant padrão.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, tenant_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    coalesce(
      (select t.id from public.tenants t where t.slug = new.raw_user_meta_data ->> 'tenant_slug'),
      '00000000-0000-4000-8000-000000000001'
    )
  );

  insert into public.user_roles (user_id, role)
  values (new.id, 'viewer');   -- menor privilégio por padrão; admin promove depois

  insert into public.accounts (user_id, name)
  values (new.id, 'Conta Principal');

  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. TENANT_STAFF (papel de equipe restrito a UM tenant)
-- ----------------------------------------------------------------------------
create table public.tenant_staff (
  id uuid not null default gen_random_uuid() unique,  -- exigido por write_audit()
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id),
  role text not null check (role in ('admin', 'support', 'compliance')),
  created_at timestamptz not null default now(),
  primary key (user_id, tenant_id, role)
);

alter table public.tenant_staff enable row level security;

create policy "tenant_staff: usuario le os proprios"
  on public.tenant_staff for select
  to authenticated
  using (user_id = auth.uid());

-- Só leitura para a aplicação: concessão/revogação é manual (ver cabeçalho).
revoke all on public.tenant_staff from public, anon, authenticated, service_role;
grant select on public.tenant_staff to authenticated, service_role;

-- A equipe de um tenant tem de PERTENCER a esse tenant (impede dar ao cliente de
-- um tenant poder de operação em outro).
create or replace function public.tenant_staff_same_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles p where p.id = new.user_id and p.tenant_id = new.tenant_id
  ) then
    raise exception 'Usuário não pertence ao tenant informado' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger tenant_staff_same_tenant
  before insert or update on public.tenant_staff
  for each row execute function public.tenant_staff_same_tenant();

-- Concessão/revogação de equipe fica na trilha de auditoria.
create trigger audit_tenant_staff
  after insert or update or delete on public.tenant_staff
  for each row execute function public.write_audit();

-- ----------------------------------------------------------------------------
-- 4. Helpers (privados: só as funções SECURITY DEFINER abaixo os chamam)
-- ----------------------------------------------------------------------------
create or replace function public.require_tenant_staff(_roles text[])
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  _tenant uuid;
begin
  select ts.tenant_id into _tenant
    from public.tenant_staff ts
    join public.profiles p on p.id = ts.user_id and p.tenant_id = ts.tenant_id
   where ts.user_id = auth.uid() and ts.role = any (_roles)
   limit 1;

  if _tenant is null then
    raise exception 'Apenas a equipe do tenant (%) pode fazer isto', array_to_string(_roles, '/')
      using errcode = '42501';
  end if;
  return _tenant;
end;
$$;

-- Equipe de tenant (admin/compliance) pode PRÉ-APROVAR ou RECUSAR um recebível
-- cujo DONO é do mesmo tenant — e nunca o próprio. Pré-aprovar NÃO libera crédito:
-- o crédito exige verified_at, que continua só de admin/compliance da PLATAFORMA
-- (controle duplo: a equipe do tenant analisa, a LivrePay libera).
create or replace function public.tenant_staff_can_review(_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.tenant_staff ts
      join public.profiles me on me.id = ts.user_id and me.tenant_id = ts.tenant_id
      join public.profiles ow on ow.id = _owner and ow.tenant_id = ts.tenant_id
     where ts.user_id = auth.uid()
       and ts.role in ('admin', 'compliance')
       and _owner <> auth.uid()
  );
$$;

revoke all on function public.require_tenant_staff(text[]) from public, anon, authenticated;
revoke all on function public.tenant_staff_can_review(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. Recebíveis: pré-aprovação do tenant, guard e imutabilidade
-- ----------------------------------------------------------------------------
alter table public.receivables
  add column tenant_reviewed_at timestamptz,
  add column tenant_reviewed_by uuid references auth.users(id),
  add constraint receivables_tenant_review_pair
    check ((tenant_reviewed_at is null) = (tenant_reviewed_by is null));

-- verified_*: só admin/compliance da PLATAFORMA (libera crédito).
-- rejected_* e tenant_reviewed_*: plataforma ou equipe do tenant do dono (nunca o próprio).
create or replace function public.guard_receivable_verification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'compliance') then
    return new;
  end if;

  if new.verified_at is distinct from old.verified_at
     or new.verified_by is distinct from old.verified_by then
    raise exception 'Apenas admin/compliance pode alterar a verificação de um recebível';
  end if;

  if (new.rejected_at is distinct from old.rejected_at
      or new.rejected_by is distinct from old.rejected_by
      or new.rejection_reason is distinct from old.rejection_reason
      or new.tenant_reviewed_at is distinct from old.tenant_reviewed_at
      or new.tenant_reviewed_by is distinct from old.tenant_reviewed_by)
     and not public.tenant_staff_can_review(new.user_id) then
    raise exception 'Apenas admin/compliance pode alterar a verificação de um recebível';
  end if;

  return new;
end;
$$;

-- Depois de pré-aprovado ou verificado, o valor/prazo/contrato não muda mais
-- (a policy do dono permite editar enquanto 'scheduled'/'overdue': sem isto,
-- dava para aprovar um valor e trocá-lo depois).
create or replace function public.guard_receivable_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (old.verified_at is not null or old.tenant_reviewed_at is not null)
     and (new.gross_cents is distinct from old.gross_cents
          or new.net_cents is distinct from old.net_cents
          or new.due_date is distinct from old.due_date
          or new.contract_id is distinct from old.contract_id) then
    raise exception 'Recebível já analisado: valor, vencimento e contrato não podem mudar'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger receivables_immutable_after_review
  before update on public.receivables
  for each row execute function public.guard_receivable_immutable();

-- Trilha de auditoria (estado antes/depois, quem, quando).
create trigger audit_receivables
  after insert or update on public.receivables
  for each row execute function public.write_audit();

-- ----------------------------------------------------------------------------
-- 6. Operações do painel de equipe de tenant (todas filtram por tenant no SQL)
-- ----------------------------------------------------------------------------
create or replace function public.tenant_overview()
returns table (
  customers int,
  pending_receivables int,
  payments_30d int,
  payments_30d_cents bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  _tenant uuid := public.require_tenant_staff(array['admin', 'support', 'compliance']);
begin
  return query
    select
      (select count(*)::int from public.profiles p where p.tenant_id = _tenant),
      (select count(*)::int
         from public.receivables r join public.profiles p on p.id = r.user_id
        where p.tenant_id = _tenant and r.status in ('scheduled', 'overdue')
          and r.tenant_reviewed_at is null and r.verified_at is null),
      (select count(*)::int
         from public.payments y join public.profiles p on p.id = y.user_id
        where p.tenant_id = _tenant and y.status = 'completed' and y.executed_at >= now() - interval '30 days'),
      (select coalesce(sum(y.amount_cents), 0)::bigint
         from public.payments y join public.profiles p on p.id = y.user_id
        where p.tenant_id = _tenant and y.status = 'completed' and y.executed_at >= now() - interval '30 days');
end;
$$;

-- Documento mascarado (só os 4 últimos dígitos): a equipe identifica o cliente
-- sem receber o CPF/CNPJ completo (minimização, LGPD).
create or replace function public.tenant_list_customers()
returns table (
  id uuid,
  full_name text,
  email text,
  phone text,
  tax_id_masked text,
  ether_account_status text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  _tenant uuid := public.require_tenant_staff(array['admin', 'support', 'compliance']);
begin
  -- Leitura de PII pela equipe fica registrada (quem, quando, de que tenant).
  insert into public.audit_log (user_id, action, table_name, new_data)
  values (auth.uid(), 'READ', 'profiles',
          jsonb_build_object('view', 'tenant_list_customers', 'tenant_id', _tenant));

  return query
    select p.id, p.full_name, u.email::text, p.phone,
           case when p.tax_id is null then null
                else repeat('*', greatest(length(p.tax_id) - 4, 0)) || right(p.tax_id, 4) end,
           p.ether_account_status,
           p.created_at
      from public.profiles p
      join auth.users u on u.id = p.id
     where p.tenant_id = _tenant
     order by p.created_at desc
     limit 500;
end;
$$;

create or replace function public.tenant_receivables_list()
returns table (
  id uuid,
  user_id uuid,
  gross_cents bigint,
  net_cents bigint,
  due_date date,
  status public.receivable_status,
  created_at timestamptz,
  tenant_reviewed_at timestamptz,
  verified_at timestamptz,
  rejected_at timestamptz,
  rejection_reason text,
  contract_name text,
  contract_acquirer text,
  owner_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  _tenant uuid := public.require_tenant_staff(array['admin', 'compliance']);
begin
  return query
    select r.id, r.user_id, r.gross_cents, r.net_cents, r.due_date, r.status,
           r.created_at, r.tenant_reviewed_at, r.verified_at, r.rejected_at, r.rejection_reason,
           c.name, c.acquirer, p.full_name
      from public.receivables r
      join public.profiles p on p.id = r.user_id and p.tenant_id = _tenant
      left join public.receivable_contracts c on c.id = r.contract_id
     where r.status in ('scheduled', 'overdue')
       and r.user_id <> auth.uid()   -- o próprio não se aprova: outra pessoa da equipe revisa
     order by (r.tenant_reviewed_at is not null), r.due_date asc
     limit 200;
end;
$$;

-- Pré-aprovação: registra a análise da equipe do tenant. NÃO define verified_at, então
-- não libera crédito (advance_receivable): a plataforma ainda precisa verificar.
create or replace function public.tenant_approve_receivable(_receivable_id uuid)
returns public.receivables
language plpgsql
security definer
set search_path = public
as $$
declare
  _tenant uuid := public.require_tenant_staff(array['admin', 'compliance']);
  _row public.receivables%rowtype;
begin
  update public.receivables r
     set tenant_reviewed_at = now(), tenant_reviewed_by = auth.uid()
    from public.profiles p
   where r.id = _receivable_id
     and p.id = r.user_id
     and p.tenant_id = _tenant
     and r.user_id <> auth.uid()
     and r.status in ('scheduled', 'overdue')
     and r.verified_at is null
     and r.tenant_reviewed_at is null
  returning r.* into _row;

  if not found then
    raise exception 'Recebível % não encontrado neste tenant ou não pode mais ser aprovado', _receivable_id;
  end if;
  return _row;
end;
$$;

create or replace function public.tenant_reject_receivable(_receivable_id uuid, _reason text)
returns public.receivables
language plpgsql
security definer
set search_path = public
as $$
declare
  _tenant uuid := public.require_tenant_staff(array['admin', 'compliance']);
  _row public.receivables%rowtype;
begin
  if _reason is null or btrim(_reason) = '' then
    raise exception 'Informe o motivo da recusa';
  end if;

  update public.receivables r
     set status = 'cancelled',
         rejected_at = now(), rejected_by = auth.uid(), rejection_reason = _reason
    from public.profiles p
   where r.id = _receivable_id
     and p.id = r.user_id
     and p.tenant_id = _tenant
     and r.user_id <> auth.uid()
     and r.status in ('scheduled', 'overdue')
     and r.verified_at is null
  returning r.* into _row;

  if not found then
    raise exception 'Recebível % não encontrado neste tenant ou não pode mais ser recusado', _receivable_id;
  end if;
  return _row;
end;
$$;

-- Acompanhamento de pagamentos: sem chave PIX, linha digitável nem documento do
-- destinatário (o painel acompanha andamento, não dados de terceiros).
create or replace function public.tenant_payments_list()
returns table (
  id uuid,
  owner_name text,
  kind public.payment_kind,
  status public.payment_status,
  amount_cents bigint,
  recipient_name text,
  scheduled_for date,
  executed_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  _tenant uuid := public.require_tenant_staff(array['admin', 'support', 'compliance']);
begin
  return query
    select y.id, p.full_name, y.kind, y.status, y.amount_cents, y.recipient_name,
           y.scheduled_for, y.executed_at, y.created_at
      from public.payments y
      join public.profiles p on p.id = y.user_id and p.tenant_id = _tenant
     where y.status <> 'draft'
     order by y.created_at desc
     limit 200;
end;
$$;

revoke all on function public.tenant_overview() from public, anon;
revoke all on function public.tenant_list_customers() from public, anon;
revoke all on function public.tenant_receivables_list() from public, anon;
revoke all on function public.tenant_approve_receivable(uuid) from public, anon;
revoke all on function public.tenant_reject_receivable(uuid, text) from public, anon;
revoke all on function public.tenant_payments_list() from public, anon;
grant execute on function public.tenant_overview() to authenticated;
grant execute on function public.tenant_list_customers() to authenticated;
grant execute on function public.tenant_receivables_list() to authenticated;
grant execute on function public.tenant_approve_receivable(uuid) to authenticated;
grant execute on function public.tenant_reject_receivable(uuid, text) to authenticated;
grant execute on function public.tenant_payments_list() to authenticated;

-- ----------------------------------------------------------------------------
-- 7. Painel da PLATAFORMA: mostra a pré-aprovação do tenant e de qual tenant é
--    (mesmo corpo de admin_receivables_list + duas colunas; o tipo de retorno
--    muda, então a função é recriada).
-- ----------------------------------------------------------------------------
drop function public.admin_receivables_list();

create function public.admin_receivables_list()
returns table (
  id uuid,
  user_id uuid,
  contract_id uuid,
  gross_cents bigint,
  net_cents bigint,
  due_date date,
  status public.receivable_status,
  created_at timestamptz,
  updated_at timestamptz,
  verified_at timestamptz,
  verified_by uuid,
  rejected_at timestamptz,
  rejected_by uuid,
  rejection_reason text,
  contract_name text,
  contract_acquirer text,
  owner_name text,
  tenant_slug text,
  tenant_reviewed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'compliance')) then
    raise exception 'Apenas admin/compliance pode listar recebiveis de todos os usuarios';
  end if;

  return query
    select r.id, r.user_id, r.contract_id, r.gross_cents, r.net_cents, r.due_date, r.status,
           r.created_at, r.updated_at, r.verified_at, r.verified_by,
           r.rejected_at, r.rejected_by, r.rejection_reason,
           c.name as contract_name, c.acquirer as contract_acquirer,
           p.full_name as owner_name,
           t.slug as tenant_slug, r.tenant_reviewed_at
      from public.receivables r
      left join public.receivable_contracts c on c.id = r.contract_id
      left join public.profiles p on p.id = r.user_id
      left join public.tenants t on t.id = p.tenant_id
     where r.status in ('scheduled', 'overdue')
     order by r.verified_at is not null, r.due_date asc
     limit 200;
end;
$$;

revoke all on function public.admin_receivables_list() from public, anon;
grant execute on function public.admin_receivables_list() to authenticated;
