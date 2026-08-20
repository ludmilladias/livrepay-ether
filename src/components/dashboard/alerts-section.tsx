import { AlertTriangle, Info, CheckCircle, Clock } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

const alerts = [
  {
    id: 1,
    type: "urgent",
    title: "Tentativa de fraude bloqueada",
    description: "PIX de R$ 15.000 foi bloqueado automaticamente por suspeita de fraude",
    time: "2 min atrás",
    action: "Revisar"
  },
  {
    id: 2,
    type: "warning",
    title: "KYC pendente",
    description: "3 clientes aguardam verificação de documentos",
    time: "15 min atrás",
    action: "Verificar"
  },
  {
    id: 3,
    type: "info",
    title: "Boletos vencendo hoje",
    description: "12 boletos vencem nas próximas 2 horas",
    time: "1 hora atrás",
    action: "Visualizar"
  },
  {
    id: 4,
    type: "success",
    title: "Liquidação concluída",
    description: "R$ 45.280,00 liquidados automaticamente",
    time: "2 horas atrás",
    action: "Detalhes"
  }
]

const nextActions = [
  {
    title: "Aprovar folha de pagamento",
    description: "Lote de 150 funcionários - R$ 284.750,00",
    deadline: "Hoje, 17:00",
    priority: "high"
  },
  {
    title: "Renovar apólice de seguro",
    description: "Seguro empresarial vence em 5 dias",
    deadline: "23 Jan",
    priority: "medium"
  },
  {
    title: "Revisar limites de PIX",
    description: "Ajuste semanal de limites por cliente",
    deadline: "Amanhã",
    priority: "low"
  }
]

export function AlertsSection() {
  const getAlertIcon = (type: string) => {
    switch (type) {
      case "urgent":
        return <AlertTriangle className="h-4 w-4 text-destructive" />
      case "warning":
        return <Clock className="h-4 w-4 text-warning" />
      case "info":
        return <Info className="h-4 w-4 text-primary" />
      case "success":
        return <CheckCircle className="h-4 w-4 text-success" />
      default:
        return <Info className="h-4 w-4" />
    }
  }

  const getAlertBorderColor = (type: string) => {
    switch (type) {
      case "urgent":
        return "border-l-destructive"
      case "warning":
        return "border-l-warning"
      case "info":
        return "border-l-primary"
      case "success":
        return "border-l-success"
      default:
        return "border-l-border"
    }
  }

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "high":
        return "destructive"
      case "medium":
        return "secondary"
      case "low":
        return "outline"
      default:
        return "outline"
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      {/* Alertas */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold">Alertas</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {alerts.map((alert) => (
              <div 
                key={alert.id} 
                className={`p-4 border-l-4 bg-muted/20 rounded-r-lg ${getAlertBorderColor(alert.type)}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    {getAlertIcon(alert.type)}
                    <div className="flex-1">
                      <h4 className="text-sm font-medium">{alert.title}</h4>
                      <p className="text-sm text-muted-foreground mt-1">{alert.description}</p>
                      <span className="text-xs text-muted-foreground">{alert.time}</span>
                    </div>
                  </div>
                  <Button size="sm" variant="outline" className="text-xs">
                    {alert.action}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Próximas Ações */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold">Próximas Ações</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {nextActions.map((action, index) => (
              <div key={index} className="p-4 border rounded-lg hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h4 className="text-sm font-medium">{action.title}</h4>
                      <Badge variant={getPriorityColor(action.priority)} className="text-xs">
                        {action.priority === "high" ? "Urgente" : 
                         action.priority === "medium" ? "Médio" : "Baixo"}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{action.description}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <Clock className="h-3 w-3 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">{action.deadline}</span>
                    </div>
                  </div>
                  <Button size="sm" variant="outline">
                    Executar
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}