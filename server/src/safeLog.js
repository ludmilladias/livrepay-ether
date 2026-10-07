/**
 * Campos de erro que podem ir para log sem carregar PII.
 *
 * Corpo de erro da Ether e `detail` do Postgres costumam ECOAR o valor
 * rejeitado (CPF, data de nascimento, renda, a linha inteira de `profiles` em
 * "Failing row contains (...)"). Por isso log de erro de integração/banco usa
 * SEMPRE estes helpers, nunca o objeto de erro nem `error.body`.
 */

/** Código do erro da Ether só se tiver cara de código (nunca mensagem/corpo livre). */
export function safeEtherCode(error) {
  const code = error?.body?.code ?? error?.body?.error;
  return typeof code === "string" && /^[A-Z0-9_]{3,40}$/.test(code) ? code : undefined;
}

/** { status, code } de um erro da Ether — nada do corpo. */
export function etherErrorFields(error) {
  return { status: error?.status, code: safeEtherCode(error) };
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
