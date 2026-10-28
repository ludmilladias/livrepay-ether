import { z } from "zod";
import { isValidCNPJ, isValidCPF, onlyDigits } from "@/lib/br-docs";
import type { OnboardingPayload, PersonType } from "@/hooks/use-onboarding";

/**
 * Validação do cadastro de abertura de conta (conveniência de UX: erro por campo,
 * antes de enviar). O servidor valida de novo em `onboardingSchema`
 * (server/src/routes/auth.js) e é quem decide.
 */

export const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;

/** Valores idênticos aos aceitos por `onboardingSchema` (documentType). */
export const DOCUMENT_TYPES = [
  { value: "CARTEIRA_IDENTIDADE", label: "RG (carteira de identidade)" },
  { value: "CARTEIRA_HABILITACAO", label: "CNH (carteira de habilitação)" },
] as const;

export const NATIONALITIES = ["Brasileiro", "Brasileira"] as const;

export const MARITAL_STATUSES = [
  { value: "SOLTEIRO(A)", label: "Solteiro(a)" },
  { value: "CASADO(A)", label: "Casado(a)" },
  { value: "DIVORCIADO(A)", label: "Divorciado(a)" },
  { value: "VIUVO(A)", label: "Viúvo(a)" },
  { value: "UNIÃO ESTÁVEL", label: "União estável" },
] as const;

/** id do campo no DOM: usado por label, resumo de erros e foco. */
export const fieldId = (name: string) => `ob-${name}`;

/** Todos os campos são string no formulário; a conversão acontece em `buildPayload`. */
export interface OnboardingFormValues {
  personType: PersonType;
  // Identificação (PF) / empresa (PJ)
  taxId: string;
  phone: string;
  dateBirth: string; //   PF: nascimento; PJ: nascimento do representante legal
  // Empresa (PJ)
  socialName: string; //  razão social
  tradeName: string;
  openingDate: string;
  revenue: string;
  // Documento (PF: da pessoa; PJ: do representante legal)
  documentType: string;
  documentNumber: string;
  documentIssuingAgency: string;
  documentIssueDate: string;
  documentIssueState: string;
  // Perfil (PF)
  nationality: string;
  maritalStatus: string;
  monthlyIncome: string;
  hometown: string;
  // Endereço
  zipcode: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
  // Representante (PJ)
  respFullName: string;
  respEmail: string;
  respPhone: string;
  // Presença digital (PJ)
  website: string;
  socialNetwork: string;
}

/** Sem pré-seleção em nacionalidade, estado civil, tipo de documento e UF: a pessoa escolhe. */
export const EMPTY_VALUES: OnboardingFormValues = {
  personType: "FISICA",
  taxId: "",
  phone: "",
  dateBirth: "",
  socialName: "",
  tradeName: "",
  openingDate: "",
  revenue: "",
  documentType: "",
  documentNumber: "",
  documentIssuingAgency: "",
  documentIssueDate: "",
  documentIssueState: "",
  nationality: "",
  maritalStatus: "",
  monthlyIncome: "",
  hometown: "",
  zipcode: "",
  street: "",
  number: "",
  complement: "",
  district: "",
  city: "",
  state: "",
  respFullName: "",
  respEmail: "",
  respPhone: "",
  website: "",
  socialNetwork: "",
};

// --- Passos -------------------------------------------------------------------

export interface StepDef {
  id: string;
  title: string;
  fields: (keyof OnboardingFormValues)[];
}

const ADDRESS_FIELDS: (keyof OnboardingFormValues)[] = [
  "zipcode", "street", "number", "complement", "district", "city", "state",
];

const DOCUMENT_FIELDS: (keyof OnboardingFormValues)[] = [
  "documentType", "documentNumber", "documentIssuingAgency", "documentIssueDate", "documentIssueState",
];

export const PF_STEPS: StepDef[] = [
  { id: "identificacao", title: "Identificação", fields: ["taxId", "phone", "dateBirth"] },
  { id: "documento", title: "Documento", fields: DOCUMENT_FIELDS },
  { id: "perfil", title: "Renda e naturalidade", fields: ["nationality", "maritalStatus", "monthlyIncome", "hometown"] },
  { id: "endereco", title: "Endereço", fields: ADDRESS_FIELDS },
  { id: "revisao", title: "Revisão", fields: [] },
];

export const PJ_STEPS: StepDef[] = [
  { id: "empresa", title: "Empresa", fields: ["taxId", "socialName", "tradeName", "openingDate", "revenue", "phone"] },
  { id: "endereco", title: "Endereço", fields: ADDRESS_FIELDS },
  {
    id: "representante",
    title: "Representante",
    fields: ["respFullName", "respEmail", "respPhone", "dateBirth", ...DOCUMENT_FIELDS],
  },
  { id: "digital", title: "Presença digital", fields: ["website", "socialNetwork"] },
  { id: "revisao", title: "Revisão", fields: [] },
];

