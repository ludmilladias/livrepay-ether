/**
 * Dinheiro no LIVREPAY trafega SEMPRE em centavos (inteiro), igual ao banco.
 * Estas funções são a única fronteira de conversão para exibição/entrada.
 */

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** 123456 -> "R$ 1.234,56" */
export function formatCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) {
    throw new Error(`Valor em centavos inválido: ${cents}`);
  }
  return brl.format(cents / 100);
}

/**
 * Converte entrada do usuário ("1.234,56", "1234.56", "1234") para centavos.
 * Retorna null se não for um valor monetário válido e positivo.
 */
export function parseToCents(input: string): number | null {
  const cleaned = input.trim().replace(/[R$\s]/g, "");
  if (!cleaned) return null;

  // Formato brasileiro: pontos de milhar + vírgula decimal
  const normalized = cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned;

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;

  const cents = Math.round(parseFloat(normalized) * 100);
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}
