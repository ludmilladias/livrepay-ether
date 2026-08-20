import { useState } from "react"
import type { LucideIcon } from "lucide-react"
import { AlertCircle, AlertTriangle, Ban, Plus, Send, Wallet } from "lucide-react"
import { toast } from "sonner"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  usePayments, useCreatePayment, useExecutePayment, useCancelPayment, useAccountBalance,
  paymentStatusLabel, paymentStatusClass, isSettled,
  type Payment, type PaymentKind, type PixKeyType,
} from "@/hooks/use-payments"
import { formatCents, parseToCents } from "@/lib/money"

export interface PaymentsViewProps {
  kind: PaymentKind
  title: string
  subtitle: string
  createLabel: string
  recipientLabel: string
  keyLabel: string
  keyPlaceholder: string
  emptyMessage: string
  icon: LucideIcon
  /**
   * "pix": transferência para uma chave (padrão).
   * "boleto": pagamento por linha digitável — sem seletor de tipo de chave,
   * favorecido é opcional (só se sabe quem é ao consultar o boleto).
   */
  method?: "pix" | "boleto"
}

const keyTypes: { value: PixKeyType; label: string }[] = [
  { value: "CPF", label: "CPF" },
  { value: "CNPJ", label: "CNPJ" },
  { value: "EMAIL", label: "E-mail" },
  { value: "PHONE", label: "Telefone" },
  { value: "RANDOM", label: "Chave aleatória" },
]

function formatDateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString("pt-BR") : "—"
}

