import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";

export type PersonType = "FISICA" | "JURIDICA";

/** Mesmos campos de `onboardingSchema` em server/src/routes/auth.js — nomes idênticos. */
export interface OnboardingPayload {
  taxId: string;
  personType: PersonType;
  phone: string;
  dateBirth: string;

  documentType?: string;
  documentNumber: string;
  documentIssuingAgency?: string;
  documentIssueDate?: string;
  documentIssueState?: string;

  nationality?: string;
  maritalStatus?: string;
  monthlyIncome?: string;
  hometown?: string;
  gender?: string;
  education?: string;
  socialName?: string;
  website?: string;
  socialNetwork?: string;
  managerName?: string;
  cnaeId?: string;
  assessment?: string;
  legalNature?: string;

  address: {
    addressType: string;
    zipcode: string;
    street: string;
    number: string;
    complement?: string;
    district: string;
    city: string;
    state: string;
    country?: string;
  };

  companyInfo?: {
    tradeName: string;
    openingDate: string;
    revenue: string;
    responsible: { fullName: string; email: string; phone: string };
  };
}

// --- Checklist de documentos (KYC) -----------------------------------------

/**
 * Item do checklist. Forma documentada pela Ether: `{type, label}`, com
 * `uploadedAt` nos enviados. Os recusados provavelmente trazem um motivo, mas
 * o nome do campo NÃO está documentado: `reason` é preenchido de forma
 * defensiva (ver `toItem`) e a tela funciona sem ele.
 */
export interface ChecklistItem {
  type: string;
  label: string;
  reason?: string;
  uploadedAt?: string;
}

export interface DocumentChecklist {
  pending: ChecklistItem[];
  uploaded: ChecklistItem[];
  rejected: ChecklistItem[];
}

/**
 * Rótulo de apoio só para quando a Ether não manda `label`. A lista de
 * documentos exigidos NUNCA é fixa no front: ela vem sempre do backend.
 */
const FALLBACK_LABELS: Record<string, string> = {
  CARTEIRA_IDENTIDADE: "Documento de identidade (RG/CNH)",
  COMPROVANTE_RESIDENCIA: "Comprovante de residência",
  SELFIE_COM_DOC: "Selfie segurando o documento",
  CARTAO_CNPJ: "Cartão CNPJ",
  CONTRATO_SOCIAL: "Contrato social",
};

function toItem(raw: unknown): ChecklistItem | null {
  if (typeof raw === "string") {
    return { type: raw, label: FALLBACK_LABELS[raw] ?? raw };
  }
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const type =
      typeof o.type === "string" ? o.type : typeof o.documentType === "string" ? o.documentType : null;
    if (!type) return null;
    const reasonRaw = o.reason ?? o.rejectionReason ?? o.message ?? o.observation;
    return {
      type,
      label: typeof o.label === "string" && o.label ? o.label : (FALLBACK_LABELS[type] ?? type),
      reason: typeof reasonRaw === "string" && reasonRaw ? reasonRaw : undefined,
      uploadedAt: typeof o.uploadedAt === "string" ? o.uploadedAt : undefined,
    };
  }
  return null;
}

function toItems(raw: unknown): ChecklistItem[] {
  return Array.isArray(raw) ? raw.map(toItem).filter((i): i is ChecklistItem => i !== null) : [];
}

/**
 * Normaliza o checklist vindo do backend. Aceita itens como objeto ou string e
 * `sent` como sinônimo de `uploaded` (o mock dos testes do servidor usa `sent`;
 * a spec da Ether usa `uploaded`): a forma real, com upload já feito, ainda não
 * foi vista numa chamada real. `null` = o backend não conseguiu consultar a Ether.
 */
export function normalizeChecklist(raw: unknown): DocumentChecklist | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  return {
    pending: toItems(o.pending),
    uploaded: toItems(o.uploaded ?? o.sent),
    rejected: toItems(o.rejected),
  };
}

export interface OnboardingResult {
  ether_user_id: string;
  status: string;
  document_checklist?: unknown;
  message: string;
}

export interface OnboardingStatus {
  ether_user_id?: string;
  /**
   * `not_started`, o status CRU da Ether (pending_documents | pending_analysis |
   * active | inactive) ou, se a Ether estiver fora, o status LOCAL
   * (pending | basic | full | rejected). `deriveStage` lida com os dois.
   */
  status: string;
  pix_key?: string | null;
  pix_key_type?: string | null;
  checklist?: unknown;
}

export interface UploadResult {
  uploaded_type: string;
  ether_user_id: string;
  status: string;
  checklist?: unknown;
}

// --- Etapa da jornada --------------------------------------------------------

