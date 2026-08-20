import { Router } from "express";
import { withUser } from "../db.js";
import { asyncRoute, requireAuth } from "../middleware.js";

export const coreRouter = Router();
coreRouter.use(requireAuth);

/** Saldo da conta principal (centavos). Fonte da verdade é o banco. */
coreRouter.get(
  "/accounts/balance",
  asyncRoute(async (req, res) => {
    const balance = await withUser(req.userId, async (client) => {
      const { rows } = await client.query(
        `select balance_cents from public.accounts order by created_at limit 1`,
      );
      return rows[0]?.balance_cents ?? 0;
    });
    res.json({ balance_cents: balance });
  }),
);

coreRouter.get(
  "/accounts",
  asyncRoute(async (req, res) => {
    const rows = await withUser(req.userId, async (client) => {
      const result = await client.query(
        `select id, name, status, currency, balance_cents, created_at
           from public.accounts order by created_at`,
      );
      return result.rows;
    });
    res.json(rows);
  }),
);

/** Extrato. Ordenado por `seq` — created_at empata dentro da mesma transação. */
coreRouter.get(
  "/transactions",
  asyncRoute(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const rows = await withUser(req.userId, async (client) => {
      const result = await client.query(
        `select seq, id, type, amount_cents, balance_after_cents,
                description, reference_table, reference_id, created_at
           from public.transactions
          order by seq desc
          limit $1`,
        [limit],
      );
      return result.rows;
    });
    res.json(rows);
  }),
);

coreRouter.get(
  "/alerts",
  asyncRoute(async (req, res) => {
    const rows = await withUser(req.userId, async (client) => {
      const result = await client.query(
        `select id, type, title, description, read, created_at
           from public.alerts order by created_at desc limit 50`,
      );
      return result.rows;
    });
    res.json(rows);
  }),
);

coreRouter.patch(
  "/alerts/:id/read",
  asyncRoute(async (req, res) => {
    await withUser(req.userId, async (client) => {
      await client.query(`update public.alerts set read = true where id = $1`, [req.params.id]);
    });
    res.status(204).end();
  }),
);