export function stepsFor(type: PersonType): StepDef[] {
  return type === "FISICA" ? PF_STEPS : PJ_STEPS;
}

// --- Datas --------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, "0");

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayISO(): string {
  return toISODate(new Date());
}

/**
 * Data de nascimento máxima: hoje menos 18 anos. O cadastro não tem fluxo para
 * menor (sem responsável legal), então não oferecemos datas que levariam a recusa.
 */
export function maxBirthISO(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 18);
  return toISODate(d);
}

export const MIN_DATE = "1900-01-01";

function isRealISODate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

// --- Normalizações ------------------------------------------------------------

/**
 * "5.000,00" / "5000,5" / "R$ 5000.00" -> "5000.00" | "5000.5" (formato do servidor).
 * Devolve null se não for um valor monetário válido (> 0).
 */
export function normalizeMoney(raw: string): string | null {
  let v = raw.replace(/[R$\s]/g, "");
  if (v.includes(",")) v = v.replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
  return Number(v) > 0 ? v : null;
}

/** Aceita "empresa.com.br" e completa com https://; só http(s). Null se inválida. */
export function normalizeUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname.includes(".")) return null;
    return candidate.length <= 200 ? candidate : null;
  } catch {
    return null;
  }
}

// --- Schema -------------------------------------------------------------------

const required = (msg: string) => z.string().trim().min(1, msg);

function mobile(msg: string) {
  return z.string().refine((v) => {
    const d = onlyDigits(v);
    return d.length === 11 && Number(d.slice(0, 2)) >= 11 && d[2] === "9";
  }, msg);
}

/**
 * Schema por tipo de pessoa. Campos que não se aplicam ao tipo ficam livres
 * (`z.string()`), porque o formulário guarda todos juntos.
 */
export function schemaFor(type: PersonType) {
  const isPF = type === "FISICA";
  const today = todayISO();
  const maxBirth = maxBirthISO();

  const dateRange = (label: string, min: string, max: string, maxMsg: string) =>
    z
      .string()
      .min(1, `Informe ${label}`)
      .refine(isRealISODate, "Data inválida")
      .refine((v) => v >= min, "Data muito antiga")
      .refine((v) => v <= max, maxMsg);

  const free = z.string();

  return z
    .object({
      personType: z.enum(["FISICA", "JURIDICA"]),
      taxId: isPF
        ? z.string().refine((v) => isValidCPF(v), "CPF inválido. Confira os 11 dígitos.")
        : z.string().refine((v) => isValidCNPJ(v), "CNPJ inválido. Confira os 14 dígitos."),
      phone: mobile(
        isPF ? "Celular com DDD, 11 dígitos. Ex.: (11) 98888-7777" : "Celular da empresa com DDD, 11 dígitos. Ex.: (11) 98888-7777",
      ),
      dateBirth: dateRange(
        isPF ? "a data de nascimento" : "a data de nascimento do representante",
        MIN_DATE,
        maxBirth,
        "É preciso ter 18 anos ou mais",
      ),

      socialName: isPF ? free : required("Informe a razão social").pipe(z.string().max(140, "Máximo de 140 caracteres")),
      tradeName: isPF ? free : required("Informe o nome fantasia").pipe(z.string().max(140, "Máximo de 140 caracteres")),
      openingDate: isPF ? free : dateRange("a data de abertura", MIN_DATE, today, "A data não pode ser futura"),
      revenue: isPF ? free : z.string().refine((v) => normalizeMoney(v) !== null, "Informe um valor maior que zero. Ex.: 100000,00"),

      documentType: z.enum(["CARTEIRA_IDENTIDADE", "CARTEIRA_HABILITACAO"], {
        errorMap: () => ({ message: "Escolha o tipo de documento" }),
      }),
      documentNumber: required("Informe o número do documento").pipe(z.string().max(30, "Máximo de 30 caracteres")),
      // Doc: o bloco `document` tem os 5 campos obrigatórios para PF e PJ (em PJ é o
      // documento do representante legal).
      documentIssuingAgency: required("Informe o órgão emissor. Ex.: SSP").pipe(z.string().max(30, "Máximo de 30 caracteres")),
      documentIssueDate: dateRange("a data de emissão", MIN_DATE, today, "A data não pode ser futura"),
      documentIssueState: z.enum(UFS, { errorMap: () => ({ message: "Escolha a UF de emissão" }) }),

      nationality: isPF ? z.enum(NATIONALITIES, { errorMap: () => ({ message: "Escolha a nacionalidade" }) }) : free,
      maritalStatus: isPF
        ? z.enum(MARITAL_STATUSES.map((m) => m.value) as [string, ...string[]], {
            errorMap: () => ({ message: "Escolha o estado civil" }),
          })
        : free,
      monthlyIncome: isPF
        ? z.string().refine((v) => normalizeMoney(v) !== null, "Informe um valor maior que zero. Ex.: 5000,00")
        : free,
      hometown: isPF ? required("Informe a cidade de nascimento").pipe(z.string().max(100, "Máximo de 100 caracteres")) : free,

      zipcode: z.string().refine((v) => onlyDigits(v).length === 8, "CEP com 8 dígitos. Ex.: 01310-100"),
      street: required("Informe o logradouro").pipe(z.string().max(200, "Máximo de 200 caracteres")),
      number: required("Informe o número (ou S/N)").pipe(z.string().max(20, "Máximo de 20 caracteres")),
      complement: z.string().max(100, "Máximo de 100 caracteres"),
      district: required("Informe o bairro").pipe(z.string().max(100, "Máximo de 100 caracteres")),
      city: required("Informe a cidade").pipe(z.string().max(100, "Máximo de 100 caracteres")),
      state: z.enum(UFS, { errorMap: () => ({ message: "Escolha a UF" }) }),

      respFullName: isPF ? free : required("Informe o nome do representante").pipe(z.string().max(140, "Máximo de 140 caracteres")),
      respEmail: isPF ? free : z.string().trim().email("E-mail inválido").max(320),
      // Doc: celular com DDD, exatamente 11 dígitos.
      respPhone: isPF ? free : mobile("Celular do representante com DDD, 11 dígitos. Ex.: (11) 98888-7777"),

      website: isPF ? free : z.string().refine((v) => normalizeUrl(v) !== null, "Informe um endereço válido. Ex.: https://www.empresa.com.br"),
      socialNetwork: isPF
        ? free
        : z.string().refine((v) => normalizeUrl(v) !== null, "Informe um endereço válido. Ex.: https://instagram.com/empresa"),
    })
    .superRefine((v, ctx) => {
      // Emissão do documento não pode ser anterior ao nascimento.
      if (v.documentIssueDate && v.dateBirth && v.documentIssueDate < v.dateBirth) {
        ctx.addIssue({
          code: "custom",
          path: ["documentIssueDate"],
          message: "A emissão não pode ser anterior ao nascimento",
        });
      }
    });
}