export type KycStage =
  | "not_started" //        ainda não enviou o cadastro
  | "awaiting_documents" // cadastro feito, faltam documentos
  | "in_analysis" //        documentos enviados, Ether/Compliance analisando
  | "approved" //           conta ativa
  | "rejected" //           cadastro recusado
  | "pending_unknown"; //   só sabemos "pending" (Ether fora do ar): não dá para dizer qual

export function deriveStage(status: string | undefined): KycStage | undefined {
  switch (status) {
    case undefined:
      return undefined;
    case "not_started":
      return "not_started";
    case "pending_documents":
      return "awaiting_documents";
    case "pending_analysis":
      return "in_analysis";
    case "active":
    case "full":
      return "approved";
    case "inactive":
    case "rejected":
      return "rejected";
    // "pending" e "basic" (vocabulário local) e qualquer valor desconhecido:
    // não afirmamos aprovação nem trancamos o usuário numa etapa incerta.
    default:
      return "pending_unknown";
  }
}

const statusKey = ["onboarding-status"] as const;

/**
 * Atualização automática do status enquanto a conta está em análise.
 *
 * Intervalo de 60 s: a aprovação é uma análise humana/de compliance que leva
 * minutos a dias, então saber dela com até 1 minuto de atraso não muda nada
 * para o usuário, e cada consulta bate na Ether (por isso o `staleTime` de
 * 30 s). 60 s dá no máximo 60 consultas/h por conta em análise, só com a aba
 * visível (`refetchIntervalInBackground: false`); ao voltar para a aba, o
 * `refetchOnWindowFocus` padrão atualiza na hora se o dado tiver mais de 30 s.
 * Se a última consulta falhou (Ether instável), o intervalo dobra para 120 s
 * em vez de martelar um provedor que já está com problema.
 *
 * Só consulta em `in_analysis` e `pending_unknown`: os estados finais
 * (`approved`, `rejected`) e os que dependem de ação do próprio usuário
 * (`not_started`, `awaiting_documents`, que muda quando ELE envia) não têm o
 * que esperar da Ether.
 */
export const KYC_POLL_INTERVAL_MS = 60_000;
export const KYC_POLL_INTERVAL_AFTER_ERROR_MS = 120_000;
const POLLING_STAGES: readonly KycStage[] = ["in_analysis", "pending_unknown"];

/**
 * Status atual do cadastro na Ether (`not_started` se ainda não iniciado).
 *
 * `autoRefresh` liga o polling. Use em UM lugar por vez (o gate do painel ou a
 * tela de documentos, nunca os dois): cada observador com intervalo tem o seu
 * próprio timer, e vários multiplicariam as consultas à Ether.
 */
export function useOnboardingStatus(options: { autoRefresh?: boolean } = {}) {
  const { user } = useAuth();
  const autoRefresh = options.autoRefresh ?? false;

  return useQuery({
    queryKey: statusKey,
    queryFn: () => api.get<OnboardingStatus>("/auth/onboarding/status"),
    enabled: !!user,
    // Cada consulta bate na Ether; evita refetch a cada foco/montagem.
    staleTime: 30_000,
    refetchInterval: autoRefresh
      ? (query) => {
          const stage = deriveStage(query.state.data?.status);
          if (!stage || !POLLING_STAGES.includes(stage)) return false;
          return query.state.status === "error" ? KYC_POLL_INTERVAL_AFTER_ERROR_MS : KYC_POLL_INTERVAL_MS;
        }
      : false,
    refetchIntervalInBackground: false,
  });
}

/** Etapa + checklist já normalizados, para o gate, o banner e a tela de documentos. */
export function useKycJourney(options: { autoRefresh?: boolean } = {}) {
  const queryClient = useQueryClient();
  const query = useOnboardingStatus(options);
  const stage = deriveStage(query.data?.status);

  // Quando a análise termina, o perfil (que guarda o status local da conta) fica velho.
  const previousStage = useRef(stage);
  useEffect(() => {
    const before = previousStage.current;
    previousStage.current = stage;
    if (
      options.autoRefresh &&
      before &&
      POLLING_STAGES.includes(before) &&
      (stage === "approved" || stage === "rejected")
    ) {
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
    }
  }, [stage, options.autoRefresh, queryClient]);

  return {
    ...query,
    stage,
    checklist: normalizeChecklist(query.data?.checklist),
  };
}

/** Envia os dados de KYC e inicia a abertura de conta na Ether. */
export function useSubmitOnboarding() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: OnboardingPayload) => api.post<OnboardingResult>("/auth/onboarding", payload),
    onSuccess: (result) => {
      // Usa o checklist que veio no 201 em vez de reconsultar a Ether.
      queryClient.setQueryData<OnboardingStatus>(statusKey, {
        ether_user_id: result.ether_user_id,
        status: result.status,
        checklist: result.document_checklist ?? null,
      });
      queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
  });
}

