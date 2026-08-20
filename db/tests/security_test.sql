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
do $$
declare _rec uuid; _bal_before bigint; _bal_after bigint;
begin
  select id into _rec from public.receivables
  where user_id = '11111111-1111-1111-1111-111111111111' and status = 'scheduled'
  order by created_at desc limit 1;

  -- promove Alice a admin só para este teste conseguir chamar verify_receivable
  reset role;
  insert into public.user_roles (user_id, role)
  values ('11111111-1111-1111-1111-111111111111', 'admin')
  on conflict do nothing;
  set role authenticated;
  set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

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
