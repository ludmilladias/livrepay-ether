import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type ReceivableStatus = "scheduled" | "settled" | "advanced" | "overdue" | "cancelled";

export interface ReceivableContract {
  id: string;
  name: string;
  acquirer: string | null;
  total_cents: number;
  pending_cents: number;
  created_at: string;
}

export interface Receivable {
  id: string;
  contract_id: string | null;
  contract_name: string | null;
  contract_acquirer: string | null;
  gross_cents: number;
  net_cents: number;
  due_date: string;
  status: ReceivableStatus;
  created_at: string;
}

export const receivableStatusLabel: Record<ReceivableStatus, string> = {
  scheduled: "Agendado",
  settled: "Liquidado",
  advanced: "Antecipado",
  overdue: "Atrasado",
  cancelled: "Cancelado",
};

export const receivableStatusClass: Record<ReceivableStatus, string> = {
  scheduled: "bg-blue-100 text-blue-800",
  settled: "bg-green-100 text-green-800",
  advanced: "bg-purple-100 text-purple-800",
  overdue: "bg-red-100 text-red-800",
  cancelled: "bg-gray-100 text-gray-800",
};

/** Só agendado/atrasado pode virar cancelado ou ser antecipado. */
export function isReceivableOpen(status: ReceivableStatus): boolean {
  return status === "scheduled" || status === "overdue";
}

const contractsKey = ["receivable-contracts"] as const;
const receivablesKey = (status?: ReceivableStatus) => ["receivables", status ?? "all"] as const;
const summaryKey = ["receivables", "summary"] as const;

export function useReceivableContracts() {
  return useQuery({
    queryKey: contractsKey,
    queryFn: () => api.get<ReceivableContract[]>("/receivable-contracts"),
  });
}

export function useCreateReceivableContract() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; acquirer?: string }) =>
      api.post<ReceivableContract>("/receivable-contracts", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: contractsKey });
    },
  });
}

export function useReceivables(status?: ReceivableStatus) {
  return useQuery({
    queryKey: receivablesKey(status),
    queryFn: () => api.get<Receivable[]>(`/receivables${status ? `?status=${status}` : ""}`),
  });
}

export interface ReceivableSummaryRow {
  status: ReceivableStatus;
  count: number;
  gross_cents: number;
}

export function useReceivableSummary() {
  return useQuery({
    queryKey: summaryKey,
    queryFn: () => api.get<ReceivableSummaryRow[]>("/receivables/summary"),
  });
}

export interface NewReceivable {
  contractId?: string | null;
  grossCents: number;
  netCents: number;
  dueDate: string;
}

function invalidateAllReceivables(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ["receivables"] });
  void queryClient.invalidateQueries({ queryKey: contractsKey });
}

export function useCreateReceivable() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NewReceivable) =>
      api.post<Receivable>("/receivables", {
        contract_id: input.contractId ?? null,
        gross_cents: input.grossCents,
        net_cents: input.netCents,
        due_date: input.dueDate,
      }),
    onSuccess: () => invalidateAllReceivables(queryClient),
  });
}

export function useCancelReceivable() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.patch<Receivable>(`/receivables/${id}/cancel`),
    onSuccess: () => invalidateAllReceivables(queryClient),
  });
}

/** Credita o valor líquido agora; não passa pela Ether, é ledger interno. */
export function useAdvanceReceivable() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<Receivable>(`/receivables/${id}/advance`),
    onSuccess: () => {
      invalidateAllReceivables(queryClient);
      void queryClient.invalidateQueries({ queryKey: ["account-balance"] });
    },
  });
}
