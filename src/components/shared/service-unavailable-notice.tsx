import { AlertTriangle } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

/**
 * Aviso de funcionalidade desligada no momento. O backend responde 503 nas duas
 * rotas (POST /charges/:id/emit em server/src/routes/charges.js e
 * POST /payments/:id/execute em payments.js): "aguardando integração de conta
 * individual com o provedor". A navegação continua visível; só avisamos antes
 * de a pessoa tentar. Quando o backend religar, remover este componente.
 */
const COPY = {
  charges: {
    title: "Emissão de cobrança indisponível no momento",
    text: "A emissão de cobranças no banco parceiro está temporariamente desligada. Você pode registrar cobranças, mas elas não serão emitidas até a liberação.",
  },
  payments: {
    title: "Envio de pagamentos indisponível no momento",
    text: "A execução de pagamentos está temporariamente desligada, aguardando a integração da sua conta com o banco parceiro. Você pode cadastrar pagamentos, mas nenhum valor será enviado até a liberação.",
  },
  both: {
    title: "Emissão de cobrança e envio de pagamentos indisponíveis no momento",
    text: "Esses recursos estão temporariamente desligados, aguardando a integração da sua conta com o banco parceiro. A navegação segue disponível.",
  },
} as const

export function ServiceUnavailableNotice({ scope }: { scope: keyof typeof COPY }) {
  const copy = COPY[scope]
  return (
    <Alert role="status" className="border-warning/50 bg-warning/10">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>{copy.title}</AlertTitle>
      <AlertDescription>{copy.text}</AlertDescription>
    </Alert>
  )
}
