import { FlowChart } from "@/components/dashboard/flow-chart"
import { useAdminVolume } from "@/hooks/use-reports"

export function VolumeChart() {
  const { data, isLoading, isError } = useAdminVolume()

  return (
    <FlowChart
      title="Volume da plataforma — últimos 30 dias"
      gradientId="volume"
      data={data}
      isLoading={isLoading}
      isError={isError}
      errorMessage="Não foi possível carregar o volume."
      emptyMessage="Nenhuma movimentação nos últimos 30 dias."
    />
  )
}
