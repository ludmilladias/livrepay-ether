import { AlertTriangle, Info, CheckCircle, Clock } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useAlerts, useMarkAlertRead, type AlertType } from "@/hooks/use-alerts"

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return "agora"
  if (minutes < 60) return `${minutes} min atrás`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h atrás`
  return `${Math.floor(hours / 24)}d atrás`
}

function getAlertIcon(type: AlertType) {
  switch (type) {
    case "urgent":
      return <AlertTriangle className="h-4 w-4 text-destructive" />
    case "warning":
      return <Clock className="h-4 w-4 text-warning" />
    case "success":
      return <CheckCircle className="h-4 w-4 text-success" />
    default:
      return <Info className="h-4 w-4 text-primary" />
  }
}

function getAlertBorderColor(type: AlertType) {
  switch (type) {
    case "urgent":
      return "border-l-destructive"
    case "warning":
      return "border-l-warning"
    case "success":
      return "border-l-success"
    default:
      return "border-l-primary"
  }
}

/**
 * Alertas reais do backend (GET /alerts) — hoje gerados por eventos de
 * pagamento (ex.: "Pagamento não concluído... valor foi estornado") e de
 * cobrança recebida. Não existe "Próximas Ações" no backend (aprovação de
 * folha, renovação de seguro, revisão de limites) — mostrar isso aqui seria
 * inventar trabalho que ninguém pediu. Ver PENDING.md.
 */
export function AlertsSection() {
  const { data: alerts, isLoading, isError } = useAlerts()
  const markRead = useMarkAlertRead()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-semibold">Alertas</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && (
          <p className="text-sm text-muted-foreground">Carregando alertas…</p>
        )}
        {isError && (
          <p className="text-sm text-destructive">Não foi possível carregar os alertas.</p>
        )}
        {!isLoading && !isError && alerts?.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhum alerta no momento.</p>
        )}
        <div className="space-y-4">
          {alerts?.map((alert) => (
            <div
              key={alert.id}
              className={`p-4 border-l-4 rounded-r-lg ${getAlertBorderColor(alert.type)} ${
                alert.read ? "bg-muted/10 opacity-70" : "bg-muted/20"
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  {getAlertIcon(alert.type)}
                  <div className="flex-1">
                    <h4 className="text-sm font-medium">{alert.title}</h4>
                    <p className="text-sm text-muted-foreground mt-1">{alert.description}</p>
                    <span className="text-xs text-muted-foreground">
                      {relativeTime(alert.created_at)}
                    </span>
                  </div>
                </div>
                {!alert.read && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs"
                    disabled={markRead.isPending}
                    onClick={() => markRead.mutate(alert.id)}
                  >
                    Marcar como lido
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
