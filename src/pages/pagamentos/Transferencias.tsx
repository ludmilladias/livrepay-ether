import { ArrowLeftRight } from "lucide-react"
import { PaymentsView } from "@/components/pagamentos/payments-view"

const Transferencias = () => (
  <PaymentsView
    kind="transferencia"
    icon={ArrowLeftRight}
    title="Transferências"
    subtitle="Envie PIX para qualquer chave, com confirmação antes do débito"
    createLabel="Nova Transferência"
    recipientLabel="Favorecido"
    keyLabel="Chave PIX"
    keyPlaceholder="CPF, CNPJ, e-mail, telefone ou chave aleatória"
    emptyMessage="Nenhuma transferência ainda. Crie a primeira usando o botão acima."
  />
)

export default Transferencias
