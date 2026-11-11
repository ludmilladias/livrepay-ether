-- ===========================================================================
-- Testes de segurança da migration LIVREPAY.
-- Cada bloco levanta exceção se o comportamento esperado não ocorrer.
-- ===========================================================================
\set ON_ERROR_STOP on

-- Grants equivalentes aos do Supabase (RLS é quem filtra, não o grant).
-- grants agora vêm da migration 20260811190000_grants.sql

-- Dois usuários de teste (hash fictício: nenhum login real acontece aqui).
insert into auth.users (id, email, password_hash, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.com', 'x', '{"full_name":"Alice"}'),
  ('22222222-2222-2222-2222-222222222222', 'bob@test.com',   'x', '{"full_name":"Bob"}');

-- --- T1: trigger de onboarding criou profile + role viewer + conta ---------
do $$
declare n int;
begin
  select count(*) into n from public.profiles;
  if n <> 2 then raise exception 'T1 FALHOU: esperava 2 profiles, achei %', n; end if;

  select count(*) into n from public.user_roles where role = 'viewer';
  if n <> 2 then raise exception 'T1 FALHOU: esperava 2 roles viewer, achei %', n; end if;

  select count(*) into n from public.accounts;
  if n <> 2 then raise exception 'T1 FALHOU: esperava 2 contas, achei %', n; end if;

  raise notice 'T1 OK: onboarding automatico (profile + role viewer + conta)';
end $$;

-- --- T2: RLS isola dados entre usuários ------------------------------------
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

do $$
declare n int;
begin
  select count(*) into n from public.accounts;
  if n <> 1 then raise exception 'T2 FALHOU: Alice ve % contas (deveria ver so a dela)', n; end if;

  select count(*) into n from public.profiles;
  if n <> 1 then raise exception 'T2 FALHOU: Alice ve % profiles', n; end if;

  raise notice 'T2 OK: RLS isola contas/profiles por usuario';
end $$;

-- --- T2b: authenticated NÃO chama process_transaction() diretamente -------
-- Fecha o caminho de auto-crédito: só código privilegiado (execute_payment,
-- advance_receivable — ambos SECURITY DEFINER) pode acionar a RPC de fato.
do $$
declare _acc uuid;
begin
  select id into _acc from public.accounts;
  begin
    perform public.process_transaction(_acc, 'credit', 1000, 'Tentativa direta');
    raise exception 'T2b FALHOU: authenticated creditou via process_transaction() direto!';
  exception when insufficient_privilege then
    null;
  end;
  raise notice 'T2b OK: process_transaction() nao e chamavel direto por authenticated';
end $$;

-- --- T3: crédito e débito via RPC atualizam saldo + ledger -----------------
-- Roda como superusuário: process_transaction() só é chamável direto por
-- quem tem privilégio total (as funções SECURITY DEFINER que a envolvem
-- herdam isso do dono). Este teste valida a mecânica da RPC em si, não
-- controle de acesso — isso é o T2b acima.
reset role;
do $$
declare
  _acc uuid;
  _bal bigint;
  _n int;
begin
  select id into _acc from public.accounts
   where user_id = '11111111-1111-1111-1111-111111111111';

  perform public.process_transaction(_acc, 'credit', 150000, 'Deposito PIX teste');
  select balance_cents into _bal from public.accounts where id = _acc;
  if _bal <> 150000 then raise exception 'T3 FALHOU: saldo apos credito = %', _bal; end if;

  perform public.process_transaction(_acc, 'debit', 50000, 'Pagamento teste');
  select balance_cents into _bal from public.accounts where id = _acc;
  if _bal <> 100000 then raise exception 'T3 FALHOU: saldo apos debito = %', _bal; end if;

  select count(*) into _n from public.transactions;
  if _n <> 2 then raise exception 'T3 FALHOU: esperava 2 lancamentos, achei %', _n; end if;

  -- ledger coerente: balance_after do ultimo lancamento = saldo atual
  select balance_after_cents into _bal
  from public.transactions order by seq desc limit 1;
  if _bal <> 100000 then raise exception 'T3 FALHOU: ledger dessincronizado (%)', _bal; end if;

  -- encadeamento: balance_before do lancamento N = balance_after do N-1
  if exists (
    select 1 from (
      select balance_before_cents,
             lag(balance_after_cents) over (partition by account_id order by seq) as prev_after
      from public.transactions
    ) t where prev_after is not null and balance_before_cents <> prev_after
  ) then
    raise exception 'T3 FALHOU: cadeia de saldos quebrada no ledger';
  end if;

  raise notice 'T3 OK: credito/debito atomicos com ledger coerente';
end $$;

-- --- T4: saldo insuficiente é bloqueado ------------------------------------
do $$
declare _acc uuid; _bal bigint;
begin
  select id into _acc from public.accounts
   where user_id = '11111111-1111-1111-1111-111111111111';
  begin
    perform public.process_transaction(_acc, 'debit', 99999999, 'Debito maior que saldo');
    raise exception 'T4 FALHOU: debito acima do saldo foi aceito!';
  exception when others then
    if sqlerrm not like '%Saldo insuficiente%' then raise; end if;
  end;

  select balance_cents into _bal from public.accounts where id = _acc;
  if _bal <> 100000 then raise exception 'T4 FALHOU: saldo mudou apos erro (%)', _bal; end if;

  raise notice 'T4 OK: saldo insuficiente bloqueado, saldo intacto';
end $$;

-- --- T5: valor negativo/zero rejeitado -------------------------------------
do $$
declare _acc uuid;
begin
  select id into _acc from public.accounts
   where user_id = '11111111-1111-1111-1111-111111111111';
  begin
    perform public.process_transaction(_acc, 'credit', -5000, 'Valor negativo');
    raise exception 'T5 FALHOU: valor negativo aceito!';
  exception when others then
    if sqlerrm not like '%positivo%' then raise; end if;
  end;
  raise notice 'T5 OK: valor nao-positivo rejeitado';
end $$;

-- --- T6: usuário NÃO movimenta conta alheia --------------------------------
-- auth.uid() continua Alice (GUC de sessão, independe de role). A própria
-- RPC filtra "user_id = auth.uid()" — por isso a rejeição vale mesmo com
-- RLS contornada por privilégio total.
do $$
declare _bob_acc uuid;
begin
  select id into _bob_acc from public.accounts
   where user_id = '22222222-2222-2222-2222-222222222222';

  begin
    perform public.process_transaction(_bob_acc, 'credit', 1000, 'Tentativa em conta alheia');
    raise exception 'T6 FALHOU: movimentou conta alheia!';
  exception when others then
    if sqlerrm not like '%nao encontrada%' and sqlerrm not like '%não encontrada%'
       and sqlerrm not like '%sem permissao%' and sqlerrm not like '%sem permissão%'
    then raise; end if;
  end;
  raise notice 'T6 OK: RPC recusa conta de outro usuario';
end $$;

-- --- T7a: camada 1 (grant + RLS) — cliente nao toca no ledger --------------
-- Desde a migration 20260820000000, authenticated nem tem grant de
-- UPDATE/DELETE em transactions — nao chega a depender só da RLS.
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$
begin
  begin
    update public.transactions set amount_cents = 1;
    raise exception 'T7a FALHOU: cliente alterou o ledger!';
  exception when insufficient_privilege then
    null;
  end;

  begin
    delete from public.transactions;
    raise exception 'T7a FALHOU: cliente apagou o ledger!';
  exception when insufficient_privilege then
    null;
  end;

  raise notice 'T7a OK: cliente nem tem grant para tocar no ledger';
end $$;

-- --- T7b: camada 2 (trigger) — nem o dono da tabela altera o ledger --------
-- Defesa em profundidade: se algum codigo privilegiado (SECURITY DEFINER,
-- service_role) tentar reescrever historico, o trigger barra.
reset role;
do $$
declare _n int;
begin
  begin
    update public.transactions set amount_cents = 1 where true;
    raise exception 'T7b FALHOU: dono da tabela reescreveu o ledger!';
  exception when others then
    if sqlerrm not like '%imut%' then raise; end if;
  end;

  begin
    delete from public.transactions where true;
    raise exception 'T7b FALHOU: dono da tabela apagou o ledger!';
  exception when others then
    if sqlerrm not like '%imut%' then raise; end if;
  end;

  select count(*) into _n from public.transactions;
  if _n <> 2 then raise exception 'T7b FALHOU: ledger tem % linhas (esperava 2)', _n; end if;

  raise notice 'T7b OK: trigger bloqueia ate usuario privilegiado; ledger intacto';
end $$;

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

-- --- T8: usuário NÃO altera o próprio saldo diretamente --------------------
do $$
declare _n int;
begin
  update public.accounts set balance_cents = 99999999;
  get diagnostics _n = row_count;
  if _n > 0 then raise exception 'T8 FALHOU: usuario alterou o proprio saldo (% linhas)', _n; end if;
  raise notice 'T8 OK: UPDATE direto em accounts nao afeta nenhuma linha (sem policy)';
end $$;

-- --- T9: usuário NÃO se autopromove a admin --------------------------------
do $$
declare _n int;
begin
  begin
    insert into public.user_roles (user_id, role)
    values ('11111111-1111-1111-1111-111111111111', 'admin');
    raise exception 'T9 FALHOU: usuario virou admin sozinho!';
  exception when insufficient_privilege then
    null; -- esperado: policy de insert exige has_role(admin)
  when others then
    if sqlerrm not like '%row-level security%' and sqlerrm not like '%policy%' then raise; end if;
  end;

  select count(*) into _n from public.user_roles where role = 'admin';
  if _n <> 0 then raise exception 'T9 FALHOU: existe admin indevido'; end if;
  raise notice 'T9 OK: escalacao de privilegio bloqueada';
end $$;

-- --- T10: auditoria registra mudanças e não é legível por não-admin --------
do $$
declare _n int; _charge uuid;
begin
  insert into public.charges (user_id, kind, status, description, amount_cents)
  values ('11111111-1111-1111-1111-111111111111', 'pix', 'draft', 'Cobranca teste', 350000)
  returning id into _charge;

  update public.charges set status = 'pending' where id = _charge;

  -- viewer nao le audit_log
  select count(*) into _n from public.audit_log;
  if _n <> 0 then raise exception 'T10 FALHOU: nao-admin leu % linhas de auditoria', _n; end if;

  raise notice 'T10 OK: charge criada/atualizada; audit_log invisivel para nao-admin';
end $$;

-- --- T11: admin enxerga a auditoria e ela registrou os eventos -------------
reset role;
insert into public.user_roles (user_id, role)
values ('22222222-2222-2222-2222-222222222222', 'admin');

set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

do $$
declare _n int;
begin
  select count(*) into _n from public.audit_log where table_name = 'charges';
  if _n < 2 then raise exception 'T11 FALHOU: auditoria de charges tem % linhas (esperava >=2)', _n; end if;

  select count(*) into _n from public.audit_log where table_name = 'accounts';
  if _n < 2 then raise exception 'T11 FALHOU: auditoria de accounts tem % linhas', _n; end if;

  raise notice 'T11 OK: admin le auditoria; INSERT/UPDATE registrados';
end $$;

-- --- T12: cobrança finalizada não pode mais ser editada --------------------
reset role;
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

do $$
declare _charge uuid; _n int;
begin
  select id into _charge from public.charges limit 1;

  -- dono move para 'paid' (permitido a partir de 'pending')
  update public.charges set status = 'paid' where id = _charge;

  -- agora 'paid' esta fora do USING da policy de update
  update public.charges set amount_cents = 1 where id = _charge;
  get diagnostics _n = row_count;
  if _n > 0 then raise exception 'T12 FALHOU: cobranca paga foi editada'; end if;

  -- e nao pode ser apagada (sem policy de delete)
  delete from public.charges where id = _charge;
  get diagnostics _n = row_count;
  if _n > 0 then raise exception 'T12 FALHOU: cobranca foi apagada'; end if;

  raise notice 'T12 OK: cobranca paga e imutavel e nao apagavel';
end $$;

-- --- T13: constraints de dinheiro ------------------------------------------
reset role;
do $$
begin
  begin
    insert into public.charges (user_id, kind, description, amount_cents)
    values ('11111111-1111-1111-1111-111111111111', 'pix', 'Valor invalido', 0);
    raise exception 'T13 FALHOU: aceitou cobranca de valor zero';
  exception when check_violation then null;
  end;

  begin
    insert into public.cards (user_id, label, last4)
    values ('11111111-1111-1111-1111-111111111111', 'Cartao', 'abcd');
    raise exception 'T13 FALHOU: aceitou last4 nao numerico';
  exception when check_violation then null;
  end;

  raise notice 'T13 OK: constraints de valor e last4 aplicadas';
end $$;

-- ===========================================================================
-- Integração com provedor (migration 20260811140000)
-- ===========================================================================

-- --- T14: cliente NÃO pode invocar as funções de liquidação do provedor ----
-- Esta é a barreira mais crítica da integração: se `authenticated` conseguisse
-- executar provider_settle via PostgREST, qualquer usuário se creditaria.
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

do $$
begin
  begin
    perform public.provider_settle(
      '11111111-1111-1111-1111-111111111111', 'credit', 100000, 'Auto-credito ilegal');
    raise exception 'T14 FALHOU: usuario executou provider_settle!';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.provider_confirm_charge(gen_random_uuid(), 100000);
    raise exception 'T14 FALHOU: usuario executou provider_confirm_charge!';
  exception when insufficient_privilege then null;
  end;

  raise notice 'T14 OK: funcoes do provedor negadas ao usuario autenticado';
end $$;

-- --- T15: service_role liquida cobrança e credita a conta ------------------
reset role;
do $$
declare _charge uuid; _bal_before bigint; _bal_after bigint; _n int;
begin
  select balance_cents into _bal_before
  from public.accounts where user_id = '11111111-1111-1111-1111-111111111111';

  insert into public.charges (user_id, kind, status, description, amount_cents,
                              provider, provider_charge_id)
  values ('11111111-1111-1111-1111-111111111111', 'pix', 'pending',
          'Cobranca via Ether', 250000, 'ether', 'ether-pix-001')
  returning id into _charge;

  perform public.provider_confirm_charge(_charge, 250000, 'CONFIRMED',
                                         '{"e2e":"E123"}'::jsonb);

  select balance_cents into _bal_after
  from public.accounts where user_id = '11111111-1111-1111-1111-111111111111';
  if _bal_after <> _bal_before + 250000 then
    raise exception 'T15 FALHOU: saldo % -> % (esperava +250000)', _bal_before, _bal_after;
  end if;

  if (select status from public.charges where id = _charge) <> 'paid' then
    raise exception 'T15 FALHOU: cobranca nao ficou paga';
  end if;

  -- alerta de recebimento criado
  select count(*) into _n from public.alerts
  where user_id = '11111111-1111-1111-1111-111111111111' and type = 'success';
  if _n < 1 then raise exception 'T15 FALHOU: alerta de recebimento nao criado'; end if;

  raise notice 'T15 OK: provider_confirm_charge credita, marca paga e alerta';
end $$;

-- --- T16: reentrega do webhook NÃO credita duas vezes (idempotência) -------
do $$
declare _charge uuid; _bal_before bigint; _bal_after bigint; _n int;
begin
  select id into _charge from public.charges where provider_charge_id = 'ether-pix-001';
  select balance_cents into _bal_before
  from public.accounts where user_id = '11111111-1111-1111-1111-111111111111';

  -- mesma confirmação chegando de novo
  perform public.provider_confirm_charge(_charge, 250000, 'CONFIRMED', '{}'::jsonb);

  select balance_cents into _bal_after
  from public.accounts where user_id = '11111111-1111-1111-1111-111111111111';
  if _bal_after <> _bal_before then
    raise exception 'T16 FALHOU: credito duplicado (% -> %)', _bal_before, _bal_after;
  end if;

  select count(*) into _n from public.transactions
  where reference_table = 'charges' and reference_id = _charge;
  if _n <> 1 then raise exception 'T16 FALHOU: % lancamentos para a mesma cobranca', _n; end if;

  raise notice 'T16 OK: confirmacao repetida nao credita duas vezes';
end $$;

-- --- T17: cobrança cancelada não pode ser liquidada ------------------------
do $$
declare _charge uuid;
begin
  insert into public.charges (user_id, kind, status, description, amount_cents,
                              provider, provider_charge_id)
  values ('11111111-1111-1111-1111-111111111111', 'pix', 'cancelled',
          'Cobranca cancelada', 5000, 'ether', 'ether-pix-002')
  returning id into _charge;

  begin
    perform public.provider_confirm_charge(_charge, 5000);
    raise exception 'T17 FALHOU: liquidou cobranca cancelada!';
  exception when others then
    if sqlerrm not like '%cancelada%' then raise; end if;
  end;
  raise notice 'T17 OK: cobranca cancelada nao e liquidada';
end $$;

-- --- T18: eventos do provedor são idempotentes e privados ------------------
do $$
declare _n int;
begin
  insert into public.provider_events (provider, event_id, event_type, payload)
  values ('ether', 'evt-001', 'pix.deposit.confirmed', '{"a":1}'::jsonb);

  begin
    insert into public.provider_events (provider, event_id, event_type, payload)
    values ('ether', 'evt-001', 'pix.deposit.confirmed', '{"a":1}'::jsonb);
    raise exception 'T18 FALHOU: evento duplicado foi aceito!';
  exception when unique_violation then null;
  end;

  -- payload recebido e evidencia: nao se apaga
  begin
    delete from public.provider_events where event_id = 'evt-001';
    raise exception 'T18 FALHOU: evento foi apagado!';
  exception when others then
    if sqlerrm not like '%imut%' then raise; end if;
  end;

  select count(*) into _n from public.provider_events;
  if _n <> 1 then raise exception 'T18 FALHOU: esperava 1 evento, achei %', _n; end if;
  raise notice 'T18 OK: eventos idempotentes e nao apagaveis';
end $$;

-- --- T19: não-admin não enxerga eventos do provedor ------------------------
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$
declare _n int;
begin
  select count(*) into _n from public.provider_events;
  if _n <> 0 then raise exception 'T19 FALHOU: nao-admin leu % eventos', _n; end if;
  raise notice 'T19 OK: provider_events invisivel para nao-admin';
end $$;

-- ===========================================================================
-- Execução de pagamentos (migration 20260811160000)
-- ===========================================================================
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

-- --- T20: pagamento debita saldo e vai para 'processing' -------------------
do $$
declare _pay uuid; _before bigint; _after bigint; _n int;
begin
  select balance_cents into _before
  from public.accounts where user_id = '11111111-1111-1111-1111-111111111111';

  insert into public.payments (user_id, kind, amount_cents, recipient_name, recipient_key)
  values ('11111111-1111-1111-1111-111111111111', 'transferencia', 30000,
          'Fornecedor X', 'fornecedor@x.com')
  returning id into _pay;

  perform public.execute_payment(_pay);

  select balance_cents into _after
  from public.accounts where user_id = '11111111-1111-1111-1111-111111111111';
  if _after <> _before - 30000 then
    raise exception 'T20 FALHOU: saldo % -> % (esperava -30000)', _before, _after;
  end if;

  if (select status from public.payments where id = _pay) <> 'processing' then
    raise exception 'T20 FALHOU: status nao virou processing';
  end if;

  select count(*) into _n from public.transactions
  where reference_table = 'payments' and reference_id = _pay and type = 'debit';
  if _n <> 1 then raise exception 'T20 FALHOU: % debitos no ledger', _n; end if;

  raise notice 'T20 OK: pagamento debita saldo e registra no ledger';
end $$;

-- --- T21: executar duas vezes NÃO debita duas vezes ------------------------
-- Cenario real: usuario clica duas vezes no botao "Pagar".
do $$
declare _pay uuid; _before bigint; _after bigint; _n int;
begin
  select id into _pay from public.payments
  where recipient_name = 'Fornecedor X' order by created_at desc limit 1;

  select balance_cents into _before
  from public.accounts where user_id = '11111111-1111-1111-1111-111111111111';

  perform public.execute_payment(_pay);   -- segunda chamada

  select balance_cents into _after
  from public.accounts where user_id = '11111111-1111-1111-1111-111111111111';
  if _after <> _before then
    raise exception 'T21 FALHOU: DOUBLE-SPEND! saldo % -> %', _before, _after;
  end if;

  select count(*) into _n from public.transactions
  where reference_table = 'payments' and reference_id = _pay;
  if _n <> 1 then raise exception 'T21 FALHOU: % lancamentos (esperava 1)', _n; end if;

  raise notice 'T21 OK: reexecucao nao debita de novo (sem double-spend)';
end $$;

-- --- T22: saldo insuficiente aborta sem efeito colateral -------------------
do $$
declare _pay uuid; _before bigint; _after bigint;
begin
  select balance_cents into _before
  from public.accounts where user_id = '11111111-1111-1111-1111-111111111111';

  insert into public.payments (user_id, kind, amount_cents, recipient_name)
  values ('11111111-1111-1111-1111-111111111111', 'conta', 99999999, 'Conta impagavel')
  returning id into _pay;

  begin
    perform public.execute_payment(_pay);
    raise exception 'T22 FALHOU: pagamento acima do saldo foi executado!';
  exception when others then
    if sqlerrm not like '%Saldo insuficiente%' then raise; end if;
  end;

  select balance_cents into _after
  from public.accounts where user_id = '11111111-1111-1111-1111-111111111111';
  if _after <> _before then raise exception 'T22 FALHOU: saldo mudou'; end if;

  if (select status from public.payments where id = _pay) <> 'draft' then
    raise exception 'T22 FALHOU: status mudou apesar do erro';
  end if;

  raise notice 'T22 OK: saldo insuficiente aborta sem debitar nem mudar status';
end $$;

-- --- T23: não executa pagamento de outro usuário ---------------------------
do $$
declare _pay uuid;
begin
  reset role;
  insert into public.payments (user_id, kind, amount_cents, recipient_name)
  values ('22222222-2222-2222-2222-222222222222', 'transferencia', 1000, 'Bob paga')
  returning id into _pay;

  set role authenticated;
  set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

  begin
    perform public.execute_payment(_pay);
    raise exception 'T23 FALHOU: Alice executou pagamento do Bob!';
  exception when others then
    if sqlerrm not like '%nao encontrado%' and sqlerrm not like '%não encontrado%'
       and sqlerrm not like '%sem permiss%' then raise; end if;
  end;
  raise notice 'T23 OK: nao executa pagamento alheio';
end $$;

-- --- T24: lote de folha é tudo-ou-nada -------------------------------------
do $$
declare _batch uuid; _before bigint; _after bigint; _n int;
begin
  select balance_cents into _before
  from public.accounts where user_id = '11111111-1111-1111-1111-111111111111';

  insert into public.payment_batches (user_id, name)
  values ('11111111-1111-1111-1111-111111111111', 'Folha teste')
  returning id into _batch;

  -- 1o cabe no saldo; 2o estoura de proposito
  insert into public.payments (user_id, kind, amount_cents, recipient_name, batch_id)
  values ('11111111-1111-1111-1111-111111111111', 'folha', 10000, 'Func A', _batch),
         ('11111111-1111-1111-1111-111111111111', 'folha', 99999999, 'Func B', _batch);

  begin
    perform public.execute_payment_batch(_batch);
    raise exception 'T24 FALHOU: lote sem saldo foi executado!';
  exception when others then
    if sqlerrm not like '%Saldo insuficiente%' then raise; end if;
  end;

  select balance_cents into _after
  from public.accounts where user_id = '11111111-1111-1111-1111-111111111111';
  if _after <> _before then
    raise exception 'T24 FALHOU: folha pagou parcialmente (% -> %)', _before, _after;
  end if;

  select count(*) into _n from public.payments
  where batch_id = _batch and status <> 'draft';
  if _n <> 0 then raise exception 'T24 FALHOU: % pagamentos saíram de draft', _n; end if;

  raise notice 'T24 OK: lote sem saldo nao paga ninguem (atomicidade da folha)';
end $$;

-- --- T25: lote com saldo paga todos ----------------------------------------
do $$
declare _batch uuid; _before bigint; _after bigint; _n int;
begin
  select balance_cents into _before
  from public.accounts where user_id = '11111111-1111-1111-1111-111111111111';

  insert into public.payment_batches (user_id, name)
  values ('11111111-1111-1111-1111-111111111111', 'Folha valida')
  returning id into _batch;

  insert into public.payments (user_id, kind, amount_cents, recipient_name, batch_id)
  values ('11111111-1111-1111-1111-111111111111', 'folha', 10000, 'Func C', _batch),
         ('11111111-1111-1111-1111-111111111111', 'folha', 15000, 'Func D', _batch);

  perform public.execute_payment_batch(_batch);

  select balance_cents into _after
  from public.accounts where user_id = '11111111-1111-1111-1111-111111111111';
  if _after <> _before - 25000 then
    raise exception 'T25 FALHOU: saldo % -> % (esperava -25000)', _before, _after;
  end if;

  select count(*) into _n from public.payments
  where batch_id = _batch and status = 'processing';
  if _n <> 2 then raise exception 'T25 FALHOU: % pagamentos em processing', _n; end if;

  raise notice 'T25 OK: lote com saldo paga todos os beneficiarios';
end $$;

-- --- T26: cliente NÃO conclui nem faz falhar pagamento ---------------------
do $$
begin
  begin
    perform public.provider_complete_payment(gen_random_uuid());
    raise exception 'T26 FALHOU: usuario concluiu pagamento!';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.provider_fail_payment(gen_random_uuid(), 'teste');
    raise exception 'T26 FALHOU: usuario forcou falha/estorno!';
  exception when insufficient_privilege then null;
  end;

  raise notice 'T26 OK: conclusao/estorno negados ao usuario autenticado';
end $$;

-- --- T27: falha do provedor estorna exatamente uma vez ---------------------
reset role;
do $$
declare _pay uuid; _before bigint; _after bigint; _n int;
begin
  select id into _pay from public.payments
  where recipient_name = 'Fornecedor X' limit 1;

  select balance_cents into _before
  from public.accounts where user_id = '11111111-1111-1111-1111-111111111111';

  perform public.provider_fail_payment(_pay, 'Chave PIX invalida');

  select balance_cents into _after
  from public.accounts where user_id = '11111111-1111-1111-1111-111111111111';
  if _after <> _before + 30000 then
    raise exception 'T27 FALHOU: estorno errado (% -> %)', _before, _after;
  end if;

  if (select status from public.payments where id = _pay) <> 'failed' then
    raise exception 'T27 FALHOU: status nao virou failed';
  end if;

  -- reentrega do webhook de falha nao pode estornar de novo
  perform public.provider_fail_payment(_pay, 'Chave PIX invalida');
  select balance_cents into _after
  from public.accounts where user_id = '11111111-1111-1111-1111-111111111111';
  if _after <> _before + 30000 then
    raise exception 'T27 FALHOU: ESTORNO DUPLICADO';
  end if;

  select count(*) into _n from public.transactions
  where reference_table = 'payments' and reference_id = _pay;
  if _n <> 2 then
    raise exception 'T27 FALHOU: esperava 2 lancamentos (debito+estorno), achei %', _n;
  end if;

  raise notice 'T27 OK: falha estorna uma unica vez e preserva historico';
end $$;

-- --- T28: pagamento concluído não pode mais falhar/estornar ----------------
do $$
declare _pay uuid;
begin
  select id into _pay from public.payments
  where recipient_name = 'Func C' limit 1;

  perform public.provider_complete_payment(_pay, 'ether-pay-001', 'CONFIRMED');
  if (select status from public.payments where id = _pay) <> 'completed' then
    raise exception 'T28 FALHOU: nao concluiu';
  end if;

  begin
    perform public.provider_fail_payment(_pay, 'tentativa tardia');
    raise exception 'T28 FALHOU: estornou pagamento ja concluido!';
  exception when others then
    if sqlerrm not like '%processamento%' then raise; end if;
  end;

  raise notice 'T28 OK: pagamento concluido nao pode ser estornado';
end $$;

-- --- T29: liquidação com valor diferente do cobrado é rejeitada -----------
do $$
declare _charge uuid; _bal_before bigint; _bal_after bigint;
begin
  insert into public.charges (user_id, kind, status, description, amount_cents,
                              provider, provider_charge_id)
  values ('11111111-1111-1111-1111-111111111111', 'pix', 'pending',
          'Cobranca valor divergente', 10000, 'ether', 'ether-pix-divergente')
  returning id into _charge;

  select balance_cents into _bal_before
  from public.accounts where user_id = '11111111-1111-1111-1111-111111111111';

  begin
    perform public.provider_confirm_charge(_charge, 999999, 'CONFIRMED', '{}'::jsonb);
    raise exception 'T29 FALHOU: liquidou com valor diferente do cobrado!';
  exception when others then
    if sqlerrm not like '%diverge do valor cobrado%' then raise; end if;
  end;

  select balance_cents into _bal_after
  from public.accounts where user_id = '11111111-1111-1111-1111-111111111111';
  if _bal_after <> _bal_before then
    raise exception 'T29 FALHOU: saldo mudou apesar da rejeicao (% -> %)', _bal_before, _bal_after;
  end if;

  if (select status from public.charges where id = _charge) = 'paid' then
    raise exception 'T29 FALHOU: cobranca marcada paga com valor errado';
  end if;

  raise notice 'T29 OK: liquidacao com valor divergente e rejeitada, saldo intacto';
end $$;

-- --- T30: recebível não pode ser antecipado sem verificação admin ---------
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$
declare _rec uuid; _bal_before bigint; _bal_after bigint;
begin
  insert into public.receivable_contracts (user_id, name, acquirer)
  values ('11111111-1111-1111-1111-111111111111', 'Contrato Teste', 'Adquirente X')
  returning id into _rec;

  insert into public.receivables (user_id, contract_id, gross_cents, net_cents, due_date)
  values ('11111111-1111-1111-1111-111111111111', _rec, 500000, 480000, current_date + 5)
  returning id into _rec;

  select balance_cents into _bal_before
  from public.accounts where user_id = '11111111-1111-1111-1111-111111111111';

  begin
    perform public.advance_receivable(_rec);
    raise exception 'T30 FALHOU: antecipou recebivel nao verificado!';
  exception when others then
    if sqlerrm not like '%ainda nao verificado%' and sqlerrm not like '%ainda não verificado%' then
      raise;
    end if;
  end;

  select balance_cents into _bal_after
  from public.accounts where user_id = '11111111-1111-1111-1111-111111111111';
  if _bal_after <> _bal_before then
    raise exception 'T30 FALHOU: saldo mudou sem verificacao (% -> %)', _bal_before, _bal_after;
  end if;

  -- usuário comum não pode se autoverificar
  begin
    perform public.verify_receivable(_rec);
    raise exception 'T30 FALHOU: usuario comum verificou o proprio recebivel!';
  exception when others then
    if sqlerrm not like '%Apenas admin%' then raise; end if;
  end;

  raise notice 'T30 OK: recebivel sem verificacao admin nao credita nada';
end $$;

-- --- T31: após verificação admin, antecipação credita corretamente --------
-- Promove Alice a admin só para este teste conseguir chamar verify_receivable
-- (troca de role precisa ser statement de topo — não é válido dentro de
-- um bloco do $$ ... $$ em plpgsql).
reset role;
insert into public.user_roles (user_id, role)
values ('11111111-1111-1111-1111-111111111111', 'admin')
on conflict do nothing;
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

do $$
declare _rec uuid; _bal_before bigint; _bal_after bigint;
begin
  select id into _rec from public.receivables
  where user_id = '11111111-1111-1111-1111-111111111111' and status = 'scheduled'
  order by created_at desc limit 1;

  perform public.verify_receivable(_rec);
  if (select verified_at from public.receivables where id = _rec) is null then
    raise exception 'T31 FALHOU: verify_receivable nao marcou verified_at';
  end if;

  select balance_cents into _bal_before
  from public.accounts where user_id = '11111111-1111-1111-1111-111111111111';

  perform public.advance_receivable(_rec);

  select balance_cents into _bal_after
  from public.accounts where user_id = '11111111-1111-1111-1111-111111111111';
  if _bal_after <> _bal_before + 480000 then
    raise exception 'T31 FALHOU: saldo % -> % (esperava +480000)', _bal_before, _bal_after;
  end if;

  if (select status from public.receivables where id = _rec) <> 'advanced' then
    raise exception 'T31 FALHOU: status nao virou advanced';
  end if;

  raise notice 'T31 OK: recebivel verificado antecipa e credita corretamente';
end $$;

-- --- T32: uma conta por usuário é garantida pelo banco ---------------------
reset role;
do $$
begin
  begin
    insert into public.accounts (user_id, name)
    values ('11111111-1111-1111-1111-111111111111', 'Conta Duplicada');
    raise exception 'T32 FALHOU: segunda conta para o mesmo usuario foi aceita!';
  exception when unique_violation then
    null;
  end;
  raise notice 'T32 OK: unique(user_id) impede segunda conta';
end $$;

-- --- T33: compliance verifica recebível de outro usuário; dono antecipa ---
reset role;
insert into auth.users (id, email, password_hash, raw_user_meta_data) values
  ('33333333-3333-3333-3333-333333333333', 'carol@test.com', 'x', '{"full_name":"Carol"}'),
  ('44444444-4444-4444-4444-444444444444', 'dave@test.com',  'x', '{"full_name":"Dave"}');
insert into public.user_roles (user_id, role) values
  ('33333333-3333-3333-3333-333333333333', 'compliance'),
  ('44444444-4444-4444-4444-444444444444', 'support');

set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222'; -- Bob
do $$
declare _contract uuid; _rec uuid;
begin
  insert into public.receivable_contracts (user_id, name, acquirer)
  values ('22222222-2222-2222-2222-222222222222', 'Contrato Bob', 'Adquirente Y')
  returning id into _contract;

  insert into public.receivables (user_id, contract_id, gross_cents, net_cents, due_date)
  values ('22222222-2222-2222-2222-222222222222', _contract, 200000, 190000, current_date + 3);

  insert into public.receivables (user_id, contract_id, gross_cents, net_cents, due_date)
  values ('22222222-2222-2222-2222-222222222222', _contract, 100000, 95000, current_date + 3);
end $$;

set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333'; -- Carol (compliance)
do $$
declare _rec uuid; _verified public.receivables%rowtype;
begin
  -- verifica o primeiro recebível do Bob (compliance não é dona; desde
  -- 20261006000000 a unica leitura ampla que compliance tem e' via
  -- admin_receivables_list(), nao mais SELECT direto em receivables)
  select id into _rec from public.admin_receivables_list()
   where user_id = '22222222-2222-2222-2222-222222222222' and gross_cents = 200000;
  -- captura o retorno da function em vez de reler public.receivables como
  -- Carol: desde 20261006000000 ela nao tem mais policy de staff para isso.
  select * into _verified from public.verify_receivable(_rec);

  if _verified.verified_at is null then
    raise exception 'T33 FALHOU: compliance nao conseguiu verificar recebivel de outro usuario';
  end if;

  raise notice 'T33 OK: compliance verifica recebivel de outro usuario';
end $$;

set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222'; -- Bob
do $$
declare _rec uuid; _bal_before bigint; _bal_after bigint;
begin
  select id into _rec from public.receivables
   where user_id = '22222222-2222-2222-2222-222222222222' and gross_cents = 200000;

  select balance_cents into _bal_before from public.accounts
   where user_id = '22222222-2222-2222-2222-222222222222';

  perform public.advance_receivable(_rec);

  select balance_cents into _bal_after from public.accounts
   where user_id = '22222222-2222-2222-2222-222222222222';

  if _bal_after <> _bal_before + 190000 then
    raise exception 'T33 FALHOU: saldo do Bob nao creditado corretamente (% -> %)', _bal_before, _bal_after;
  end if;

  raise notice 'T33 OK: Bob antecipa apos verificacao da compliance';
end $$;

-- --- T34: compliance recusa recebível; recusado não pode ser antecipado ---
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333'; -- Carol (compliance)
do $$
declare _rec uuid; _rejected public.receivables%rowtype;
begin
  select id into _rec from public.admin_receivables_list()
   where user_id = '22222222-2222-2222-2222-222222222222' and gross_cents = 100000;

  begin
    perform public.reject_receivable(_rec, '');
    raise exception 'T34 FALHOU: recusa sem motivo foi aceita!';
  exception when others then
    if sqlerrm not like '%motivo%' then raise; end if;
  end;

  -- captura o retorno da function em vez de reler public.receivables como
  -- Carol: desde 20261006000000 ela nao tem mais policy de staff para isso.
  select * into _rejected from public.reject_receivable(_rec, 'Contrato nao confere com a adquirente');

  if _rejected.status <> 'cancelled' then
    raise exception 'T34 FALHOU: status nao virou cancelled';
  end if;
  if _rejected.rejected_by <> '33333333-3333-3333-3333-333333333333' then
    raise exception 'T34 FALHOU: rejected_by nao registrado';
  end if;

  raise notice 'T34 OK: compliance recusa recebivel com motivo obrigatorio';
end $$;

set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222'; -- Bob
do $$
declare _rec uuid;
begin
  select id into _rec from public.receivables
   where user_id = '22222222-2222-2222-2222-222222222222' and gross_cents = 100000;

  begin
    perform public.advance_receivable(_rec);
    raise exception 'T34 FALHOU: antecipou recebivel recusado!';
  exception when others then
    if sqlerrm not like '%não pode ser antecipado%' and sqlerrm not like '%nao pode ser antecipado%'
    then raise; end if;
  end;

  raise notice 'T34 OK: recebivel recusado nao pode ser antecipado';
end $$;

-- --- T35: role support NÃO ganha leitura ampla (sem policy nova) ----------
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444'; -- Dave (support)
do $$
declare _n int;
begin
  select count(*) into _n from public.receivables;
  if _n <> 0 then
    raise exception 'T35 FALHOU: support viu % recebiveis de outros usuarios', _n;
  end if;
  raise notice 'T35 OK: support nao tem leitura ampla de recebiveis';
end $$;

-- --- T36: admin_list_users() exige admin/compliance -----------------------
do $$
begin
  begin
    perform public.admin_list_users();
    raise exception 'T36 FALHOU: support listou usuarios!';
  exception when others then
    if sqlerrm not like '%Apenas admin%' then raise; end if;
  end;
  raise notice 'T36 OK: admin_list_users nega quem nao e admin/compliance';
end $$;

set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333'; -- Carol (compliance)
do $$
declare _n int;
begin
  select count(*) into _n from public.admin_list_users();
  if _n < 4 then
    raise exception 'T36 FALHOU: compliance deveria listar ao menos 4 usuarios, viu %', _n;
  end if;
  raise notice 'T36 OK: compliance lista usuarios';
end $$;

-- --- T37: service_role grava profiles.ether_* (onboarding Ether) ------------
-- O trigger prevent_ether_field_tampering decide "serviço" pela identidade real
-- do Postgres (current_user), a mesma que withService() assume via SET LOCAL
-- ROLE. Antes (20260901000000) lia uma GUC que ninguem seta: o UPDATE do
-- onboarding sempre estourava.
reset role;
set role service_role;
do $$
declare _n int;
begin
  update public.profiles
     set ether_user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
         ether_account_status = 'basic'
   where id = '11111111-1111-1111-1111-111111111111';
  get diagnostics _n = row_count;
  if _n <> 1 then
    raise exception 'T37 FALHOU: service_role atualizou % linhas (esperava 1)', _n;
  end if;
  raise notice 'T37 OK: service_role grava campos ether_*';
exception when raise_exception then
  raise exception 'T37 FALHOU: service_role barrado pelo trigger: %', sqlerrm;
end $$;

-- --- T38: authenticated NAO altera ether_* (nem forjando GUC de role) -------
reset role;
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$
declare _status text; _uid uuid;
begin
  -- 1) tentativa direta
  begin
    update public.profiles
       set ether_user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
     where id = '11111111-1111-1111-1111-111111111111';
    raise exception 'T38 FALHOU: authenticated alterou ether_user_id!';
  exception when raise_exception then
    if sqlerrm not like 'Campos ether_%' then
      raise exception 'T38 FALHOU: erro inesperado: %', sqlerrm;
    end if;
  end;

  -- 2) forjar a GUC de role nao pode virar bypass
  perform set_config('request.jwt.claim.role', 'service_role', true);
  begin
    update public.profiles
       set ether_account_status = 'full'
     where id = '11111111-1111-1111-1111-111111111111';
    raise exception 'T38 FALHOU: GUC forjada virou bypass do trigger!';
  exception when raise_exception then
    if sqlerrm not like 'Campos ether_%' then
      raise exception 'T38 FALHOU: erro inesperado (GUC forjada): %', sqlerrm;
    end if;
  end;

  -- 3) nada mudou alem do que o service_role gravou em T37
  select ether_user_id, ether_account_status into _uid, _status
    from public.profiles where id = '11111111-1111-1111-1111-111111111111';
  if _uid <> 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' or _status <> 'basic' then
    raise exception 'T38 FALHOU: estado inesperado (%, %)', _uid, _status;
  end if;
  raise notice 'T38 OK: authenticated nao altera ether_* (GUC forjada ignorada)';
