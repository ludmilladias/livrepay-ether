import { RefreshCw } from "lucide-react"
import { ChargesView } from "@/components/cobranca/charges-view"
import { chargePayload } from "@/hooks/use-charges"

const frequencyLabel: Record<string, string> = {
  mensal: "Mensal",
  trimestral: "Trimestral",
  semestral: "Semestral",
  anual: "Anual",
}

const Assinaturas = () => (
  <ChargesView
    kind="assinatura"
    icon={RefreshCw}
    title="Assinaturas"
    subtitle="Cobranças recorrentes com renovação automática"
    createLabel="Nova Assinatura"
    createTitle="Nova Assinatura"
    emptyMessage="Nenhuma assinatura ativa. Crie a primeira usando o botão acima."
    showCustomer
    extraFields={[
      {
        key: "frequencia",
        label: "Periodicidade",
        type: "select",
        defaultValue: "mensal",
        options: [
          { value: "mensal", label: "Mensal" },
          { value: "trimestral", label: "Trimestral" },
          { value: "semestral", label: "Semestral" },
          { value: "anual", label: "Anual" },
        ],
      },
    ]}
    extraColumns={[
      {
        header: "Periodicidade",
        render: (charge) => {
          const freq = chargePayload(charge).frequencia
          return typeof freq === "string" ? (frequencyLabel[freq] ?? freq) : "—"
        },
      },
    ]}
  />
)

export default Assinaturas
