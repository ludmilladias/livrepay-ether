-- ============================================================================
-- LIVREPAY — Fecha lacunas encontradas no diagnóstico de 2026-08-20
--
-- 1) process_transaction('credit', ...) estava concedida a `authenticated`.
--    Como /receivables/:id/advance chamava essa função diretamente sob a role
--    do próprio usuário, qualquer usuário autenticado podia criar um recebível
--    com valor arbitrário e "antecipá-lo" — creditando dinheiro que nunca
--    existiu. Fechamos revogando o EXECUTE de `authenticated` (o débito
--    legítimo continua funcionando: execute_payment() é SECURITY DEFINER e
--    chama process_transaction() com os privilégios do dono da função, não do
--    chamador) e substituindo o crédito de recebível por uma função dedicada
--    que só libera depois de verificação administrativa.
--
-- 2) provider_confirm_charge() creditava o valor que veio no payload do
--    webhook sem comparar com charges.amount_cents. Agora valida e rejeita
--    divergência, reduzindo o dano possível de um segredo de webhook vazado.
--
-- 3) accounts não tinha nenhuma garantia de conta única por usuário, mas todo
--    o código (execute_payment, provider_settle, receivables) assume isso via
--    `order by created_at limit 1`. Tornamos a suposição uma garantia real.
--
-- 4) Grants amplos de DELETE/UPDATE/INSERT em tabelas append-only e
--    admin-only dependiam só de RLS como única camada de defesa. Revogamos
--    de `authenticated` o que só service_role/triggers SECURITY DEFINER
--    deveriam poder fazer.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1a. process_transaction: fecha o caminho de auto-crédito
-- ----------------------------------------------------------------------------
revoke execute on function public.process_transaction(
  uuid, public.transaction_type, bigint, text, text, uuid, jsonb
) from authenticated;
-- Continua acessível a quem já tem privilégio total (dono das funções
-- SECURITY DEFINER que a chamam internamente, como execute_payment()).

-- ----------------------------------------------------------------------------
-- 1b. Recebíveis: verificação administrativa antes de qualquer crédito
-- ----------------------------------------------------------------------------
alter table public.receivables
  add column verified_at timestamptz,
  add column verified_by uuid references auth.users(id);

-- Defesa em camada: mesmo que uma rota futura exponha um PATCH genérico,
-- ninguém além de admin (via verify_receivable) altera estas duas colunas.
create or replace function public.guard_receivable_verification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.verified_at is distinct from old.verified_at
      or new.verified_by is distinct from old.verified_by)
     and not public.has_role(auth.uid(), 'admin') then
    raise exception 'Apenas admin pode alterar a verificação de um recebível';
  end if;
  return new;
end;
$$;

create trigger receivables_guard_verification
  before update on public.receivables
  for each row execute function public.guard_receivable_verification();

-- Admin confirma que o recebível corresponde a um crédito real (contrato,
-- conciliação com adquirente etc. — fora do escopo desta migration, mas o
-- crédito não deve acontecer sem esse passo).
create or replace function public.verify_receivable(_receivable_id uuid)
returns public.receivables
language plpgsql
security definer
set search_path = public
as $$
declare
  _receivable public.receivables%rowtype;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Apenas admin pode verificar recebíveis';
  end if;

  update public.receivables
  set verified_at = now(), verified_by = auth.uid()
  where id = _receivable_id
  returning * into _receivable;

  if not found then
    raise exception 'Recebível % não encontrado', _receivable_id;
  end if;

  return _receivable;
end;
$$;

revoke all on function public.verify_receivable(uuid) from public, anon;
grant execute on function public.verify_receivable(uuid) to authenticated;

-- Substitui a chamada direta a process_transaction('credit', ...) que existia
-- em receivables.js. Só avança recebível já verificado por admin.
create or replace function public.advance_receivable(_receivable_id uuid)
returns public.receivables
language plpgsql
security definer
set search_path = public
as $$
declare
  _receivable public.receivables%rowtype;
  _account_id uuid;
