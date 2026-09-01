import { Area, AreaChart, CartesianGrid, XAxis } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartConfig,
} from "@/components/ui/chart"
import type { DailyFlow } from "@/hooks/use-reports"
import { formatCents } from "@/lib/money"

const chartConfig: ChartConfig = {
  in_cents: { label: "Entradas", color: "hsl(var(--chart-in))" },
  out_cents: { label: "Saídas", color: "hsl(var(--chart-out))" },
}

function formatDay(day: string): string {
  return new Date(`${day}T00:00:00`).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  })
}

function formatMonth(day: string): string {
  return new Date(`${day}T00:00:00`).toLocaleDateString("pt-BR", {
    month: "short",
    year: "2-digit",
  })
}

interface FlowChartProps {
  title: string
  gradientId: string
  data: DailyFlow[] | undefined
  isLoading: boolean
  isError: boolean
  errorMessage: string
  emptyMessage: string
  /** "day" (padrão) rotula DD/MM; "month" rotula mês/ano — use para séries mensais. */
  granularity?: "day" | "month"
}

export function FlowChart({
  title,
  gradientId,
  data,
  isLoading,
  isError,
  errorMessage,
  emptyMessage,
  granularity = "day",
}: FlowChartProps) {
  const formatTick = granularity === "month" ? formatMonth : formatDay
  const hasMovement = data?.some((d) => d.in_cents > 0 || d.out_cents > 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <Skeleton className="h-[250px] w-full" />}

        {isError && <p className="text-sm text-destructive">{errorMessage}</p>}

        {!isLoading && !isError && !hasMovement && (
          <p className="text-sm text-muted-foreground py-16 text-center">{emptyMessage}</p>
        )}

        {!isLoading && !isError && hasMovement && (
          <>
            <ChartContainer config={chartConfig} className="aspect-auto h-[250px] w-full">
              <AreaChart data={data} margin={{ left: 4, right: 4 }}>
                <defs>
                  <linearGradient id={`${gradientId}-in`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-in_cents)" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="var(--color-in_cents)" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id={`${gradientId}-out`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-out_cents)" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="var(--color-out_cents)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="day"
                  tickFormatter={formatTick}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={24}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(value) => formatTick(String(value))}
                      formatter={(value, name) => [
                        formatCents(Number(value)),
                        chartConfig[name as keyof typeof chartConfig]?.label ?? name,
                      ]}
                    />
                  }
                />
                <Area
                  dataKey="in_cents"
                  type="monotone"
                  stroke="var(--color-in_cents)"
                  fill={`url(#${gradientId}-in)`}
                  strokeWidth={2}
                />
                <Area
                  dataKey="out_cents"
                  type="monotone"
                  stroke="var(--color-out_cents)"
                  fill={`url(#${gradientId}-out)`}
                  strokeWidth={2}
                />
              </AreaChart>
            </ChartContainer>

            <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: "hsl(var(--chart-in))" }}
                />
                Entradas
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: "hsl(var(--chart-out))" }}
                />
                Saídas
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
