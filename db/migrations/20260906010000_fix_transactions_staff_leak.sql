-- ============================================================================
-- LIVREPAY — corrige vazamento do ledger pessoal via policy de staff
--
-- Bug: a policy "transactions: staff le todas" (20260821010000) foi criada só
-- para o gráfico agregado de /admin/reports/volume, mas RLS vale por
-- sessão/role, não por rota — qualquer admin/compliance que chamasse as
-- rotas PESSOAIS GET /reports/statement e GET /reports/financials
-- (server/src/routes/reports.js, SEM filtro de conta nessas queries, porque
-- a RLS "usuário lê as próprias" bastava até aqui) passou a ler o ledger de
-- TODOS os usuários, não só o seu — saldo (`accounts`, sem policy de staff)
-- ficava isolado mas o extrato/financeiro vinha de todo mundo. Achado em
-- 2026-10-06, nunca explorado em produção (sem evidência de uso indevido).
--
-- Correção (causa raiz, não remendo em rota): derruba a policy ampla em
-- `transactions` — ela nunca deveria ter existido por SESSÃO, só por
-- FUNÇÃO — e move a agregação de /admin/reports/volume para uma function
-- SECURITY DEFINER com o mesmo guard de role já usado em admin_list_users()/
-- verify_receivable() (20260821000000). A function roda como dona da tabela
-- (bypassa RLS por definição de SECURITY DEFINER), então o resultado
-- agregado de todos os usuários continua existindo — só que agora é
-- inacessível a não ser pela própria function, chamada só por
-- GET /admin/reports/volume (requireRole admin/compliance no Express, mas a
-- autorização de verdade é o `raise exception` abaixo, não o middleware).
--
-- Depois desta migration, `transactions` só tem a policy original "usuário lê
-- as próprias" (20260811120000) — /reports/statement e /reports/financials
-- voltam a ser isolados por conta independente da role de quem chama, sem
-- precisar de nenhum filtro explícito de user_id nessas rotas (não têm
-- user_id pra filtrar: accounts é 1:1 hoje, o isolamento é via RLS mesmo).
--
-- NÃO reintroduza uma policy "staff le todas" em transactions sem também
-- auditar/corrigir reports.js — é exatamente essa combinação que causou o bug.
-- ============================================================================

drop policy "transactions: staff le todas" on public.transactions;

create or replace function public.admin_transactions_volume()
returns table (
  day date,
  in_cents bigint,
  out_cents bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'compliance')) then
    raise exception 'Apenas admin/compliance pode ver volume agregado';
  end if;

  return query
    select gs.day::date as day,
           coalesce(sum(t.amount_cents) filter (where t.type = 'credit'), 0)::bigint as in_cents,
           coalesce(sum(t.amount_cents) filter (where t.type = 'debit'), 0)::bigint as out_cents
      from generate_series(
             date_trunc('day', now()) - interval '29 days',
             date_trunc('day', now()),
             interval '1 day'
           ) as gs(day)
      left join public.transactions t
        on date_trunc('day', t.created_at) = gs.day
     group by gs.day
     order by gs.day;
end;
$$;

revoke all on function public.admin_transactions_volume() from public, anon;
grant execute on function public.admin_transactions_volume() to authenticated;
