import { FileText } from "lucide-react"
import { ChargesView } from "@/components/cobranca/charges-view"
import { chargePayload } from "@/hooks/use-charges"

const Boletos = () => (
  <ChargesView
    kind="boleto"
    icon={FileText}
    title="Boletos"
    subtitle="Registro local de boletos a cobrar — a Ether paga boletos, mas não emite linha digitável para cobrar terceiros"
    createLabel="Novo Registro"
    createTitle="Novo Registro de Boleto"
    emptyMessage="Nenhum boleto registrado ainda. Crie o primeiro usando o botão acima."
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
          return typeof line === "string" ? (
            <span className="font-mono text-xs">{line}</span>
          ) : (
            <span className="text-xs text-muted-foreground" title="Sem provedor de emissão de boleto integrado">
              não gerada
            </span>
          )
        },
      },
    ]}
  />
)

export default Boletos
