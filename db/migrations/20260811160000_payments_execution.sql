-- ============================================================================
-- LIVREPAY — Execução de pagamentos (saída de dinheiro)
--
-- Ciclo de vida do dinheiro:
--   draft/scheduled --execute_payment()--> processing   (saldo JÁ debitado)
--        processing --provider_complete_payment()-----> completed
--        processing --provider_fail_payment()---------> failed (saldo ESTORNADO)
--
-- Debitamos ANTES de acionar o provedor, de propósito: se debitássemos só na
-- confirmação, o usuário poderia disparar N pagamentos com saldo para um só
-- (double-spend). O preço é precisar estornar quando o provedor recusa — que é
-- exatamente o que provider_fail_payment faz.
-- ============================================================================

create type public.batch_status as enum
  ('draft', 'processing', 'completed', 'failed', 'cancelled');

-- ----------------------------------------------------------------------------
-- 1. Lotes de pagamento (folha)
-- ----------------------------------------------------------------------------
create table public.payment_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  status public.batch_status not null default 'draft',
  executed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.payment_batches enable row level security;

create trigger payment_batches_updated_at
  before update on public.payment_batches
  for each row execute function public.set_updated_at();

create policy "payment_batches: usuário lê os próprios"
  on public.payment_batches for select
  to authenticated
  using (user_id = auth.uid());

create policy "payment_batches: usuário cria os próprios"
  on public.payment_batches for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "payment_batches: usuário edita rascunhos"
  on public.payment_batches for update
  to authenticated
  using (user_id = auth.uid() and status = 'draft')
  with check (user_id = auth.uid());

alter table public.payments
  add column batch_id uuid references public.payment_batches(id) on delete set null,
  add column provider text,
  add column provider_payment_id text,
  add column provider_status text,
  add column failure_reason text;

create index payments_batch_idx on public.payments (batch_id) where batch_id is not null;

create unique index payments_provider_ref_key
  on public.payments (provider, provider_payment_id)
  where provider_payment_id is not null;

create trigger audit_payment_batches
  after insert or update or delete on public.payment_batches
  for each row execute function public.write_audit();

-- ----------------------------------------------------------------------------
-- 2. Execução de um pagamento (debita e trava para envio ao provedor)
-- ----------------------------------------------------------------------------
create or replace function public.execute_payment(_payment_id uuid)
returns public.payments
language plpgsql
security definer
set search_path = public
as $$
declare
  _payment public.payments%rowtype;
  _account_id uuid;
begin
  -- Lock pessimista: dois cliques simultâneos no botão "Pagar" são serializados;
  -- o segundo enxerga o status já alterado e não debita de novo.
  select * into _payment
  from public.payments
  where id = _payment_id and user_id = auth.uid()
  for update;

  if not found then
    raise exception 'Pagamento não encontrado ou sem permissão';
  end if;

  -- Idempotência: reentrada em pagamento já processado não move dinheiro.
  if _payment.status in ('processing', 'completed') then
    return _payment;
  end if;

  if _payment.status <> 'draft' and _payment.status <> 'scheduled' then
    raise exception 'Pagamento com status % não pode ser executado', _payment.status;
  end if;

  select id into _account_id
  from public.accounts
  where user_id = auth.uid()
  order by created_at
  limit 1;

  if _account_id is null then
    raise exception 'Conta de origem não encontrada';
  end if;

  -- Debita. process_transaction valida saldo, trava a conta e grava o ledger.
  -- Se o saldo for insuficiente, a exceção aborta tudo (nada é debitado nem
  -- muda de status), porque estamos na mesma transação.
  perform public.process_transaction(
    _account_id,
    'debit',
    _payment.amount_cents,
    'Pagamento: ' || coalesce(_payment.recipient_name, _payment.kind::text),
    'payments',
    _payment.id,
    jsonb_build_object('payment_kind', _payment.kind)
  );

  update public.payments
  set status = 'processing',
      executed_at = now()
  where id = _payment_id
  returning * into _payment;

  return _payment;
end;
$$;