begin
  select * into _receivable
  from public.receivables
  where id = _receivable_id and user_id = auth.uid()
  for update;

  if not found then
    raise exception 'Recebível não encontrado';
  end if;

  if _receivable.status not in ('scheduled', 'overdue') then
    raise exception 'Recebível com status % não pode ser antecipado', _receivable.status;
  end if;

  if _receivable.verified_at is null then
    raise exception 'Recebível ainda não verificado — aguarde a conciliação antes de antecipar';
  end if;

  select id into _account_id
  from public.accounts
  where user_id = auth.uid();

  if _account_id is null then
    raise exception 'Conta não encontrada';
  end if;

  perform public.process_transaction(
    _account_id, 'credit', _receivable.net_cents,
    'Antecipação de recebível', 'receivables', _receivable.id, '{}'::jsonb
  );

  update public.receivables
  set status = 'advanced'
  where id = _receivable_id
  returning * into _receivable;

  return _receivable;
end;
$$;

revoke all on function public.advance_receivable(uuid) from public, anon;
grant execute on function public.advance_receivable(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. provider_confirm_charge: valida o valor liquidado contra o cobrado
-- ----------------------------------------------------------------------------
create or replace function public.provider_confirm_charge(
  _charge_id uuid,
  _paid_amount_cents bigint,
  _provider_status text default null,
  _metadata jsonb default '{}'
)
returns public.charges
language plpgsql
security definer
set search_path = public
as $$
declare
  _charge public.charges%rowtype;
begin
  select * into _charge from public.charges where id = _charge_id for update;
  if not found then
    raise exception 'Cobrança % não encontrada', _charge_id;
  end if;

  if _charge.status = 'paid' then
    return _charge;
  end if;

  if _charge.status = 'cancelled' then
    raise exception 'Cobrança % está cancelada e não pode ser liquidada', _charge_id;
  end if;

  if _paid_amount_cents <> _charge.amount_cents then
    raise exception
      'Valor liquidado (%) diverge do valor cobrado (%) para a cobrança % — liquidação rejeitada',
      _paid_amount_cents, _charge.amount_cents, _charge_id;
  end if;

  perform public.provider_settle(
    _charge.user_id,
    'credit',
    _paid_amount_cents,
    'Recebimento: ' || _charge.description,
    'charges',
    _charge.id,
    _metadata
  );

  update public.charges
  set status = 'paid',
      paid_at = now(),
      provider_status = coalesce(_provider_status, provider_status)
  where id = _charge_id
  returning * into _charge;

  insert into public.alerts (user_id, type, title, description)
  values (
    _charge.user_id,
    'success',
    'Pagamento recebido',
    _charge.description || ' — ' ||
      to_char(_paid_amount_cents / 100.0, 'FM999G999G990D00') || ' creditado'
  );

  return _charge;
end;
$$;

revoke all on function public.provider_confirm_charge(uuid, bigint, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.provider_confirm_charge(uuid, bigint, text, jsonb)
  to service_role;

-- ----------------------------------------------------------------------------
-- 3. Uma conta por usuário — a suposição implícita em execute_payment(),
--    provider_settle() e receivables.js agora é uma garantia do banco.
-- ----------------------------------------------------------------------------
create unique index accounts_one_per_user on public.accounts (user_id);

-- ----------------------------------------------------------------------------
-- 4. Grants mínimos: só quem realmente escreve nessas tabelas pode escrever.
--    Ledger e trilhas de auditoria/eventos nunca são escritos direto por
--    `authenticated` — sempre por função SECURITY DEFINER ou service_role.
-- ----------------------------------------------------------------------------
revoke insert, update, delete on public.transactions from authenticated;
revoke insert, update, delete on public.card_transactions from authenticated;
revoke insert, update, delete on public.audit_log from authenticated;
revoke insert, update, delete on public.provider_events from authenticated;
