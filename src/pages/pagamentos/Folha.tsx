import { Users } from "lucide-react"
import { PaymentsView } from "@/components/pagamentos/payments-view"

const Folha = () => (
  <PaymentsView
    kind="folha"
    icon={Users}
    title="Folha de Pagamento"
    subtitle="Pagamentos a colaboradores — lotes são processados por inteiro ou não são processados"
    createLabel="Novo Pagamento"
    recipientLabel="Colaborador"
    keyLabel="Chave PIX"
    keyPlaceholder="CPF ou chave PIX do colaborador"
    emptyMessage="Nenhum pagamento de folha ainda. Cadastre o primeiro usando o botão acima."
  />
)

export default Folha
