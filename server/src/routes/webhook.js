import crypto from "node:crypto";
import { Router } from "express";
import { config } from "../config.js";
import { withService } from "../db.js";
import { asyncRoute } from "../middleware.js";

export const webhookRouter = Router();

/** Comparação em tempo constante — evita descobrir o segredo por timing. */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Aplica um evento do provedor (dado já validado/persistido) contra o
 * ledger. Usada pelo webhook em tempo real E pelo reprocessamento manual no
 * painel admin (`POST /admin/provider-events/:id/reprocess`) — mesma lógica,
 * sem duplicar a idempotência que já vive dentro de cada função SQL
 * chamada aqui (`provider_confirm_charge`, `provider_complete_payment`,
 * `provider_fail_payment`).
 */
export async function processProviderEvent(client, { eventType, payload, eventId }) {
  switch (eventType) {
    case "pix.deposit.confirmed": {
      const providerId = payload.pixId;
      const amount = payload.amount;
      if (!providerId || typeof amount !== "number") {
        throw new Error("payload sem pixId/amount");
      }

      const { rows } = await client.query(
        `select id from public.charges
          where provider = 'ether' and provider_charge_id = $1`,
        [providerId],
      );
      if (!rows[0]) throw new Error(`nenhuma cobrança para pixId ${providerId}`);

      // Idempotente: se já estiver 'paid', não credita de novo.
      await client.query(`select public.provider_confirm_charge($1, $2, $3, $4)`, [
        rows[0].id,
        amount,
        payload.status ?? null,
        { e2e: payload.e2e ?? null, provider_event_id: eventId },
      ]);
      break;
    }

    case "pix.withdraw.confirmed": {
      const providerId = payload.pixId;
      if (!providerId) throw new Error("payload sem pixId");

      const { rows } = await client.query(
        `select id from public.payments
          where provider = 'ether' and provider_payment_id = $1`,
        [providerId],
      );
      if (!rows[0]) throw new Error(`nenhum pagamento para pixId ${providerId}`);

      await client.query(`select public.provider_complete_payment($1, $2, $3)`, [
        rows[0].id,
        providerId,
        payload.status ?? null,
      ]);
      break;
    }

    case "pix.withdraw.failed": {
      const providerId = payload.pixId;
      if (!providerId) throw new Error("payload sem pixId");

      const { rows } = await client.query(
        `select id, status from public.payments
          where provider = 'ether' and provider_payment_id = $1`,
        [providerId],
      );
      if (!rows[0]) throw new Error(`nenhum pagamento para pixId ${providerId}`);

      // Só estorna o que ainda está em processamento. Falha reportada para
      // algo já concluído exige conciliação, não mexer no saldo.
      if (rows[0].status !== "processing") {
        throw new Error(
          `falha reportada para pagamento em status ${rows[0].status} — requer conciliação`,
        );
      }

      await client.query(`select public.provider_fail_payment($1, $2)`, [
        rows[0].id,
        "Provedor reportou falha no saque PIX",
      ]);
      break;
    }

    // Eventos conhecidos que ainda não exigem ação do nosso lado.
    case "pix.created":
    case "user.status":
    case "pix.exchange.updated":
      break;

    default:
      console.warn("Evento não tratado", eventType);
  }
}

/**
 * Roda `processProviderEvent` e grava o resultado em `provider_events`
 * (limpa `error` em caso de sucesso — importante para reprocessamento: um
 * evento corrigido não deve continuar aparecendo como "com erro").
 */
export async function runProviderEvent(storedId, { eventType, payload, eventId }) {
  try {
    await withService(async (client) => {
      await processProviderEvent(client, { eventType, payload, eventId });
      await client.query(
        `update public.provider_events set processed_at = now(), error = null where id = $1`,
        [storedId],
      );
    });
    return { status: "ok" };
  } catch (error) {
    const message = error?.message ?? String(error);
    console.error("Falha ao processar evento do provedor", { eventId, eventType, message });

    await withService(async (client) => {
      await client.query(`update public.provider_events set error = $2 where id = $1`, [
        storedId,
        message,
      ]);
    }).catch(() => {});

    return { status: "stored_with_error", error: message };
  }
}

/**
 * Webhook da Ether. Rota pública (o provedor não tem JWT de usuário), então a
 * autenticação é por segredo compartilhado.
 *
 * Aceita duas formas de autenticação (a que chegar primeiro):
 *  1. Header `x-webhook-secret` (preferível se o provedor suportar)
 *  2. Token no path: POST /ether/:token (fallback — a Ether só configura URL)
 *
 * Garantias:
 *  - Persistimos o payload ANTES de processar: se o processamento falhar, o
 *    evento não se perde e pode ser reprocessado.
 *  - Idempotência por (provider, event_id) UNIQUE: reentrega não credita 2x.
 */
webhookRouter.post(
  ["/ether", "/ether/:token"],
  asyncRoute(async (req, res) => {
    if (!config.ether.webhookSecret) {
      console.error("ETHER_WEBHOOK_SECRET não configurado — rejeitando tudo");
      return res.status(401).json({ error: "unauthorized" });
    }

    // Aceita segredo via header ou via path param (a Ether não documenta
    // suporte a headers customizados, então o token na URL é o fallback).
    const provided =
      req.get("x-webhook-secret") || req.params.token || "";
    if (!safeEqual(provided, config.ether.webhookSecret)) {
      return res.status(401).json({ error: "unauthorized" });
    }

    const envelope = req.body ?? {};
    const eventId = envelope.id;
    const eventType = envelope.eventType ?? envelope.data?.event;
    if (!eventId || !eventType) {
      return res.status(400).json({ error: "missing id or eventType" });
    }

    // Registro do evento numa transação própria: mesmo que o processamento
    // falhe depois, o recebimento fica gravado.
    let storedId;
    try {
      storedId = await withService(async (client) => {
        const { rows } = await client.query(
          `insert into public.provider_events (provider, event_id, event_type, payload)
           values ('ether', $1, $2, $3) returning id`,
          [eventId, eventType, envelope],
        );
        return rows[0].id;
      });
    } catch (error) {
      if (error.code === "23505") {
        // Já recebemos: responder 200 para o provedor parar de reenviar.
        return res.json({ status: "duplicate_ignored" });
      }
      console.error("Falha ao registrar evento do provedor", error);
      return res.status(500).json({ error: "storage failure" });
    }

    const payload = envelope.data?.data ?? {};
    const result = await runProviderEvent(storedId, { eventType, payload, eventId });
    return res.json(result);
  }),
);