// --- Payload -----------------------------------------------------------------

/**
 * Monta o corpo de POST /auth/onboarding. O CONTRATO é o de `onboardingSchema` do
 * servidor; em relação à versão anterior, só entram `documentType` (já aceito) e,
 * em PJ, `socialName` (razão social, já aceito).
 */
export function buildPayload(v: OnboardingFormValues): OnboardingPayload {
  const isPF = v.personType === "FISICA";
  const payload: OnboardingPayload = {
    taxId: onlyDigits(v.taxId),
    personType: v.personType,
    phone: onlyDigits(v.phone),
    dateBirth: v.dateBirth,
    documentType: v.documentType,
    documentNumber: v.documentNumber.trim(),
    documentIssuingAgency: v.documentIssuingAgency.trim() || undefined,
    documentIssueDate: v.documentIssueDate || undefined,
    documentIssueState: v.documentIssueState || undefined,
    address: {
      addressType: isPF ? "RESIDENCIAL" : "COMERCIAL",
      zipcode: onlyDigits(v.zipcode),
      street: v.street.trim(),
      number: v.number.trim(),
      complement: v.complement.trim(),
      district: v.district.trim(),
      city: v.city.trim(),
      state: v.state,
    },
  };

  if (isPF) {
    payload.nationality = v.nationality;
    payload.maritalStatus = v.maritalStatus;
    payload.monthlyIncome = normalizeMoney(v.monthlyIncome) ?? v.monthlyIncome;
    payload.hometown = v.hometown.trim();
  } else {
    // A empresa informa o faturamento MENSAL. A Ether pede o mensal em
    // profile.monthlyIncome e o ANUAL total em companyInfo.revenue (estimado: mensal x 12).
    const monthly = normalizeMoney(v.revenue) ?? v.revenue;
    const annual = Number.isFinite(Number(monthly)) ? ((Math.round(Number(monthly) * 100) * 12) / 100).toFixed(2) : monthly;
    payload.nationality = "Brasileiro"; // obrigatório também em PJ na Ether
    payload.monthlyIncome = monthly;
    payload.socialName = v.socialName.trim();
    payload.website = normalizeUrl(v.website) ?? v.website;
    payload.socialNetwork = normalizeUrl(v.socialNetwork) ?? v.socialNetwork;
    payload.companyInfo = {
      tradeName: v.tradeName.trim(),
      openingDate: v.openingDate,
      revenue: annual,
      responsible: {
        fullName: v.respFullName.trim(),
        email: v.respEmail.trim(),
        phone: onlyDigits(v.respPhone),
      },
    };
  }
  return payload;
}
