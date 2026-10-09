import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { auth, onAuthChange, getCurrentUser, type SessionUser } from "@/lib/api";
import { clearOnboardingDraft } from "@/lib/onboarding-draft";

interface AuthState {
  user: SessionUser | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(getCurrentUser());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Assina antes de restaurar para não perder a atualização de estado.
    const unsubscribe = onAuthChange(setUser);
    void auth.restore().finally(() => setLoading(false));
    return unsubscribe;
  }, []);

  const signOut = async () => {
    // Rascunho do cadastro (só campos não sensíveis) não sobrevive ao logout.
    clearOnboardingDraft();
    await auth.logout();
    // Navegação completa: descarta qualquer estado sensível em memória.
    window.location.replace("/auth");
  };

  return (
    <AuthContext.Provider value={{ user, loading, signOut }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de <AuthProvider>");
  return ctx;
}
