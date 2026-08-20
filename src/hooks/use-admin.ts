import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

// --- Visão geral --------------------------------------------------------------

export interface AdminOverview {
  pending_receivables: number;
  provider_events_with_error: number;
  total_users: number;
}

export function useAdminOverview() {
  return useQuery({
    queryKey: ["admin", "overview"],
    queryFn: () => api.get<AdminOverview>("/admin/overview"),
  });
}

// --- Verificação de recebíveis --------------------------------------------------

export interface AdminReceivable {
  id: string;
  user_id: string;
  owner_name: string | null;
  contract_name: string | null;
  contract_acquirer: string | null;
  gross_cents: number;
  net_cents: number;
  due_date: string;
  status: "scheduled" | "overdue" | "advanced" | "settled" | "cancelled";
  verified_at: string | null;
  verified_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  created_at: string;
}

const adminReceivablesKey = ["admin", "receivables"] as const;

export function useAdminReceivables() {
  return useQuery({
    queryKey: adminReceivablesKey,
    queryFn: () => api.get<AdminReceivable[]>("/admin/receivables"),
  });
}

export function useVerifyReceivable() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/admin/receivables/${id}/verify`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminReceivablesKey });
      void queryClient.invalidateQueries({ queryKey: ["admin", "overview"] });
    },
  });
}

export function useRejectReceivable() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/admin/receivables/${id}/reject`, { reason }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminReceivablesKey });
      void queryClient.invalidateQueries({ queryKey: ["admin", "overview"] });
    },
  });
}

// --- Eventos do provedor --------------------------------------------------------

export interface AdminProviderEvent {
  id: string;
  provider: string;
  event_id: string;
  event_type: string;
  payload: unknown;
  processed_at: string | null;
  error: string | null;
  received_at: string;
}

const providerEventsKey = (onlyErrors: boolean) => ["admin", "provider-events", onlyErrors] as const;

export function useAdminProviderEvents(onlyErrors: boolean) {
  return useQuery({
    queryKey: providerEventsKey(onlyErrors),
    queryFn: () =>
      api.get<AdminProviderEvent[]>(`/admin/provider-events?onlyErrors=${onlyErrors}`),
  });
}

export function useReprocessProviderEvent(onlyErrors: boolean) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/admin/provider-events/${id}/reprocess`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: providerEventsKey(onlyErrors) });
      void queryClient.invalidateQueries({ queryKey: ["admin", "overview"] });
    },
  });
}

// --- Auditoria -------------------------------------------------------------------

export interface AdminAuditEntry {
  id: string;
  user_id: string | null;
  action: string;
  table_name: string;
  record_id: string | null;
  old_data: unknown;
  new_data: unknown;
  created_at: string;
}

export function useAdminAuditLog(table?: string) {
  return useQuery({
    queryKey: ["admin", "audit-log", table ?? null],
    queryFn: () =>
      api.get<AdminAuditEntry[]>(`/admin/audit-log${table ? `?table=${table}` : ""}`),
  });
}

// --- Usuários e papéis -----------------------------------------------------------

export interface AdminUser {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string;
  roles: string[];
}

const adminUsersKey = ["admin", "users"] as const;

export function useAdminUsers() {
  return useQuery({
    queryKey: adminUsersKey,
    queryFn: () => api.get<AdminUser[]>("/admin/users"),
  });
}

export function useAssignRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      api.post(`/admin/users/${userId}/roles`, { role }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminUsersKey });
    },
  });
}

export function useRemoveRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      api.delete(`/admin/users/${userId}/roles/${role}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminUsersKey });
    },
  });
}
