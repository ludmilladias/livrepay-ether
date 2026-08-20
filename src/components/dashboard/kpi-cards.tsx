import { TrendingUp, TrendingDown, DollarSign, Calendar, Shield, AlertTriangle } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

const kpis = [
  {
    title: "Saldo Total",
    value: "R$ 4.184.204,35",
    change: "+12.5%",
    changeType: "positive" as const,
    icon: DollarSign,
    description: "vs. mês anterior"
  },
  {
    title: "Caixa D0",
    value: "R$ 847.291,75",
    change: "+8.2%",
    changeType: "positive" as const,
    icon: TrendingUp,
    description: "disponível hoje"
  },
  {
    title: "Caixa D+30",
    value: "R$ 2.156.842,60",
    change: "-2.1%",
    changeType: "negative" as const,
    icon: Calendar,
    description: "próximos 30 dias"
  },
  {
    title: "Limite Disponível",
    value: "R$ 500.000,00",
    change: "75%",
    changeType: "neutral" as const,
    icon: Shield,
    description: "do limite total"
  },
  {
    title: "Risco/Fraude",
    value: "0.02%",
    change: "-0.01%",
    changeType: "positive" as const,
    icon: AlertTriangle,
    description: "taxa de fraude"
  }
]

export function KPICards() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
      {kpis.map((kpi, index) => (
        <Card key={index} className="hover:shadow-lg transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {kpi.title}
            </CardTitle>
            <kpi.icon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{kpi.value}</div>
            <div className="flex items-center gap-2 mt-2">
              <Badge 
                variant={
                  kpi.changeType === "positive" ? "default" : 
                  kpi.changeType === "negative" ? "destructive" : 
                  "secondary"
                }
                className="text-xs"
              >
                {kpi.changeType === "positive" && <TrendingUp className="h-3 w-3 mr-1" />}
                {kpi.changeType === "negative" && <TrendingDown className="h-3 w-3 mr-1" />}
                {kpi.change}
              </Badge>
              <p className="text-xs text-muted-foreground">
                {kpi.description}
              </p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}