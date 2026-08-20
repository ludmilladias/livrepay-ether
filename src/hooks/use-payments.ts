import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type PaymentKind = "transferencia" | "conta" | "folha";
export type PaymentStatus =
  | "draft"
  | "scheduled"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";
export type PixKeyType = "CPF" | "CNPJ" | "PHONE" | "EMAIL" | "RANDOM";
export type PaymentMethod = "PIX" | "BOLETO";

export interface Payment {
  id: string;
  kind: PaymentKind;
  status: PaymentStatus;
  amount_cents: number;
  recipient_name: string | null;
  recipient_key: string | null;
  scheduled_for: string | null;
  executed_at: string | null;
  failure_reason: string | null;
  created_at: string;
}

export const paymentStatusLabel: Record<PaymentStatus, string> = {
  draft: "Rascunho",
  scheduled: "Agendado",
  processing: "Processando",
  completed: "Concluído",
  failed: "Falhou",
  cancelled: "Cancelado",
};

export const paymentStatusClass: Record<PaymentStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  scheduled: "bg-blue-100 text-blue-800",
  processing: "bg-yellow-100 text-yellow-800",
  completed: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  cancelled: "bg-gray-100 text-gray-800",
};

/** A partir daqui o dinheiro já saiu — nenhuma edição é permitida. */
export function isSettled(status: PaymentStatus): boolean {
  return status === "processing" || status === "completed";
}

export interface NewPayment {
  amountCents: number;
  /** Chave PIX (método PIX) ou linha digitável (método BOLETO). */
  recipientKey: string;
  recipientName?: string;
  paymentMethod?: PaymentMethod;
  pixKeyType?: PixKeyType;
  scheduledFor?: string | null;
}

export interface PayResult {
  status: "completed" | "processing";
  e2e?: string;
  fee_cents?: number;
  boleto_id?: string;
  warning?: string;
}

const paymentsKey = (kind: PaymentKind) => ["payments", kind] as const;
const balanceKey = ["account-balance"] as const;

export function usePayments(kind: PaymentKind) {
  return useQuery({
    queryKey: paymentsKey(kind),
    queryFn: () => api.get<Payment[]>(`/payments?kind=${kind}`),
  });
}

/** Saldo disponível em centavos. Fonte da verdade é o banco. */
export function useAccountBalance() {
  return useQuery({
    queryKey: balanceKey,
    queryFn: async () => {
      const data = await api.get<{ balance_cents: number }>("/accounts/balance");
      return data.balance_cents;
    },
  });
}

export function useCreatePayment(kind: PaymentKind) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: NewPayment) =>
      api.post<Payment>("/payments", {
        kind,
        amount_cents: input.amountCents,
        payment_method: input.paymentMethod ?? "PIX",
        recipient_name: input.recipientName,
        recipient_key: input.recipientKey,
        pix_key_type: input.pixKeyType,
        scheduled_for: input.scheduledFor ?? null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: paymentsKey(kind) });
    },
  });
}

/**
 * Executa o pagamento. O servidor debita, envia o PIX e — se o provedor
 * recusar — estorna. O cliente nunca decide sobre saldo.
 */
export function useExecutePayment(kind: PaymentKind) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (paymentId: string) => api.post<PayResult>(`/payments/${paymentId}/execute`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: paymentsKey(kind) });
      // O saldo mudou: relê do servidor em vez de recalcular no cliente.
      void queryClient.invalidateQueries({ queryKey: balanceKey });
    },
  });
}

export function useCancelPayment(kind: PaymentKind) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.patch<Payment>(`/payments/${id}/cancel`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: paymentsKey(kind) });
    },
  });
}