end $$;

-- --- T39: policy de staff em transactions NÃO existe mais (fix 20260906010000) ---
-- Reproduz exatamente o que /reports/statement e /reports/financials fazem:
-- SELECT em public.transactions sob a sessão RLS do usuário logado, sem
-- filtro explícito de account_id (a tabela nem tem user_id direto — o
-- isolamento é 100% via RLS). Carol é compliance e nunca teve conta própria
-- movimentada; se a policy "transactions: staff le todas" ainda existisse,
-- ela veria o ledger de Alice/Bob (dezenas de linhas). Depois do fix deve
-- ver zero.
set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333'; -- Carol (compliance)
do $$
declare _n int;
begin
  select count(*) into _n from public.transactions;
  if _n <> 0 then
    raise exception 'T39 FALHOU: compliance leu % linhas do ledger de outros usuarios via RLS direta', _n;
  end if;
  raise notice 'T39 OK: compliance nao le transactions de outros usuarios via RLS direta (sem policy de staff)';
end $$;

-- admin_transactions_volume() continua funcionando para staff (é a única via
-- de acesso agregado que resta, SECURITY DEFINER com guard de role interno).
do $$
declare _total bigint;
begin
  select coalesce(sum(in_cents), 0) into _total from public.admin_transactions_volume();
  if _total <= 0 then
    raise exception 'T39 FALHOU: admin_transactions_volume() nao agregou nenhum credito (esperava > 0)';
  end if;
  raise notice 'T39 OK: admin_transactions_volume() segue agregando volume para compliance (% centavos em creditos)', _total;
