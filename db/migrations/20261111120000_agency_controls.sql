-- ============================================================================
-- LIVREPAY — Controles de AGÊNCIA (tenant): suspensão, limites e conciliação
--
-- "Agência" é o nome de produto do tenant (a VARKI é uma agência do LivrePay).
-- No código e no banco o termo continua `tenant`, para não confundir com a
-- agência/conta bancária de TED. A Ether não conhece agência: todos os clientes
-- são clientes do LivrePay lá, então TODO controle abaixo é do nosso lado, no
-- banco (o dinheiro só se move por funções SECURITY DEFINER — ver SECURITY.md).
--
-- Decisões:
--  * Limites em tenant_limits; NULL = sem limite (comportamento anterior).
--    Exposição = soma do líquido dos recebíveis 'advanced' da agência; antecipação
--    diária = créditos de recebível do dia (fuso de São Paulo). A checagem roda
--    dentro de advance_receivable() sob lock da agência (sem corrida entre dois
--    clientes estourando o teto ao mesmo tempo).
--  * Suspensão bloqueia o que SAI ou ANTECIPA (execute_payment/advance_receivable),
--    a equipe do tenant e o login (API). Crédito já confirmado pelo provedor NÃO é
--    bloqueado: o dinheiro já entrou na Ether e precisa ser registrado.
--  * Conciliação é derivada de profiles.tenant_id (imutável): evita mexer no
--    ledger append-only e não cria um segundo lugar onde o tenant possa divergir.
--  * 'livrepay' (a plataforma) nunca é suspenso.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Status da agência
-- ----------------------------------------------------------------------------
alter table public.tenants
  add column status text not null default 'active' check (status in ('active', 'suspended')),
  add column suspended_at timestamptz,
  add column suspended_reason text,
  add constraint tenants_suspension_pair check ((status = 'suspended') = (suspended_at is not null)),
  add constraint tenants_platform_never_suspended check (slug <> 'livrepay' or status = 'active');

create trigger audit_tenants
  after update on public.tenants
  for each row execute function public.write_audit();

