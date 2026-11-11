import { config } from "./config.js";

export const DEFAULT_TENANT = "livrepay";

/**
 * Tenant do app que fez a requisição, a partir do cabeçalho Origin.
 *
 * Só vale para ESCOLHER o tenant no cadastro e para barrar login no app errado:
 * Origin é falsificável fora de um navegador, então isto nunca concede acesso a
 * dado — o isolamento é feito no banco (RLS + tenant_staff), pelo tenant gravado
 * no cadastro do usuário. Origem desconhecida ou ausente = tenant padrão.
 */
export function tenantFromOrigin(origin) {
  if (typeof origin !== "string" || origin === "") return DEFAULT_TENANT;
  const normalized = origin.trim().replace(/\/+$/, "").toLowerCase();
  for (const [slug, tenant] of Object.entries(config.tenants)) {
    if (tenant.origins.some((o) => o.toLowerCase() === normalized)) return slug;
  }
  return DEFAULT_TENANT;
}

/** Base dos links de e-mail (redefinição de senha) do tenant. */
export function appUrlForTenant(slug) {
  return config.tenants[slug]?.appUrl || config.appUrl;
}
