import { QrCode } from "lucide-react"
import { ChargesView } from "@/components/cobranca/charges-view"
import { chargePayload } from "@/hooks/use-charges"

const Pix = () => (
  <ChargesView
    kind="pix"
    icon={QrCode}
    title="PIX Cobrança"
    subtitle="Crie cobranças PIX instantâneas com QR Code ou Copia e Cola"
    createLabel="Nova Cobrança PIX"
    createTitle="Nova Cobrança PIX"
    emptyMessage="Nenhuma cobrança PIX ainda. Crie a primeira usando o botão acima."
    canEmit
    extraFields={[
      {
        key: "pix_type",
        label: "Tipo de PIX",
        type: "select",
        defaultValue: "qrcode",
        options: [
          { value: "qrcode", label: "QR Code" },
          { value: "copiacola", label: "PIX Copia e Cola" },
        ],
      },
    ]}
    extraColumns={[
      {
        header: "TXID",
        render: (charge) => (
          <span className="font-mono text-xs">{charge.txid ?? "—"}</span>
        ),
      },
      {
        header: "Expira em",
        render: (charge) => {
          const expire = chargePayload(charge).expire_at
          return expire ? new Date(expire).toLocaleString("pt-BR") : "—"
        },
      },
    ]}
  />
)

export default Pix
