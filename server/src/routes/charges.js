import { Router } from "express";
import { z } from "zod";
import { withUser, withService } from "../db.js";
import { ApiError, asyncRoute, requireAuth, validate } from "../middleware.js";
import { createPixDeposit, idempotencyKeyFrom, EtherError } from "../ether.js";

export const chargesRouter = Router();
chargesRouter.use(requireAuth);

const PIX_EXPIRATION_SECONDS = 3600;

const kindSchema = z.enum(["link", "boleto", "pix", "assinatura"]);

const newCharge = z.object({
  kind: kindSchema,
  description: z.string().trim().min(1, "Informe a descrição").max(140),
  // Centavos: inteiro positivo. Nunca aceitamos float de dinheiro.
  amount_cents: z.number().int().positive("Valor deve ser maior que zero"),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  customer_name: z.string().trim().max(140).nullable().optional(),
  payload: z.record(z.unknown()).optional(),
});

chargesRouter.get(
  "/",
  asyncRoute(async (req, res) => {
    const kind = kindSchema.safeParse(req.query.kind);
    if (!kind.success) throw new ApiError(400, "Parâmetro 'kind' inválido");

    // Sem filtro por user_id: a RLS já restringe ao dono.
    const rows = await withUser(req.userId, async (client) => {
      const result = await client.query(
        `select * from public.charges
          where kind = $1
          order by created_at desc
          limit 100`,
        [kind.data],
      );
      return result.rows;
    });

    res.json(rows);
  }),
);

chargesRouter.get(
  "/stats",
  asyncRoute(async (req, res) => {
    const kind = kindSchema.safeParse(req.query.kind);
    if (!kind.success) throw new ApiError(400, "Parâmetro 'kind' inválido");

    // Agregação no banco em vez de trazer todas as linhas para somar em JS.
    const stats = await withUser(req.userId, async (client) => {
      const { rows } = await client.query(
        `select count(*)::int                                        as total,
                count(*) filter (where status = 'paid')::int          as paid,
                coalesce(sum(amount_cents), 0)::bigint                as total_cents
           from public.charges where kind = $1`,
        [kind.data],
      );
      return rows[0];
    });

    res.json({
      total: stats.total,
      paid: stats.paid,
      paid_rate: stats.total ? (stats.paid / stats.total) * 100 : 0,
      total_cents: stats.total_cents,
    });
  }),
);

chargesRouter.post(
  "/",
  validate(newCharge),
  asyncRoute(async (req, res) => {
    const b = req.body;
    const charge = await withUser(req.userId, async (client) => {
      const { rows } = await client.query(
        `insert into public.charges
           (user_id, kind, status, description, amount_cents, due_date, customer_name, payload)
         values ($1, $2, 'pending', $3, $4, $5, $6, $7)
         returning *`,
        [
          req.userId,
          b.kind,
          b.description,
          b.amount_cents,
          b.due_date ?? null,
          b.customer_name ?? null,
          b.payload ?? {},
        ],
      );
      return rows[0];
    });

    res.status(201).json(charge);
  }),
);

chargesRouter.patch(
  "/:id/cancel",
  asyncRoute(async (req, res) => {
    // Cobrança nunca é apagada — a policy só permite alterar status enquanto
    // estiver em draft/pending.
    const charge = await withUser(req.userId, async (client) => {
      const { rows } = await client.query(
        `update public.charges set status = 'cancelled'
          where id = $1 returning *`,
        [req.params.id],
      );
      return rows[0];
    });

    if (!charge) throw new ApiError(404, "Cobrança não encontrada ou já finalizada");
    res.json(charge);
  }),
);

/**
 * Emite a cobrança no provedor (Ether) e grava o código PIX.
 * O usuário nunca fala com a Ether: as credenciais vivem só aqui.
 */
chargesRouter.post(
  "/:id/emit",
  asyncRoute(async (req, res) => {
    const charge = await withUser(req.userId, async (client) => {
      const { rows } = await client.query(
        `select id, kind, status, amount_cents, provider_charge_id
           from public.charges where id = $1`,
        [req.params.id],
      );
      return rows[0];
    });

    if (!charge) throw new ApiError(404, "Cobrança não encontrada");
    if (charge.kind !== "pix") throw new ApiError(400, "Apenas cobranças PIX podem ser emitidas");
    if (charge.status !== "draft" && charge.status !== "pending") {
      throw new ApiError(409, `Cobrança com status ${charge.status} não pode ser emitida`);
    }
    if (charge.provider_charge_id) {
      throw new ApiError(409, "Cobrança já emitida no provedor");
    }

    let deposit;
    try {
      deposit = await createPixDeposit(
        charge.amount_cents,
        PIX_EXPIRATION_SECONDS,
        idempotencyKeyFrom(charge.id),
      );
    } catch (error) {
      console.error("Ether recusou a emissão", {
        chargeId: charge.id,
        detail: error instanceof EtherError ? error.body : String(error),
      });
      throw new ApiError(502, "Provedor recusou a emissão da cobrança");
    }

    // Campos do provedor são gravados com privilégio de serviço: o usuário não
    // pode escrever provider_* por conta própria.
    await withService(async (client) => {
      await client.query(
        `update public.charges
            set status = 'pending', provider = 'ether',
                provider_charge_id = $2, provider_status = $3,
                txid = $4, emitted_at = now(),
                payload = payload || jsonb_build_object(
                  'pix_copy_paste', $5::text,
                  'qr_code_id', $4::text,
                  'expire_at', $6::text)
          where id = $1`,
        [
          charge.id,
          deposit.uuid,
          deposit.status,
          deposit.qrCodeId,
          deposit.pixKey,
          deposit.expireAt,
        ],
      );
    }).catch((error) => {
      // A cobrança existe na Ether mas não conseguimos gravar. Registramos
      // para conciliação em vez de fingir falha total.
      console.error("PIX emitido na Ether mas falhou ao gravar", {
        chargeId: charge.id,
        etherUuid: deposit.uuid,
        error,
      });
      throw new ApiError(500, "Cobrança emitida, mas houve falha ao salvar. Contate o suporte.");
    });

    res.json({
      charge_id: charge.id,
      pix_copy_paste: deposit.pixKey,
      qr_code_id: deposit.qrCodeId,
      expire_at: deposit.expireAt,
    });
  }),
);