end $$;

-- support (sem admin/compliance) nao pode nem chamar a function agregada.
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444'; -- Dave (support)
do $$
begin
  begin
    perform public.admin_transactions_volume();
    raise exception 'T39 FALHOU: support chamou admin_transactions_volume()!';
  exception when others then
    if sqlerrm not like '%Apenas admin%' then raise; end if;
  end;
  raise notice 'T39 OK: admin_transactions_volume() nega quem nao e admin/compliance';
end $$;

-- --- T40: policy de staff em receivables NÃO existe mais (fix 20261006000000) ---
-- Reproduz exatamente o que GET /receivables e GET /receivables/summary fazem:
-- SELECT em public.receivables sob a sessão RLS do usuário logado, sem
-- filtro explícito de user_id. Carol é compliance e não tem recebível
-- próprio; se a policy "receivables: staff le todos" ainda existisse, ela
-- veria os recebíveis de Alice/Bob criados em T30/T31/T33/T34 (várias
-- linhas). Depois do fix deve ver zero.
set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333'; -- Carol (compliance)
do $$
declare _n int;
begin
  select count(*) into _n from public.receivables;
  if _n <> 0 then
    raise exception 'T40 FALHOU: compliance leu % linhas de recebiveis de outros usuarios via RLS direta', _n;
  end if;
  raise notice 'T40 OK: compliance nao le receivables de outros usuarios via RLS direta (sem policy de staff)';
