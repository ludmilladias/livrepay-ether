import { useParams, useNavigate } from "react-router-dom"
import { ArrowLeft, Ban, Send } from "lucide-react"
import { toast } from "sonner"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import {
  useCancelInstallmentCharge, useEmitInstallmentCharge, useInstallmentPlan,
} from "@/hooks/use-installment-plans"
import { chargeStatusClass, chargeStatusLabel } from "@/hooks/use-charges"
import { formatCents } from "@/lib/money"
import { ServiceUnavailableNotice } from "@/components/shared/service-unavailable-notice"

function formatDate(value: string | null): string {
  if (!value) return "—"
  const [year, month, day] = value.slice(0, 10).split("-")
  return `${day}/${month}/${year}`
}

const CarneDetalhe = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const plan = useInstallmentPlan(id)
  const cancelCharge = useCancelInstallmentCharge(id ?? "")
  const emitCharge = useEmitInstallmentCharge(id ?? "")

  async function handleCancel(chargeId: string) {
    try {
      await cancelCharge.mutateAsync(chargeId)
      toast.success("Parcela cancelada.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível cancelar a parcela.")
    }
  }

  async function handleEmit(chargeId: string) {
    try {
      await emitCharge.mutateAsync(chargeId)
      toast.success("Parcela emitida no banco parceiro.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao emitir no banco parceiro.")
    }
  }

  if (plan.isLoading) {
    return (
      <div className="space-y-4 max-w-5xl">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (plan.isError || !plan.data) {
    return (
      <div className="max-w-5xl">
        <p className="text-sm text-destructive">Carnê não encontrado.</p>
        <Button variant="outline" className="mt-4 gap-2" onClick={() => navigate("/cobranca/carne")}>
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </Button>
      </div>
    )
  }

  const data = plan.data

  return (
    <div className="space-y-8 max-w-5xl">
      <ServiceUnavailableNotice scope="charges" />
      <div>
        <Button variant="ghost" size="sm" className="gap-2 -ml-2 mb-2" onClick={() => navigate("/cobranca/carne")}>
          <ArrowLeft className="h-4 w-4" />
          Voltar aos carnês
        </Button>
        <h1 className="text-3xl font-bold text-foreground">{data.description}</h1>
        <p className="text-muted-foreground mt-2">
          {data.customer_name} — {data.total_installments} parcela(s) de{" "}
          {formatCents(data.amount_per_installment_cents)}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Parcelas</CardTitle>
          <CardDescription>
            Cada parcela é um boleto independente — cancelar ou deixar vencer uma não afeta as demais.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Parcela</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.charges.map((charge) => {
                const open = charge.status === "draft" || charge.status === "pending"
                return (
                  <TableRow key={charge.id}>
                    <TableCell className="font-medium">
                      {charge.installment_number}/{data.total_installments}
                    </TableCell>
                    <TableCell>{formatDate(charge.due_date)}</TableCell>
                    <TableCell className="font-semibold text-success">
                      {formatCents(charge.amount_cents)}
                    </TableCell>
                    <TableCell>
                      <Badge className={chargeStatusClass[charge.status]} variant="secondary">
                        {chargeStatusLabel[charge.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {open && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={emitCharge.isPending}
                            onClick={() => void handleEmit(charge.id)}
                            title="Emitir no banco parceiro"
                          >
                            <Send className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!open || cancelCharge.isPending}
                          onClick={() => void handleCancel(charge.id)}
                          title={open ? "Cancelar parcela" : "Parcela finalizada"}
                        >
                          <Ban className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

export default CarneDetalhe
