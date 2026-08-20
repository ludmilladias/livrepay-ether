import { FileText } from "lucide-react"
import { ChargesView } from "@/components/cobranca/charges-view"
import { chargePayload } from "@/hooks/use-charges"

const Boletos = () => (
  <ChargesView
    kind="boleto"
    icon={FileText}
    title="Boletos"
    subtitle="Emita e acompanhe boletos bancários registrados"
    createLabel="Novo Boleto"
    createTitle="Novo Boleto"
    emptyMessage="Nenhum boleto emitido ainda. Crie o primeiro usando o botão acima."
    showCustomer
    extraFields={[
      {
        key: "instrucoes",
        label: "Instruções ao sacado",
        type: "text",
        placeholder: "Ex: Não receber após o vencimento",
      },
    ]}
    extraColumns={[
      {
        header: "Linha digitável",
        render: (charge) => {
          const line = chargePayload(charge).linha_digitavel
          return (
            <span className="font-mono text-xs">
              {typeof line === "string" ? line : "—"}
            </span>
          )
        },
      },
    ]}
  />
)

export default Boletos
