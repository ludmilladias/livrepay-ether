import { Receipt } from "lucide-react"
import { PaymentsView } from "@/components/pagamentos/payments-view"

const Contas = () => (
  <PaymentsView
    kind="conta"
    icon={Receipt}
    method="boleto"
    title="Contas e Tributos"
    subtitle="Pague boletos, contas de consumo e guias de tributos pela linha digitável"
    createLabel="Novo Pagamento"
    recipientLabel="Beneficiário"
    keyLabel="Linha digitável"
    keyPlaceholder="47 ou 48 dígitos do boleto/guia"
    emptyMessage="Nenhum boleto cadastrado. Cadastre o primeiro usando o botão acima."
  />
)

export default Contas
