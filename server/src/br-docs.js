/**
 * Validação de CPF e CNPJ pelos dígitos verificadores (módulo 11).
 *
 * Por que existe: uma recusa de cadastro pela Ether pode "queimar" o documento
 * do lado dela (USR_DUP_005). Documento com dígito verificador errado é
 * rejeitado AQUI, antes de qualquer chamada externa.
 *
 * Funções puras, só dígitos (sem máscara). Não retornam nem logam o documento.
 */

const allSame = (digits) => /^(\d)\1+$/.test(digits);

function checkDigit(digits, weights) {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) sum += Number(digits[i]) * weights[i];
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

/** CPF: 11 dígitos, não repetidos (000...0, 111...1 etc.), DVs corretos. */
export function isValidCpf(value) {
  const d = String(value ?? "");
  if (!/^\d{11}$/.test(d) || allSame(d)) return false;
  const d1 = checkDigit(d, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = checkDigit(d, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d1 === Number(d[9]) && d2 === Number(d[10]);
}

/** CNPJ: 14 dígitos, não repetidos, DVs corretos. */
export function isValidCnpj(value) {
  const d = String(value ?? "");
  if (!/^\d{14}$/.test(d) || allSame(d)) return false;
  const d1 = checkDigit(d, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = checkDigit(d, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d1 === Number(d[12]) && d2 === Number(d[13]);
}
