/**
 * Campos de erro que podem ir para log sem carregar PII.
 *
 * Corpo de erro da Ether e `detail` do Postgres costumam ECOAR o valor
 * rejeitado (CPF, data de nascimento, renda, a linha inteira de `profiles` em
 * "Failing row contains (...)"). Por isso log de erro de integração/banco usa
 * SEMPRE estes helpers, nunca o objeto de erro nem `error.body`.
 */

/**
 * Código do erro da Ether só se tiver cara de código (nunca mensagem/corpo livre).
 *
 * A Ether manda o código de negócio em `message` (ex.: `{"error":"Bad
 * Request","message":"USR_DUP_005"}`, visto em chamada real), não em `code`.
 * Ler só `code`/`error` fazia todo log de produção sair `code: undefined`. O
 * regex continua barrando texto livre (que pode ecoar CPF/endereço), então
 * `message` só passa quando é um código.
 */
export function safeEtherCode(error) {
  const body = error?.body;
  for (const candidate of [body?.code, body?.message, body?.error]) {
    if (typeof candidate === "string" && /^[A-Z0-9_]{3,40}$/.test(candidate)) return candidate;
  }
  return undefined;
}

/**
 * { status, code } de um erro da Ether — nada do corpo.
 *
 * Dois tipos de erro chegam aqui:
 *  1. `EtherError` (ether.js): a Ether respondeu com um HTTP não-2xx. `status`
 *     e `code` (quando a Ether manda um código de negócio reconhecível) bastam.
 *  2. Erro de rede cru (fetch nunca completou: DNS, TLS, conexão recusada,
 *     ECONNRESET...) — `fetchWithTimeout` só embrulha em EtherError(504) o
 *     caso de abort por timeout; qualquer outra falha de rede sobe como o
 *     erro original do `fetch`/undici, sem `.status` nem `.body`. Nesse caso
 *     `name`/`message`/`cause.code` são técnicos (ex.: "ENOTFOUND api...",
 *     nunca CPF/endereço), então são seguros de logar — e é exatamente o que
 *     faltava para diferenciar "Ether recusou" de "não conseguimos nem falar
 *     com a Ether".
 */
export function etherErrorFields(error) {
  if (error?.name === "EtherError") {
    return {
      status: error.status,
      code: safeEtherCode(error),
      // Resposta não-JSON (página HTML de WAF/gateway, ver call() em ether.js):
      // só o fato e o content-type — nunca o preview do corpo.
      ...(error.body?.error === "RespostaNaoJSON"
        ? { nonJson: true, contentType: typeof error.body.contentType === "string" ? error.body.contentType.slice(0, 80) : undefined }
        : {}),
    };
  }
  return {
    status: error?.status,
    code: safeEtherCode(error),
    errorName: typeof error?.name === "string" ? error.name : undefined,
    errorMessage: typeof error?.message === "string" ? error.message.slice(0, 200) : undefined,
    causeCode: typeof error?.cause?.code === "string" ? error.cause.code : undefined,
  };
}

const SAFE_PG_TEXT = /^[A-Za-z0-9_.$ -]{1,100}$/;
const pick = (v) => (typeof v === "string" && SAFE_PG_TEXT.test(v) ? v : undefined);

/**
 * Campos selecionados de um erro do Postgres (ou qualquer erro): nunca a
 * mensagem, `detail`, `where` nem o objeto cru — `detail` traz a linha com
 * tax_id/phone numa violação de constraint, e a mensagem de "invalid input
 * syntax" repete o valor recebido.
 */
export function errorLogFields(err) {
  return {
    name: pick(err?.name),
    code: pick(err?.code),
    constraint: pick(err?.constraint),
    table: pick(err?.table),
    routine: pick(err?.routine),
  };
}
