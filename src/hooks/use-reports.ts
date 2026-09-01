import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface DailyFlow {
  day: string;
  in_cents: number;
  out_cents: number;
}

/** Fluxo de caixa dos últimos 30 dias — só do usuário logado (RLS). */
export function useCashflow() {
  return useQuery({
    queryKey: ["reports", "cashflow"],
    queryFn: () => api.get<DailyFlow[]>("/reports/cashflow"),
  });
}

/** Volume agregado de todas as contas — só staff (admin/compliance). */
export function useAdminVolume() {
  return useQuery({
    queryKey: ["admin", "reports", "volume"],
    queryFn: () => api.get<DailyFlow[]>("/admin/reports/volume"),
  });
}

// --- Extrato ---------------------------------------------------------------

export interface StatementTransaction {
  id: string;
  type: "credit" | "debit";
  amount_cents: number;
  balance_before_cents: number;
  balance_after_cents: number;
  description: string;
  reference_table: string | null;
  created_at: string;
}

export interface Statement {
  from: string;
  to: string;
  opening_balance_cents: number;
  closing_balance_cents: number;
  total_in_cents: number;
  total_out_cents: number;
  transaction_count: number;
  transactions: StatementTransaction[];
}

/** Extrato real do ledger num período. `from`/`to` no formato YYYY-MM-DD. */
export function useStatement(from?: string, to?: string) {
  return useQuery({
    queryKey: ["reports", "statement", from ?? null, to ?? null],
    queryFn: () => {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const qs = params.toString();
      return api.get<Statement>(`/reports/statement${qs ? `?${qs}` : ""}`);
    },
  });
}

// --- Conciliação -------------------------------------------------------------

export interface ReconciliationItem {
  source: "charge" | "payment";
  id: string;
  kind: string;
  description: string;
  amount_cents: number;
  settled_at: string | null;
  reconciled: boolean;
}

export interface Reconciliation {
  total: number;
  reconciled_count: number;
  divergent_count: number;
  divergent_items: ReconciliationItem[];
  items: ReconciliationItem[];
}

/** Checagem de integridade: cobrança paga / pagamento concluído sem lançamento no ledger. */
export function useReconciliation() {
  return useQuery({
    queryKey: ["reports", "reconciliation"],
    queryFn: () => api.get<Reconciliation>("/reports/reconciliation"),
  });
}

// --- Financeiro --------------------------------------------------------------

export interface MonthlyFlow {
  month: string;
  in_cents: number;
  out_cents: number;
}

export interface KindTotal {
  kind: string;
  total_cents: number;
}

export interface Financials {
  period_days: number;
  balance_cents: number;
  revenue_cents: number;
  expense_cents: number;
  net_cents: number;
  monthly: MonthlyFlow[];
  revenue_by_kind: KindTotal[];
  expense_by_kind: KindTotal[];
}

export function useFinancials(months = 12) {
  return useQuery({
    queryKey: ["reports", "financials", months],
    queryFn: () => api.get<Financials>(`/reports/financials?months=${months}`),
  });
}
