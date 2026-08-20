-- ============================================================================
-- LIVREPAY — Integração com provedor bancário externo (inicialmente: Ether)
--
-- Princípio de segurança: o provedor credita/debita via Edge Function rodando
-- com service_role. O cliente autenticado NUNCA pode invocar essas funções —
-- por isso o EXECUTE é revogado de authenticated/anon e concedido só a
-- service_role. Sem isso, um usuário chamaria a RPC pelo PostgREST e se
-- creditaria à vontade.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Referências do provedor nas cobranças
-- ----------------------------------------------------------------------------
alter table public.charges
  add column provider text,               -- 'ether'
  add column provider_charge_id text,     -- id da cobrança no provedor
  add column provider_status text,        -- status bruto devolvido pelo provedor
  add column emitted_at timestamptz,
  add column paid_at timestamptz;

-- Evita processar a mesma cobrança do provedor duas vezes.
create unique index charges_provider_ref_key
  on public.charges (provider, provider_charge_id)
  where provider_charge_id is not null;

-- ----------------------------------------------------------------------------
-- 2. Eventos recebidos do provedor (idempotência + auditoria de entrada)
-- ----------------------------------------------------------------------------
create table public.provider_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,          -- id do evento no provedor
  event_type text not null,        -- pix.deposit.confirmed, pix.withdraw.failed, ...
  payload jsonb not null,
  processed_at timestamptz,
  error text,
  received_at timestamptz not null default clock_timestamp(),
  -- Chave de idempotência: reentrega do mesmo evento não reprocessa.
  unique (provider, event_id)
);

create index provider_events_unprocessed_idx
  on public.provider_events (received_at)
  where processed_at is null;

alter table public.provider_events enable row level security;

-- Só admin lê; escrita exclusiva do service_role (Edge Function).
create policy "provider_events: apenas admin le"
  on public.provider_events for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- Payload recebido é evidência: não pode ser alterado nem apagado.
create trigger provider_events_immutable_payload
  before delete on public.provider_events
  for each row execute function public.forbid_change();

-- ----------------------------------------------------------------------------
-- 3. Crédito/débito originado do provedor (somente service_role)
-- ----------------------------------------------------------------------------
create or replace function public.provider_settle(
  _user_id uuid,
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

  -- Conta principal do usuário, com lock (serializa liquidações concorrentes).
  select * into _account
  from public.accounts
  where user_id = _user_id
  order by created_at
  limit 1
  for update;

  if not found then
    raise exception 'Conta não encontrada para o usuário %', _user_id;
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
    (_account.id, _user_id, _type, _amount_cents,
     _account.balance_cents, _new_balance,
     _description, _reference_table, _reference_id, coalesce(_metadata, '{}'))
  returning * into _tx;

  update public.accounts
  set balance_cents = _new_balance
  where id = _account.id;

  return _tx;
end;
$$;

-- Barreira crítica: cliente logado não pode invocar esta função.
revoke all on function public.provider_settle(uuid, public.transaction_type, bigint, text, text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.provider_settle(uuid, public.transaction_type, bigint, text, text, uuid, jsonb)
  to service_role;

-- ----------------------------------------------------------------------------
-- 4. Liquidação de cobrança confirmada pelo provedor (idempotente)
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

  -- Idempotência: reentrega do webhook não credita duas vezes.
  if _charge.status = 'paid' then
    return _charge;
  end if;

  if _charge.status = 'cancelled' then
    raise exception 'Cobrança % está cancelada e não pode ser liquidada', _charge_id;
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
