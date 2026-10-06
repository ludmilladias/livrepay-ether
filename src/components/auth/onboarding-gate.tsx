import { Link, Navigate } from "react-router-dom";
import type { ReactNode } from "react";
import { AlertTriangle, Clock, FileWarning } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useKycJourney, type KycStage } from "@/hooks/use-onboarding";
import { useProfile } from "@/hooks/use-profile";

/**
 * Etapas em que o cliente ainda precisa agir para abrir a conta: a ele só
 * interessa a jornada de abertura, então é mandado para ela.
 */
const INCOMPLETE: KycStage[] = ["not_started", "awaiting_documents"];

/**
 * Leva quem logou com cadastro incompleto para onde parou. É roteamento de UX,
 * não segurança: o que de fato impede dinheiro sem conta aprovada é o backend/
 * Postgres. Por isso falha ABERTA: se o status não puder ser consultado, não
 * tranca ninguém fora do painel (o banner e o menu continuam apontando o caminho).
 *
 * Contas de equipe (admin/compliance) não passam por KYC de cliente.
 */
export function OnboardingGate({ children }: { children: ReactNode }) {
  const { data: profile, isLoading: profileLoading } = useProfile();
  const { stage, isLoading: statusLoading } = useKycJourney();

  if (profileLoading || statusLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background" role="status" aria-label="Carregando">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const isStaff = !!profile?.roles?.some((r) => r === "admin" || r === "compliance");
  if (!isStaff && stage && INCOMPLETE.includes(stage)) {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}

/** Faixa no topo do painel enquanto a conta não está aprovada. */
export function OnboardingBanner() {
  const { stage, checklist } = useKycJourney();
  const { data: profile } = useProfile();

  const isStaff = !!profile?.roles?.some((r) => r === "admin" || r === "compliance");
  if (isStaff || !stage || stage === "approved") return null;

  const pendingCount = (checklist?.pending.length ?? 0) + (checklist?.rejected.length ?? 0);

  const content: Record<Exclude<KycStage, "approved">, { icon: ReactNode; title: string; text: string; cta: string; destructive?: boolean }> = {
    not_started: {
      icon: <FileWarning className="h-4 w-4" />,
      title: "Complete seu cadastro",
      text: "Sua conta ainda não foi aberta. Preencha o cadastro para continuar.",
      cta: "Completar cadastro",
    },
    awaiting_documents: {
      icon: <FileWarning className="h-4 w-4" />,
      title: "Documentos pendentes",
      text: pendingCount > 0
        ? `Faltam ${pendingCount} documento(s) para a análise da sua conta.`
        : "Envie os documentos pedidos para a análise da sua conta.",
      cta: "Enviar documentos",
    },
    in_analysis: {
      icon: <Clock className="h-4 w-4" />,
      title: "Conta em análise",
      text: pendingCount > 0
        ? `Seu cadastro está em análise, mas ${pendingCount} documento(s) precisam ser (re)enviados.`
        : "Seu cadastro está em análise pelo banco parceiro. PIX e pagamentos serão liberados após a aprovação.",
      cta: "Ver situação",
    },
    rejected: {
      icon: <AlertTriangle className="h-4 w-4" />,
      title: "Cadastro recusado",
      text: "O banco parceiro não aprovou este cadastro. Fale com o suporte para os próximos passos.",
      cta: "Ver detalhes",
      destructive: true,
    },
    pending_unknown: {
      icon: <Clock className="h-4 w-4" />,
      title: "Conta ainda não aprovada",
      text: "Sua conta está em processo de abertura. PIX e pagamentos serão liberados após a aprovação.",
      cta: "Ver situação",
    },
  };

  const c = content[stage];
  return (
    <Alert variant={c.destructive ? "destructive" : "default"} className="mb-6">
      {c.icon}
      <AlertTitle>{c.title}</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span>{c.text}</span>
        <Button asChild size="sm" variant="outline">
          <Link to="/onboarding">{c.cta}</Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}
