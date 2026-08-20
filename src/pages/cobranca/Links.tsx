import { Link2 } from "lucide-react"
import { ChargesView } from "@/components/cobranca/charges-view"
import { chargePayload } from "@/hooks/use-charges"

const Links = () => (
  <ChargesView
    kind="link"
    icon={Link2}
    title="Links de Pagamento"
    subtitle="Gere links compartilháveis para receber de qualquer canal"
    createLabel="Novo Link"
    createTitle="Novo Link de Pagamento"
    emptyMessage="Nenhum link criado ainda. Crie o primeiro usando o botão acima."
    extraFields={[
      {
        key: "canal",
        label: "Canal de divulgação",
        type: "select",
        defaultValue: "whatsapp",
        options: [
          { value: "whatsapp", label: "WhatsApp" },
          { value: "email", label: "E-mail" },
          { value: "redes", label: "Redes sociais" },
          { value: "outro", label: "Outro" },
        ],
      },
    ]}
    extraColumns={[
      {
        header: "Canal",
        render: (charge) => {
          const canal = chargePayload(charge).canal
          return typeof canal === "string" ? canal : "—"
        },
      },
    ]}
  />
)

export default Links
