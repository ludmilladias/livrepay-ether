import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { auth, onAuthChange, getCurrentUser, type SessionUser } from "@/lib/api";

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