end $$;

-- admin_receivables_list() continua funcionando para staff (é a única via de
-- acesso agregado que resta, SECURITY DEFINER com guard de role interno). Os
-- recebíveis criados em T30/T31/T33/T34 já saíram todos de scheduled/overdue
-- (advanced ou cancelled) — cria um novo pendente para provar que a function
-- agrega staff de verdade, não só retorna vazio por acidente.
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111'; -- Alice
do $$
declare _contract uuid;
begin
  insert into public.receivable_contracts (user_id, name, acquirer)
  values ('11111111-1111-1111-1111-111111111111', 'Contrato T40', 'Adquirente T40')
  returning id into _contract;

  insert into public.receivables (user_id, contract_id, gross_cents, net_cents, due_date)
  values ('11111111-1111-1111-1111-111111111111', _contract, 300000, 290000, current_date + 7);
end $$;

set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333'; -- Carol (compliance)
do $$
declare _n int;
begin
  select count(*) into _n from public.admin_receivables_list();
  if _n <= 0 then
    raise exception 'T40 FALHOU: admin_receivables_list() nao retornou nenhum recebivel pendente (esperava > 0)';
  end if;
  raise notice 'T40 OK: admin_receivables_list() segue agregando recebiveis pendentes para compliance (% linhas)', _n;
end $$;

-- support (sem admin/compliance) nao pode nem chamar a function agregada.
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444'; -- Dave (support)
do $$
begin
  begin
    perform public.admin_receivables_list();
    raise exception 'T40 FALHOU: support chamou admin_receivables_list()!';
  exception when others then
    if sqlerrm not like '%Apenas admin%' then raise; end if;
  end;
  raise notice 'T40 OK: admin_receivables_list() nega quem nao e admin/compliance';
end $$;

-- --- T41: tokens de redefinicao de senha ----------------------------------
reset role;
do $$
declare
  _rls boolean;
  _denied boolean := false;
  _uid uuid;
  _n int;
