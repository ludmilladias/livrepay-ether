import { FlaskConical } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

/**
 * Cartões e Seguros ainda não têm integração real (sem tabela/rota própria
 * para cartão físico/virtual, sem provedor de seguro — ver PENDING.md e
 * LivrePay-Product-Context.md). Os dados aqui são fixos e os botões não têm
 * efeito. Sem este aviso, a tela passa a falsa impressão de que uma ação
 * (bloquear cartão, contratar seguro) foi de fato executada.
 */
export function PreviewBanner() {
  return (
    <Alert className="border-warning/50 bg-warning/10">
      <FlaskConical className="h-4 w-4" />
      <AlertTitle>Prévia — sem integração real</AlertTitle>
      <AlertDescription>
        Esta tela mostra dados de demonstração. Nenhuma ação aqui move dinheiro, cria cartão ou
        contrata cobertura de verdade.
      </AlertDescription>
    </Alert>
  )
}
