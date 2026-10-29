import { Link } from "react-router-dom"
import { CheckCircle2, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useKycJourney, type KycStage } from "@/hooks/use-onboarding"

const STEPS = ["Cadastro", "Documentos", "Análise", "Conta ativa"] as const

/** Índice do passo atual por etapa. Passo `STEPS.length` = tudo concluído. */
const CURRENT: Record<KycStage, number> = {
  not_started: 0,
  awaiting_documents: 1,
  in_analysis: 2,
  pending_unknown: 2,
  rejected: 2,
  approved: STEPS.length,
}

const HINT: Record<KycStage, string> = {
  not_started: "Preencha o cadastro para começar a abertura da conta.",
  awaiting_documents: "Envie os documentos pedidos para seguir para a análise.",
  in_analysis: "Seu cadastro está com o banco parceiro. Acompanhamos sozinhos.",
  pending_unknown: "Não conseguimos confirmar a situação agora. Tentaremos de novo.",
  rejected: "O banco parceiro não aprovou este cadastro.",
  approved: "Conta aprovada. Pix e pagamentos liberados.",
}

export function AccountProgress() {
  const { stage } = useKycJourney()
  if (!stage) return null

  const current = CURRENT[stage]
  const rejected = stage === "rejected"
  const cta = stage === "not_started" ? { to: "/onboarding", label: "Preencher cadastro" }
    : stage === "approved" ? null
    : { to: "/documentos", label: "Ver documentos" }

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">Abertura da conta</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <ol className="space-y-4" aria-label="Etapas da abertura da conta">
          {STEPS.map((label, i) => {
            const done = i < current
            const active = i === current && !rejected
            return (
              <li key={label} className="flex items-center gap-3" aria-current={active ? "step" : undefined}>
                <span
                  className={
                    done
                      ? "flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white"
                      : active
                        ? "flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground ring-4 ring-primary/20"
                        : "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs text-muted-foreground"
                  }
                  aria-hidden="true"
                >
                  {done ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
                </span>
                <span className={done || active ? "text-sm font-medium" : "text-sm text-muted-foreground"}>
                  {label}
                </span>
              </li>
            )
          })}
        </ol>

        <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
          {rejected && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />}
          <span>{HINT[stage]}</span>
        </div>

        {cta && (
          <Button asChild variant="outline" className="w-full">
            <Link to={cta.to}>{cta.label}</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
