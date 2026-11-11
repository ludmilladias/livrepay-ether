import { Router } from "express";
import { z } from "zod";
import { withUser } from "../db.js";
import { ApiError, asyncRoute, requireAuth, validate } from "../middleware.js";

/**
 * Painel de operação de um tenant (ex.: VARKI). A equipe do tenant vê e opera SÓ
 * os clientes do próprio tenant.
 *
 * Esta rota NÃO decide nada: cada função tenant_*() no banco (SECURITY DEFINER)
 * exige tenant_staff do chamador e filtra por profiles.tenant_id. Quem não é
 * equipe recebe 403 (42501). Não reaproveita /admin de propósito: aquele é da
 * plataforma (user_roles globais, withService, credenciais da Ether).
 */
export const tenantRouter = Router();

tenantRouter.use(requireAuth);

const idParam = (value) => {
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) throw new ApiError(400, "Identificador inválido");
  return parsed.data;
};

// Recebível de outro tenant, o próprio da pessoa ou já analisado: tratado como inexistente.
function notFoundAsApiError(error) {
  if (String(error?.message ?? "").includes("não encontrado neste tenant")) {
    return new ApiError(404, "Recebível não encontrado ou já analisado");
  }
  return error;
}

function listRoute(path, fn) {
  tenantRouter.get(
    path,
    asyncRoute(async (req, res) => {
      const rows = await withUser(req.userId, async (client) => {
        const result = await client.query(`select * from public.${fn}()`);
        return result.rows;
      });
      res.json(rows);
    }),
  );
}

tenantRouter.get(
  "/overview",
  asyncRoute(async (req, res) => {
    const row = await withUser(req.userId, async (client) => {
      const result = await client.query(`select * from public.tenant_overview()`);
      return result.rows[0];
    });
    res.json(row);
  }),
);

listRoute("/customers", "tenant_list_customers");
listRoute("/receivables", "tenant_receivables_list");
listRoute("/payments", "tenant_payments_list");
listRoute("/movement", "tenant_daily_movement");

// Saldo, movimento de 30 dias e uso dos limites da PRÓPRIA agência.
tenantRouter.get(
  "/agency",
  asyncRoute(async (req, res) => {
    const row = await withUser(req.userId, async (client) => {
      const result = await client.query(`select * from public.tenant_agency_status()`);
      return result.rows[0];
    });
    res.json(row);
  }),
);

tenantRouter.post(
  "/receivables/:id/approve",
  asyncRoute(async (req, res) => {
    const id = idParam(req.params.id);
    try {
      const row = await withUser(req.userId, async (client) => {
        // Pré-aprovação: NÃO libera crédito; a verificação final é da plataforma (admin/compliance).
        // "select * from fn(...)": nunca "select (fn(...)).*" (chamaria a função por coluna).
        const { rows } = await client.query(`select * from public.tenant_approve_receivable($1)`, [id]);
        return rows[0];
      });
      res.json(row);
    } catch (error) {
      throw notFoundAsApiError(error);
    }
  }),
);

tenantRouter.post(
  "/receivables/:id/reject",
  validate(z.object({ reason: z.string().trim().min(3, "Informe o motivo da recusa").max(500) })),
  asyncRoute(async (req, res) => {
    const id = idParam(req.params.id);
    try {
      const row = await withUser(req.userId, async (client) => {
        const { rows } = await client.query(`select * from public.tenant_reject_receivable($1, $2)`, [
          id,
          req.body.reason,
        ]);
        return rows[0];
      });
      res.json(row);
    } catch (error) {
      throw notFoundAsApiError(error);
    }
  }),
);