export function PaymentsView({
  kind, title, subtitle, createLabel, recipientLabel,
  keyLabel, keyPlaceholder, emptyMessage, icon: Icon,
  method = "pix",
}: PaymentsViewProps) {
  const isBoleto = method === "boleto"
  const [dialogOpen, setDialogOpen] = useState(false)
  const [recipient, setRecipient] = useState("")
  const [recipientKey, setRecipientKey] = useState("")
  const [keyType, setKeyType] = useState<PixKeyType>("CPF")
  const [amount, setAmount] = useState("")
  const [scheduledFor, setScheduledFor] = useState("")
  const [formError, setFormError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<Payment | null>(null)

  const payments = usePayments(kind)
  const balance = useAccountBalance()
  const createPayment = useCreatePayment(kind)
  const executePayment = useExecutePayment(kind)
  const cancelPayment = useCancelPayment(kind)

  function resetForm() {
    setRecipient("")
    setRecipientKey("")
    setKeyType("CPF")
    setAmount("")
    setScheduledFor("")
    setFormError(null)
  }

  async function handleCreate() {
    const name = recipient.trim()
    if (!isBoleto && !name) return setFormError(`Informe o ${recipientLabel.toLowerCase()}.`)

    const key = recipientKey.trim()
    if (!key) return setFormError(`Informe ${keyLabel.toLowerCase()}.`)

    if (isBoleto && key.replace(/\D/g, "").length < 47) {
      return setFormError("Linha digitável inválida (esperado 47 ou 48 dígitos).")
    }

    const amountCents = parseToCents(amount)
    if (amountCents === null) return setFormError("Informe um valor válido maior que zero.")

    setFormError(null)
    try {
      await createPayment.mutateAsync({
        amountCents,
        paymentMethod: isBoleto ? "BOLETO" : "PIX",
        recipientName: isBoleto ? (name || undefined) : name,
        recipientKey: key,
        pixKeyType: isBoleto ? undefined : keyType,
        scheduledFor: scheduledFor || null,
      })
      toast.success("Pagamento cadastrado. Revise e confirme para enviar.")
      setDialogOpen(false)
      resetForm()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Não foi possível cadastrar.")
    }
  }

  async function handleExecute(payment: Payment) {
    setConfirming(null)
    try {
      const result = await executePayment.mutateAsync(payment.id)
      if (result.status === "processing") {
        toast.warning(result.warning ?? "Pagamento enviado; aguardando confirmação.")
      } else {
        toast.success("Pagamento concluído.")
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao executar o pagamento.")
    }
  }

  async function handleCancel(id: string) {
    try {
      await cancelPayment.mutateAsync(id)
      toast.success("Pagamento cancelado.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível cancelar.")
    }
  }

  const rows = payments.data ?? []
  const availableCents = balance.data ?? 0
  const pendingTotal = rows
    .filter((p) => p.status === "draft" || p.status === "scheduled")
    .reduce((sum, p) => sum + p.amount_cents, 0)
  const insufficientForConfirming =
    confirming !== null && confirming.amount_cents > availableCents

  return (
    <div className="space-y-8 max-w-7xl">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-foreground">{title}</h1>
          <p className="text-muted-foreground mt-2">{subtitle}</p>
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
              {createLabel}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[525px]">
            <DialogHeader>
              <DialogTitle>{createLabel}</DialogTitle>
              <DialogDescription>
                O valor só sai da conta depois que você confirmar o envio.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="destinatario">
                  {recipientLabel}
                  {isBoleto && <span className="text-muted-foreground"> (opcional)</span>}
                </Label>
                <Input
                  id="destinatario"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder="Nome ou razão social"
                />
              </div>
              {isBoleto ? (
                <div className="grid gap-2">
                  <Label htmlFor="chave">{keyLabel}</Label>
                  <Input
                    id="chave"
                    value={recipientKey}
                    onChange={(e) => setRecipientKey(e.target.value)}
                    placeholder={keyPlaceholder}
                    className="font-mono"
                  />
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="tipo-chave">Tipo</Label>
                    <Select value={keyType} onValueChange={(v) => setKeyType(v as PixKeyType)}>
                      <SelectTrigger id="tipo-chave">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {keyTypes.map((t) => (
                          <SelectItem key={t.value} value={t.value}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2 col-span-2">
                    <Label htmlFor="chave">{keyLabel}</Label>
                    <Input
                      id="chave"
                      value={recipientKey}
                      onChange={(e) => setRecipientKey(e.target.value)}
                      placeholder={keyPlaceholder}
                    />
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="valor">Valor (R$)</Label>
                  <Input
                    id="valor"
                    inputMode="decimal"
                    placeholder="0,00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="agendamento">Agendar para</Label>
                  <Input
                    id="agendamento"
                    type="date"
                    value={scheduledFor}
                    onChange={(e) => setScheduledFor(e.target.value)}
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
              <Button onClick={() => void handleCreate()} disabled={createPayment.isPending}>
                {createPayment.isPending ? "Salvando..." : "Salvar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Indicadores */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Saldo Disponível</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {balance.isLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="text-2xl font-bold">{formatCents(availableCents)}</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">A Pagar</CardTitle>
            <Icon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {payments.isLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <>
                <div className="text-2xl font-bold">{formatCents(pendingTotal)}</div>
                {pendingTotal > availableCents && (
                  <p className="text-xs text-destructive flex items-center gap-1 mt-1">
                    <AlertTriangle className="h-3 w-3" />
                    Acima do saldo disponível
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Concluídos</CardTitle>
            <Icon className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            {payments.isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">
                {rows.filter((p) => p.status === "completed").length}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tabela */}
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>
            Pagamentos em processamento ou concluídos não podem ser alterados.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {payments.isError ? (
            <div className="py-8 text-center text-sm text-destructive">
              Não foi possível carregar os pagamentos. Verifique sua conexão e tente novamente.
            </div>
          ) : payments.isLoading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="py-12 text-center">
              <Icon className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">{emptyMessage}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{recipientLabel}</TableHead>
                  <TableHead>{keyLabel}</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Executado em</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((payment) => {
                  const editable = payment.status === "draft" || payment.status === "scheduled"
                  return (
                    <TableRow key={payment.id}>
                      <TableCell className="font-medium">
                        {payment.recipient_name ?? "—"}
                        {payment.status === "failed" && payment.failure_reason && (
                          <p className="text-xs text-destructive mt-1">
                            {payment.failure_reason} — valor estornado
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {payment.recipient_key ?? "—"}
                      </TableCell>
                      <TableCell className="font-semibold">
                        {formatCents(payment.amount_cents)}
                      </TableCell>
                      <TableCell>
                        <Badge className={paymentStatusClass[payment.status]} variant="secondary">
                          {paymentStatusLabel[payment.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {formatDateTime(payment.executed_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={!editable || executePayment.isPending}
                            onClick={() => setConfirming(payment)}
                            title={
                              isSettled(payment.status)
                                ? "Pagamento já processado"
                                : "Enviar pagamento"
                            }
                          >
                            <Send className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={!editable || cancelPayment.isPending}
                            onClick={() => void handleCancel(payment.id)}
                            title={editable ? "Cancelar" : "Não é mais possível cancelar"}
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
          )}
        </CardContent>
      </Card>

      {/* Confirmação explícita — saída de dinheiro é irreversível */}
      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar pagamento</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Enviar <strong>{confirming ? formatCents(confirming.amount_cents) : ""}</strong>{" "}
                  para <strong>{confirming?.recipient_name}</strong> (
                  <span className="font-mono text-xs">{confirming?.recipient_key}</span>)?
                </p>
                <p className="text-sm">
                  Saldo após o envio:{" "}
                  <strong>
                    {formatCents(Math.max(0, availableCents - (confirming?.amount_cents ?? 0)))}
                  </strong>
                </p>
                {insufficientForConfirming && (
                  <p className="text-sm text-destructive flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" />
                    Saldo insuficiente para este pagamento.
                  </p>
                )}
                <p className="text-sm text-muted-foreground">
                  Uma transferência PIX confirmada não pode ser desfeita.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              disabled={insufficientForConfirming}
              onClick={() => confirming && void handleExecute(confirming)}
            >
              Confirmar envio
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
