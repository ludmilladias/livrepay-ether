import { Navigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useProfile, type StaffRole } from "@/hooks/use-profile";

/**
 * Bloqueia acesso de quem não tem nenhuma das roles listadas. Igual a
 * ProtectedRoute: é conveniência de UX, não segurança — quem autoriza de
 * verdade são as policies de RLS e as funções SECURITY DEFINER que checam
 * has_role() no banco. Alguém contornando isto no browser não vê nem
 * consegue alterar nada que a role dele não permita no Postgres.
 */
export function RequireRole({ roles, children }: { roles: StaffRole[]; children: ReactNode }) {
  const { data: profile, isLoading } = useProfile();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const hasRole = profile?.roles?.some((r) => roles.includes(r as StaffRole));
  if (!hasRole) return <Navigate to="/" replace />;

  return <>{children}</>;
}
