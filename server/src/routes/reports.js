import { Router } from "express";
import { z } from "zod";
import { withUser } from "../db.js";
import { ApiError, asyncRoute, requireAuth } from "../middleware.js";

export const reportsRouter = Router();

reportsRouter.use(requireAuth);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data deve ser YYYY-MM-DD");

// --- Fluxo de caixa (dashboard do cliente) ------------------------------------
//
// Agrega o próprio ledger (public.transactions) por dia, últimos 30 dias.
// RLS "transactions: usuário lê as próprias" já garante que só vem o que é do
// usuário logado — nenhum filtro por user_id é necessário aqui.
reportsRouter.get(
  "/cashflow",
  asyncRoute(async (req, res) => {
    const rows = await withUser(req.userId, async (client) => {
      const result = await client.query(
        `select day::date as day,
                coalesce(sum(amount_cents) filter (where type = 'credit'), 0)::bigint as in_cents,
                coalesce(sum(amount_cents) filter (where type = 'debit'), 0)::bigint as out_cents
           from generate_series(
                  date_trunc('day', now()) - interval '29 days',
                  date_trunc('day', now()),
                  interval '1 day'
                ) as day
           left join public.transactions t
             on date_trunc('day', t.created_at) = day
          group by day
          order by day`,
      );
      return result.rows;
    });
    res.json(rows);
  }),
);

// --- Extrato (Relatórios > Extratos) -------------------------------------------
//
// Extrato de verdade a partir do ledger imutável — sem tabela de "extratos
// gerados" nem contador fictício: o próprio período consultado É o extrato.
reportsRouter.get(
  "/statement",
  asyncRoute(async (req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const firstOfMonth = today.slice(0, 8) + "01";

    const parsed = z
      .object({
        from: isoDate.default(firstOfMonth),
        to: isoDate.default(today),
      })
      .safeParse(req.query);

    if (!parsed.success) {
      throw new ApiError(400, "Parâmetros from/to inválidos (YYYY-MM-DD)");
    }
    const { from, to } = parsed.data;
    if (from > to) throw new ApiError(400, "'from' não pode ser depois de 'to'");

    const statement = await withUser(req.userId, async (client) => {
      const account = await client.query(
        `select balance_cents from public.accounts where user_id = auth.uid() limit 1`,
      );
      const currentBalance = account.rows[0]?.balance_cents ?? 0;

      const range = await client.query(
        `select id, type, amount_cents, balance_before_cents, balance_after_cents,
                description, reference_table, created_at
           from public.transactions
          where created_at >= $1::date and created_at < ($2::date + interval '1 day')
          order by seq asc`,
        [from, to],
      );

      const first = range.rows[0];
      const last = range.rows[range.rows.length - 1];
      const openingBalance = first ? first.balance_before_cents : currentBalance;
      const closingBalance = last ? last.balance_after_cents : currentBalance;
      const totalIn = range.rows
        .filter((r) => r.type === "credit")
        .reduce((sum, r) => sum + r.amount_cents, 0);
      const totalOut = range.rows
        .filter((r) => r.type === "debit")
        .reduce((sum, r) => sum + r.amount_cents, 0);

      return {
        from,
        to,
        opening_balance_cents: openingBalance,
        closing_balance_cents: closingBalance,
        total_in_cents: totalIn,
        total_out_cents: totalOut,
        transaction_count: range.rows.length,
        transactions: range.rows.reverse(),
      };
    });
    res.json(statement);
  }),
);

// --- Conciliação (Relatórios > Conciliação) ------------------------------------
//
// Não existe extrato bancário externo pra conciliar contra (a Ether não
// devolve um feed de conta corrente — ver PENDING.md) — o que É real e vale
// checar é a integridade interna: toda cobrança paga e todo pagamento
// concluído tem que ter EXATAMENTE uma linha correspondente no ledger
// (process_transaction() grava as duas coisas na mesma transação SQL). Uma
// divergência aqui não é "banco bateu diferente", é sinal de bug de dados.
reportsRouter.get(
  "/reconciliation",
  asyncRoute(async (req, res) => {
    const rows = await withUser(req.userId, async (client) => {
      const result = await client.query(
        `select 'charge'::text as source, c.id, c.kind::text as kind, c.description,
                c.amount_cents, c.updated_at as settled_at,
                exists (
                  select 1 from public.transactions t
                   where t.reference_table = 'charges' and t.reference_id = c.id
                ) as reconciled
           from public.charges c
          where c.status = 'paid'
          union all
         select 'payment'::text as source, p.id, p.kind::text as kind,
                coalesce(p.recipient_name, p.kind::text) as description,
                p.amount_cents, p.executed_at as settled_at,
                exists (
                  select 1 from public.transactions t
                   where t.reference_table = 'payments' and t.reference_id = p.id
                ) as reconciled
           from public.payments p
          where p.status = 'completed'
          order by settled_at desc
          limit 500`,
      );
      return result.rows;
    });

    const total = rows.length;
    const divergent = rows.filter((r) => !r.reconciled);
    res.json({
      total,
      reconciled_count: total - divergent.length,
      divergent_count: divergent.length,
      divergent_items: divergent,
      items: rows,
    });
  }),
);

// --- Financeiro (Relatórios > Financeiro) --------------------------------------
reportsRouter.get(
  "/financials",
  asyncRoute(async (req, res) => {
    const months = Math.min(Math.max(Number(req.query.months) || 12, 1), 24);

    const financials = await withUser(req.userId, async (client) => {
      const [balance, period30d, monthly, revenueByKind, expenseByKind] = await Promise.all([
        client.query(
          `select balance_cents from public.accounts where user_id = auth.uid() limit 1`,
        ),
        client.query(
          `select coalesce(sum(amount_cents) filter (where type = 'credit'), 0)::bigint as in_cents,
                  coalesce(sum(amount_cents) filter (where type = 'debit'), 0)::bigint as out_cents
             from public.transactions
            where created_at >= now() - interval '30 days'`,
        ),
        client.query(
          `select month::date as month,
                  coalesce(sum(amount_cents) filter (where type = 'credit'), 0)::bigint as in_cents,
                  coalesce(sum(amount_cents) filter (where type = 'debit'), 0)::bigint as out_cents
             from generate_series(
                    date_trunc('month', now()) - interval '1 month' * ($1::int - 1),
                    date_trunc('month', now()),
                    interval '1 month'
                  ) as month
             left join public.transactions t
               on date_trunc('month', t.created_at) = month
            group by month
            order by month`,
          [months],
        ),
        client.query(
          `select kind::text as kind, coalesce(sum(amount_cents), 0)::bigint as total_cents
             from public.charges
            where status = 'paid' and updated_at >= now() - interval '30 days'
            group by kind
            order by total_cents desc`,
        ),
        client.query(
          `select kind::text as kind, coalesce(sum(amount_cents), 0)::bigint as total_cents
             from public.payments
            where status = 'completed' and executed_at >= now() - interval '30 days'
            group by kind
            order by total_cents desc`,
        ),
      ]);

      const revenueCents = period30d.rows[0].in_cents;
      const expenseCents = period30d.rows[0].out_cents;

      return {
        period_days: 30,
        balance_cents: balance.rows[0]?.balance_cents ?? 0,
        revenue_cents: revenueCents,
        expense_cents: expenseCents,
        net_cents: revenueCents - expenseCents,
        monthly: monthly.rows,
        revenue_by_kind: revenueByKind.rows,
        expense_by_kind: expenseByKind.rows,
      };
    });
    res.json(financials);
  }),
);
