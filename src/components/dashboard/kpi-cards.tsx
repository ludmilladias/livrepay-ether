import { DollarSign } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useAccountBalance } from "@/hooks/use-payments"

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

/**
 * Só o saldo tem fonte real hoje (GET /accounts/balance — RLS garante que é
 * exatamente o saldo do usuário logado). Caixa D0/D+30, limite disponível e
 * taxa de fraude não têm nenhuma feature por trás (sem projeção de fluxo de
 * caixa, sem sistema de limites, sem detecção de fraude implementada) — por
 * isso não aparecem aqui. Ver PENDING.md e Open-Decisions.md antes de
 * reintroduzir qualquer um desses cartões com dado real.
 */
export function KPICards() {
  const { data: balanceCents, isLoading, isError } = useAccountBalance()

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      <Card className="hover:shadow-lg transition-shadow">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Saldo Total
          </CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {isLoading && (
            <div className="text-2xl font-bold text-muted-foreground">Carregando…</div>
          )}
          {isError && (
            <div className="text-sm text-destructive">Não foi possível carregar o saldo.</div>
          )}
          {!isLoading && !isError && (
            <div className="text-2xl font-bold">{formatCents(balanceCents ?? 0)}</div>
          )}
          <p className="text-xs text-muted-foreground mt-2">saldo atual da conta</p>
        </CardContent>
      </Card>
    </div>
  )
}
