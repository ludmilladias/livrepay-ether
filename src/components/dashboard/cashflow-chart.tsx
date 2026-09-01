import { FlowChart } from "@/components/dashboard/flow-chart"
import { useCashflow } from "@/hooks/use-reports"

export function CashflowChart() {
  const { data, isLoading, isError } = useCashflow()

  return (
    <FlowChart
      title="Entradas x Saídas — últimos 30 dias"
      gradientId="cashflow"
      data={data}
      isLoading={isLoading}
      isError={isError}
      errorMessage="Não foi possível carregar o fluxo de caixa."
      emptyMessage="Nenhuma movimentação nos últimos 30 dias."
    />
  )
}
