import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { AlertCircle, Ban, Calendar, DollarSign, Plus } from "lucide-react"
import { toast } from "sonner"
import {
  useReceivables, useReceivableSummary, useReceivableContracts,
  useCreateReceivable, useCancelReceivable,
  receivableStatusLabel, receivableStatusClass, isReceivableOpen,
} from "@/hooks/use-receivables"
import { formatCents, parseToCents } from "@/lib/money"

function formatDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split("-")
  return `${day}/${month}/${year}`
}

const NONE_CONTRACT = "none"

const Agenda = () => {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [contractId, setContractId] = useState<string>(NONE_CONTRACT)
  const [grossAmount, setGrossAmount] = useState("")
  const [netAmount, setNetAmount] = useState("")
  const [dueDate, setDueDate] = useState("")
  const [formError, setFormError] = useState<string | null>(null)

  const receivables = useReceivables()
  const summary = useReceivableSummary()
  const contracts = useReceivableContracts()
  const createReceivable = useCreateReceivable()
  const cancelReceivable = useCancelReceivable()

  function resetForm() {
    setContractId(NONE_CONTRACT)
    setGrossAmount("")
    setNetAmount("")
    setDueDate("")
    setFormError(null)
  }

  async function handleCreate() {
    const grossCents = parseToCents(grossAmount)
    if (grossCents === null) return setFormError("Informe um valor bruto válido.")

    const netCents = parseToCents(netAmount || grossAmount)
    if (netCents === null) return setFormError("Informe um valor líquido válido.")
    if (netCents > grossCents) return setFormError("O valor líquido não pode ser maior que o bruto.")

    if (!dueDate) return setFormError("Informe a data de vencimento.")

    setFormError(null)
    try {
      await createReceivable.mutateAsync({
        contractId: contractId === NONE_CONTRACT ? null : contractId,
        grossCents,
        netCents,
        dueDate,
      })
      toast.success("Recebível agendado.")
      setDialogOpen(false)
      resetForm()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Não foi possível agendar.")
    }
  }

  async function handleCancel(id: string) {
    try {
      await cancelReceivable.mutateAsync(id)
      toast.success("Recebível cancelado.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível cancelar.")
    }
  }

  const rows = receivables.data ?? []
  const summaryData = summary.data ?? []
  const totalCents = summaryData.reduce((sum, s) => sum + s.gross_cents, 0)
  const scheduledCents = summaryData.find((s) => s.status === "scheduled")?.gross_cents ?? 0
  const overdueCents = summaryData.find((s) => s.status === "overdue")?.gross_cents ?? 0

  return (
    <div className="space-y-8 max-w-7xl">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Agenda de Recebíveis</h1>
          <p className="text-muted-foreground mt-2">
            Acompanhe seus recebimentos futuros e organize seu fluxo de caixa
          </p>
        </div>
        <Dialog
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open)
            if (!open) resetForm()
          }}
        >
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              Agendar Recebível
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[480px]">
            <DialogHeader>
              <DialogTitle>Agendar Recebível</DialogTitle>
              <DialogDescription>
                Registre um recebimento futuro para acompanhar na agenda.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="contrato">Contrato (opcional)</Label>
                <Select value={contractId} onValueChange={setContractId}>
                  <SelectTrigger id="contrato">
                    <SelectValue placeholder="Nenhum" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_CONTRACT}>Nenhum</SelectItem>
                    {(contracts.data ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="bruto">Valor bruto (R$)</Label>
                  <Input
                    id="bruto"
                    inputMode="decimal"
                    placeholder="0,00"
                    value={grossAmount}
                    onChange={(e) => setGrossAmount(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="liquido">Valor líquido (R$)</Label>
                  <Input
                    id="liquido"
                    inputMode="decimal"
                    placeholder="igual ao bruto"
                    value={netAmount}
                    onChange={(e) => setNetAmount(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="vencimento">Data de vencimento</Label>
                <Input
                  id="vencimento"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
              {formError && (
                <p className="text-sm text-destructive flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  {formError}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={() => void handleCreate()} disabled={createReceivable.isPending}>
                {createReceivable.isPending ? "Salvando..." : "Agendar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total (todos os status)</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {summary.isLoading ? <Skeleton className="h-8 w-28" /> : (
              <div className="text-2xl font-bold">{formatCents(totalCents)}</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Agendado</CardTitle>
            <Calendar className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            {summary.isLoading ? <Skeleton className="h-8 w-28" /> : (
              <div className="text-2xl font-bold">{formatCents(scheduledCents)}</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Em Atraso</CardTitle>
            <Calendar className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            {summary.isLoading ? <Skeleton className="h-8 w-28" /> : (
              <div className="text-2xl font-bold">{formatCents(overdueCents)}</div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Próximos Recebimentos</CardTitle>
          <CardDescription>Ordenado por data de vencimento</CardDescription>
        </CardHeader>
        <CardContent>
          {receivables.isError ? (
            <div className="py-8 text-center text-sm text-destructive">
              Não foi possível carregar a agenda.
            </div>
          ) : receivables.isLoading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="py-12 text-center">
              <Calendar className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">
                Nenhum recebível agendado ainda. Adicione o primeiro usando o botão acima.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contrato</TableHead>
                  <TableHead>Valor Bruto</TableHead>
                  <TableHead>Valor Líquido</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.contract_name ?? "—"}</TableCell>
                    <TableCell>{formatCents(r.gross_cents)}</TableCell>
                    <TableCell className="font-semibold text-green-600">
                      {formatCents(r.net_cents)}
                    </TableCell>
                    <TableCell>{formatDate(r.due_date)}</TableCell>
                    <TableCell>
                      <Badge className={receivableStatusClass[r.status]} variant="secondary">
                        {receivableStatusLabel[r.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!isReceivableOpen(r.status) || cancelReceivable.isPending}
                        onClick={() => void handleCancel(r.id)}
                        title={isReceivableOpen(r.status) ? "Cancelar" : "Não pode mais ser cancelado"}
                      >
                        <Ban className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default Agenda
