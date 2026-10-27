-- ============================================================================
-- LIVREPAY — Carnê de cobrança (parcelamento em boletos independentes)
--
-- Contexto: decisão de produto (2026-10) de não ter folha de pagamento de
-- funcionário (ver remoção da navegação em src/App.tsx); no lugar, Cobrança
-- ganha "Carnê" — até 12 parcelas, cada uma um registro independente em
-- public.charges (kind='boleto', já existente, mesmo caminho de emissão via
-- Ether que BoléPIX já usa).
--
-- Decisão de produto explícita: parcela não paga afeta SÓ aquele boleto —
-- as demais seguem seu curso normalmente. Por isso não existe nenhuma coluna
-- de "status do carnê" nem trigger de cascata aqui: cada parcela já tem seu
-- próprio public.charges.status, e as policies de charges (cancelar
-- individualmente) já cobrem isso. installment_plans é só o agrupador/cabeçalho,
-- imutável após criado (igual à filosofia de charges: corrige cancelando/
-- recriando, não editando o que já existe).
-- ============================================================================

create table public.installment_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  customer_name text not null,
  customer_tax_id text not null,
  description text not null,
  total_installments smallint not null check (total_installments between 1 and 12),
  amount_per_installment_cents bigint not null check (amount_per_installment_cents > 0),
  first_due_date date not null,
  created_at timestamptz not null default now()
);

alter table public.installment_plans enable row level security;

-- Sem update/delete: cabeçalho do carnê não muda depois de criado (mesma
-- filosofia de charges — trilha de auditoria em vez de edição).
create policy "installment_plans: usuário lê os próprios"
  on public.installment_plans for select
  to authenticated
  using (user_id = auth.uid());

create policy "installment_plans: usuário cria os próprios"
  on public.installment_plans for insert
  to authenticated
  with check (user_id = auth.uid());

-- Cada parcela é uma linha de public.charges, ligada ao carnê. As policies
-- de charges (20260811120000_core_schema_security.sql) já cobrem leitura,
-- criação e cancelamento por dono — nada novo precisa ser escrito ali.
alter table public.charges
  add column installment_plan_id uuid references public.installment_plans(id) on delete cascade,
  add column installment_number smallint check (installment_number between 1 and 12);

create index charges_installment_plan_idx
  on public.charges (installment_plan_id)
  where installment_plan_id is not null;
