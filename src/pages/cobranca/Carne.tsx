import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { BookCopy, Plus, AlertCircle } from "lucide-react"
import { toast } from "sonner"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { useCreateInstallmentPlan, useInstallmentPlans } from "@/hooks/use-installment-plans"
import { formatCents, parseToCents } from "@/lib/money"
import { ServiceUnavailableNotice } from "@/components/shared/service-unavailable-notice"

const MAX_INSTALLMENTS = 12

function formatDate(value: string | null): string {
  if (!value) return "—"
  const [year, month, day] = value.slice(0, 10).split("-")
  return `${day}/${month}/${year}`
}

const Carne = () => {
  const navigate = useNavigate()
  const plans = useInstallmentPlans()
  const createPlan = useCreateInstallmentPlan()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [customerName, setCustomerName] = useState("")
  const [customerTaxId, setCustomerTaxId] = useState("")
  const [description, setDescription] = useState("")
  const [amount, setAmount] = useState("")
  const [totalInstallments, setTotalInstallments] = useState("2")
  const [firstDueDate, setFirstDueDate] = useState("")
  const [formError, setFormError] = useState<string | null>(null)

  function resetForm() {
    setCustomerName("")
    setCustomerTaxId("")
    setDescription("")
    setAmount("")
    setTotalInstallments("2")
    setFirstDueDate("")
    setFormError(null)
  }

  async function handleCreate() {
    if (!customerName.trim()) return setFormError("Informe o cliente.")
    if (!customerTaxId.trim()) return setFormError("Informe o CPF ou CNPJ do cliente.")
    if (!description.trim()) return setFormError("Informe a descrição.")

    const amountCents = parseToCents(amount)
    if (amountCents === null) return setFormError("Informe o valor da parcela (maior que zero).")

    const total = Number(totalInstallments)
    if (!Number.isInteger(total) || total < 1 || total > MAX_INSTALLMENTS) {
      return setFormError(`Quantidade de parcelas deve ser entre 1 e ${MAX_INSTALLMENTS}.`)
    }

    if (!firstDueDate) return setFormError("Informe a data da primeira parcela.")

    setFormError(null)
    try {
      await createPlan.mutateAsync({
        customerName: customerName.trim(),
        customerTaxId: customerTaxId.trim(),
        description: description.trim(),
        amountPerInstallmentCents: amountCents,
        totalInstallments: total,
        firstDueDate,
      })
      toast.success("Carnê criado com sucesso.")
      setDialogOpen(false)
      resetForm()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Não foi possível criar o carnê.")
    }
  }

  const rows = plans.data ?? []

  return (
    <div className="space-y-8 max-w-7xl">
      <ServiceUnavailableNotice scope="charges" />
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Carnê de Cobrança</h1>
          <p className="text-muted-foreground mt-2">
            Parcelamento em até {MAX_INSTALLMENTS} boletos — cada parcela é independente: atraso
            numa não afeta as demais.
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
              Novo Carnê
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[525px]">
            <DialogHeader>
              <DialogTitle>Novo Carnê de Cobrança</DialogTitle>
              <DialogDescription>
                As parcelas são geradas mensalmente a partir da primeira data informada.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="cliente">Cliente</Label>
                <Input
                  id="cliente"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Nome ou razão social"
                  maxLength={140}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="documento">CPF ou CNPJ do cliente</Label>
                <Input
                  id="documento"
                  value={customerTaxId}
                  onChange={(e) => setCustomerTaxId(e.target.value)}
                  placeholder="Só números"
                  inputMode="numeric"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="descricao">Descrição</Label>
                <Input
                  id="descricao"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ex: Serviço de consultoria"
                  maxLength={140}
                />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="valor">Valor da parcela</Label>
                  <Input
                    id="valor"
                    inputMode="decimal"
                    placeholder="0,00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="parcelas">Parcelas</Label>
                  <Input
                    id="parcelas"
                    type="number"
                    min={1}
                    max={MAX_INSTALLMENTS}
                    value={totalInstallments}
                    onChange={(e) => setTotalInstallments(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="primeira-parcela">1ª parcela</Label>
                  <Input
                    id="primeira-parcela"
                    type="date"
                    value={firstDueDate}
                    onChange={(e) => setFirstDueDate(e.target.value)}
                  />
                </div>
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
              <Button onClick={() => void handleCreate()} disabled={createPlan.isPending}>
                {createPlan.isPending ? "Criando..." : "Criar carnê"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Carnês</CardTitle>
          <CardDescription>Clique num carnê para ver as parcelas individualmente.</CardDescription>
        </CardHeader>
        <CardContent>
          {plans.isError ? (
            <div className="py-8 text-center text-sm text-destructive">
              Não foi possível carregar os carnês. Verifique sua conexão e tente novamente.
            </div>
          ) : plans.isLoading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="py-12 text-center">
              <BookCopy className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">
                Nenhum carnê ainda. Crie o primeiro usando o botão acima.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Parcela</TableHead>
                  <TableHead>Valor/parcela</TableHead>
                  <TableHead>Próximo vencimento</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((plan) => (
                  <TableRow
                    key={plan.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/cobranca/carne/${plan.id}`)}
                  >
                    <TableCell className="font-medium">{plan.customer_name}</TableCell>
                    <TableCell>{plan.description}</TableCell>
                    <TableCell>
                      {plan.paid_count}/{plan.total_installments}
                    </TableCell>
                    <TableCell className="font-semibold text-success">
                      {formatCents(plan.amount_per_installment_cents)}
                    </TableCell>
                    <TableCell>{formatDate(plan.next_due_date)}</TableCell>
                    <TableCell>
                      {plan.paid_count === plan.total_installments ? (
                        <Badge className="bg-green-100 text-green-800" variant="secondary">
                          Quitado
                        </Badge>
                      ) : (
                        <Badge className="bg-yellow-100 text-yellow-800" variant="secondary">
                          Em aberto
                        </Badge>
                      )}
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

export default Carne
