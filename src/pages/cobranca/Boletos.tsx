import { FileText } from "lucide-react"
import { ChargesView } from "@/components/cobranca/charges-view"
import { chargePayload } from "@/hooks/use-charges"

const Boletos = () => (
  <ChargesView
    kind="boleto"
    icon={FileText}
    title="BoléPIX"
    subtitle="Cobrança com vencimento e dados do cliente — pagamento via PIX QR Code (sem linha digitável)"
    createLabel="Novo BoléPIX"
    createTitle="Nova Cobrança BoléPIX"
    emptyMessage="Nenhum BoléPIX emitido ainda. Crie o primeiro usando o botão acima."
    showCustomer
    canEmit
    extraFields={[
      {
        key: "instrucoes",
        label: "Instruções ao pagador",
        type: "text",
        placeholder: "Ex: Não receber após o vencimento",
      },
    ]}
    extraColumns={[
      {
        header: "PIX",
        render: (charge) => {
          const code = chargePayload(charge).pix_copy_paste
          return typeof code === "string" ? (
            <span className="font-mono text-xs truncate max-w-[120px] inline-block" title={code}>
              {code.slice(0, 20)}…
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">emita para gerar</span>
          )
        },
      },
    ]}
  />
)

export default Boletos
