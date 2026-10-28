/**
 * Normaliza o payload de eventos PIX da Ether (`envelope.data.data`).
 *
 * Existem dois formatos documentados:
 *  - plano (spec OpenAPI): { pixId, uuid, amount, status, e2e, ... }
 *  - aninhado (guia privatedocs, 2026): { pix: { id, uuid, amount, status, e2e, ... }, timestamp }
 * Aceitamos os dois: se a Ether mudar ou documentar errado, o evento não vira
 * "payload sem pixId" com saldo sem creditar/estornar.
 */
export function normalizePixPayload(payload) {
  const pix =
    payload?.pix && typeof payload.pix === "object" ? payload.pix : (payload ?? {});

  // Ordem de preferência; o chamador casa com a referência que guardou
  // (depósito: `uuid` da resposta de /pix/deposit; saque: `pixId` da resposta).
  const ids = [pix.pixId, pix.id, pix.uuid].filter(
    (v) => typeof v === "string" && v.length > 0,
  );

  return {
    ids: [...new Set(ids)],
    amount: typeof pix.amount === "number" ? pix.amount : null,
    status: pix.status ?? null,
    e2e: pix.e2e ?? null,
  };
}
