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

// O WAF da Ether bloqueia User-Agent de cliente HTTP padrão: devolve uma
// página HTML de bloqueio, não JSON. O UA default do fetch do Node cai nesse
// filtro, o que derruba TODA chamada à Ether em produção (achado em teste real
// 2026-10-02). Prefixo "Mozilla/5.0" é o que passa — mantemos a identificação
// do nosso cliente no resto da string.
const CLIENT_USER_AGENT =
  "Mozilla/5.0 (compatible; LivrePay-API/1.0; +https://livrepay.digital)";

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
    headers: { "Content-Type": "application/json", "User-Agent": CLIENT_USER_AGENT },
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
    headers: { "Content-Type": "application/json", "User-Agent": CLIENT_USER_AGENT },
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

// ---------------------------------------------------------------------------
// Cadastro de cliente final (Criação de Conta + KYC)
//
// Fluxo conforme a documentação oficial (privatedocs.etherglobalassets.com.br
// → Ether Global Assets) e a spec `Ether Global Assets.json`:
//   1. POST /users/profile-data          → cria/recupera rascunho, devolve userId
//   2. POST /users/{id}/accept-terms     → aceite dos termos (IP/UA auditados)
//   3. POST /users/{id}/pep-declaration  → autodeclaração de não-PEP
//   4. POST /users/document/upload       → um documento por chamada (máx 5MB)
//   5. GET  /users/{id}/check-account    → pending_documents → pending_analysis → active
//
// HISTÓRICO (não repetir o erro): em 2026-09-04 estes endpoints foram trocados
// por `POST /users/onboarding` + `POST /kyc/submissions` com base em orientação
// do suporte por WhatsApp. Ambos retornam **404 NOT_FOUND** em produção e não
// aparecem na documentação — verificado em 2026-09-09. Só mude este fluxo
// contra evidência de request real, não contra mensagem de suporte.
// ---------------------------------------------------------------------------

/**
 * Passo 1 — cria (ou recupera, por e-mail) o cadastro do cliente final.
 * @param {object} payload — CreateUserProfilePayload (name, email, tenantUrl,
 *   profile, address, document e companyInfo quando personType = JURIDICA)
 * @param {string} [token] — token da sub-conta; se omitido usa o do participant
 */
export async function createUserProfile(payload, token) {
  return call("POST", "/users/profile-data", payload, true, token);
}

/**
 * Passo 2 — registra o aceite dos termos de uso do cliente.
 *
 * Guia oficial: sem corpo; o backend da Ether registra IP e User-Agent da
 * requisição como evidência do aceite. Por isso (a) não enviamos corpo nem
 * Content-Type e (b) mandamos um User-Agent explícito. Se `userAgent` (do
 * navegador do cliente) for informado, ele é repassado — melhor evidência de
 * consentimento do que o UA do nosso servidor; o IP registrado continua sendo
 * o do servidor (limitação: não há header documentado para repassar o IP do
 * cliente). Pergunta em aberto para a Ether: aceitam IP/UA do cliente?
 */
export async function acceptTerms(userId, { userAgent } = {}, token) {
  return call("POST", `/users/${userId}/accept-terms`, undefined, true, token, {
    "User-Agent": sanitizeUserAgent(userAgent),
  });
}

/** Passo 3 — grava a autodeclaração de não-PEP. */
export async function submitPepDeclaration(userId, declarationVersion = "v1.0", token) {
  return call("POST", `/users/${userId}/pep-declaration`, { declarationVersion }, true, token);
}

/** Passo 5 — status do cadastro: pending_documents | pending_analysis | active | inactive. */
export async function checkAccountStatus(userId, token) {
  return call("GET", `/users/${userId}/check-account`, undefined, true, token);
}

/**
 * Passo 4 — envia UM documento do KYC (multipart/form-data: userId, type, file).
 * Guia oficial: PDF, JPEG ou PNG, máximo 5MB. Valida tamanho e MIME aqui para
 * falhar antes de gastar uma chamada; a validação definitiva é da Ether.
 * @param {string} userId — userId da Ether
 * @param {string} type — ex.: CARTEIRA_IDENTIDADE, COMPROVANTE_RESIDENCIA, SELFIE_COM_DOC
 * @param {Buffer|Uint8Array} fileBuffer
 */
