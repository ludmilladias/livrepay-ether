import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { auth } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/ui/logo";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Regra real do servidor (credentials em server/src/routes/auth.js). */
const MIN_PASSWORD = 10;

/** O token chega no fragmento (#token=...): não vai para logs de servidor nem para o Referer. */
function readToken(): string {
  return new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token") ?? "";
}

export default function RedefinirSenha() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setToken(readToken());
    // Tira o token da barra de endereço e do histórico.
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < MIN_PASSWORD) return setMessage(`A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`);
    if (password !== confirm) return setMessage("As senhas não conferem.");

    setBusy(true);
    setMessage(null);
    try {
      await auth.resetPassword(token, password);
      setDone(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível concluir.");
    } finally {
      setBusy(false);
    }
  }

  const invalidLink = !token && !done;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 sm:p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="flex justify-center">
          <Logo size="lg" className="text-primary" />
        </div>

        <Card>
          <CardHeader className="space-y-2">
            <CardTitle className="text-xl">Criar nova senha</CardTitle>
            <CardDescription>
              {done ? "Senha alterada." : "Escolha uma senha nova para a sua conta."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {done ? (
              <div className="space-y-4" role="status">
                <p className="text-sm">Pronto. Por segurança, você foi desconectado de todos os dispositivos.</p>
                <Button asChild className="w-full">
                  <Link to="/auth">Entrar</Link>
                </Button>
              </div>
            ) : invalidLink ? (
              <div className="space-y-4">
                <p role="alert" className="text-sm text-destructive">
                  Este link é inválido ou está incompleto. Peça um novo.
                </p>
                <Button asChild className="w-full">
                  <Link to="/esqueci-senha">Pedir novo link</Link>
                </Button>
              </div>
            ) : (
              <form onSubmit={submit} noValidate className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="password">Nova senha</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={show ? "text" : "password"}
                      required
                      minLength={MIN_PASSWORD}
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pr-11"
                      aria-describedby="password-hint"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-full w-11"
                      onClick={() => setShow((s) => !s)}
                      aria-label={show ? "Ocultar senha" : "Mostrar senha"}
                      aria-pressed={show}
                    >
                      {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                  <p id="password-hint" className="text-xs text-muted-foreground">
                    Mínimo de {MIN_PASSWORD} caracteres.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirm">Repita a nova senha</Label>
                  <Input
                    id="confirm"
                    type={show ? "text" : "password"}
                    required
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                </div>

                {message && (
                  <p role="alert" className="text-sm text-destructive">
                    {message}
                  </p>
                )}

                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? "Aguarde..." : "Salvar nova senha"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