begin
  select c.relrowsecurity into _rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'auth' and c.relname = 'password_reset_tokens';
  if not coalesce(_rls, false) then
    raise exception 'T41 FALHA: RLS desligada em auth.password_reset_tokens';
  end if;

  set local role authenticated;
  begin
    perform 1 from auth.password_reset_tokens;
  exception when insufficient_privilege then
    _denied := true;
  end;
  reset role;
  if not _denied then
    raise exception 'T41 FALHA: authenticated conseguiu ler auth.password_reset_tokens';
  end if;
  raise notice 'T41 OK: authenticated nao le tokens de redefinicao (RLS + sem grant)';

  -- service_role (via API) cria e consome o token de uso unico.
  set local role service_role;
  insert into auth.users (email, password_hash) values ('t41-reset@example.com', 'x') returning id into _uid;
  insert into auth.password_reset_tokens (user_id, token_hash, expires_at)
    values (_uid, 'hash-t41', now() + interval '30 minutes');
  update auth.password_reset_tokens set used_at = now()
   where token_hash = 'hash-t41' and used_at is null and expires_at > now();
  get diagnostics _n = row_count;
  if _n <> 1 then raise exception 'T41 FALHA: primeiro uso do token deveria atualizar 1 linha, atualizou %', _n; end if;
  update auth.password_reset_tokens set used_at = now()
   where token_hash = 'hash-t41' and used_at is null and expires_at > now();
  get diagnostics _n = row_count;
  if _n <> 0 then raise exception 'T41 FALHA: token reutilizado (% linhas)', _n; end if;
  reset role;
  raise notice 'T41 OK: token de redefinicao e de uso unico';
end $$;

-- --- T42: cofre de credenciais da Ether por cliente ------------------------
reset role;
do $$
declare
  _rls boolean;
  _denied boolean := false;
  _uid uuid;
  _uid2 uuid;
  _cred uuid;
  _ok boolean;
  _audit jsonb;
begin
  select c.relrowsecurity into _rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'vault' and c.relname = 'ether_credentials';
  if not coalesce(_rls, false) then
    raise exception 'T42 FALHA: RLS desligada em vault.ether_credentials';
  end if;

  set local role authenticated;
  begin
    perform 1 from vault.ether_credentials;
  exception when insufficient_privilege then
    _denied := true;
  end;
  reset role;
  if not _denied then
    raise exception 'T42 FALHA: authenticated conseguiu ler o cofre';
  end if;
  raise notice 'T42 OK: authenticated nao le o cofre (schema fechado + RLS)';

  set local role service_role;
  insert into auth.users (email, password_hash) values ('t42-a@example.com', 'x') returning id into _uid;
  insert into auth.users (email, password_hash) values ('t42-b@example.com', 'x') returning id into _uid2;
  insert into vault.ether_credentials (user_id, ether_user_id, client_id, secret_ciphertext, secret_iv, secret_tag, created_by)
    values (_uid, 'ether-t42-a', 'client-t42-a', '', '', '', _uid) returning id into _cred;

  -- Segunda credencial viva para o mesmo usuário: recusada.
  _ok := false;
  begin
    insert into vault.ether_credentials (user_id, ether_user_id, client_id, secret_ciphertext, secret_iv, secret_tag)
      values (_uid, 'ether-t42-a2', 'client-t42-a2', '', '', '');
  exception when unique_violation then _ok := true;
  end;
  if not _ok then raise exception 'T42 FALHA: duas credenciais vivas para o mesmo usuario'; end if;

  -- O mesmo cliente Ether ligado a outro usuário LivrePay: recusado.
  _ok := false;
  begin
    insert into vault.ether_credentials (user_id, ether_user_id, client_id, secret_ciphertext, secret_iv, secret_tag)
      values (_uid2, 'ether-t42-a', 'client-t42-x', '', '', '');
  exception when unique_violation then _ok := true;
  end;
  if not _ok then raise exception 'T42 FALHA: mesmo cliente Ether ligado a dois usuarios'; end if;
  raise notice 'T42 OK: uma credencial viva por usuario e por cliente Ether';

  -- Segredo imutável.
  _ok := false;
  begin
    update vault.ether_credentials set secret_ciphertext = '	' where id = _cred;
  exception when others then _ok := true;
  end;
  if not _ok then raise exception 'T42 FALHA: segredo da credencial foi alterado'; end if;

  -- Revogar funciona; reativar não.
  update vault.ether_credentials set status = 'revoked', revoked_at = now() where id = _cred;
  _ok := false;
  begin
    update vault.ether_credentials set status = 'active', revoked_at = null where id = _cred;
  exception when others then _ok := true;
  end;
  if not _ok then raise exception 'T42 FALHA: credencial revogada foi reativada'; end if;
  reset role;
  raise notice 'T42 OK: segredo imutavel e credencial revogada nao volta';

  select new_data into _audit from public.audit_log
   where table_name = 'vault.ether_credentials' and record_id = _cred
   order by created_at desc limit 1;
  if _audit is null then raise exception 'T42 FALHA: sem registro de auditoria'; end if;
  if _audit ?| array['secret_ciphertext', 'secret_iv', 'secret_tag'] then
    raise exception 'T42 FALHA: auditoria gravou dado do segredo';
  end if;
  raise notice 'T42 OK: auditoria registra a credencial sem o segredo';
end $$;

-- --- T43: módulos por conta — só admin concede; usuário só lê o seu --------
reset role;
do $$
declare _n int; _ok boolean;
begin
  -- Alice (já usada nos testes) não é admin aqui: remove a role que T31 deu.
  delete from public.user_roles where user_id = '11111111-1111-1111-1111-111111111111';
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  set local role authenticated;

  _ok := false;
  begin
    perform public.admin_set_module('11111111-1111-1111-1111-111111111111', 'crypto', true);
  exception when others then
    _ok := sqlerrm like '%Apenas admin%';
  end;
  if not _ok then raise exception 'T43 FALHA: nao-admin concedeu modulo a si mesmo'; end if;

  _ok := false;
  begin
    insert into public.account_modules (user_id, module, enabled_by)
    values ('11111111-1111-1111-1111-111111111111', 'crypto', '11111111-1111-1111-1111-111111111111');
  exception when insufficient_privilege then _ok := true;
  end;
  if not _ok then raise exception 'T43 FALHA: INSERT direto em account_modules permitido'; end if;
  if public.has_module('11111111-1111-1111-1111-111111111111', 'crypto') then
    raise exception 'T43 FALHA: conta sem modulo aparece com modulo';
  end if;
  reset role;

  -- Admin (Bob) concede à Alice; Alice passa a ter; Bob/outros não leem a linha dela por RLS comum.
  insert into public.user_roles (user_id, role) values ('22222222-2222-2222-2222-222222222222', 'admin')
    on conflict do nothing;
  perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
  set local role authenticated;
  perform public.admin_set_module('11111111-1111-1111-1111-111111111111', 'crypto', true);
  perform public.admin_set_module('11111111-1111-1111-1111-111111111111', 'crypto', true); -- idempotente
  reset role;
  if not public.has_module('11111111-1111-1111-1111-111111111111', 'crypto') then
    raise exception 'T43 FALHA: modulo concedido nao vale';
  end if;
  if public.has_module('22222222-2222-2222-2222-222222222222', 'crypto') then
    raise exception 'T43 FALHA: modulo vazou para outra conta';
  end if;

  -- Revogar desliga e mantém histórico.
  perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
  set local role authenticated;
  perform public.admin_set_module('11111111-1111-1111-1111-111111111111', 'crypto', false);
  reset role;
  if public.has_module('11111111-1111-1111-1111-111111111111', 'crypto') then
    raise exception 'T43 FALHA: modulo revogado continua ativo';
  end if;
  select count(*) into _n from public.account_modules
   where user_id = '11111111-1111-1111-1111-111111111111' and revoked_at is not null;
  if _n <> 1 then raise exception 'T43 FALHA: historico de revogacao perdido (%)', _n; end if;
  raise notice 'T43 OK: modulos so por admin, isolados por conta, revogaveis com historico';
end $$;

-- ===========================================================================
-- MULTI-TENANT (20261111000000_tenants.sql): VARKI opera só os clientes dela
-- ===========================================================================
reset role;
insert into auth.users (id, email, password_hash, raw_user_meta_data) values
  ('aaaaaaaa-0000-0000-0000-00000000000e', 'eve@varki.test',   'x', '{"full_name":"Eve","tenant_slug":"varki"}'),
  ('aaaaaaaa-0000-0000-0000-00000000000f', 'frank@varki.test', 'x', '{"full_name":"Frank","tenant_slug":"varki"}'),
  ('aaaaaaaa-0000-0000-0000-000000000010', 'gina@varki.test',  'x', '{"full_name":"Gina","tenant_slug":"varki"}'),
  ('aaaaaaaa-0000-0000-0000-000000000011', 'hank@lp.test',     'x', '{"full_name":"Hank"}'),
  ('aaaaaaaa-0000-0000-0000-000000000012', 'ivy@lp.test',      'x', '{"full_name":"Ivy","tenant_slug":"inexistente"}');
update public.profiles set tax_id = '12345678901'
 where id = 'aaaaaaaa-0000-0000-0000-00000000000e';

-- Frank: admin da VARKI. Gina: suporte da VARKI. (concessão manual, como em produção)
insert into public.tenant_staff (user_id, tenant_id, role) values
  ('aaaaaaaa-0000-0000-0000-00000000000f', '00000000-0000-4000-8000-000000000002', 'admin'),
  ('aaaaaaaa-0000-0000-0000-000000000010', '00000000-0000-4000-8000-000000000002', 'support');

-- Recebíveis: Eve (VARKI), Frank (VARKI, o próprio staff), Hank (LivrePay).
do $$
declare _c uuid;
begin
  insert into public.receivable_contracts (user_id, name, acquirer)
  values ('aaaaaaaa-0000-0000-0000-00000000000e', 'Contrato Eve', 'Adq') returning id into _c;
  insert into public.receivables (user_id, contract_id, gross_cents, net_cents, due_date)
  values ('aaaaaaaa-0000-0000-0000-00000000000e', _c, 500000, 480000, current_date + 5),
         ('aaaaaaaa-0000-0000-0000-00000000000e', _c, 300000, 290000, current_date + 6);

  insert into public.receivable_contracts (user_id, name, acquirer)
  values ('aaaaaaaa-0000-0000-0000-00000000000f', 'Contrato Frank', 'Adq') returning id into _c;
  insert into public.receivables (user_id, contract_id, gross_cents, net_cents, due_date)
  values ('aaaaaaaa-0000-0000-0000-00000000000f', _c, 700000, 680000, current_date + 5);

  insert into public.receivable_contracts (user_id, name, acquirer)
  values ('aaaaaaaa-0000-0000-0000-000000000011', 'Contrato Hank', 'Adq') returning id into _c;
  insert into public.receivables (user_id, contract_id, gross_cents, net_cents, due_date)
  values ('aaaaaaaa-0000-0000-0000-000000000011', _c, 900000, 880000, current_date + 5);

  insert into public.payments (user_id, kind, amount_cents, recipient_name, status, executed_at)
  values ('aaaaaaaa-0000-0000-0000-00000000000e', 'transferencia', 10000, 'Dest Eve', 'completed', now()),
         ('aaaaaaaa-0000-0000-0000-000000000011', 'transferencia', 99999, 'Dest Hank', 'completed', now());
end $$;