export async function uploadDocument(userId, type, fileBuffer, { filename, mimeType }, token) {
  if (!UPLOAD_DOCUMENT_TYPES.has(type)) {
    throw new Error("Tipo de documento de upload inválido");
  }
  if (!UPLOAD_MIME_TYPES.has(mimeType)) {
    throw new Error("Tipo de arquivo não aceito (use PDF, JPEG ou PNG)");
  }
  if (fileBuffer.byteLength > UPLOAD_MAX_BYTES) {
    throw new Error("Arquivo acima de 5MB");
  }
  const form = new FormData();
  form.append("userId", userId);
  form.append("type", type);
  form.append("file", new Blob([fileBuffer], { type: mimeType }), filename ?? "documento");
  return call("POST", "/users/document/upload", form, true, token);
}

/** Checklist de documentos: pendentes, enviados e recusados. */
export async function getDocumentRequirements(userId, token) {
  return call("GET", `/users/${userId}/document-requirements`, undefined, true, token);
}

/** Tipos de documento aceitos para upload no KYC. */
export async function getDocumentTypes(token) {
  return call("GET", "/users/document/types", undefined, true, token);
}

// ---------------------------------------------------------------------------
// Chamadas protegidas (com token do participant OU da sub-conta)
// ---------------------------------------------------------------------------

const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
const UPLOAD_MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);
/**
 * Tipos de documento do UPLOAD / `documentChecklist` (passo 4). NÃO é o mesmo
 * vocabulário de `document.type` do profile-data (passo 1): lá só valem
 * CARTEIRA_IDENTIDADE|CARTEIRA_TRABALHO|CARTEIRA_HABILITACAO|PASSAPORTE e
 * "CARTAO_CNPJ" é recusado; aqui "CARTAO_CNPJ" é válido. Não unificar os enums.
 *   PF: CARTEIRA_IDENTIDADE, COMPROVANTE_RESIDENCIA, SELFIE_COM_DOC
 *   PJ: CARTAO_CNPJ, CONTRATO_SOCIAL, COMPROVANTE_RESIDENCIA
 * (guias oficiais PF e PJ, 2026-10-02; a Ether pode aceitar mais — a validação
 * definitiva é dela; a nossa evita gastar chamada com typo.)
 */
export const UPLOAD_DOCUMENT_TYPES = new Set([
  "CARTEIRA_IDENTIDADE", "COMPROVANTE_RESIDENCIA", "SELFIE_COM_DOC",
  "CARTAO_CNPJ", "CONTRATO_SOCIAL",
]);

/**
 * UA vem do cliente (não confiável): só ASCII imprimível, tamanho limitado.
 * Se vazio ou sem o prefixo "Mozilla/5.0", cai em CLIENT_USER_AGENT: qualquer
 * outro prefixo cai no filtro do WAF da Ether (ver CLIENT_USER_AGENT) e o
 * accept-terms seria bloqueado.
 */
function sanitizeUserAgent(value) {
  const clean = String(value ?? "").replace(/[^ -~]/g, "").trim().slice(0, 300);
  return clean.startsWith("Mozilla/5.0") ? clean : CLIENT_USER_AGENT;
}

async function call(method, path, body, retry = true, token = null, extraHeaders = {}) {
  const authToken = token ?? await getParticipantToken();
  // FormData: o fetch define o Content-Type com o boundary — não setar à mão.
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const response = await fetchWithTimeout(`${config.ether.baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${authToken}`,
      "User-Agent": CLIENT_USER_AGENT,
      ...(body !== undefined && !isForm ? { "Content-Type": "application/json" } : {}),
      ...extraHeaders,
    },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });

  // Token revogado antes da hora: limpa o cache e tenta uma única vez.
  if (response.status === 401 && retry && !token) {
    cachedParticipantToken = null;
    return call(method, path, body, false, null, extraHeaders);
  }

  const text = await response.text();
  // Resposta pode não ser JSON (página de bloqueio do WAF, erro de gateway).
  // Deixar o JSON.parse estourar perde o status HTTP e transforma um
  // diagnóstico claro num SyntaxError sem contexto.
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    throw new EtherError(response.status, {
      error: "RespostaNaoJSON",
      contentType: response.headers.get("content-type"),
      preview: text.slice(0, 200),
    });
  }
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
