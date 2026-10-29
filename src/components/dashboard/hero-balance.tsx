import { useState } from "react"
import { ArrowDownLeft, ArrowUpRight, Eye, EyeOff, Wallet } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { useAccountBalance } from "@/hooks/use-payments"
import { useCashflow } from "@/hooks/use-reports"
import { formatCents } from "@/lib/money"

/**
 * Saldo real da conta (GET /accounts/balance) e totais dos últimos 30 dias
 * somados do fluxo real (GET /reports/cashflow). Nada aqui é estimativa.
 */
export function HeroBalance() {
  const { data: balanceCents, isLoading, isError } = useAccountBalance()
  const { data: flow, isLoading: flowLoading } = useCashflow()
  const [hidden, setHidden] = useState(false)

  const totalIn = (flow ?? []).reduce((sum, d) => sum + d.in_cents, 0)
  const totalOut = (flow ?? []).reduce((sum, d) => sum + d.out_cents, 0)

  return (
    <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary via-primary to-primary/80 p-6 text-primary-foreground shadow-lg sm:p-8">
      <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10" aria-hidden="true" />
      <div className="pointer-events-none absolute -bottom-20 right-10 h-40 w-40 rounded-full bg-white/5" aria-hidden="true" />

      <div className="relative flex items-start justify-between gap-4">
        <div className="flex items-center gap-2 text-sm font-medium text-primary-foreground/80">
          <Wallet className="h-4 w-4" aria-hidden="true" />
          Saldo disponível
        </div>
        <button
          type="button"
          onClick={() => setHidden((h) => !h)}
          className="rounded-full p-2 text-primary-foreground/80 transition hover:bg-white/10 hover:text-primary-foreground"
          aria-label={hidden ? "Mostrar saldo" : "Ocultar saldo"}
          aria-pressed={hidden}
        >
          {hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>

      <div className="relative mt-3">
        {isLoading && <Skeleton className="h-12 w-56 bg-white/20" />}
        {isError && <p className="text-sm">Não foi possível carregar o saldo.</p>}
        {!isLoading && !isError && (
          <p className="text-4xl font-bold tracking-tight sm:text-5xl">
            {hidden ? "R$ •••••" : formatCents(balanceCents ?? 0)}
          </p>
        )}
        <p className="mt-2 text-sm text-primary-foreground/70">Conta Principal</p>
      </div>

      <div className="relative mt-8 grid grid-cols-2 gap-3 sm:max-w-md">
        <div className="rounded-xl bg-white/10 p-4">
          <div className="flex items-center gap-1.5 text-xs font-medium text-primary-foreground/80">
            <ArrowDownLeft className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" />
            Entradas · 30 dias
          </div>
          {flowLoading ? (
            <Skeleton className="mt-2 h-6 w-24 bg-white/20" />
          ) : (
            <p className="mt-1 text-lg font-semibold">{hidden ? "•••" : formatCents(totalIn)}</p>
          )}
        </div>
        <div className="rounded-xl bg-white/10 p-4">
          <div className="flex items-center gap-1.5 text-xs font-medium text-primary-foreground/80">
            <ArrowUpRight className="h-3.5 w-3.5 text-rose-300" aria-hidden="true" />
            Saídas · 30 dias
          </div>
          {flowLoading ? (
            <Skeleton className="mt-2 h-6 w-24 bg-white/20" />
          ) : (
            <p className="mt-1 text-lg font-semibold">{hidden ? "•••" : formatCents(totalOut)}</p>
          )}
        </div>
      </div>
    </section>
  )
}
