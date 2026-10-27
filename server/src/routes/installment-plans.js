import { Router } from "express";
import { z } from "zod";
import { withUser } from "../db.js";
import { ApiError, asyncRoute, requireAuth, validate } from "../middleware.js";
import { isValidCpf, isValidCnpj } from "../br-docs.js";

export const installmentPlansRouter = Router();
installmentPlansRouter.use(requireAuth);

/**
 * Carnê de cobrança: N parcelas, cada uma um registro independente em
 * public.charges (kind='boleto'). Parcela não paga afeta só aquele boleto —
 * não há cascata entre parcelas (decisão de produto, 2026-10).
 */
const newPlan = z.object({
  customerName: z.string().trim().min(1, "Informe o cliente").max(140),
  customerTaxId: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ""))
    .refine((v) => isValidCpf(v) || isValidCnpj(v), "CPF ou CNPJ inválido"),
  description: z.string().trim().min(1, "Informe a descrição").max(140),
  amountPerInstallmentCents: z.number().int().positive("Valor da parcela deve ser maior que zero"),
  totalInstallments: z.number().int().min(1).max(12, "Máximo de 12 parcelas"),
  firstDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida"),
});

installmentPlansRouter.get(
  "/",
  asyncRoute(async (req, res) => {
    // Sem filtro por user_id: a RLS já restringe ao dono.
    const rows = await withUser(req.userId, async (client) => {
      const { rows } = await client.query(`
        select p.*,
               count(c.id)::int as created_charges,
               count(c.id) filter (where c.status = 'paid')::int as paid_count,
               count(c.id) filter (where c.status = 'cancelled')::int as cancelled_count,
               min(c.due_date) filter (where c.status in ('draft', 'pending')) as next_due_date
          from public.installment_plans p
          left join public.charges c on c.installment_plan_id = p.id
         group by p.id
         order by p.created_at desc
         limit 100
      `);
      return rows;
    });

    res.json(rows);
  }),
);

installmentPlansRouter.get(
  "/:id",
  asyncRoute(async (req, res) => {
    const { plan, charges } = await withUser(req.userId, async (client) => {
      const planResult = await client.query(
        `select * from public.installment_plans where id = $1`,
        [req.params.id],
      );
      const chargesResult = await client.query(
        `select * from public.charges
          where installment_plan_id = $1
          order by installment_number`,
        [req.params.id],
      );
      return { plan: planResult.rows[0], charges: chargesResult.rows };
    });

    if (!plan) throw new ApiError(404, "Carnê não encontrado");
    res.json({ ...plan, charges });
  }),
);

installmentPlansRouter.post(
  "/",
  validate(newPlan),
  asyncRoute(async (req, res) => {
    const b = req.body;

    const { plan, charges } = await withUser(req.userId, async (client) => {
      const { rows: planRows } = await client.query(
        `insert into public.installment_plans
           (user_id, customer_name, customer_tax_id, description,
            total_installments, amount_per_installment_cents, first_due_date)
         values ($1, $2, $3, $4, $5, $6, $7)
         returning *`,
        [
          req.userId,
          b.customerName,
          b.customerTaxId,
          b.description,
          b.totalInstallments,
          b.amountPerInstallmentCents,
          b.firstDueDate,
        ],
      );
      const plan = planRows[0];

      // Uma parcela por mês a partir de first_due_date. generate_series cobre
      // as N parcelas numa única inserção, sem laço em JS.
      const { rows: chargeRows } = await client.query(
        `insert into public.charges
           (user_id, kind, status, description, amount_cents, due_date,
            customer_name, customer_tax_id, installment_plan_id, installment_number)
         select $1, 'boleto', 'pending',
                $2 || ' — parcela ' || n || '/' || $3,
                $4,
                ($5::date + ((n - 1) || ' months')::interval)::date,
                $6, $7, $8, n
           from generate_series(1, $3) as n
         returning *`,
        [
          req.userId,
          b.description,
          b.totalInstallments,
          b.amountPerInstallmentCents,
          b.firstDueDate,
          b.customerName,
          b.customerTaxId,
          plan.id,
        ],
      );

      return { plan, charges: chargeRows };
    });

    res.status(201).json({ ...plan, charges });
  }),
);
