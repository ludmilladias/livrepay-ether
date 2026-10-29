import type { ChecklistItem } from "@/hooks/use-onboarding";

/**
 * Lista padrão de documentos do KYC, por tipo de pessoa (guias oficiais "Abertura
 * de Conta PF/PJ" da Ether). É só o PLANO B da tela: quando a Ether não devolve o
 * checklist (a consulta falhou ou veio sem lista), a pessoa ainda consegue enviar
 * o que a doc manda. Quando o checklist da Ether existe, ele sempre vence.
 *
 * O tipo de pessoa sai do tamanho do CPF/CNPJ do perfil (11 = PF, 14 = PJ).
 * Os tipos são os aceitos no upload (UPLOAD_DOCUMENT_TYPES no servidor).
 */
const PF_DOCUMENTS: ChecklistItem[] = [
  { type: "CARTEIRA_IDENTIDADE", label: "Documento de identidade (RG ou CNH)" },
  { type: "COMPROVANTE_RESIDENCIA", label: "Comprovante de residência (conta de água, luz ou telefone dos últimos 90 dias)" },
  { type: "SELFIE_COM_DOC", label: "Selfie segurando o documento ao lado do rosto" },
];

const PJ_DOCUMENTS: ChecklistItem[] = [
  { type: "CARTAO_CNPJ", label: "Cartão CNPJ (comprovante de inscrição e situação cadastral)" },
  { type: "CONTRATO_SOCIAL", label: "Contrato social atualizado (ou estatuto)" },
  { type: "COMPROVANTE_RESIDENCIA", label: "Comprovante de endereço da empresa" },
];

/** `null` quando não dá para saber o tipo (perfil sem CPF/CNPJ). */
export function defaultKycDocuments(taxId: string | null | undefined): ChecklistItem[] | null {
  const digits = String(taxId ?? "").replace(/\D/g, "");
  if (digits.length === 11) return PF_DOCUMENTS;
  if (digits.length === 14) return PJ_DOCUMENTS;
  return null;
}