/** Mensagem acionável por `code` do backend (nunca o código cru). */
export function uploadErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case "ONBOARDING_REQUIRED":
        return "Antes de enviar documentos, preencha o cadastro de abertura de conta.";
      case "ACCOUNT_NOT_PENDING":
        return "Esta conta não aceita mais documentos. Atualize a página para ver a situação atual.";
      case "FILE_TOO_LARGE":
        return "O arquivo tem mais de 5 MB. Reduza o tamanho (ou tire a foto em resolução menor) e envie de novo.";
      case "UNSUPPORTED_MEDIA_TYPE":
        return "Formato não aceito. Envie um PDF, JPG ou PNG válido (não renomeie arquivos de outro tipo).";
      case "DOCUMENT_REJECTED":
        return "O documento foi recusado. Confira se está legível, completo e é o documento pedido, e envie outro arquivo.";
      case "PROVIDER_UNAVAILABLE":
        return "Não conseguimos enviar agora por instabilidade do nosso parceiro bancário. Tente de novo em alguns minutos.";
      case "EMPTY_FILE":
        return "O arquivo está vazio. Escolha outro arquivo.";
      default:
        if (err.status === 429) return "Muitos envios seguidos. Aguarde alguns minutos e tente novamente.";
        if (err.status === 401) return "Sua sessão expirou. Entre novamente para continuar.";
        return err.message;
    }
  }
  return "Falha de conexão. Verifique sua internet e tente de novo.";
}

/**
 * Mensagem de erro para a SUBSTITUIÇÃO de um documento já enviado. Não sabemos
 * se a Ether troca o arquivo ou recusa um segundo envio do mesmo tipo, então
 * a mensagem separa o que sabemos (a Ether recusou: nada mudou) do que não
 * sabemos (falha de rede/provedor: o envio pode ou não ter chegado).
 */
export function replaceErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.code === "DOCUMENT_REJECTED") {
    return (
      "O banco parceiro não aceitou o novo arquivo, então a troca NÃO foi feita: o documento continua como estava. " +
      "Pode ser que o arquivo tenha sido recusado ou que o banco não aceite trocar um documento já enviado. " +
      "Confira se o arquivo está legível e completo; se precisar corrigir o documento, fale com o suporte."
    );
  }
  if (!(err instanceof ApiError) || err.code === "PROVIDER_UNAVAILABLE" || err.status >= 500) {
    return (
      "Não conseguimos confirmar se a troca foi feita: o novo arquivo pode ou não ter chegado ao banco parceiro. " +
      "Estamos reconsultando a situação; confira a data de envio acima antes de tentar de novo."
    );
  }
  return uploadErrorMessage(err);
}

/** Move o documento enviado de pendente/recusado para enviado, quando o backend não devolveu checklist. */
function markUploadedLocally(raw: unknown, type: string): DocumentChecklist | null {
  const current = normalizeChecklist(raw);
  if (!current) return null;
  const moved = [...current.pending, ...current.rejected].find((i) => i.type === type);
  return {
    pending: current.pending.filter((i) => i.type !== type),
    rejected: current.rejected.filter((i) => i.type !== type),
    uploaded: moved ? [...current.uploaded, moved] : current.uploaded,
  };
}

/** Envia UM documento (corpo binário bruto) e atualiza o cache com o checklist da resposta. */
export function useUploadDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ type, file }: { type: string; file: File }) =>
      api.upload<UploadResult>(`/auth/onboarding/documents/${encodeURIComponent(type)}`, file),
    onSuccess: (result, { type }) => {
      queryClient.setQueryData<OnboardingStatus>(statusKey, (old) => ({
        ...old,
        status: result.status ?? old?.status ?? "pending_documents",
        // Se a Ether não respondeu o checklist após o upload, o servidor devolve
        // null mesmo com o envio feito: reflete localmente em vez de apagar a lista.
        checklist: result.checklist ?? markUploadedLocally(old?.checklist, type),
      }));
    },
    onError: (err) => {
      // Estados que mudam o que a tela deve mostrar: reconsulta.
      // Falha ambígua (rede/provedor): o envio pode ter chegado, então reconsulta para a tela não mentir.
      const ambiguous = !(err instanceof ApiError) || err.code === "PROVIDER_UNAVAILABLE" || err.status >= 500;
      if (
        ambiguous ||
        (err instanceof ApiError && (err.code === "ONBOARDING_REQUIRED" || err.code === "ACCOUNT_NOT_PENDING"))
      ) {
        queryClient.invalidateQueries({ queryKey: statusKey });
      }
    },
  });
}

