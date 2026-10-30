import crypto from "node:crypto";
import { Router } from "express";
import { config } from "../config.js";
import { withService } from "../db.js";
import { asyncRoute } from "../middleware.js";
import { errorLogFields } from "../safeLog.js";
import { normalizePixPayload } from "../etherEvents.js";

export const webhookRouter = Router();

const MAX_AGE_SECONDS = 300;
const MAX_FUTURE_SKEW_SECONDS = 60;

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
      const pix = normalizePixPayload(payload);
      if (!pix.ids.length || pix.amount === null) {
        throw new Error("payload sem pixId/amount");
      }

      const { rows } = await client.query(
        `select id from public.charges
          where provider = 'ether' and provider_charge_id = any($1::text[])`,
        [pix.ids],
      );
      if (!rows[0]) throw new Error(`nenhuma cobrança para pixId ${pix.ids[0]}`);
      if (rows.length > 1) throw new Error(`pixId ${pix.ids[0]} casa com mais de uma cobrança`);

      // Idempotente: se já estiver 'paid', não credita de novo.
      await client.query(`select public.provider_confirm_charge($1, $2, $3, $4)`, [
        rows[0].id,
        pix.amount,
        pix.status,
        { e2e: pix.e2e, provider_event_id: eventId },
      ]);
      break;
    }

    case "pix.withdraw.confirmed": {
      const pix = normalizePixPayload(payload);
      if (!pix.ids.length) throw new Error("payload sem pixId");

      const { rows } = await client.query(
        `select id, provider_payment_id from public.payments
          where provider = 'ether' and provider_payment_id = any($1::text[])`,
        [pix.ids],
      );
      if (!rows[0]) throw new Error(`nenhum pagamento para pixId ${pix.ids[0]}`);
      if (rows.length > 1) throw new Error(`pixId ${pix.ids[0]} casa com mais de um pagamento`);

      await client.query(`select public.provider_complete_payment($1, $2, $3)`, [
        rows[0].id,
        rows[0].provider_payment_id,
        pix.status,
      ]);
      break;
    }

    case "pix.withdraw.failed": {
      const pix = normalizePixPayload(payload);
      if (!pix.ids.length) throw new Error("payload sem pixId");

      const { rows } = await client.query(
        `select id, status from public.payments
          where provider = 'ether' and provider_payment_id = any($1::text[])`,
        [pix.ids],
      );
      if (!rows[0]) throw new Error(`nenhum pagamento para pixId ${pix.ids[0]}`);
      if (rows.length > 1) throw new Error(`pixId ${pix.ids[0]} casa com mais de um pagamento`);

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
 * Webhook da Ether. Rota pública (o provedor não tem JWT de usuário).
 *
 * Assinatura (formato confirmado pelo suporte da Ether em 2026-10-30):
 *  - x-ether-timestamp: momento do envio, em MILISSEGUNDOS.
 *  - x-ether-signature: "sha256=<hex>".
 *  - hex = HMAC-SHA256(segredo do webhook, `${timestamp}.${corpoBruto}`), sobre os
 *    bytes recebidos (req.rawBody), nunca o JSON re-serializado.
 *  - Replay: rejeitamos timestamp com mais de 5 minutos no passado ou mais de 60s
 *    no futuro (recomendação da Ether: recusar notificação muito antiga).
 *  - Comparação em tempo constante.
 *
 * Garantias:
 *  - Persistimos o payload ANTES de processar: se o processamento falhar, o
 *    evento não se perde e pode ser reprocessado.
 *  - Idempotência por (provider, event_id) UNIQUE: reentrega não credita 2x.
 */
/**
 * Valida a assinatura HMAC (x-ether-signature) ou, na ausência dela, o segredo
 * legado por header. Retorna null se válido, ou a resposta de erro a enviar.
 */
function validateSignature(req) {
  const signatureHeader = req.get("x-ether-signature");
  if (signatureHeader) {
    const timestamp = req.get("x-ether-timestamp");
    const match = /^sha256=([0-9a-f]{64})$/i.exec(signatureHeader.trim());
    if (!timestamp || !match) {
      return { status: 401, body: { error: "assinatura malformada" } };
    }

    const tsMs = Number(timestamp);
    if (!Number.isFinite(tsMs)) {
      return { status: 401, body: { error: "assinatura malformada" } };
    }
    const ageSeconds = (Date.now() - tsMs) / 1000;
    if (ageSeconds > MAX_AGE_SECONDS || ageSeconds < -MAX_FUTURE_SKEW_SECONDS) {
      return { status: 401, body: { error: "assinatura expirada" } };
    }

    // HMAC sobre os BYTES recebidos (capturados em express.json({ verify })), não
    // sobre JSON.stringify(req.body). Sem o buffer cru, falha fechado.
    const raw = req.rawBody;
    if (!Buffer.isBuffer(raw)) {
      return { status: 401, body: { error: "assinatura inválida" } };
    }
    const expected = crypto
      .createHmac("sha256", config.ether.webhookSecret)
      .update(`${timestamp}.`)
      .update(raw)
      .digest("hex");

    if (!safeEqual(match[1].toLowerCase(), expected)) {
      return { status: 401, body: { error: "assinatura inválida" } };
    }
    return null;
  }

  // Fallback: comparação simples de segredo compartilhado (legado).
  const provided = req.get("x-webhook-secret") ?? "";
  if (!safeEqual(provided, config.ether.webhookSecret)) {
    return { status: 401, body: { error: "unauthorized" } };
  }
  return null;
}

/** Processa o corpo do webhook já autenticado — comum às duas rotas. */
async function handleEtherWebhook(req, res) {
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
    // Não loga o erro cru: o `detail` do Postgres pode carregar o payload do evento.
    console.error("Falha ao registrar evento do provedor", errorLogFields(error));
    return res.status(500).json({ error: "storage failure" });
  }

  const payload = envelope.data?.data ?? {};
  const result = await runProviderEvent(storedId, { eventType, payload, eventId });
  return res.json(result);
}

