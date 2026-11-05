import { Navigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useProfile } from "@/hooks/use-profile";

/**
 * Esconde telas de módulo que a conta não contratou. Conveniência de UX, como
 * RequireRole: a API recusa (403 MODULE_NOT_ENABLED) e o banco é quem decide.
 */
export function RequireModule({ module, children }: { module: string; children: ReactNode }) {
  const { data: profile, isLoading } = useProfile();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!profile?.modules?.includes(module)) return <Navigate to="/" replace />;

  return <>{children}</>;
}
