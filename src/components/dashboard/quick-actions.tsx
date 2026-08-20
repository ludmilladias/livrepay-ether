import {
  Link,
  FileBarChart,
  Zap,
  PiggyBank,
  Send,
  Shield,
} from "lucide-react"
import { useNavigate } from "react-router-dom"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

const quickActions = [
  {
    title: "Criar Link",
    description: "Link de pagamento personalizado",
    icon: Link,
    color: "bg-gradient-primary",
    to: "/cobranca/links",
  },
  {
    title: "Emitir Boleto",
    description: "Boleto bancário tradicional",
    icon: FileBarChart,
    color: "bg-primary",
    to: "/cobranca/boletos",
  },
  {
    title: "Cobrança PIX",
    description: "PIX instantâneo ou agendado",
    icon: Zap,
    color: "bg-secondary",
    to: "/cobranca/pix",
  },
  {
    title: "Simular Adiantamento",
    description: "Antecipação de recebíveis",
    icon: PiggyBank,
    color: "bg-gradient-light",
    to: "/recebiveis/simulador",
  },
  {
    title: "Nova Transferência",
    description: "PIX, TED ou agendamento",
    icon: Send,
    color: "bg-gradient-dark",
    to: "/pagamentos/transferencias",
  },
  {
    title: "Cotar Seguro",
    description: "Proteção para seu negócio",
    icon: Shield,
    color: "bg-warning",
    to: "/seguros/cotacoes",
  },
]

export function QuickActions() {
  const navigate = useNavigate()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-semibold">Ações Rápidas</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {quickActions.map((action, index) => (
            <Button
              key={index}
              variant="outline"
              className="h-auto p-4 hover:shadow-md transition-all duration-200 hover:scale-105"
              onClick={() => navigate(action.to)}
            >
              <div className="flex flex-col items-center text-center gap-3 w-full">
                <div className={`${action.color} p-3 rounded-lg text-white`}>
                  <action.icon className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-medium text-sm">{action.title}</h3>
                  <p className="text-xs text-muted-foreground mt-1">{action.description}</p>
                </div>
              </div>
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}