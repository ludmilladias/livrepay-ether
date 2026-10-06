import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
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

export interface OnboardingResult {
  ether_user_id: string;
  status: string;
  document_checklist?: { pending: { type: string; label: string }[] } | null;
  message: string;
}

export interface OnboardingStatus {
  ether_user_id?: string;
  status: string;
  pix_key?: string | null;
  pix_key_type?: string | null;
  checklist?: { pending?: unknown[]; uploaded?: unknown[]; rejected?: unknown[] } | null;
}

const statusKey = ["onboarding-status"] as const;

/** Status atual do cadastro na Ether (null se ainda não iniciado). */
export function useOnboardingStatus() {
  const { user } = useAuth();

  return useQuery({
    queryKey: statusKey,
    queryFn: () => api.get<OnboardingStatus>("/auth/onboarding/status"),
    enabled: !!user,
  });
}

/** Envia os dados de KYC e inicia a abertura de conta na Ether. */
export function useSubmitOnboarding() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: OnboardingPayload) => api.post<OnboardingResult>("/auth/onboarding", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: statusKey });
      queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
  });
}
