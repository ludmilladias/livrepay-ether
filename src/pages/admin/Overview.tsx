import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ShieldCheck, AlertTriangle, Users } from "lucide-react"
import { useAdminOverview } from "@/hooks/use-admin"
import { VolumeChart } from "@/components/admin/volume-chart"

const Overview = () => {
  const { data, isLoading, isError } = useAdminOverview()

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

      <VolumeChart />
    </div>
  )
}

export default Overview
