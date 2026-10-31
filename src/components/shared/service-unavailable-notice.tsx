import { AlertTriangle } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

/**
 * Aviso de que emitir cobrança e enviar pagamento dependem de a conta estar
 * habilitada no banco parceiro. O backend (POST /charges/:id/emit e
 * POST /payments/:id/execute) responde 403 ACCOUNT_NOT_ENABLED para quem ainda
 * não tem acesso — hoje só o operador da conta da LivrePay. Remover quando os
 * clientes receberem a credencial própria por integração com a Ether.
 */
const COPY = {
  charges: {
    title: "Emissão de cobrança só para contas habilitadas",
    text: "A emissão de cobranças no banco parceiro está sendo liberada aos poucos. Se a sua conta ainda não estiver habilitada, você pode registrar cobranças, mas elas não serão emitidas.",
  },
  payments: {
    title: "Envio de pagamentos só para contas habilitadas",
    text: "A execução de pagamentos está sendo liberada aos poucos. Se a sua conta ainda não estiver habilitada, você pode cadastrar pagamentos, mas nenhum valor será enviado.",
  },
  both: {
    title: "Cobranças e pagamentos só para contas habilitadas",
    text: "Esses recursos estão sendo liberados aos poucos, conforme cada conta é habilitada no banco parceiro.",
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