-- ----------------------------------------------------------------------------
-- 2. Limites (NULL = sem limite). Só funções SECURITY DEFINER leem/escrevem.
-- ----------------------------------------------------------------------------
create table public.tenant_limits (
  id uuid not null default gen_random_uuid() unique,   -- exigido por write_audit()
  tenant_id uuid primary key references public.tenants(id),
  max_receivable_cents bigint check (max_receivable_cents is null or max_receivable_cents > 0),
  max_exposure_cents bigint check (max_exposure_cents is null or max_exposure_cents > 0),
  max_daily_advance_cents bigint check (max_daily_advance_cents is null or max_daily_advance_cents > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

alter table public.tenant_limits enable row level security;
revoke all on public.tenant_limits from public, anon, authenticated, service_role;

insert into public.tenant_limits (tenant_id)
select id from public.tenants;

create trigger audit_tenant_limits
  after insert or update on public.tenant_limits
  for each row execute function public.write_audit();

-- ----------------------------------------------------------------------------
-- 3. Guardas internas (privadas)
-- ----------------------------------------------------------------------------
-- Barra qualquer operação de quem pertence a uma agência suspensa. Devolve o tenant.
create or replace function public.assert_tenant_operational(_user uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  _tenant uuid;
  _status text;
begin
  select t.id, t.status into _tenant, _status
    from public.profiles p join public.tenants t on t.id = p.tenant_id
   where p.id = _user;

  if _status = 'suspended' then
    raise exception 'Agência suspensa: operação bloqueada';
  end if;
  return _tenant;
end;
$$;

-- Verifica limites da agência para antecipar este recebível. Serializa por agência.
create or replace function public.assert_advance_allowed(_receivable public.receivables)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _tenant uuid := public.assert_tenant_operational(_receivable.user_id);
  _l public.tenant_limits%rowtype;
  _exposure bigint;
  _today bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('advance:' || _tenant::text, 0));

  select * into _l from public.tenant_limits where tenant_id = _tenant;

  if _l.max_receivable_cents is not null and _receivable.net_cents > _l.max_receivable_cents then
    raise exception 'Limite da agência: valor do recebível acima do permitido';
  end if;

  if _l.max_exposure_cents is not null then
    select coalesce(sum(r.net_cents), 0) into _exposure
      from public.receivables r join public.profiles p on p.id = r.user_id
     where p.tenant_id = _tenant and r.status = 'advanced';
    if _exposure + _receivable.net_cents > _l.max_exposure_cents then
      raise exception 'Limite da agência: exposição total antecipada atingida';
    end if;
  end if;

  if _l.max_daily_advance_cents is not null then
    select coalesce(sum(x.amount_cents), 0) into _today
      from public.transactions x join public.profiles p on p.id = x.user_id
     where p.tenant_id = _tenant and x.type = 'credit' and x.reference_table = 'receivables'
       and (x.created_at at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date;
    if _today + _receivable.net_cents > _l.max_daily_advance_cents then
      raise exception 'Limite da agência: antecipação diária atingida';
    end if;
  end if;
end;
$$;

revoke all on function public.assert_tenant_operational(uuid) from public, anon, authenticated;
revoke all on function public.assert_advance_allowed(public.receivables) from public, anon, authenticated;

-- Métricas de conciliação de uma agência (base dos relatórios abaixo).
create or replace function public.tenant_metrics(_tenant uuid)
returns table (
  customers int,
  balance_cents bigint,
  credits_30d_cents bigint,
  debits_30d_cents bigint,
  advanced_exposure_cents bigint,
  advanced_today_cents bigint,
  pending_receivables int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*)::int from public.profiles p where p.tenant_id = _tenant),
    (select coalesce(sum(a.balance_cents), 0)::bigint
       from public.accounts a join public.profiles p on p.id = a.user_id where p.tenant_id = _tenant),
    (select coalesce(sum(x.amount_cents), 0)::bigint
       from public.transactions x join public.profiles p on p.id = x.user_id
      where p.tenant_id = _tenant and x.type = 'credit' and x.created_at >= now() - interval '30 days'),
    (select coalesce(sum(x.amount_cents), 0)::bigint
       from public.transactions x join public.profiles p on p.id = x.user_id
      where p.tenant_id = _tenant and x.type = 'debit' and x.created_at >= now() - interval '30 days'),
    (select coalesce(sum(r.net_cents), 0)::bigint
       from public.receivables r join public.profiles p on p.id = r.user_id
      where p.tenant_id = _tenant and r.status = 'advanced'),
    (select coalesce(sum(x.amount_cents), 0)::bigint
       from public.transactions x join public.profiles p on p.id = x.user_id
      where p.tenant_id = _tenant and x.type = 'credit' and x.reference_table = 'receivables'
        and (x.created_at at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date),
    (select count(*)::int
       from public.receivables r join public.profiles p on p.id = r.user_id
      where p.tenant_id = _tenant and r.status in ('scheduled', 'overdue') and r.verified_at is null);
$$;

revoke all on function public.tenant_metrics(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. Aplicação nos caminhos de dinheiro: antecipar e pagar
-- ----------------------------------------------------------------------------
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

  -- Agência suspensa e limites (valor, exposição, dia).
  perform public.assert_advance_allowed(_receivable);

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

  -- Agência suspensa não paga.
  perform public.assert_tenant_operational(auth.uid());

  select id into _account_id
  from public.accounts
  where user_id = auth.uid()
  order by created_at
  limit 1;

  if _account_id is null then
    raise exception 'Conta de origem não encontrada';
  end if;

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

-- A equipe de uma agência suspensa também não opera (exige tenant ativo).
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
    join public.tenants t on t.id = ts.tenant_id and t.status = 'active'
   where ts.user_id = auth.uid() and ts.role = any (_roles)
   limit 1;

  if _tenant is null then
    raise exception 'Apenas a equipe do tenant (%) pode fazer isto', array_to_string(_roles, '/')
      using errcode = '42501';
  end if;
  return _tenant;
end;
$$;

-- A pré-aprovação também respeita o limite por recebível da agência.
create or replace function public.tenant_approve_receivable(_receivable_id uuid)
returns public.receivables
language plpgsql
security definer
set search_path = public
as $$
declare
  _tenant uuid := public.require_tenant_staff(array['admin', 'compliance']);
  _max bigint;
  _row public.receivables%rowtype;
begin
  select max_receivable_cents into _max from public.tenant_limits where tenant_id = _tenant;

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
     and (_max is null or r.net_cents <= _max)
  returning r.* into _row;

  if not found then
    raise exception 'Recebível % não encontrado neste tenant, acima do limite da agência ou não pode mais ser aprovado', _receivable_id;
  end if;
  return _row;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Painel da PLATAFORMA (admin/compliance globais)
-- ----------------------------------------------------------------------------
create or replace function public.admin_tenants_overview()
returns table (
  slug text,
  name text,
  status text,
  suspended_at timestamptz,
  suspended_reason text,
  customers int,
  balance_cents bigint,
  credits_30d_cents bigint,
  debits_30d_cents bigint,
  advanced_exposure_cents bigint,
  advanced_today_cents bigint,
  pending_receivables int,
  max_receivable_cents bigint,
  max_exposure_cents bigint,
  max_daily_advance_cents bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'compliance')) then
    raise exception 'Apenas admin/compliance pode ver as agências' using errcode = '42501';
  end if;

  return query
    select t.slug, t.name, t.status, t.suspended_at, t.suspended_reason,
           m.customers, m.balance_cents, m.credits_30d_cents, m.debits_30d_cents,
           m.advanced_exposure_cents, m.advanced_today_cents, m.pending_receivables,
           l.max_receivable_cents, l.max_exposure_cents, l.max_daily_advance_cents
      from public.tenants t
      left join public.tenant_limits l on l.tenant_id = t.id
      cross join lateral public.tenant_metrics(t.id) m
     order by (t.slug = 'livrepay') desc, t.name;
end;
$$;

create or replace function public.admin_tenant_daily_movement(_slug text)
returns table (day date, credits_cents bigint, debits_cents bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  _tenant uuid;
begin
  if not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'compliance')) then
    raise exception 'Apenas admin/compliance pode ver as agências' using errcode = '42501';
  end if;
  select id into _tenant from public.tenants where slug = _slug;
  if _tenant is null then
    raise exception 'Agência não encontrada';
  end if;

  return query
    select gs.day::date,
           coalesce(sum(x.amount_cents) filter (where x.type = 'credit'), 0)::bigint,
           coalesce(sum(x.amount_cents) filter (where x.type = 'debit'), 0)::bigint
      from generate_series(
             (now() at time zone 'America/Sao_Paulo')::date - 29,
             (now() at time zone 'America/Sao_Paulo')::date,
             interval '1 day') as gs(day)
      left join public.transactions x
        on (x.created_at at time zone 'America/Sao_Paulo')::date = gs.day::date
       and x.user_id in (select p.id from public.profiles p where p.tenant_id = _tenant)
     group by gs.day
     order by gs.day;
end;
$$;

create or replace function public.admin_set_tenant_limits(
  _slug text, _max_receivable bigint, _max_exposure bigint, _max_daily bigint
)
returns public.tenant_limits
language plpgsql
security definer
set search_path = public
as $$
declare
  _row public.tenant_limits%rowtype;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Apenas admin pode alterar limites de agência' using errcode = '42501';
  end if;

  update public.tenant_limits l
     set max_receivable_cents = _max_receivable,
         max_exposure_cents = _max_exposure,
         max_daily_advance_cents = _max_daily,
         updated_at = now(), updated_by = auth.uid()
    from public.tenants t
   where t.id = l.tenant_id and t.slug = _slug
  returning l.* into _row;

  if not found then
    raise exception 'Agência não encontrada';
  end if;
  return _row;
end;
$$;

-- Suspende/reativa. Suspender também derruba as sessões (refresh tokens) da agência;
-- tokens de acesso já emitidos valem poucos minutos e as operações de dinheiro já barram.
create or replace function public.admin_set_tenant_status(_slug text, _status text, _reason text)
returns public.tenants
language plpgsql
security definer
set search_path = public
as $$
declare
  _row public.tenants%rowtype;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Apenas admin pode suspender ou reativar uma agência' using errcode = '42501';
  end if;
  if _status not in ('active', 'suspended') then
    raise exception 'Status inválido';
  end if;
  if _slug = 'livrepay' then
    raise exception 'A plataforma não pode ser suspensa';
  end if;
  if _status = 'suspended' and (_reason is null or btrim(_reason) = '') then
    raise exception 'Informe o motivo da suspensão';
  end if;

  update public.tenants
     set status = _status,
         suspended_at = case when _status = 'suspended' then now() end,
         suspended_reason = case when _status = 'suspended' then btrim(_reason) end
   where slug = _slug
  returning * into _row;

  if not found then
    raise exception 'Agência não encontrada';
  end if;

  if _status = 'suspended' then
    update auth.refresh_tokens set revoked_at = now()
     where revoked_at is null
       and user_id in (select p.id from public.profiles p where p.tenant_id = _row.id);
  end if;
  return _row;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. Painel da EQUIPE da agência: seu saldo, movimento e uso dos limites
-- ----------------------------------------------------------------------------
create or replace function public.tenant_agency_status()
returns table (
  name text,
  customers int,
  balance_cents bigint,
  credits_30d_cents bigint,
  debits_30d_cents bigint,
  advanced_exposure_cents bigint,
  advanced_today_cents bigint,
  max_receivable_cents bigint,
  max_exposure_cents bigint,
  max_daily_advance_cents bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  _tenant uuid := public.require_tenant_staff(array['admin', 'support', 'compliance']);
begin
  return query
    select t.name, m.customers, m.balance_cents, m.credits_30d_cents, m.debits_30d_cents,
           m.advanced_exposure_cents, m.advanced_today_cents,
           l.max_receivable_cents, l.max_exposure_cents, l.max_daily_advance_cents
      from public.tenants t
      left join public.tenant_limits l on l.tenant_id = t.id
      cross join lateral public.tenant_metrics(t.id) m
     where t.id = _tenant;
end;
$$;

create or replace function public.tenant_daily_movement()
returns table (day date, credits_cents bigint, debits_cents bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  _tenant uuid := public.require_tenant_staff(array['admin', 'support', 'compliance']);
begin
  return query
    select gs.day::date,
           coalesce(sum(x.amount_cents) filter (where x.type = 'credit'), 0)::bigint,
           coalesce(sum(x.amount_cents) filter (where x.type = 'debit'), 0)::bigint
      from generate_series(
             (now() at time zone 'America/Sao_Paulo')::date - 29,
             (now() at time zone 'America/Sao_Paulo')::date,
             interval '1 day') as gs(day)
      left join public.transactions x
        on (x.created_at at time zone 'America/Sao_Paulo')::date = gs.day::date
       and x.user_id in (select p.id from public.profiles p where p.tenant_id = _tenant)
     group by gs.day
     order by gs.day;
end;
$$;

revoke all on function public.admin_tenants_overview() from public, anon;
revoke all on function public.admin_tenant_daily_movement(text) from public, anon;
revoke all on function public.admin_set_tenant_limits(text, bigint, bigint, bigint) from public, anon;
revoke all on function public.admin_set_tenant_status(text, text, text) from public, anon;
revoke all on function public.tenant_agency_status() from public, anon;
revoke all on function public.tenant_daily_movement() from public, anon;
grant execute on function public.admin_tenants_overview() to authenticated;
grant execute on function public.admin_tenant_daily_movement(text) to authenticated;
grant execute on function public.admin_set_tenant_limits(text, bigint, bigint, bigint) to authenticated;
grant execute on function public.admin_set_tenant_status(text, text, text) to authenticated;
grant execute on function public.tenant_agency_status() to authenticated;
grant execute on function public.tenant_daily_movement() to authenticated;
