import { config } from "./config.js";

/**
 * Cliente da API Ether Global Assets.
 * Roda apenas no servidor — clientId/clientSecret jamais vão ao browser.
 *
 * Dois níveis de autenticação:
 *  1. Participant (LivrePay): clientId/clientSecret — usado para operações
 *     administrativas e para criar sub-contas.
 *  2. Sub-conta (cliente final): Cognito — cada cliente tem seu próprio
 *     token JWT obtido via AWS Cognito User Pool.
 */

export class EtherError extends Error {
  constructor(status, body) {
    super(`Ether API error (HTTP ${status})`);
    this.name = "EtherError";
    this.status = status;
    this.body = body;
  }
}

let cachedParticipantToken = null; // { token, expiresAt }

const TIMEOUT_MS = 15_000;

function assertConfigured() {
  if (!config.ether.clientId || !config.ether.clientSecret) {
    throw new Error("Integração Ether não configurada (ETHER_CLIENT_ID/SECRET)");
  }
}

/**
 * fetch com timeout: sem isso, uma Ether lenta ou travada prende a requisição
 * (e a conexão de banco que ela segura) indefinidamente.
 */
async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new EtherError(504, { message: `Ether não respondeu em ${TIMEOUT_MS}ms` });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Participant (conta principal do LivrePay na Ether)
// ---------------------------------------------------------------------------

async function getParticipantToken() {
  // Margem de 60s: evita usar token que expira no meio da chamada.
  if (cachedParticipantToken && cachedParticipantToken.expiresAt > Date.now() + 60_000) {
    return cachedParticipantToken.token;
  }
  assertConfigured();

  // Único fluxo documentado na spec (POST /auth/authenticate, clientId+clientSecret).
  // O suporte confirmou (2026-09-04) que o 401 nos endpoints protegidos é rejeição
  // do token por aud/App Client mal configurado no participant — pendência da Ether.
  const response = await fetchWithTimeout(`${config.ether.baseUrl}/auth/authenticate`, {
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

  cachedParticipantToken = {
    token: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
  return cachedParticipantToken.token;
}

// ---------------------------------------------------------------------------
// Sub-conta (cliente final) — autenticação via Cognito
// ---------------------------------------------------------------------------

/**
 * Autentica um cliente final (sub-conta) via Cognito e retorna o token JWT
 * para chamar endpoints protegidos da Ether como esse usuário.
 *
 * @param {string} email — e-mail do usuário no Cognito
 * @param {string} password — senha temporária/definitiva do Cognito
 */
export async function authenticateSubAccount(email, password) {
  const response = await fetchWithTimeout(`${config.ether.baseUrl}/auth/authenticate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: config.ether.cognitoAppClientId,
      username: email,
      password,
    }),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.access_token) {
    throw new EtherError(response.status, body);
  }
  return body.access_token;
}

/**
 * Onboarding de conta na Ether — primeira requisição autenticada de um usuário.
 * Fluxo real confirmado pelo suporte (2026-09-04):
 *   1. usuário criado no Cognito → 2. POST /users/onboarding com identityDocument
 *   → 3. POST /kyc/submissions → 4. Ether aprova → conta BASIC vira FULL.
 * Não existem endpoints accept-terms nem pep-declaration.
 *
 * @param {string} identityDocument — CPF ou CNPJ (somente dígitos)
 * @param {string} [token] — token da sub-conta; se omitido usa o do participant
 */
export async function submitOnboarding(identityDocument, token) {
  const authToken = token ?? await getParticipantToken();
  const response = await fetchWithTimeout(`${config.ether.baseUrl}/users/onboarding`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${authToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ identityDocument }),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) throw new EtherError(response.status, body);
  return body;
}

/**
 * Submete documentos de KYC (POST /kyc/submissions). Conta sai de BASIC para
 * FULL somente após aprovação pela Ether; até lá endpoints protegidos falham.
 */
export async function submitKyc(submission, token) {
  const authToken = token ?? await getParticipantToken();
  const response = await fetchWithTimeout(`${config.ether.baseUrl}/kyc/submissions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${authToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(submission),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) throw new EtherError(response.status, body);
  return body;
}

// ---------------------------------------------------------------------------
// Chamadas protegidas (com token do participant OU da sub-conta)
// ---------------------------------------------------------------------------

async function call(method, path, body, retry = true, token = null) {
  const authToken = token ?? await getParticipantToken();
  const response = await fetchWithTimeout(`${config.ether.baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${authToken}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // Token revogado antes da hora: limpa o cache e tenta uma única vez.
  if (response.status === 401 && retry && !token) {
    cachedParticipantToken = null;
    return call(method, path, body, false);
  }

  const text = await response.text();
  const parsed = text ? JSON.parse(text) : undefined;
  if (!response.ok) throw new EtherError(response.status, parsed);
  return parsed;
}

// ---------------------------------------------------------------------------
// Operações bancárias (participant-level)
// ---------------------------------------------------------------------------

/** PIX dinâmico para depósito (valor em centavos). */
export function createPixDeposit(amountCents, expirationSeconds, idempotencyKey, subAccountToken = null) {
  return call("POST", "/pix/deposit", {
    amount: amountCents,
    expirationTime: expirationSeconds,
    ...(idempotencyKey ? { idempotencyKey } : {}),
  }, true, subAccountToken);
}

/** Saque PIX para chave fixa. */
export function withdrawPixToKey(amountCents, pixKeyType, pixKey, description, subAccountToken = null) {
  return call("POST", "/pix/withdraw/pix-key", {
    amount: amountCents,
    pixKeyType,
    pixKey,
    ...(description ? { description } : {}),
  }, true, subAccountToken);
}

/**
 * Paga (ou simula) um boleto. `paymentMethod` decide a origem do saldo do
 * lado da Ether: 'FIAT' ou 'CRYPTO'. Hoje só usamos FIAT — o ledger do
 * LIVREPAY é só em BRL, então pagar com CRYPTO exigiria uma conta cripto
 * própria que ainda não existe neste sistema.
 */
export function payBoleto(digitableLine, { paymentMethod = "FIAT", isSimulation = false, cryptoToken, network } = {}, subAccountToken = null) {
  return call("POST", "/boletos/pay-boleto", {
    digitableLine,
    paymentMethod,
    isSimulation,
    ...(cryptoToken ? { cryptoToken } : {}),
    ...(network ? { network } : {}),
  }, true, subAccountToken);
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

/** Registra uma chave PIX para o participant ou sub-conta. */
export function createPixKey(pixKey, pixKeyType, subAccountToken = null) {
  return call("POST", "/pix/keys", {
    pixKey,
    pixKeyType,
    preview: false,
  }, true, subAccountToken);
}

/** Lista chaves PIX registradas. */
export function listPixKeys(subAccountToken = null) {
  return call("GET", "/pix/keys", undefined, true, subAccountToken);
}

/** Consulta saldo da conta. */
export function getAccountBalance(subAccountToken = null) {
  return call("GET", "/account-balance", undefined, true, subAccountToken);
}

/** Consulta status da conta (KYC). */
export function getAccountStatus(userId) {
  return call("GET", `/users/${userId}/check-account`);
}

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

/** Gera o secret de webhook (mostrado apenas uma vez pela Ether). */
export function generateWebhookSecret() {
  return call("POST", "/webhooks/secret");
}

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

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
