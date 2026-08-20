import { Router } from "express";
import { z } from "zod";
import { withUser } from "../db.js";
import { ApiError, asyncRoute, requireAuth } from "../middleware.js";

export const receivableContractsRouter = Router();
export const receivablesRouter = Router();

receivableContractsRouter.use(requireAuth);
receivablesRouter.use(requireAuth);

const newContract = z.object({
  name: z.string().trim().min(1, "Informe o nome do contrato").max(140),
  acquirer: z.string().trim().max(140).optional(),
});

const statusSchema = z.enum(["scheduled", "settled", "advanced", "overdue", "cancelled"]);

const newReceivable = z
  .object({
    contract_id: z.string().uuid().nullable().optional(),
    gross_cents: z.number().int().positive("Valor bruto deve ser maior que zero"),
    net_cents: z.number().int().positive("Valor líquido deve ser maior que zero"),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data de vencimento inválida"),
  })
  .refine((data) => data.net_cents <= data.gross_cents, {
    path: ["net_cents"],
    message: "O valor líquido não pode ser maior que o valor bruto",
  });

// --- Contratos de recebíveis -------------------------------------------------

receivableContractsRouter.get(
  "/",
  asyncRoute(async (req, res) => {
    const rows = await withUser(req.userId, async (client) => {
      const result = await client.query(
        `select c.*,
                coalesce(sum(r.gross_cents) filter (where r.status in ('scheduled','overdue')), 0)::bigint as pending_cents
           from public.receivable_contracts c
           left join public.receivables r on r.contract_id = c.id
          group by c.id
          order by c.created_at desc`,
      );
      return result.rows;
    });
    res.json(rows);
  }),
);

receivableContractsRouter.post(
  "/",
  asyncRoute(async (req, res) => {
    const parsed = newContract.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues.map((i) => i.message).join("; "));
    }
    const { name, acquirer } = parsed.data;

    const contract = await withUser(req.userId, async (client) => {
      const { rows } = await client.query(
        `insert into public.receivable_contracts (user_id, name, acquirer)
         values ($1, $2, $3) returning *`,
        [req.userId, name, acquirer ?? null],
      );
      return rows[0];
    });

    res.status(201).json(contract);
  }),
);

// --- Recebíveis agendados ----------------------------------------------------

receivablesRouter.get(
  "/",
  asyncRoute(async (req, res) => {
    const statusFilter = req.query.status ? statusSchema.safeParse(req.query.status) : null;
    if (statusFilter && !statusFilter.success) {
      throw new ApiError(400, "Parâmetro 'status' inválido");
    }

    const rows = await withUser(req.userId, async (client) => {
      const result = await client.query(
        `select r.*, c.name as contract_name, c.acquirer as contract_acquirer
           from public.receivables r
           left join public.receivable_contracts c on c.id = r.contract_id
          where ($1::text is null or r.status = $1::public.receivable_status)
          order by r.due_date asc
          limit 200`,
        [statusFilter?.data ?? null],
      );
      return result.rows;
    });

    res.json(rows);
  }),
);

receivablesRouter.get(
  "/summary",
  asyncRoute(async (req, res) => {
    const rows = await withUser(req.userId, async (client) => {
      const result = await client.query(
        `select status, count(*)::int as count, coalesce(sum(gross_cents), 0)::bigint as gross_cents
           from public.receivables
          group by status`,
      );
      return result.rows;
    });
    res.json(rows);
  }),
);

receivablesRouter.post(
  "/",
  asyncRoute(async (req, res) => {
    const parsed = newReceivable.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues.map((i) => i.message).join("; "));
    }
    const { contract_id, gross_cents, net_cents, due_date } = parsed.data;

    const receivable = await withUser(req.userId, async (client) => {
      const { rows } = await client.query(
        `insert into public.receivables (user_id, contract_id, gross_cents, net_cents, due_date)
         values ($1, $2, $3, $4, $5) returning *`,
        [req.userId, contract_id ?? null, gross_cents, net_cents, due_date],
      );
      return rows[0];
    });

    res.status(201).json(receivable);
  }),
);

receivablesRouter.patch(
  "/:id/cancel",
  asyncRoute(async (req, res) => {
    // Só recebíveis agendados/atrasados podem ser cancelados (mesma regra da
    // policy de UPDATE) — liquidados ou já antecipados não retrocedem.
    const receivable = await withUser(req.userId, async (client) => {
      const { rows } = await client.query(
        `update public.receivables set status = 'cancelled'
          where id = $1 returning *`,
        [req.params.id],
      );
      return rows[0];
    });

    if (!receivable) throw new ApiError(404, "Recebível não encontrado ou não pode mais ser cancelado");
    res.json(receivable);
  }),
);

/**
 * Antecipa um recebível: credita o valor líquido na conta agora, em troca do
 * desconto já embutido em `net_cents` na criação do registro. Diferente de
 * Pagamentos, isto não passa pela Ether — é um crédito interno do LIVREPAY.
 *
 * O crédito só acontece dentro de `advance_receivable()` (SECURITY DEFINER),
 * que exige `verified_at` preenchido. Sem isso, qualquer usuário poderia
 * criar um recebível com valor arbitrário e "antecipá-lo" — creditando
 * dinheiro que nunca existiu. Ver POST /:id/verify (admin) e migration
 * 20260820000000_close_settlement_gaps.sql.
 */
receivablesRouter.post(
  "/:id/advance",
  asyncRoute(async (req, res) => {
    const result = await withUser(req.userId, async (client) => {
      const { rows } = await client.query(`select public.advance_receivable($1) as receivable`, [
        req.params.id,
      ]);
      return rows[0].receivable;
    });
    res.json(result);
  }),
);

/**
 * Verifica um recebível (admin): confirma que o valor corresponde a um
 * crédito real (contrato, conciliação com adquirente etc.) antes de liberar
 * a antecipação. `verify_receivable()` rejeita quem não tiver a role admin.
 */
receivablesRouter.post(
  "/:id/verify",
  asyncRoute(async (req, res) => {
    const result = await withUser(req.userId, async (client) => {
      const { rows } = await client.query(`select public.verify_receivable($1) as receivable`, [
        req.params.id,
      ]);
      return rows[0].receivable;
    });
    res.json(result);
  }),
);
