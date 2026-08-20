import { 
  Link, 
  FileBarChart, 
  Zap, 
  PiggyBank, 
  Send, 
  Shield,
  Plus,
  ArrowRight 
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

const quickActions = [
  {
    title: "Criar Link",
    description: "Link de pagamento personalizado",
    icon: Link,
    color: "bg-gradient-primary",
    action: () => console.log("Criar link")
  },
  {
    title: "Emitir Boleto",
    description: "Boleto bancário tradicional",
    icon: FileBarChart,
    color: "bg-primary",
    action: () => console.log("Emitir boleto")
  },
  {
    title: "Cobrança PIX",
    description: "PIX instantâneo ou agendado",
    icon: Zap,
    color: "bg-secondary",
    action: () => console.log("Cobrança PIX")
  },
  {
    title: "Simular Adiantamento",
    description: "Antecipação de recebíveis",
    icon: PiggyBank,
    color: "bg-gradient-light",
    action: () => console.log("Simular adiantamento")
  },
  {
    title: "Nova Transferência",
    description: "PIX, TED ou agendamento",
    icon: Send,
    color: "bg-gradient-dark",
    action: () => console.log("Nova transferência")
  },
  {
    title: "Cotar Seguro",
    description: "Proteção para seu negócio",
    icon: Shield,
    color: "bg-warning",
    action: () => console.log("Cotar seguro")
  }
]

export function QuickActions() {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg font-semibold">Ações Rápidas</CardTitle>
        <Button variant="ghost" size="sm" className="text-primary hover:text-primary-dark">
          Ver todas
          <ArrowRight className="h-4 w-4 ml-1" />
        </Button>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {quickActions.map((action, index) => (
            <Button
              key={index}
              variant="outline"
              className="h-auto p-4 hover:shadow-md transition-all duration-200 hover:scale-105"
              onClick={action.action}
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