revoke all on function public.execute_payment(uuid) from public, anon;
grant execute on function public.execute_payment(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Execução de lote (folha) — tudo ou nada
-- ----------------------------------------------------------------------------
create or replace function public.execute_payment_batch(_batch_id uuid)
returns public.payment_batches
language plpgsql
security definer
set search_path = public
as $$
declare
  _batch public.payment_batches%rowtype;
  _payment public.payments%rowtype;
  _count int := 0;
begin
  select * into _batch
  from public.payment_batches
  where id = _batch_id and user_id = auth.uid()
  for update;

  if not found then
    raise exception 'Lote não encontrado ou sem permissão';
  end if;

  if _batch.status in ('processing', 'completed') then
    return _batch;  -- idempotente
  end if;

  if _batch.status <> 'draft' then
    raise exception 'Lote com status % não pode ser executado', _batch.status;
  end if;

  -- Um lançamento por pagamento (rastreabilidade individual por beneficiário).
  -- Se qualquer um falhar — inclusive por saldo insuficiente no meio do lote —
  -- a exceção desfaz o lote inteiro. Folha não pode pagar "metade".
  for _payment in
    select * from public.payments
    where batch_id = _batch_id and status in ('draft', 'scheduled')
    order by created_at
  loop
    perform public.execute_payment(_payment.id);
    _count := _count + 1;
  end loop;

  if _count = 0 then
    raise exception 'Lote não possui pagamentos pendentes';
  end if;

  update public.payment_batches
  set status = 'processing', executed_at = now()
  where id = _batch_id
  returning * into _batch;

  return _batch;
end;
$$;

revoke all on function public.execute_payment_batch(uuid) from public, anon;
grant execute on function public.execute_payment_batch(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Conclusão pelo provedor (service_role)
-- ----------------------------------------------------------------------------
create or replace function public.provider_complete_payment(
  _payment_id uuid,
  _provider_payment_id text default null,
  _provider_status text default null
)
returns public.payments
language plpgsql
security definer
set search_path = public
as $$
declare _payment public.payments%rowtype;
begin
  select * into _payment from public.payments where id = _payment_id for update;
  if not found then
    raise exception 'Pagamento % não encontrado', _payment_id;
  end if;

  if _payment.status = 'completed' then
    return _payment;  -- reentrega do webhook
  end if;

  if _payment.status <> 'processing' then
    raise exception 'Pagamento % não está em processamento (status %)',
      _payment_id, _payment.status;
  end if;

  update public.payments
  set status = 'completed',
      provider_payment_id = coalesce(_provider_payment_id, provider_payment_id),
      provider_status = coalesce(_provider_status, provider_status)
  where id = _payment_id
  returning * into _payment;

  return _payment;
end;
$$;

revoke all on function public.provider_complete_payment(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.provider_complete_payment(uuid, text, text) to service_role;

-- ----------------------------------------------------------------------------
-- 5. Falha no provedor → ESTORNO obrigatório (service_role)
-- ----------------------------------------------------------------------------
create or replace function public.provider_fail_payment(
  _payment_id uuid,
  _reason text
)
returns public.payments
language plpgsql
security definer
set search_path = public
as $$
declare _payment public.payments%rowtype;
begin
  select * into _payment from public.payments where id = _payment_id for update;
  if not found then
    raise exception 'Pagamento % não encontrado', _payment_id;
  end if;

  if _payment.status = 'failed' then
    return _payment;  -- estorno já feito; não estornar duas vezes
  end if;

  if _payment.status <> 'processing' then
    raise exception 'Só pagamento em processamento pode falhar (status atual: %)',
      _payment.status;
  end if;

  -- Devolve o valor debitado na execução. O ledger fica com os dois lançamentos
  -- (débito + crédito), preservando o histórico do que aconteceu.
  perform public.provider_settle(
    _payment.user_id,
    'credit',
    _payment.amount_cents,
    'Estorno de pagamento: ' || coalesce(_payment.recipient_name, _payment.kind::text),
    'payments',
    _payment.id,
    jsonb_build_object('reason', _reason, 'refund', true)
  );

  update public.payments
  set status = 'failed', failure_reason = _reason
  where id = _payment_id
  returning * into _payment;

  insert into public.alerts (user_id, type, title, description)
  values (
    _payment.user_id,
    'urgent',
    'Pagamento não concluído',
    coalesce(_payment.recipient_name, 'Pagamento') ||
      ' falhou e o valor foi estornado. Motivo: ' || _reason
  );

  return _payment;
end;
$$;

revoke all on function public.provider_fail_payment(uuid, text)
  from public, anon, authenticated;
grant execute on function public.provider_fail_payment(uuid, text) to service_role;
