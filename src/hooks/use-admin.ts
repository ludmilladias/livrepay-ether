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
  /** Agência (tenant) do dono do recebível. */
  tenant_slug: string | null;
  /** Pré-aprovado pela equipe da agência (não libera crédito; a verificação final é da plataforma). */
  tenant_reviewed_at: string | null;
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

// --- Módulos por conta -----------------------------------------------------------

export type AccountModule = "crypto";

const adminModulesKey = ["admin", "modules"] as const;

export function useAdminModules() {
  return useQuery({
    queryKey: adminModulesKey,
    queryFn: () => api.get<{ user_id: string; module: AccountModule }[]>("/admin/modules"),
  });
}

export function useSetModule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      userId,
      module,
      enabled,
    }: {
      userId: string;
      module: AccountModule;
      enabled: boolean;
    }) => api.put(`/admin/users/${userId}/modules`, { module, enabled }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminModulesKey });
    },
  });
}

// --- Credenciais da Ether por cliente --------------------------------------------

/** Só metadados: o servidor nunca devolve o clientSecret. */
export interface EtherCredential {
  user_id: string;
  ether_user_id: string;
  client_id: string;
  status: "active" | "suspect";
  created_at: string;
}

const etherCredentialsKey = ["admin", "ether-credentials"] as const;

export function useEtherCredentials() {
  return useQuery({
    queryKey: etherCredentialsKey,
    queryFn: () => api.get<EtherCredential[]>("/admin/ether-credentials"),
  });
}

/** Conta da própria LivrePay na Ether (ID configurado no servidor). */
export interface HouseAccount {
  ether_user_id: string;
  linked_user_id: string | null;
}

const houseAccountKey = ["admin", "house-account"] as const;

export function useHouseAccount() {
  return useQuery({
    queryKey: houseAccountKey,
    queryFn: () => api.get<HouseAccount>("/admin/house-account"),
  });
}

/** Conferência: saldo cru da Ether × saldo do ledger do operador da conta da casa. */
export interface HouseBalance {
  ether_balance_raw: number | null;
  local_balance_cents: number | null;
}

export function useHouseBalance(enabled: boolean) {
  return useQuery({
    queryKey: [...houseAccountKey, "balance"],
    queryFn: () => api.get<HouseBalance>("/admin/house-account/balance"),
    enabled,
    retry: false,
  });
}

/** Liga a conta da LivrePay a um usuário admin. Sem segredo no corpo: o servidor já tem a credencial. */
export function useLinkHouseAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.post(`/admin/users/${userId}/link-house-account`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: houseAccountKey });
    },
  });
}

/** Tira o vínculo de quem opera a conta da LivrePay (troca de operador, saída da empresa). */
export function useUnlinkHouseAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post(`/admin/house-account/unlink`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: houseAccountKey });
    },
  });
}

export function useRevokeEtherCredential() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.post(`/admin/users/${userId}/ether-credential/revoke`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: etherCredentialsKey });
    },
  });
}

// --- Agências (tenants): limites, suspensão e conciliação -----------------------
// A Ether não conhece agência: estes controles são só do LivrePay (valem no banco).

export interface AdminTenant {
  slug: string;
  name: string;
  status: "active" | "suspended";
  suspended_at: string | null;
  suspended_reason: string | null;
  customers: number;
  balance_cents: number;
  credits_30d_cents: number;
  debits_30d_cents: number;
  advanced_exposure_cents: number;
  advanced_today_cents: number;
  pending_receivables: number;
  /** null = sem limite */
  max_receivable_cents: number | null;
  max_exposure_cents: number | null;
  max_daily_advance_cents: number | null;
}

export interface TenantLimitsInput {
  max_receivable_cents: number | null;
  max_exposure_cents: number | null;
  max_daily_advance_cents: number | null;
}

const adminTenantsKey = ["admin", "tenants"] as const;

export function useAdminTenants() {
  return useQuery({
    queryKey: adminTenantsKey,
    queryFn: () => api.get<AdminTenant[]>("/admin/tenants"),
  });
}

export interface TenantMovementDay {
  day: string;
  credits_cents: number;
  debits_cents: number;
}

/** Entradas e saídas por dia (30 dias) de uma agência; só busca quando `enabled`. */
export function useAdminTenantMovement(slug: string | null) {
  return useQuery({
    queryKey: ["admin", "tenants", slug, "movement"],
    queryFn: () => api.get<TenantMovementDay[]>(`/admin/tenants/${slug}/movement`),
    enabled: !!slug,
  });
}

export function useSetTenantLimits() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, limits }: { slug: string; limits: TenantLimitsInput }) =>
      api.put(`/admin/tenants/${slug}/limits`, limits),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminTenantsKey });
    },
  });
}

export function useSuspendTenant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, reason }: { slug: string; reason: string }) =>
      api.post(`/admin/tenants/${slug}/suspend`, { reason }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminTenantsKey });
    },
  });
}

export function useReactivateTenant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => api.post(`/admin/tenants/${slug}/reactivate`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminTenantsKey });
    },
  });
}
