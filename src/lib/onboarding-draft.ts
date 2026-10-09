/**
 * Rascunho do cadastro de abertura de conta, guardado só neste navegador.
 *
 * O QUE SALVA: apenas campos NÃO sensíveis (ver SAFE_FIELDS). NUNCA salva CPF/CNPJ,
 * telefone, e-mail, nascimento, número/órgão/data do documento, renda, faturamento,
 * logradouro, número, CEP nem nome de pessoa. Quem volta precisa digitar de novo
 * esses campos — a tela diz isso.
 *
 * Tudo em try/catch: localStorage pode estar bloqueado (modo privado, política do
 * navegador) e o cadastro precisa funcionar sem rascunho.
 */

const PREFIX = "livrepay.onboarding_draft.";

export const SAFE_FIELDS = [
  "personType",
  "documentType",
  "nationality",
  "documentIssueState",
  // socialName fora de propósito: razão social de MEI costuma ser "NOME + CPF".
  "tradeName",
  "website",
  "socialNetwork",
  "city",
  "state",
] as const;

export type SafeField = (typeof SAFE_FIELDS)[number];

export interface OnboardingDraft {
  step: number;
  values: Partial<Record<SafeField, string>>;
}

export function loadOnboardingDraft(userId: string): OnboardingDraft | null {
  try {
    const raw = localStorage.getItem(PREFIX + userId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OnboardingDraft>;
    if (!parsed || typeof parsed !== "object" || typeof parsed.values !== "object" || !parsed.values) return null;

    // Só devolve chaves da lista segura, com valor string (nunca confia no que está no storage).
    const values: Partial<Record<SafeField, string>> = {};
    for (const key of SAFE_FIELDS) {
      const v = (parsed.values as Record<string, unknown>)[key];
      if (typeof v === "string") values[key] = v.slice(0, 200);
    }
    const step = typeof parsed.step === "number" && Number.isInteger(parsed.step) && parsed.step >= 0 ? parsed.step : 0;
    return { step, values };
  } catch {
    return null;
  }
}

export function saveOnboardingDraft(userId: string, all: Record<string, unknown>, step: number): void {
  try {
    const values: Partial<Record<SafeField, string>> = {};
    for (const key of SAFE_FIELDS) {
      const v = all[key];
      if (typeof v === "string" && v !== "") values[key] = v;
    }
    localStorage.setItem(PREFIX + userId, JSON.stringify({ step, values }));
  } catch {
    // sem rascunho; segue sem erro
  }
}

export function clearOnboardingDraft(userId?: string): void {
  try {
    if (userId) {
      localStorage.removeItem(PREFIX + userId);
      return;
    }
    // Sem id (ex.: ao sair da conta): remove o de qualquer usuário deste navegador.
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    // ignora
  }
}
