import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Link } from "react-router-dom"
import { ShieldCheck, AlertTriangle, Users, Building2 } from "lucide-react"
import { useAdminOverview, useAdminTenants } from "@/hooks/use-admin"
import { VolumeChart } from "@/components/admin/volume-chart"
import { formatCents } from "@/lib/money"

const Overview = () => {
  const { data, isLoading, isError } = useAdminOverview()
  const tenants = useAdminTenants()
  const agencies = tenants.data ?? []
  const suspended = agencies.filter((t) => t.status === "suspended").length

  return (
    <div className="space-y-8 max-w-7xl">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Administração</h1>
        <p className="text-muted-foreground mt-2">
          Visão geral das pendências que dependem de admin/compliance
        </p>
      </div>

      {isError && (
        <p className="text-sm text-destructive">Não foi possível carregar a visão geral.</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Recebíveis pendentes de verificação
            </CardTitle>
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">{data?.pending_receivables ?? 0}</div>
            )}
            <p className="text-xs text-muted-foreground mt-2">
              Nenhum é antecipado sem verify_receivable()
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Eventos do provedor com erro
            </CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">{data?.provider_events_with_error ?? 0}</div>
            )}
            <p className="text-xs text-muted-foreground mt-2">reconciliação manual pendente</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Usuários
            </CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">{data?.total_users ?? 0}</div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4" /> Agências
            {suspended > 0 && <Badge variant="destructive">{suspended} suspensa(s)</Badge>}
          </CardTitle>
          <Link to="/admin/agencias" className="text-sm text-primary hover:underline">
            Limites, suspensão e conciliação
          </Link>
        </CardHeader>
        <CardContent>
          {tenants.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : tenants.isError ? (
            <p className="text-sm text-destructive">Não foi possível carregar as agências.</p>
          ) : (
            <div className="divide-y">
              {agencies.map((t) => (
                <div key={t.slug} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{t.name}</span>
                    <Badge variant={t.status === "suspended" ? "destructive" : "secondary"}>
                      {t.status === "suspended" ? "Suspensa" : "Ativa"}
                    </Badge>
                    <span className="text-muted-foreground">{t.customers} cliente(s)</span>
                  </div>
                  <div className="flex flex-wrap gap-4 text-muted-foreground">
                    <span>Saldo {formatCents(t.balance_cents)}</span>
                    <span>
                      Exposição {formatCents(t.advanced_exposure_cents)}
                      {t.max_exposure_cents !== null && ` de ${formatCents(t.max_exposure_cents)}`}
                    </span>
                    <span>{t.pending_receivables} aguardando verificação</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <VolumeChart />
    </div>
  )
}

export default Overview
