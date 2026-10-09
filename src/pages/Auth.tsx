import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Building2, Eye, EyeOff, User } from "lucide-react";
import { auth } from "@/lib/api";
import { safeNext } from "@/lib/safe-redirect";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/ui/logo";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Mode = "signin" | "signup";
type Tipo = "pf" | "pj";

/** Regra real do servidor (registration/credentials em server/src/routes/auth.js). */
const MIN_PASSWORD = 10;

const JOURNEY = ["Acesso", "Dados", "Documentos", "Análise", "Conta ativa"];

const TIPOS: { value: Tipo; title: string; hint: string; icon: typeof User }[] = [
  { value: "pf", title: "Pessoa física", hint: "Conta em seu nome, com CPF", icon: User },
  { value: "pj", title: "Pessoa jurídica", hint: "Conta da empresa, com CNPJ", icon: Building2 },
];

export default function Auth() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const next = safeNext(params.get("next"));

  const [mode, setMode] = useState<Mode>("signin");
  const [tipo, setTipo] = useState<Tipo | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void auth.restore().then((user) => {
      if (user && !cancelled) {
        queryClient.clear();
        navigate(next, { replace: true });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [next, navigate, queryClient]);

  function changeMode(value: string) {
    setMode(value as Mode);
    setMessage(null);
  }

  function validate(): string | null {
    if (!email.trim()) return "Informe seu e-mail.";
    if (mode === "signup") {
      if (!tipo) return "Escolha se a conta é de pessoa física ou jurídica.";
      if (fullName.trim().length < 2) {
        return tipo === "pj" ? "Informe o nome do responsável legal." : "Informe seu nome completo.";
      }
    }
    if (password.length < MIN_PASSWORD) {
      return mode === "signup"
        ? `A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`
        : "Informe sua senha.";
    }
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const problem = validate();
    if (problem) {
      setMessage(problem);
      return;
    }
    setBusy(true);
    setMessage(null);

    try {
      if (mode === "signin") {
        await auth.login(email, password);
        // O logout continua recarregando a página (use-auth). Aqui, sem recarga, descartamos o
        // cache de dados para que nada de uma sessão anterior apareça para esta conta.
        queryClient.clear();
        navigate(next, { replace: true });
      } else {
        await auth.register(email, password, fullName.trim());
        queryClient.clear();
        // Cadastro novo nunca tem KYC ainda: vai direto para a abertura de conta,
        // já com o tipo escolhido.
        navigate(`/onboarding?tipo=${tipo}`, { replace: true });
      }
    } catch (error) {
      setBusy(false);
      setMessage(error instanceof Error ? error.message : "Não foi possível concluir.");
    }
  }

  const isSignup = mode === "signup";

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 sm:p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="flex justify-center">
          <Logo size="lg" className="text-primary" />
        </div>

        <Card>
          <Tabs value={mode} onValueChange={changeMode}>
            <CardHeader className="space-y-4">
              <TabsList className="grid w-full grid-cols-2" aria-label="Acesso à conta">
                <TabsTrigger value="signin">Entrar</TabsTrigger>
                <TabsTrigger value="signup">Criar conta</TabsTrigger>
              </TabsList>
              <CardDescription>
                {isSignup
                  ? "Crie seu acesso. Depois você preenche seus dados e envia documentos para o banco parceiro verificar sua identidade."
                  : "Acesse sua conta para continuar."}
              </CardDescription>
            </CardHeader>

            <CardContent>
              <TabsContent value={mode} className="mt-0 space-y-5">
                {isSignup && (
                  <ol aria-label="Etapas para abrir a conta" className="flex flex-wrap gap-x-2 gap-y-1 text-xs">
                    {JOURNEY.map((label, i) => (
                      <li
                        key={label}
                        aria-current={i === 0 ? "step" : undefined}
                        className={cn("flex items-center gap-1", i === 0 ? "font-semibold text-foreground" : "text-muted-foreground")}
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            "flex h-4 w-4 items-center justify-center rounded-full border text-[10px]",
                            i === 0 && "bg-primary text-primary-foreground border-primary",
                          )}
                        >
                          {i + 1}
                        </span>
                        {label}
                        {i < JOURNEY.length - 1 && (
                          <span aria-hidden="true" className="text-muted-foreground">
                            ·
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
                )}

                <form onSubmit={submit} noValidate className="space-y-4">
                  {isSignup && (
                    <>
                      <fieldset className="space-y-2">
                        <legend className="text-sm font-medium mb-2">Tipo de conta</legend>
                        <RadioGroup
                          value={tipo ?? ""}
                          onValueChange={(v) => setTipo(v as Tipo)}
                          className="grid grid-cols-1 sm:grid-cols-2 gap-3"
                          aria-label="Tipo de conta"
                        >
                          {TIPOS.map((t) => (
                            <Label
                              key={t.value}
                              htmlFor={`tipo-${t.value}`}
                              className={cn(
                                "flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal",
                                tipo === t.value && "border-primary bg-primary/5 ring-1 ring-primary",
                              )}
                            >
                              <RadioGroupItem id={`tipo-${t.value}`} value={t.value} className="mt-1" />
                              <span className="space-y-0.5">
                                <span className="flex items-center gap-1.5 text-sm font-medium">
                                  <t.icon className="h-4 w-4" aria-hidden="true" />
                                  {t.title}
                                </span>
                                <span className="block text-xs text-muted-foreground">{t.hint}</span>
                              </span>
                            </Label>
                          ))}
                        </RadioGroup>
                      </fieldset>

                      <div className="space-y-2">
                        <Label htmlFor="nome">{tipo === "pj" ? "Nome do responsável legal" : "Nome completo"}</Label>
                        <Input
                          id="nome"
                          required
                          minLength={2}
                          maxLength={120}
                          autoComplete="name"
                          value={fullName}
                          onChange={(e) => setFullName(e.target.value)}
                          aria-describedby={tipo === "pj" ? "nome-hint" : undefined}
                        />
                        {tipo === "pj" && (
                          <p id="nome-hint" className="text-xs text-muted-foreground">
                            Pessoa que responde pela empresa. A razão social e o CNPJ vêm no passo seguinte.
                          </p>
                        )}
                      </div>
                    </>
                  )}

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

                  <div className="space-y-2">
                    <Label htmlFor="password">Senha</Label>
                    <div className="relative">
                      <Input
                        id="password"
                        type={showPassword ? "text" : "password"}
                        required
                        minLength={isSignup ? MIN_PASSWORD : undefined}
                        autoComplete={isSignup ? "new-password" : "current-password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="pr-11"
                        aria-describedby={isSignup ? "password-hint" : undefined}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-0 top-0 h-full w-11"
                        onClick={() => setShowPassword((s) => !s)}
                        aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                        aria-pressed={showPassword}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                    {isSignup && (
                      <p id="password-hint" className="text-xs text-muted-foreground">
                        Mínimo de {MIN_PASSWORD} caracteres.
                      </p>
                    )}
                  </div>

                  {message && (
                    <p role="alert" className="text-sm text-destructive">
                      {message}
                    </p>
                  )}

                  <Button type="submit" className="w-full" disabled={busy}>
                    {busy ? "Aguarde..." : isSignup ? "Criar conta" : "Entrar"}
                  </Button>
                </form>
              </TabsContent>
            </CardContent>
          </Tabs>
        </Card>
      </div>
    </div>
  );
}
