import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useOnboardingStatus, type PersonType } from "@/hooks/use-onboarding";
import { KycDocuments } from "@/components/onboarding/kyc-documents";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { useAuth } from "@/hooks/use-auth";

/** `?tipo=pf|pj` (vindo da tela de criar conta) pré-seleciona o tipo de pessoa. */
function parseTipo(raw: string | null): PersonType | null {
  if (raw === "pf") return "FISICA";
  if (raw === "pj") return "JURIDICA";
  return null;
}

/**
 * Cadastro de KYC conforme os guias oficiais da Ether ("Abertura de Conta
 * PF/PJ" + "Tipos de contas e dados usados na criação de contas", obtidos
 * 2026-10-02). Os nomes dos campos enviados são os mesmos que o backend espera
 * em `onboardingSchema` (server/src/routes/auth.js) — ver `buildPayload` em
 * components/onboarding/onboarding-schema.ts.
 */
export default function Onboarding() {
  const { signOut } = useAuth();
  const [params] = useSearchParams();
  const { data: status, isLoading: statusLoading, isError: statusError, refetch } = useOnboardingStatus();

  if (statusLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background" role="status" aria-label="Carregando">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  // Sem status confiável não mostramos o formulário: poderia ser alguém que já se cadastrou.
  if (statusError || !status) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4 sm:p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Não foi possível carregar seu cadastro</CardTitle>
            <CardDescription>Verifique sua conexão e tente de novo.</CardDescription>
          </CardHeader>
          <CardContent className="flex gap-3">
            <Button onClick={() => void refetch()}>Tentar novamente</Button>
            <Button variant="ghost" onClick={() => void signOut()}>Sair</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Cadastro já enviado (inclusive logo após o submit): documentos e situação da conta.
  if (status.status !== "not_started") return <KycDocuments />;

  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 flex items-start sm:items-center justify-center">
      <OnboardingWizard initialType={parseTipo(params.get("tipo"))} />
    </div>
  );
}
