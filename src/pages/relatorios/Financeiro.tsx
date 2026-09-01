import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartConfig } from "@/components/ui/chart"
import { TrendingUp, TrendingDown, DollarSign, Wallet, BarChart3 } from "lucide-react"
import { FlowChart } from "@/components/dashboard/flow-chart"
import { useFinancials, type KindTotal } from "@/hooks/use-reports"
import { formatCents } from "@/lib/money"

const chargeKindLabel: Record<string, string> = {
  link: "Link de Pagamento",
  boleto: "Boleto (cobrança)",
  pix: "PIX Cobrança",
  assinatura: "Assinatura",
}

const paymentKindLabel: Record<string, string> = {
  transferencia: "Transferência",
  conta: "Contas e Tributos",
  folha: "Folha/Lotes",
}

function KindBarChart({
  title,
  data,
  labelMap,
  colorVar,
  emptyMessage,
}: {
  title: string
  data: KindTotal[] | undefined
  labelMap: Record<string, string>
  colorVar: "--chart-in" | "--chart-out"
  emptyMessage: string
}) {
  const rows = (data ?? []).map((d) => ({
    kind: labelMap[d.kind] ?? d.kind,
    total_cents: d.total_cents,
  }))
  const config: ChartConfig = { total_cents: { label: title, color: `hsl(var(${colorVar}))` } }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-medium">
          <BarChart3 className="h-5 w-5" />
          {title}
        </CardTitle>
        <CardDescription>Últimos 30 dias, por categoria</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-16 text-center">{emptyMessage}</p>
        ) : (
          <ChartContainer config={config} className="aspect-auto h-64 w-full">
            <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 24 }}>
              <CartesianGrid horizontal={false} stroke="hsl(var(--border))" />
              <XAxis type="number" hide />
              <YAxis
                dataKey="kind"
                type="category"
                tickLine={false}
                axisLine={false}
                width={140}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    hideLabel
                    formatter={(value) => [formatCents(Number(value)), title]}
                  />
                }
              />
              <Bar dataKey="total_cents" fill="var(--color-total_cents)" radius={4} barSize={20}>
                <LabelList
                  dataKey="total_cents"
                  position="right"
                  className="fill-foreground text-xs"
                  formatter={(value: number) => formatCents(value)}
                />
              </Bar>
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}

const Financeiro = () => {
  const { data, isLoading, isError } = useFinancials(12)
  const monthly = data?.monthly.map((m) => ({ day: m.month, in_cents: m.in_cents, out_cents: m.out_cents }))
  const margin = data && data.revenue_cents > 0 ? (data.net_cents / data.revenue_cents) * 100 : null

  return (
    <div className="space-y-8 max-w-7xl">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Relatórios Financeiros</h1>
        <p className="text-muted-foreground mt-2">
          Receita e despesa reais, a partir das cobranças pagas e pagamentos concluídos
        </p>
      </div>

      {isError && (
        <p className="text-sm text-destructive">Não foi possível carregar os relatórios financeiros.</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Receita (30 dias)</CardTitle>
            <DollarSign className="h-4 w-4" style={{ color: "hsl(var(--chart-in))" }} />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-2xl font-bold">{formatCents(data?.revenue_cents ?? 0)}</div>
            )}
            <p className="text-xs text-muted-foreground mt-2">cobranças pagas</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Despesas (30 dias)</CardTitle>
            <TrendingDown className="h-4 w-4" style={{ color: "hsl(var(--chart-out))" }} />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-2xl font-bold">{formatCents(data?.expense_cents ?? 0)}</div>
            )}
            <p className="text-xs text-muted-foreground mt-2">pagamentos concluídos</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Resultado (30 dias)</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-2xl font-bold">{formatCents(data?.net_cents ?? 0)}</div>
            )}
            <p className="text-xs text-muted-foreground mt-2">
              {margin === null ? "sem receita no período" : `margem: ${margin.toFixed(1)}%`}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Saldo Disponível</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-2xl font-bold">{formatCents(data?.balance_cents ?? 0)}</div>
            )}
            <p className="text-xs text-muted-foreground mt-2">saldo atual da conta</p>
          </CardContent>
        </Card>
      </div>

      <FlowChart
        title="Evolução Mensal — últimos 12 meses"
        gradientId="financeiro-mensal"
        data={monthly}
        isLoading={isLoading}
        isError={isError}
        errorMessage="Não foi possível carregar a evolução mensal."
        emptyMessage="Nenhuma movimentação nos últimos 12 meses."
        granularity="month"
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <KindBarChart
          title="Receita por categoria"
          data={data?.revenue_by_kind}
          labelMap={chargeKindLabel}
          colorVar="--chart-in"
          emptyMessage="Nenhuma cobrança paga nos últimos 30 dias."
        />
        <KindBarChart
          title="Despesa por categoria"
          data={data?.expense_by_kind}
          labelMap={paymentKindLabel}
          colorVar="--chart-out"
          emptyMessage="Nenhum pagamento concluído nos últimos 30 dias."
        />
      </div>
    </div>
  )
}

export default Financeiro
