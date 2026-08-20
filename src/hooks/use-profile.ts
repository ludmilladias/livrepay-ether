import { useQuery } from "@tanstack/react-query";
import { auth } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";

export type StaffRole = "admin" | "compliance";

const profileKey = ["profile"] as const;

/**
 * Perfil + roles do usuário logado (GET /auth/me). Roles nunca vêm do JWT
 * (o token só carrega `sub`) — sempre lidas do banco, então promover/remover
 * role reflete na próxima consulta, sem precisar de novo login.
 */
export function useProfile() {
  const { user } = useAuth();

  return useQuery({
    queryKey: profileKey,
    queryFn: () => auth.me(),
    enabled: !!user,
  });
}

/** Atalho para gates de UI: `true` se o usuário tem ao menos uma role de staff. */
export function useIsStaff(): boolean {
  const { data } = useProfile();
  return !!data?.roles?.some((r) => r === "admin" || r === "compliance");
}
