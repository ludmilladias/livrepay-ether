import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type ChargeKind = "link" | "boleto" | "pix" | "assinatura";
export type ChargeStatus = "draft" | "pending" | "paid" | "expired" | "cancelled";

export interface Charge {
  id: string;
  kind: ChargeKind;
  status: ChargeStatus;
  description: string;
  amount_cents: number;
  due_date: string | null;
  customer_name: string | null;
  txid: string | null;
  payload: ChargePayload;
  provider: string | null;
  provider_charge_id: string | null;
  created_at: string;
}

export interface ChargePayload {
  pix_copy_paste?: string;
  qr_code_id?: string;
  expire_at?: string;
  [key: string]: unknown;
}

export function chargePayload(charge: Charge): ChargePayload {
  return charge.payload ?? {};
}

export const chargeStatusLabel: Record<ChargeStatus, string> = {
  draft: "Rascunho",
  pending: "Aguardando",
  paid: "Pago",
  expired: "Expirado",
  cancelled: "Cancelado",
};

export const chargeStatusClass: Record<ChargeStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  pending: "bg-yellow-100 text-yellow-800",
  paid: "bg-green-100 text-green-800",
  expired: "bg-red-100 text-red-800",
  cancelled: "bg-gray-100 text-gray-800",
};

export interface NewCharge {
  description: string;
  amountCents: number;
  dueDate: string | null;
  customerName?: string | null;
  payload?: Record<string, unknown>;
}

export interface ChargeStats {
  total: number;
  paid: number;
  paidRate: number;
  totalCents: number;
}

export interface EmittedCharge {
  charge_id: string;
  pix_copy_paste: string;
  qr_code_id: string;
  expire_at: string;
}

const chargesKey = (kind: ChargeKind) => ["charges", kind] as const;

export function useCharges(kind: ChargeKind) {
  return useQuery({
    queryKey: chargesKey(kind),
    queryFn: () => api.get<Charge[]>(`/charges?kind=${kind}`),
  });
}

export function useChargeStats(kind: ChargeKind) {
  return useQuery({
    queryKey: [...chargesKey(kind), "stats"],
    queryFn: async (): Promise<ChargeStats> => {
      // Agregação feita no banco — não trazemos todas as linhas para somar aqui.
      const data = await api.get<{
        total: number;
        paid: number;
        paid_rate: number;
        total_cents: number;
      }>(`/charges/stats?kind=${kind}`);

      return {
        total: data.total,
        paid: data.paid,
        paidRate: data.paid_rate,
        totalCents: data.total_cents,
      };
    },
  });
}

export function useCreateCharge(kind: ChargeKind) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: NewCharge) =>
      api.post<Charge>("/charges", {
        kind,
        description: input.description,
        amount_cents: input.amountCents,
        due_date: input.dueDate,
        customer_name: input.customerName ?? null,
        payload: input.payload ?? {},
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chargesKey(kind) });
    },
  });
}

/** Emite no provedor (Ether). As credenciais vivem só no servidor. */
export function useEmitCharge(kind: ChargeKind) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (chargeId: string) => api.post<EmittedCharge>(`/charges/${chargeId}/emit`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chargesKey(kind) });
    },
  });
}

export function useCancelCharge(kind: ChargeKind) {
  const queryClient = useQueryClient();

  return useMutation({
    // Cobrança não é apagada — muda de status, preservando a trilha.
    mutationFn: (id: string) => api.patch<Charge>(`/charges/${id}/cancel`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chargesKey(kind) });
    },
  });
}
