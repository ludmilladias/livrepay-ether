-- ============================================================================
-- LIVREPAY — corrige vazamento de recebíveis pessoais via policy de staff
--
-- Bug: a policy "receivables: staff le todos" (20260821000000_admin_panel.sql)
-- foi criada só para o painel admin listar recebíveis pendentes de verificação
-- (GET /admin/receivables), mas RLS vale por sessão/role, não por rota —
-- qualquer admin/compliance que chamasse as rotas PESSOAIS GET /receivables e
-- GET /receivables/summary (server/src/routes/receivables.js, SEM filtro de
-- user_id nessas queries, porque a RLS "usuário lê os próprios" bastava até
-- aqui) passou a ler gross_cents/net_cents/due_date/status de recebíveis de
-- TODOS os usuários, não só o seu. Mesmo padrão do vazamento de `transactions`
-- corrigido em 20260906010000_fix_transactions_staff_leak.sql — mesma causa
-- raiz (policy ampla por role, sem saber qual rota está chamando), mesma
-- correção. Achado em 2026-10-06, nunca explorado em produção (sem evidência
-- de uso indevido).
--
-- Correção (causa raiz, não remendo em rota): derruba a policy ampla em
-- `receivables` e move a listagem agregada de /admin/receivables para uma
-- function SECURITY DEFINER com o mesmo guard de role já usado em
-- admin_transactions_volume() / verify_receivable() / admin_list_users()
-- (todas em migrations anteriores). A function roda como dona da tabela
-- (bypassa RLS por definição de SECURITY DEFINER), então o painel admin
-- continua enxergando recebíveis de todos os usuários — só que agora é
-- inacessível a não ser pela própria function.
--
-- Depois desta migration, `receivables` só tem a policy original "usuário lê
-- os próprios" (20260811120000) — /receivables e /receivables/summary voltam
-- a ser isolados por conta independente da role de quem chama, sem precisar
-- de nenhum filtro explícito de user_id nessas rotas (a RLS já faz isso).
--
-- NÃO reintroduza uma policy "staff le todos" em receivables sem também
-- auditar/corrigir receivables.js — é exatamente essa combinação que causou
-- o bug (igual já alertado em transactions.sql para reports.js).
-- ============================================================================

drop policy "receivables: staff le todos" on public.receivables;

create or replace function public.admin_receivables_list()
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
  owner_name text
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
           p.full_name as owner_name
      from public.receivables r
      left join public.receivable_contracts c on c.id = r.contract_id
      left join public.profiles p on p.id = r.user_id
     where r.status in ('scheduled', 'overdue')
     order by r.verified_at is not null, r.due_date asc
     limit 200;
end;
$$;

revoke all on function public.admin_receivables_list() from public, anon;
grant execute on function public.admin_receivables_list() to authenticated;
