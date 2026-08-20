import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { auth } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Evita open redirect: só aceitamos caminho interno. */
function safeNext(raw: string | null): string {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

export default function Auth() {
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void auth.restore().then((user) => {
      if (user) window.location.replace(next);
    });
  }, [next]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);

    try {
      if (mode === "signin") {
        await auth.login(email, password);
      } else {
        await auth.register(email, password, fullName);
      }
      window.location.replace(next);
    } catch (error) {
      setBusy(false);
      setMessage(error instanceof Error ? error.message : "Não foi possível concluir.");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{mode === "signin" ? "Entrar" : "Criar conta"}</CardTitle>
          <CardDescription>Acesse sua conta para continuar.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={submit} className="space-y-4">
            {mode === "signup" && (
              <div className="space-y-2">
                <Label htmlFor="nome">Nome completo</Label>
                <Input
                  id="nome"
                  required
                  minLength={2}
                  autoComplete="name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={10}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {mode === "signup" && (
                <p className="text-xs text-muted-foreground">
                  Mínimo de 10 caracteres. Use letras, números e símbolos.
                </p>
              )}
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Aguarde..." : mode === "signin" ? "Entrar" : "Criar conta"}
            </Button>
          </form>
          {message && <p className="text-sm text-destructive">{message}</p>}
          <button
            type="button"
            className="text-sm text-muted-foreground underline"
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setMessage(null);
            }}
          >
            {mode === "signin" ? "Não tem conta? Criar conta" : "Já tem conta? Entrar"}
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