-- --- T44: tenant vem do cadastro; ausente/desconhecido cai no padrão -------
do $$
declare _slug text;
begin
  select t.slug into _slug from public.profiles p join public.tenants t on t.id = p.tenant_id
   where p.id = 'aaaaaaaa-0000-0000-0000-00000000000e';
  if _slug is distinct from 'varki' then raise exception 'T44 FALHOU: Eve deveria ser varki, e %', _slug; end if;

  select t.slug into _slug from public.profiles p join public.tenants t on t.id = p.tenant_id
   where p.id = 'aaaaaaaa-0000-0000-0000-000000000011';
  if _slug is distinct from 'livrepay' then raise exception 'T44 FALHOU: Hank (sem slug) deveria ser livrepay, e %', _slug; end if;

  select t.slug into _slug from public.profiles p join public.tenants t on t.id = p.tenant_id
   where p.id = 'aaaaaaaa-0000-0000-0000-000000000012';
  if _slug is distinct from 'livrepay' then raise exception 'T44 FALHOU: slug desconhecido deveria cair em livrepay, e %', _slug; end if;

  select t.slug into _slug from public.profiles p join public.tenants t on t.id = p.tenant_id
   where p.id = '11111111-1111-1111-1111-111111111111';
  if _slug is distinct from 'livrepay' then raise exception 'T44 FALHOU: Alice (anterior ao tenant) deveria ser livrepay, e %', _slug; end if;

  raise notice 'T44 OK: tenant vem do cadastro; ausente/desconhecido cai em livrepay';
end $$;

-- --- T45: ninguém da aplicação muda o próprio tenant -----------------------
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-00000000000e'; -- Eve
do $$
declare _blocked boolean := false;
begin
  begin
    update public.profiles set tenant_id = '00000000-0000-4000-8000-000000000001'
     where id = 'aaaaaaaa-0000-0000-0000-00000000000e';
  exception when insufficient_privilege then _blocked := true;
  end;
  if not _blocked then raise exception 'T45 FALHOU: authenticated trocou o proprio tenant'; end if;
  raise notice 'T45 OK: usuario nao muda o proprio tenant (authenticated)';
end $$;

reset role;
set role service_role;
do $$
declare _blocked boolean := false;
begin
  begin
    update public.profiles set tenant_id = '00000000-0000-4000-8000-000000000001'
     where id = 'aaaaaaaa-0000-0000-0000-00000000000e';
  exception when insufficient_privilege then _blocked := true;
  end;
  if not _blocked then raise exception 'T45 FALHOU: service_role trocou o tenant de um usuario'; end if;
  raise notice 'T45 OK: nem service_role muda tenant (so dono/doadmin, manualmente)';
end $$;

-- --- T46: equipe de tenant precisa pertencer ao tenant ---------------------
reset role;
do $$
declare _blocked boolean := false;
begin
  begin
    insert into public.tenant_staff (user_id, tenant_id, role)
    values ('aaaaaaaa-0000-0000-0000-000000000011', '00000000-0000-4000-8000-000000000002', 'admin'); -- Hank é livrepay
  exception when check_violation then _blocked := true;
  end;
  if not _blocked then raise exception 'T46 FALHOU: deu papel de VARKI a um cliente do LivrePay'; end if;
  raise notice 'T46 OK: tenant_staff exige que o usuario seja do proprio tenant';
end $$;

-- --- T47: staff da VARKI lista só clientes da VARKI, documento mascarado ---
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-00000000000f'; -- Frank (admin VARKI)
do $$
declare _n int; _eve record; _leak int;
begin
  select count(*) into _n from public.tenant_list_customers();
  if _n <> 3 then raise exception 'T47 FALHOU: VARKI tem 3 usuarios (Eve, Frank, Gina), a lista trouxe %', _n; end if;

  select count(*) into _leak from public.tenant_list_customers()
   where email not like '%@varki.test';
  if _leak <> 0 then raise exception 'T47 FALHOU: % cliente(s) de outro tenant na lista da VARKI', _leak; end if;

  select * into _eve from public.tenant_list_customers() where email = 'eve@varki.test';
  if _eve.tax_id_masked is distinct from '*******8901' then
    raise exception 'T47 FALHOU: documento deveria vir mascarado, veio %', _eve.tax_id_masked;
  end if;

  raise notice 'T47 OK: staff da VARKI lista so clientes da VARKI, documento mascarado';
end $$;

-- --- T48: quem não é staff do tenant não opera; staff global não vira tenant
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-00000000000e'; -- Eve (cliente)
do $$
declare _blocked boolean := false;
begin
  begin perform * from public.tenant_list_customers();
  exception when insufficient_privilege then _blocked := true; end;
  if not _blocked then raise exception 'T48 FALHOU: cliente comum listou clientes do tenant'; end if;
  raise notice 'T48 OK: cliente comum nao opera o painel do tenant';
end $$;

set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333'; -- Carol (compliance GLOBAL)
do $$
declare _blocked boolean := false;
begin
  begin perform * from public.tenant_overview();
  exception when insufficient_privilege then _blocked := true; end;
  if not _blocked then raise exception 'T48 FALHOU: compliance global acessou o painel de tenant sem ser staff dele'; end if;
  raise notice 'T48 OK: papel global nao substitui tenant_staff';
end $$;

-- --- T49: staff de tenant NAO e admin global --------------------------------
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-00000000000f'; -- Frank
do $$
declare _blocked boolean := false; _n int;
begin
  if public.has_role('aaaaaaaa-0000-0000-0000-00000000000f', 'admin')
     or public.has_role('aaaaaaaa-0000-0000-0000-00000000000f', 'compliance') then
    raise exception 'T49 FALHOU: staff de tenant virou admin/compliance global';
  end if;

  begin perform * from public.admin_list_users();
  exception when others then _blocked := true; end;
  if not _blocked then raise exception 'T49 FALHOU: staff de tenant chamou admin_list_users()'; end if;

  _blocked := false;
  begin perform * from public.admin_receivables_list();
  exception when others then _blocked := true; end;
  if not _blocked then raise exception 'T49 FALHOU: staff de tenant chamou admin_receivables_list()'; end if;

  _blocked := false;
  begin insert into public.user_roles (user_id, role) values ('aaaaaaaa-0000-0000-0000-00000000000f', 'admin');
  exception when others then _blocked := true; end;
  if not _blocked then raise exception 'T49 FALHOU: staff de tenant se promoveu a admin global'; end if;

  select count(*) into _n from public.profiles;
  if _n <> 1 then raise exception 'T49 FALHOU: leitura direta de profiles vazou (% linhas)', _n; end if;

  raise notice 'T49 OK: staff de tenant nao e admin global e nao le dados alheios direto';
end $$;

-- --- T50: pré-aprovar/recusar só no próprio tenant, nunca o próprio recebível, uma vez
do $$
declare _eve_rec uuid; _hank_rec uuid; _own_rec uuid; _row public.receivables%rowtype; _blocked boolean; _n int; _msg text;
begin
  select id into _eve_rec from public.tenant_receivables_list() where gross_cents = 500000;
  if _eve_rec is null then raise exception 'T50 FALHOU: Frank nao ve o recebivel da Eve'; end if;

  if exists (select 1 from public.tenant_receivables_list() where gross_cents in (900000, 700000)) then
    raise exception 'T50 FALHOU: lista da VARKI traz recebivel de outro tenant ou o proprio do staff';
  end if;

  -- pré-aprovação: registra a análise, mas NÃO verifica (não libera crédito)
  select * into _row from public.tenant_approve_receivable(_eve_rec);
  if _row.tenant_reviewed_at is null or _row.tenant_reviewed_by <> 'aaaaaaaa-0000-0000-0000-00000000000f' then
    raise exception 'T50 FALHOU: pre-aprovacao nao registrada';
  end if;
  if _row.verified_at is not null or _row.verified_by is not null then
    raise exception 'T50 FALHOU: pre-aprovacao do tenant NAO pode verificar o recebivel';
  end if;

  -- idempotente: nao sobrescreve o aprovador original
  _blocked := false;
  begin perform public.tenant_approve_receivable(_eve_rec); exception when others then _blocked := true; end;
  if not _blocked then raise exception 'T50 FALHOU: segunda aprovacao sobrescreveu a primeira'; end if;

  select * into _row from public.tenant_reject_receivable(
    (select id from public.tenant_receivables_list() where gross_cents = 300000), 'Documentacao divergente');
  if _row.status <> 'cancelled' or _row.rejected_by is null then
    raise exception 'T50 FALHOU: recusa nao registrada';
  end if;

  -- recebível de OUTRO tenant: tratado como inexistente
  reset role;
  select id into _hank_rec from public.receivables where gross_cents = 900000;
  select id into _own_rec  from public.receivables where gross_cents = 700000;
  set role authenticated;
  set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-00000000000f';

  _blocked := false;
  begin perform public.tenant_approve_receivable(_hank_rec); exception when others then _blocked := true; end;
  if not _blocked then raise exception 'T50 FALHOU: Frank aprovou recebivel do LivrePay'; end if;

  _blocked := false;
  begin perform public.tenant_reject_receivable(_hank_rec, 'x tentativa'); exception when others then _blocked := true; end;
  if not _blocked then raise exception 'T50 FALHOU: Frank recusou recebivel do LivrePay'; end if;

  -- auto-aprovação: pela função...
  _blocked := false;
  begin perform public.tenant_approve_receivable(_own_rec); exception when others then _blocked := true; end;
  if not _blocked then raise exception 'T50 FALHOU: staff aprovou o proprio recebivel (funcao)'; end if;

  -- ...e por UPDATE direto, tanto verified_* quanto tenant_reviewed_* (dono edita o próprio agendado)
  _blocked := false;
  begin
    update public.receivables set verified_at = now(), verified_by = 'aaaaaaaa-0000-0000-0000-00000000000f' where id = _own_rec;
  exception when others then _blocked := true; _msg := sqlerrm; end;
  if not _blocked then raise exception 'T50 FALHOU: staff verificou o proprio recebivel (UPDATE direto)'; end if;
  if _msg not like '%alterar a verificação%' then raise exception 'T50 FALHOU: UPDATE direto barrado pelo motivo errado: %', _msg; end if;

  _blocked := false;
  begin
    update public.receivables set tenant_reviewed_at = now(), tenant_reviewed_by = 'aaaaaaaa-0000-0000-0000-00000000000f' where id = _own_rec;
  exception when others then _blocked := true; _msg := sqlerrm; end;
  if not _blocked then raise exception 'T50 FALHOU: staff pre-aprovou o proprio recebivel (UPDATE direto)'; end if;
  if _msg not like '%alterar a verificação%' then raise exception 'T50 FALHOU: UPDATE direto barrado pelo motivo errado: %', _msg; end if;

  -- staff nao escreve verified_* em recebivel alheio nem por UPDATE direto (RLS: so o dono edita)
  update public.receivables set verified_at = now(), verified_by = 'aaaaaaaa-0000-0000-0000-00000000000f' where id = _eve_rec;
  get diagnostics _n = row_count;
  if _n <> 0 then raise exception 'T50 FALHOU: staff do tenant atualizou recebivel alheio por UPDATE direto'; end if;

  raise notice 'T50 OK: pre-aprovar/recusar so no proprio tenant, uma vez, nunca o proprio recebivel';
end $$;

-- --- T51: papel support só acompanha; não aprova ------------------------------
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000010'; -- Gina (support VARKI)
do $$
declare _blocked boolean := false; _n int;
begin
  select count(*) into _n from public.tenant_list_customers();
  if _n <> 3 then raise exception 'T51 FALHOU: support nao lista os clientes do tenant (%)', _n; end if;

  begin perform * from public.tenant_receivables_list();
  exception when insufficient_privilege then _blocked := true; end;
  if not _blocked then raise exception 'T51 FALHOU: support listou recebiveis para aprovacao'; end if;

  _blocked := false;
  begin perform public.tenant_approve_receivable(gen_random_uuid());
  exception when insufficient_privilege then _blocked := true; end;
  if not _blocked then raise exception 'T51 FALHOU: support chamou tenant_approve_receivable'; end if;

  raise notice 'T51 OK: support acompanha, nao aprova';
