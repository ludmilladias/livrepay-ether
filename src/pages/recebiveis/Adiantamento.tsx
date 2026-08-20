import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { TrendingUp, Zap } from "lucide-react"
import { toast } from "sonner"
import {
  useReceivables, useAdvanceReceivable,
  receivableStatusLabel, receivableStatusClass,
  type Receivable,
} from "@/hooks/use-receivables"
import { formatCents } from "@/lib/money"

function formatDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split("-")
  return `${day}/${month}/${year}`
}

const Adiantamento = () => {
  const [confirming, setConfirming] = useState<Receivable | null>(null)

  const scheduled = useReceivables("scheduled")
  const overdue = useReceivables("overdue")
  const advanced = useReceivables("advanced")
  const advanceReceivable = useAdvanceReceivable()

  const eligible = [...(scheduled.data ?? []), ...(overdue.data ?? [])].sort(
    (a, b) => a.due_date.localeCompare(b.due_date),
  )
  const history = advanced.data ?? []

  const totalEligibleGross = eligible.reduce((sum, r) => sum + r.gross_cents, 0)
  const totalEligibleNet = eligible.reduce((sum, r) => sum + r.net_cents, 0)
  const totalAdvancedNet = history.reduce((sum, r) => sum + r.net_cents, 0)

  async function handleAdvance() {
    if (!confirming) return
    const target = confirming
    setConfirming(null)
    try {
      await advanceReceivable.mutateAsync(target.id)
      toast.success(`${formatCents(target.net_cents)} creditados na sua conta.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível antecipar.")
    }
  }

  const isLoading = scheduled.isLoading || overdue.isLoading || advanced.isLoading

  return (
    <div className="space-y-8 max-w-7xl">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Adiantamento de Recebíveis</h1>
          <p className="text-muted-foreground mt-2">
            Antecipe recebíveis agendados e receba o valor líquido na hora
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Disponível para Antecipar</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-28" /> : (
              <>
                <div className="text-2xl font-bold">{formatCents(totalEligibleNet)}</div>
                <p className="text-xs text-muted-foreground">
                  Bruto: {formatCents(totalEligibleGross)}
                </p>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Recebíveis Elegíveis</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-16" /> : (
              <div className="text-2xl font-bold">{eligible.length}</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Já Antecipado</CardTitle>
            <Zap className="h-4 w-4 text-purple-600" />
          </CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-8 w-28" /> : (
              <div className="text-2xl font-bold">{formatCents(totalAdvancedNet)}</div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recebíveis Elegíveis</CardTitle>
          <CardDescription>
            Recebíveis agendados ou em atraso podem ser antecipados agora
          </CardDescription>
        </CardHeader>
        <CardContent>
          {eligible.length === 0 ? (
            <div className="py-12 text-center">
              <TrendingUp className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">
                Nenhum recebível elegível para antecipação no momento.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contrato</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Valor Bruto</TableHead>
                  <TableHead>Você recebe hoje</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {eligible.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.contract_name ?? "—"}</TableCell>
                    <TableCell>{formatDate(r.due_date)}</TableCell>
                    <TableCell>{formatCents(r.gross_cents)}</TableCell>
                    <TableCell className="font-semibold text-green-600">
                      {formatCents(r.net_cents)}
                    </TableCell>
                    <TableCell>
                      <Badge className={receivableStatusClass[r.status]} variant="secondary">
                        {receivableStatusLabel[r.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" onClick={() => setConfirming(r)} className="gap-1">
                        <Zap className="h-3.5 w-3.5" />
                        Antecipar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Histórico de Antecipações</CardTitle>
          <CardDescription>Recebíveis já antecipados</CardDescription>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Nenhuma antecipação realizada ainda.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contrato</TableHead>
                  <TableHead>Vencimento original</TableHead>
                  <TableHead>Valor Bruto</TableHead>
                  <TableHead>Creditado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.contract_name ?? "—"}</TableCell>
                    <TableCell>{formatDate(r.due_date)}</TableCell>
                    <TableCell>{formatCents(r.gross_cents)}</TableCell>
                    <TableCell className="font-semibold text-green-600">
                      {formatCents(r.net_cents)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar antecipação</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Antecipar o recebível de <strong>{confirming ? formatCents(confirming.gross_cents) : ""}</strong>{" "}
                  (vencimento {confirming ? formatDate(confirming.due_date) : ""})?
                </p>
                <p className="text-sm">
                  Você recebe <strong className="text-green-600">
                    {confirming ? formatCents(confirming.net_cents) : ""}
                  </strong>{" "}
                  na sua conta imediatamente.
                </p>
                <p className="text-sm text-muted-foreground">
                  Esta operação não pode ser desfeita.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleAdvance()}>
              Confirmar antecipação
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default Adiantamento
