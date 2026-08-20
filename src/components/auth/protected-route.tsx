import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";

/**
 * Bloqueia acesso de não autenticados. É conveniência de UX, não segurança:
 * quem protege os dados é a RLS no Postgres — sem sessão válida, a API não
 * devolve nada mesmo que alguém contorne esta verificação no browser.
 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/auth?next=${next}`} replace />;
  }

  return <>{children}</>;
}
