import { config } from "./config.js";

/**
 * Cliente da API Ether Global Assets.
 * Roda apenas no servidor — clientId/clientSecret jamais vão ao browser.
 */

export class EtherError extends Error {
  constructor(status, body) {
    super(`Ether API error (HTTP ${status})`);
    this.name = "EtherError";
    this.status = status;
    this.body = body;
  }
}

let cachedToken = null; // { token, expiresAt }

function assertConfigured() {
  if (!config.ether.clientId || !config.ether.clientSecret) {
    throw new Error("Integração Ether não configurada (ETHER_CLIENT_ID/SECRET)");
  }
}

async function getToken() {
  // Margem de 60s: evita usar token que expira no meio da chamada.
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }
  assertConfigured();

  const response = await fetch(`${config.ether.baseUrl}/auth/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: config.ether.clientId,
      clientSecret: config.ether.clientSecret,
    }),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.access_token) {
    throw new EtherError(response.status, body);
  }

  cachedToken = {
    token: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
  return cachedToken.token;
}

async function call(method, path, body, retry = true) {
  const token = await getToken();
  const response = await fetch(`${config.ether.baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // Token revogado antes da hora: limpa o cache e tenta uma única vez.
  if (response.status === 401 && retry) {
    cachedToken = null;
    return call(method, path, body, false);
  }

  const text = await response.text();
  const parsed = text ? JSON.parse(text) : undefined;
  if (!response.ok) throw new EtherError(response.status, parsed);
  return parsed;
}

/** PIX dinâmico para depósito (valor em centavos). */
export function createPixDeposit(amountCents, expirationSeconds, idempotencyKey) {
  return call("POST", "/pix/deposit", {
    amount: amountCents,
    expirationTime: expirationSeconds,
    ...(idempotencyKey ? { idempotencyKey } : {}),
  });
}

/** Saque PIX para chave fixa. */
export function withdrawPixToKey(amountCents, pixKeyType, pixKey, description) {
  return call("POST", "/pix/withdraw/pix-key", {
    amount: amountCents,
    pixKeyType,
    pixKey,
    ...(description ? { description } : {}),
  });
}

/**
 * Paga (ou simula) um boleto. `paymentMethod` decide a origem do saldo do
 * lado da Ether: 'FIAT' ou 'CRYPTO'. Hoje só usamos FIAT — o ledger do
 * LIVREPAY é só em BRL, então pagar com CRYPTO exigiria uma conta cripto
 * própria que ainda não existe neste sistema.
 */
export function payBoleto(digitableLine, { paymentMethod = "FIAT", isSimulation = false, cryptoToken, network } = {}) {
  return call("POST", "/boletos/pay-boleto", {
    digitableLine,
    paymentMethod,
    isSimulation,
    ...(cryptoToken ? { cryptoToken } : {}),
    ...(network ? { network } : {}),
  });
}

/**
 * Simula o pagamento para descobrir o valor real do boleto (`netAmount`,
 * em reais) antes de debitar qualquer coisa. A linha digitável não expõe o
 * valor de forma confiável no nosso lado — só a Ether sabe o valor real.
 */
export async function simulateBoleto(digitableLine) {
  const result = await payBoleto(digitableLine, { paymentMethod: "FIAT", isSimulation: true });
  if (!result?.boleto || typeof result.boleto.netAmount !== "number") {
    throw new EtherError(200, result);
  }
  return result;
}

/** Consulta o status de compensação bancária de um boleto pago. */
export function getBoletoStatus(identifier) {
  return call("GET", `/boletos/${identifier}`);
}

/** Chave de idempotência aceita pela Ether: <=25 chars alfanuméricos. */
export function idempotencyKeyFrom(uuid) {
  return uuid.replace(/-/g, "").slice(0, 25);
}

/** Deduz o tipo da chave PIX pelo formato quando não informado. */
export function inferPixKeyType(key) {
  const trimmed = key.trim();
  if (trimmed.includes("@")) return "EMAIL";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
    return "RANDOM";
  }
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+") && digits.length >= 12 && digits.length <= 13) return "PHONE";
  if (digits.length === 11 && !trimmed.startsWith("+")) return "CPF";
  if (digits.length === 14) return "CNPJ";
  return null;
}