webhookRouter.post(
  "/ether",
  asyncRoute(async (req, res) => {
    if (!config.ether.webhookSecret) {
      console.error("ETHER_WEBHOOK_SECRET não configurado — rejeitando tudo");
      return res.status(401).json({ error: "unauthorized" });
    }

    const invalid = validateSignature(req);
    if (invalid) return res.status(invalid.status).json(invalid.body);

    return handleEtherWebhook(req, res);
  }),
);

/**
 * Rota alternativa com token no path — usada quando o painel da Ether só
 * permite cadastrar uma URL de callback, sem headers customizados. O token
 * é validado em tempo constante. A assinatura HMAC (x-ether-signature), quando
 * enviada, é validada; com ETHER_WEBHOOK_REQUIRE_SIGNATURE=1 ela é exigida.
 */
webhookRouter.post(
  "/ether/:token",
  asyncRoute(async (req, res) => {
    if (!config.ether.webhookUrlToken) {
      console.error("ETHER_WEBHOOK_URL_TOKEN não configurado — rejeitando tudo");
      return res.status(401).json({ error: "unauthorized" });
    }
    if (!safeEqual(req.params.token, config.ether.webhookUrlToken)) {
      return res.status(401).json({ error: "unauthorized" });
    }

    // Assinatura enviada: valida (com o segredo configurado). Sem assinatura:
    // aceita só pelo token, a menos que ETHER_WEBHOOK_REQUIRE_SIGNATURE=1.
    // Ordem segura de ativação: gerar o segredo no painel da Ether, copiar para
    // ETHER_WEBHOOK_SECRET, e só então ligar a exigência.
    if (req.get("x-ether-signature") && config.ether.webhookSecret) {
      const invalid = validateSignature(req);
      if (invalid) return res.status(invalid.status).json(invalid.body);
    } else if (config.ether.webhookRequireSignature) {
      return res.status(401).json({ error: "assinatura ausente" });
    }

    return handleEtherWebhook(req, res);
  }),
);

