import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Charge } from "@/hooks/use-charges";

export interface InstallmentPlan {
  id: string;
  customer_name: string;
  customer_tax_id: string;
  description: string;
  total_installments: number;
  amount_per_installment_cents: number;
  first_due_date: string;
  created_at: string;
  created_charges: number;
  paid_count: number;
  cancelled_count: number;
  next_due_date: string | null;
}

export interface InstallmentPlanDetail extends InstallmentPlan {
  charges: Charge[];
}

export interface NewInstallmentPlan {
  customerName: string;
  customerTaxId: string;
  description: string;
  amountPerInstallmentCents: number;
  totalInstallments: number;
  firstDueDate: string;
}

const plansKey = ["installment-plans"] as const;
const planKey = (id: string) => [...plansKey, id] as const;

export function useInstallmentPlans() {
  return useQuery({
    queryKey: plansKey,
    queryFn: () => api.get<InstallmentPlan[]>("/installment-plans"),
  });
}

export function useInstallmentPlan(id: string | undefined) {
  return useQuery({
    queryKey: id ? planKey(id) : [...plansKey, "disabled"],
    queryFn: () => api.get<InstallmentPlanDetail>(`/installment-plans/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateInstallmentPlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: NewInstallmentPlan) =>
      api.post<InstallmentPlanDetail>("/installment-plans", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: plansKey });
    },
  });
}

/** Cancela uma parcela específica (um registro em charges) dentro do carnê. */
export function useCancelInstallmentCharge(planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (chargeId: string) => api.patch<Charge>(`/charges/${chargeId}/cancel`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: planKey(planId) });
      void queryClient.invalidateQueries({ queryKey: plansKey });
    },
  });
}

/** Emite uma parcela no provedor (Ether). Hoje sempre 503 (ver payments/charges). */
export function useEmitInstallmentCharge(planId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (chargeId: string) => api.post(`/charges/${chargeId}/emit`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: planKey(planId) });
    },
  });
}
