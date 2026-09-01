-- ============================================================================
-- LIVREPAY — leitura ampla de transactions para o painel admin (gráficos)
--
-- Contexto: o dashboard admin precisa de um gráfico de volume agregado (todas
-- as contas), mas `transactions` só tinha a policy "usuário lê as próprias"
-- (20260811120000). Mesmo padrão já usado para receivables/provider_events/
-- audit_log em 20260821000000_admin_panel.sql: policy adicional permissiva
-- (combina com OR), nunca escrita — só a RPC process_transaction() grava.
-- ============================================================================

create policy "transactions: staff le todas"
  on public.transactions for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'compliance'));
