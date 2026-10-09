/**
 * Utilitários de documentos e contatos brasileiros (sem dependências).
 *
 * Validação aqui é CONVENIÊNCIA de UX (erro imediato, antes de enviar o cadastro).
 * Quem decide o que é aceito é o servidor/banco parceiro. Um CPF/CNPJ com dígito
 * verificador válido ainda pode não existir na Receita.
 */

export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function allSameDigit(digits: string): boolean {
  return /^(\d)\1+$/.test(digits);
}

export function isValidCPF(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 11 || allSameDigit(d)) return false;

  const check = (len: number): number => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };

  return check(9) === Number(d[9]) && check(10) === Number(d[10]);
}

export function isValidCNPJ(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 14 || allSameDigit(d)) return false;

  const check = (len: number): number => {
    // Pesos: 5,4,3,2,9,8,7,6,5,4,3,2 (1º dígito) e 6,5,4,3,2,9,8,7,6,5,4,3,2 (2º).
    let weight = len - 7;
    let sum = 0;
    for (let i = 0; i < len; i++) {
      sum += Number(d[i]) * weight;
      weight = weight === 2 ? 9 : weight - 1;
    }
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  return check(12) === Number(d[12]) && check(13) === Number(d[13]);
}

/** 000.000.000-00, aplicada progressivamente enquanto a pessoa digita. */
export function maskCPF(value: string): string {
  const d = onlyDigits(value).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** 00.000.000/0000-00 */
export function maskCNPJ(value: string): string {
  const d = onlyDigits(value).slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/** (11) 98888-7777 (celular) ou (11) 8888-7777 (fixo). */
export function maskPhone(value: string): string {
  const d = onlyDigits(value).slice(0, 11);
  if (d.length === 0) return "";
  if (d.length <= 2) return `(${d}`;
  const ddd = d.slice(0, 2);
  const rest = d.slice(2);
  if (rest.length <= 4) return `(${ddd}) ${rest}`;
  if (d.length <= 10) return `(${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
  return `(${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
}

/** 00000-000 */
export function maskCEP(value: string): string {
  const d = onlyDigits(value).slice(0, 8);
  return d.length <= 5 ? d : `${d.slice(0, 5)}-${d.slice(5)}`;
}