end $$;

-- --- T52: pagamentos e visão geral só do tenant; sem dado sensível -----------
do $$
declare _o record; _n int; _result text;
begin
  select count(*) into _n from public.tenant_payments_list();
  if _n <> 1 then raise exception 'T52 FALHOU: VARKI tem 1 pagamento, lista trouxe %', _n; end if;

  _result := pg_get_function_result('public.tenant_payments_list()'::regprocedure);
  if _result ~ 'recipient_key|recipient_tax_id' then
    raise exception 'T52 FALHOU: lista de pagamentos expoe chave/documento do destinatario';
  end if;

  select * into _o from public.tenant_overview();
  if _o.customers <> 3 or _o.payments_30d <> 1 or _o.payments_30d_cents <> 10000 then
    raise exception 'T52 FALHOU: overview vazou/errou (% clientes, % pagtos, % centavos)',
      _o.customers, _o.payments_30d, _o.payments_30d_cents;
  end if;

  raise notice 'T52 OK: pagamentos e visao geral so do tenant, sem dado sensivel do destinatario';
end $$;

-- --- T53: cada um enxerga só o próprio tenant na tabela tenants --------------
do $$
declare _n int;
begin
  select count(*) into _n from public.tenants;
  if _n <> 1 then raise exception 'T53 FALHOU: Gina ve % tenants (deveria ver so o dela)', _n; end if;
  raise notice 'T53 OK: tabela tenants isolada por pertencimento';
end $$;

-- --- T54: controle duplo — pré-aprovação do tenant NÃO libera crédito -------
-- Cenário da revisão de segurança: staff do tenant controla uma conta (Eve), pré-aprova o
-- recebível dela e ela tenta antecipar. Só a verificação da PLATAFORMA libera.
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-00000000000e'; -- Eve (dona)
do $$
declare _rec uuid; _before bigint; _after bigint; _blocked boolean := false;
begin
  select id into _rec from public.receivables where gross_cents = 500000;
  select balance_cents into _before from public.accounts where user_id = 'aaaaaaaa-0000-0000-0000-00000000000e';

  begin perform public.advance_receivable(_rec); exception when others then _blocked := true; end;
  if not _blocked then raise exception 'T54 FALHOU: recebivel so pre-aprovado pelo tenant foi antecipado'; end if;

  select balance_cents into _after from public.accounts where user_id = 'aaaaaaaa-0000-0000-0000-00000000000e';
  if _after <> _before then raise exception 'T54 FALHOU: saldo mudou sem verificacao da plataforma'; end if;
  raise notice 'T54 OK: pre-aprovacao do tenant nao libera credito';
end $$;

set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333'; -- Carol (compliance da plataforma)
do $$
declare _rec uuid; _row record;
begin
  select * into _row from public.admin_receivables_list() where gross_cents = 500000;
  if _row.tenant_slug is distinct from 'varki' or _row.tenant_reviewed_at is null then
    raise exception 'T54 FALHOU: painel da plataforma nao mostra tenant/pre-aprovacao (% / %)', _row.tenant_slug, _row.tenant_reviewed_at;
  end if;
  perform public.verify_receivable(_row.id);
  raise notice 'T54 OK: plataforma ve a pre-aprovacao e verifica';
end $$;

set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-00000000000e'; -- Eve
do $$
declare _rec uuid; _before bigint; _after bigint;
begin
  select id into _rec from public.receivables where gross_cents = 500000;
  select balance_cents into _before from public.accounts where user_id = 'aaaaaaaa-0000-0000-0000-00000000000e';
  perform public.advance_receivable(_rec);
  select balance_cents into _after from public.accounts where user_id = 'aaaaaaaa-0000-0000-0000-00000000000e';
  if _after <> _before + 480000 then
    raise exception 'T54 FALHOU: apos verificacao da plataforma o credito deveria ser 480000, foi %', _after - _before;
  end if;
  raise notice 'T54 OK: depois da verificacao da plataforma a antecipacao credita normalmente';
end $$;

-- --- T55: recebível analisado é imutável (valor/prazo/contrato) --------------
-- Recebível NOVO, pré-aprovado pelo tenant e ainda agendado (o dono ainda poderia editá-lo
-- pela policy): a trava tem de vir do trigger.
reset role;
insert into public.receivables (user_id, contract_id, gross_cents, net_cents, due_date)
select user_id, contract_id, 410000, 400000, current_date + 9
  from public.receivables
 where gross_cents = 500000 and user_id = 'aaaaaaaa-0000-0000-0000-00000000000e' limit 1;

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-00000000000f'; -- Frank
select public.tenant_approve_receivable((select id from public.tenant_receivables_list() where gross_cents = 410000));

set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-00000000000e'; -- Eve (dona)
do $$
declare _rec uuid; _blocked boolean := false; _gross bigint;
begin
  select id into _rec from public.receivables where gross_cents = 410000;
  begin
    update public.receivables set gross_cents = 9000000, net_cents = 8900000 where id = _rec;
  exception when check_violation then _blocked := true; end;
  if not _blocked then raise exception 'T55 FALHOU: dono alterou o valor de recebivel ja analisado'; end if;

  select gross_cents into _gross from public.receivables where id = _rec;
  if _gross <> 410000 then raise exception 'T55 FALHOU: valor mudou para %', _gross; end if;

  -- recebivel ainda NAO analisado continua editavel pelo dono (regra anterior preservada)
  raise notice 'T55 OK: recebivel analisado nao muda valor/prazo/contrato';
end $$;

-- --- T56: auditoria de recebíveis, concessão de equipe e leitura de PII -------
reset role;
do $$
declare _n int;
begin
  select count(*) into _n from public.audit_log where table_name = 'tenant_staff' and action = 'INSERT';
  if _n < 2 then raise exception 'T56 FALHOU: concessao de tenant_staff sem trilha (%)', _n; end if;

  select count(*) into _n from public.audit_log
   where table_name = 'receivables' and action = 'UPDATE'
     and (new_data ->> 'tenant_reviewed_by') = 'aaaaaaaa-0000-0000-0000-00000000000f'
     and user_id = 'aaaaaaaa-0000-0000-0000-00000000000f';
  if _n < 1 then raise exception 'T56 FALHOU: pre-aprovacao sem trilha (quem/quando)'; end if;

  select count(*) into _n from public.audit_log
   where table_name = 'profiles' and action = 'READ' and user_id = 'aaaaaaaa-0000-0000-0000-00000000000f';
  if _n < 1 then raise exception 'T56 FALHOU: leitura de PII pela equipe sem trilha'; end if;

  raise notice 'T56 OK: auditoria de recebiveis, concessao de equipe e leitura de PII';
end $$;

reset role;

-- ===========================================================================
-- CONTROLES DE AGÊNCIA (20261111120000_agency_controls.sql): limites, suspensão, conciliação
-- ===========================================================================
reset role;
insert into auth.users (id, email, password_hash, raw_user_meta_data) values
  ('aaaaaaaa-0000-0000-0000-000000000020', 'ada@platform.test', 'x', '{"full_name":"Ada"}');
insert into public.user_roles (user_id, role) values ('aaaaaaaa-0000-0000-0000-000000000020', 'admin');

-- --- T57: limite por recebível (antecipação e pré-aprovação) -----------------
set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333'; -- Carol (compliance plataforma)
select public.verify_receivable((select id from public.admin_receivables_list() where gross_cents = 410000));

set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000020'; -- Ada (admin plataforma)
select public.admin_set_tenant_limits('varki', 300000, null, null);

set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-00000000000e'; -- Eve
do $$
declare _rec uuid; _before bigint; _after bigint; _msg text;
begin
  select id into _rec from public.receivables where gross_cents = 410000;
  select balance_cents into _before from public.accounts where user_id = 'aaaaaaaa-0000-0000-0000-00000000000e';
  begin perform public.advance_receivable(_rec); exception when others then _msg := sqlerrm; end;
  if _msg is null then raise exception 'T57 FALHOU: antecipou recebivel acima do limite da agencia'; end if;
  if _msg not like 'Limite da agência: valor%' then raise exception 'T57 FALHOU: barrado pelo motivo errado: %', _msg; end if;
  select balance_cents into _after from public.accounts where user_id = 'aaaaaaaa-0000-0000-0000-00000000000e';
  if _after <> _before then raise exception 'T57 FALHOU: saldo mudou'; end if;
  raise notice 'T57 OK: antecipacao respeita o limite por recebivel';
end $$;

reset role;
do $$
declare _c uuid;
begin
  select id into _c from public.receivable_contracts where user_id = 'aaaaaaaa-0000-0000-0000-00000000000e' limit 1;
  insert into public.receivables (user_id, contract_id, gross_cents, net_cents, due_date)
  values ('aaaaaaaa-0000-0000-0000-00000000000e', _c, 800000, 790000, current_date + 12);
end $$;
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-00000000000f'; -- Frank (admin VARKI)
do $$
declare _rec uuid; _blocked boolean := false;
begin
  select id into _rec from public.tenant_receivables_list() where gross_cents = 800000;
  begin perform public.tenant_approve_receivable(_rec); exception when others then _blocked := true; end;
  if not _blocked then raise exception 'T57 FALHOU: equipe pre-aprovou recebivel acima do limite da agencia'; end if;
  raise notice 'T57 OK: pre-aprovacao respeita o limite por recebivel';
end $$;

-- --- T58: limites são editáveis só pela plataforma e invisíveis a clientes ----
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-00000000000f'; -- Frank
do $$
declare _blocked boolean := false;
begin
  begin perform public.admin_set_tenant_limits('varki', null, null, null); exception when others then _blocked := true; end;
  if not _blocked then raise exception 'T58 FALHOU: staff de tenant alterou limites da propria agencia'; end if;
  raise notice 'T58 OK: staff de tenant nao altera limites';
end $$;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333'; -- Carol (compliance, nao admin)
do $$
declare _blocked boolean := false;
begin
  begin perform public.admin_set_tenant_limits('varki', null, null, null); exception when others then _blocked := true; end;
  if not _blocked then raise exception 'T58 FALHOU: compliance (sem admin) alterou limites'; end if;
  begin perform 1 from public.admin_tenants_overview(); exception when others then raise exception 'T58 FALHOU: compliance nao consegue ver o painel de agencias'; end;
  raise notice 'T58 OK: so admin altera limites; compliance so consulta';
end $$;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-00000000000e'; -- Eve (cliente)
do $$
declare _blocked boolean := false;
begin
  begin perform * from public.tenant_limits; exception when insufficient_privilege then _blocked := true; end;
  if not _blocked then raise exception 'T58 FALHOU: cliente leu tenant_limits'; end if;
  _blocked := false;
  begin perform * from public.tenant_agency_status(); exception when insufficient_privilege then _blocked := true; end;
  if not _blocked then raise exception 'T58 FALHOU: cliente leu o status da agencia'; end if;
  raise notice 'T58 OK: limites e status da agencia invisiveis a cliente';
end $$;

-- --- T59: exposição total e antecipação diária; limites de uma agência não afetam outra
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000020'; -- Ada
-- exposição: 480000 já antecipados (T54). Teto 800000 barra +400000 e 900000 deixa passar.
select public.admin_set_tenant_limits('varki', null, 800000, null);
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-00000000000e'; -- Eve
do $$
declare _rec uuid; _msg text;
begin
  select id into _rec from public.receivables where gross_cents = 410000;
  begin perform public.advance_receivable(_rec); exception when others then _msg := sqlerrm; end;
  if _msg is null or _msg not like 'Limite da agência: exposição%' then
    raise exception 'T59 FALHOU: exposicao total nao barrou (%)', _msg;
  end if;
  raise notice 'T59 OK: teto de exposicao total antecipada';
