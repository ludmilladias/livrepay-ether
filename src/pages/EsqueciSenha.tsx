import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { auth } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/ui/logo";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Recaptcha, RECAPTCHA_SITE_KEY, type RecaptchaHandle } from "@/components/auth/recaptcha";

export default function EsqueciSenha() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const captchaRef = useRef<RecaptchaHandle>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return setMessage("Informe seu e-mail.");
    if (RECAPTCHA_SITE_KEY && !captcha) return setMessage("Confirme que você não é um robô.");

    setBusy(true);
    setMessage(null);
    try {
      await auth.forgotPassword(email.trim(), captcha);
      setSent(true);
    } catch (error) {
      captchaRef.current?.reset();
      setMessage(error instanceof Error ? error.message : "Não foi possível concluir.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 sm:p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="flex justify-center">
          <Logo size="lg" className="text-primary" />
        </div>

        <Card>
          <CardHeader className="space-y-2">
            <CardTitle className="text-xl">Esqueci minha senha</CardTitle>
            <CardDescription>
              {sent
                ? "Pedido recebido."
                : "Informe o e-mail da sua conta. Se ele estiver cadastrado, enviaremos um link para criar uma nova senha."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {sent ? (
              <div className="space-y-4" role="status">
                <p className="text-sm">
                  Se este e-mail tiver uma conta, você receberá um link em instantes. Ele vale por 30 minutos e só pode
                  ser usado uma vez. Confira também a caixa de spam.
                </p>
                <Button asChild className="w-full">
                  <Link to="/auth">Voltar para o login</Link>
                </Button>
              </div>
            ) : (
              <form onSubmit={submit} noValidate className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">E-mail</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    autoComplete="email"
                    inputMode="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>

                <Recaptcha ref={captchaRef} onChange={setCaptcha} />

                {message && (
                  <p role="alert" className="text-sm text-destructive">
                    {message}
                  </p>
                )}

                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? "Aguarde..." : "Enviar link"}
                </Button>
                <p className="text-center text-sm">
                  <Link to="/auth" className="text-primary underline-offset-4 hover:underline">
                    Voltar para o login
                  </Link>
                </p>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