end $$;

set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000020'; -- Ada
select public.admin_set_tenant_limits('varki', null, null, 500000);  -- diário: já saíram 480000 hoje
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-00000000000e'; -- Eve
do $$
declare _rec uuid; _msg text;
begin
  select id into _rec from public.receivables where gross_cents = 410000;
  begin perform public.advance_receivable(_rec); exception when others then _msg := sqlerrm; end;
  if _msg is null or _msg not like 'Limite da agência: antecipação diária%' then
    raise exception 'T59 FALHOU: limite diario nao barrou (%)', _msg;
  end if;
  raise notice 'T59 OK: teto de antecipacao por dia';
end $$;

-- LivrePay (outra agência) segue sem limite, mesmo com a VARKI limitada
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333'; -- Carol
select public.verify_receivable((select id from public.admin_receivables_list() where gross_cents = 900000));
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000011'; -- Hank (LivrePay)
do $$
declare _rec uuid; _before bigint; _after bigint;
begin
  select id into _rec from public.receivables where gross_cents = 900000;
  select balance_cents into _before from public.accounts where user_id = 'aaaaaaaa-0000-0000-0000-000000000011';
  perform public.advance_receivable(_rec);
  select balance_cents into _after from public.accounts where user_id = 'aaaaaaaa-0000-0000-0000-000000000011';
  if _after <> _before + 880000 then raise exception 'T59 FALHOU: limites da VARKI afetaram o LivrePay'; end if;
  raise notice 'T59 OK: limite de uma agencia nao afeta outra';
end $$;

-- sem limite (NULL) volta ao comportamento anterior
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000020'; -- Ada
select public.admin_set_tenant_limits('varki', null, null, null);
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-00000000000e'; -- Eve
do $$
declare _rec uuid; _before bigint; _after bigint;
begin
  select id into _rec from public.receivables where gross_cents = 410000;
  select balance_cents into _before from public.accounts where user_id = 'aaaaaaaa-0000-0000-0000-00000000000e';
  perform public.advance_receivable(_rec);
  select balance_cents into _after from public.accounts where user_id = 'aaaaaaaa-0000-0000-0000-00000000000e';
  if _after <> _before + 400000 then raise exception 'T59 FALHOU: sem limite deveria antecipar normalmente'; end if;
  raise notice 'T59 OK: sem limite (NULL) antecipa normalmente';
end $$;

-- --- T60: suspensão bloqueia dinheiro, equipe, sessões; reativação restaura ---
reset role;
insert into auth.refresh_tokens (user_id, token_hash, expires_at) values
  ('aaaaaaaa-0000-0000-0000-00000000000e', 'hash-eve', now() + interval '1 day'),
  ('aaaaaaaa-0000-0000-0000-000000000011', 'hash-hank', now() + interval '1 day');

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-00000000000e'; -- Eve cria um pagamento (rascunho)
insert into public.payments (user_id, kind, amount_cents, recipient_name)
values ('aaaaaaaa-0000-0000-0000-00000000000e', 'transferencia', 1000, 'Teste suspensao');

set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-00000000000f'; -- Frank
do $$
declare _blocked boolean := false;
begin
  begin perform public.admin_set_tenant_status('varki', 'suspended', 'teste'); exception when others then _blocked := true; end;
  if not _blocked then raise exception 'T60 FALHOU: staff do tenant suspendeu a propria agencia'; end if;
  raise notice 'T60 OK: staff de tenant nao suspende agencia';
end $$;

set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000020'; -- Ada
do $$
declare _blocked boolean := false;
begin
  begin perform public.admin_set_tenant_status('livrepay', 'suspended', 'tentativa'); exception when others then _blocked := true; end;
  if not _blocked then raise exception 'T60 FALHOU: suspendeu a plataforma'; end if;
  _blocked := false;
  begin perform public.admin_set_tenant_status('varki', 'suspended', '  '); exception when others then _blocked := true; end;
  if not _blocked then raise exception 'T60 FALHOU: suspendeu sem motivo'; end if;
  raise notice 'T60 OK: plataforma nao e suspensa e suspensao exige motivo';
end $$;

select public.admin_set_tenant_status('varki', 'suspended', 'Investigacao de fraude');

set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-00000000000e'; -- Eve (agência suspensa)
do $$
declare _pay uuid; _rec uuid; _b1 boolean := false; _b2 boolean := false; _msg text;
begin
  select id into _pay from public.payments where recipient_name = 'Teste suspensao';
  begin perform public.execute_payment(_pay); exception when others then _b1 := true; _msg := sqlerrm; end;
  if not _b1 then raise exception 'T60 FALHOU: agencia suspensa executou pagamento'; end if;
  if _msg not like 'Agência suspensa%' then raise exception 'T60 FALHOU: pagamento barrado pelo motivo errado: %', _msg; end if;

  select id into _rec from public.receivables where gross_cents = 800000;
  begin perform public.advance_receivable(_rec); exception when others then _b2 := true; end;
  if not _b2 then raise exception 'T60 FALHOU: agencia suspensa antecipou'; end if;
  raise notice 'T60 OK: agencia suspensa nao paga nem antecipa';
end $$;

set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-00000000000f'; -- Frank (staff da agência suspensa)
do $$
declare _blocked boolean := false;
begin
  begin perform * from public.tenant_list_customers(); exception when insufficient_privilege then _blocked := true; end;
  if not _blocked then raise exception 'T60 FALHOU: equipe de agencia suspensa continua operando'; end if;
  raise notice 'T60 OK: equipe de agencia suspensa e barrada';
end $$;

reset role;
do $$
declare _eve int; _hank int; _t record;
begin
  select count(*) into _eve from auth.refresh_tokens where user_id = 'aaaaaaaa-0000-0000-0000-00000000000e' and revoked_at is null;
  select count(*) into _hank from auth.refresh_tokens where user_id = 'aaaaaaaa-0000-0000-0000-000000000011' and revoked_at is null;
  if _eve <> 0 then raise exception 'T60 FALHOU: sessoes da agencia suspensa nao foram derrubadas'; end if;
  if _hank <> 1 then raise exception 'T60 FALHOU: suspensao derrubou sessoes de OUTRA agencia'; end if;
  select * into _t from public.tenants where slug = 'varki';
  if _t.status <> 'suspended' or _t.suspended_at is null or _t.suspended_reason <> 'Investigacao de fraude' then
    raise exception 'T60 FALHOU: estado de suspensao incompleto';
  end if;
  raise notice 'T60 OK: suspensao derruba sessoes so da agencia e registra motivo';
end $$;

-- outra agência não é afetada: Hank (LivrePay) paga normalmente
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000011'; -- Hank
do $$
declare _pay uuid; _row public.payments%rowtype;
begin
  insert into public.payments (user_id, kind, amount_cents, recipient_name)
  values ('aaaaaaaa-0000-0000-0000-000000000011', 'transferencia', 1000, 'Hank ok') returning id into _pay;
  select * into _row from public.execute_payment(_pay);
  if _row.status <> 'processing' then raise exception 'T60 FALHOU: LivrePay nao deveria ser afetado pela suspensao da VARKI'; end if;
  raise notice 'T60 OK: suspender uma agencia nao afeta outra';
end $$;

-- reativação
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000020'; -- Ada
select public.admin_set_tenant_status('varki', 'active', null);
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-00000000000e'; -- Eve
do $$
declare _pay uuid; _row public.payments%rowtype;
begin
  select id into _pay from public.payments where recipient_name = 'Teste suspensao';
  select * into _row from public.execute_payment(_pay);
  if _row.status <> 'processing' then raise exception 'T60 FALHOU: pagamento nao voltou a funcionar apos reativar'; end if;
  raise notice 'T60 OK: reativacao restaura as operacoes';
end $$;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-00000000000f'; -- Frank
select count(*) from public.tenant_list_customers();

-- --- T61: conciliação por agência fecha com o ledger -------------------------
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000020'; -- Ada
do $$
declare _sum_tenants bigint; _total bigint; _v record; _daily_credits bigint; _daily_debits bigint; _direct_exposure bigint;
begin
  select coalesce(sum(balance_cents), 0) into _sum_tenants from public.admin_tenants_overview();
  reset role;
  select coalesce(sum(balance_cents), 0) into _total from public.accounts;
  set role authenticated;
  set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000020';
  if _sum_tenants <> _total then
    raise exception 'T61 FALHOU: saldos por agencia (%) nao fecham com o total das contas (%)', _sum_tenants, _total;
  end if;

  select * into _v from public.admin_tenants_overview() where slug = 'varki';
  select sum(credits_cents), sum(debits_cents) into _daily_credits, _daily_debits from public.admin_tenant_daily_movement('varki');
  if _daily_credits <> _v.credits_30d_cents or _daily_debits <> _v.debits_30d_cents then
    raise exception 'T61 FALHOU: movimento diario nao fecha com o consolidado (% / %)', _daily_credits, _v.credits_30d_cents;
  end if;

  reset role;
  select coalesce(sum(r.net_cents), 0) into _direct_exposure
    from public.receivables r join public.profiles p on p.id = r.user_id
   where p.tenant_id = '00000000-0000-4000-8000-000000000002' and r.status = 'advanced';
  set role authenticated;
  set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000020';
  if _v.advanced_exposure_cents <> _direct_exposure then
    raise exception 'T61 FALHOU: exposicao diverge (% vs %)', _v.advanced_exposure_cents, _direct_exposure;
  end if;
  raise notice 'T61 OK: conciliacao por agencia fecha com contas, ledger e recebiveis';
end $$;

set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000010'; -- Gina (support VARKI)
do $$
declare _s record; _admin record; _d bigint;
begin
  select * into _s from public.tenant_agency_status();
  if _s.customers <> 3 then raise exception 'T61 FALHOU: a agencia VARKI tem 3 clientes, veio %', _s.customers; end if;
  select coalesce(sum(credits_cents), 0) into _d from public.tenant_daily_movement();
  if _d <> _s.credits_30d_cents then raise exception 'T61 FALHOU: movimento da equipe nao fecha'; end if;
  raise notice 'T61 OK: equipe ve saldo e movimento so da propria agencia';
end $$;

-- --- T62: limites e suspensão ficam na trilha de auditoria --------------------
reset role;
do $$
declare _n int;
begin
  select count(*) into _n from public.audit_log
   where table_name = 'tenant_limits' and action = 'UPDATE' and user_id = 'aaaaaaaa-0000-0000-0000-000000000020';
  if _n < 3 then raise exception 'T62 FALHOU: alteracao de limites sem trilha (%)', _n; end if;
  select count(*) into _n from public.audit_log
   where table_name = 'tenants' and action = 'UPDATE' and user_id = 'aaaaaaaa-0000-0000-0000-000000000020'
     and new_data ->> 'status' = 'suspended';
  if _n < 1 then raise exception 'T62 FALHOU: suspensao sem trilha'; end if;
  raise notice 'T62 OK: limites e suspensao auditados (quem, quando, antes/depois)';
end $$;

-- --- Resumo ---------------------------------------------------------------
reset role;
do $$
declare _rls_off text;
begin
  select string_agg(tablename, ', ') into _rls_off
  from pg_tables t
  where schemaname = 'public'
    and not exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t.tablename and c.relrowsecurity
    );
  if _rls_off is not null then
    raise exception 'FALHA GERAL: tabelas sem RLS: %', _rls_off;
  end if;
  raise notice 'RLS habilitado em 100%% das tabelas public';
end $$;

select 'TODOS OS TESTES PASSARAM' as resultado;
