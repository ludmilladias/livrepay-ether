import { useState, type ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { AlertCircle, Ban, Check, Copy, Plus, Send } from "lucide-react"
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
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  useCharges, useChargeStats, useCreateCharge, useCancelCharge, useEmitCharge,
  chargeStatusLabel, chargeStatusClass, chargePayload,
  type Charge, type ChargeKind,
} from "@/hooks/use-charges"
import { formatCents, parseToCents } from "@/lib/money"

/** Campo extra específico do tipo de cobrança; o valor vai para charges.payload. */
export interface ChargeField {
  key: string
  label: string
  type: "text" | "select"
  placeholder?: string
  options?: { value: string; label: string }[]
  defaultValue?: string
}

/** Coluna extra específica do tipo de cobrança. */
export interface ChargeColumn {
  header: string
  render: (charge: Charge) => ReactNode
}

export interface ChargesViewProps {
  kind: ChargeKind
  title: string
  subtitle: string
  createLabel: string
  createTitle: string
  emptyMessage: string
  icon: LucideIcon
  /** Exibe campo/coluna de cliente (boletos e assinaturas). */
  showCustomer?: boolean
  /** Habilita emissão no provedor (Ether). Hoje só PIX. */
  canEmit?: boolean
  extraFields?: ChargeField[]
  extraColumns?: ChargeColumn[]
}

function formatDate(value: string | null): string {
  if (!value) return "—"
  // due_date é 'YYYY-MM-DD'. Criar um Date aplicaria fuso e poderia exibir o
  // dia anterior — por isso formatamos a partir das partes da string.
  const [year, month, day] = value.slice(0, 10).split("-")
  return `${day}/${month}/${year}`
}

export function ChargesView({
  kind, title, subtitle, createLabel, createTitle, emptyMessage,
  icon: Icon, showCustomer = false, canEmit = false,
  extraFields = [], extraColumns = [],
}: ChargesViewProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [description, setDescription] = useState("")
  const [amount, setAmount] = useState("")
  const [dueDate, setDueDate] = useState("")
  const [customer, setCustomer] = useState("")
  const [notes, setNotes] = useState("")
  const [extras, setExtras] = useState<Record<string, string>>(
    () => Object.fromEntries(extraFields.map((f) => [f.key, f.defaultValue ?? ""])),
  )
  const [formError, setFormError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const charges = useCharges(kind)
  const stats = useChargeStats(kind)
  const createCharge = useCreateCharge(kind)
  const cancelCharge = useCancelCharge(kind)
  const emitCharge = useEmitCharge(kind)

  function resetForm() {
    setDescription("")
    setAmount("")
    setDueDate("")
    setCustomer("")
    setNotes("")
    setExtras(Object.fromEntries(extraFields.map((f) => [f.key, f.defaultValue ?? ""])))
    setFormError(null)
  }

  async function handleCreate() {
    const trimmed = description.trim()
    if (!trimmed) return setFormError("Informe uma descrição.")

    const amountCents = parseToCents(amount)
    if (amountCents === null) return setFormError("Informe um valor válido maior que zero.")

    setFormError(null)
    try {
      await createCharge.mutateAsync({
        description: trimmed,
        amountCents,
        dueDate: dueDate || null,
        customerName: showCustomer ? customer.trim() || null : null,
        payload: { ...extras, notes: notes.trim() || undefined },
      })
      toast.success("Cobrança criada com sucesso.")
      setDialogOpen(false)
      resetForm()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Não foi possível criar a cobrança.")
    }
  }

  async function handleEmit(id: string) {
    try {
      await emitCharge.mutateAsync(id)
      toast.success("Cobrança emitida no provedor. Código PIX disponível.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao emitir no provedor.")
    }
  }

  async function handleCancel(id: string) {
    try {
      await cancelCharge.mutateAsync(id)
      toast.success("Cobrança cancelada.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível cancelar.")
    }
  }

  async function handleCopy(charge: Charge) {
    const code = chargePayload(charge).pix_copy_paste
    if (!code) return
    try {
      await navigator.clipboard.writeText(code)
      setCopiedId(charge.id)
      setTimeout(() => setCopiedId(null), 2000)
      toast.success("Código PIX copiado.")
    } catch {
      toast.error("Não foi possível copiar. Copie manualmente.")
    }
  }

  const rows = charges.data ?? []
  const pendingCount = rows.filter((r) => r.status === "pending").length

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
              <DialogTitle>{createTitle}</DialogTitle>
              <DialogDescription>Preencha os dados da cobrança.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="descricao">Descrição</Label>
                <Input
                  id="descricao"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={140}
                  placeholder="Ex: Mensalidade de janeiro"
                />
              </div>

              {showCustomer && (
                <div className="grid gap-2">
                  <Label htmlFor="cliente">Cliente</Label>
                  <Input
                    id="cliente"
                    value={customer}
                    onChange={(e) => setCustomer(e.target.value)}
                    placeholder="Nome ou razão social"
                  />
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
                  <Label htmlFor="vencimento">Vencimento</Label>
                  <Input
                    id="vencimento"
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                  />
                </div>
              </div>

              {extraFields.map((field) => (
                <div className="grid gap-2" key={field.key}>
                  <Label htmlFor={field.key}>{field.label}</Label>
                  {field.type === "select" ? (
                    <Select
                      value={extras[field.key] ?? ""}
                      onValueChange={(v) => setExtras((prev) => ({ ...prev, [field.key]: v }))}
                    >
                      <SelectTrigger id={field.key}>
                        <SelectValue placeholder={field.placeholder ?? "Selecione"} />
                      </SelectTrigger>
                      <SelectContent>
                        {field.options?.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      id={field.key}
                      value={extras[field.key] ?? ""}
                      placeholder={field.placeholder}
                      onChange={(e) => setExtras((prev) => ({ ...prev, [field.key]: e.target.value }))}
                    />
                  )}
                </div>
              ))}

              <div className="grid gap-2">
                <Label htmlFor="observacoes">Observações</Label>
                <Textarea
                  id="observacoes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Informações adicionais"
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
              <Button onClick={() => void handleCreate()} disabled={createCharge.isPending}>
                {createCharge.isPending ? "Criando..." : "Criar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Indicadores */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {[
          { label: "Total", value: stats.data?.total ?? 0, loading: stats.isLoading },
          {
            label: "Pagas",
            value: stats.data?.paid ?? 0,
            hint: `Taxa: ${(stats.data?.paidRate ?? 0).toFixed(1)}%`,
            loading: stats.isLoading,
          },
          { label: "Aguardando", value: pendingCount, loading: charges.isLoading },
          {
            label: "Valor Total",
            value: formatCents(stats.data?.totalCents ?? 0),
            loading: stats.isLoading,
          },
        ].map((card) => (
          <Card key={card.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{card.label}</CardTitle>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {card.loading ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                <>
                  <div className="text-2xl font-bold">{card.value}</div>
                  {card.hint && <p className="text-xs text-muted-foreground">{card.hint}</p>}
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabela */}
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>Acompanhe o status de cada cobrança.</CardDescription>
        </CardHeader>
        <CardContent>
          {charges.isError ? (
            <div className="py-8 text-center text-sm text-destructive">
              Não foi possível carregar as cobranças. Verifique sua conexão e tente novamente.
            </div>
          ) : charges.isLoading ? (
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
                  <TableHead>Descrição</TableHead>
                  {showCustomer && <TableHead>Cliente</TableHead>}
                  <TableHead>Valor</TableHead>
                  <TableHead>Vencimento</TableHead>
                  {extraColumns.map((col) => (
                    <TableHead key={col.header}>{col.header}</TableHead>
                  ))}
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((charge) => {
                  const payload = chargePayload(charge)
                  const open = charge.status === "draft" || charge.status === "pending"
                  const emitted = Boolean(payload.pix_copy_paste)
                  return (
                    <TableRow key={charge.id}>
                      <TableCell className="font-medium">{charge.description}</TableCell>
                      {showCustomer && <TableCell>{charge.customer_name ?? "—"}</TableCell>}
                      <TableCell className="font-semibold text-green-600">
                        {formatCents(charge.amount_cents)}
                      </TableCell>
                      <TableCell>{formatDate(charge.due_date)}</TableCell>
                      {extraColumns.map((col) => (
                        <TableCell key={col.header}>{col.render(charge)}</TableCell>
                      ))}
                      <TableCell>
                        <Badge className={chargeStatusClass[charge.status]} variant="secondary">
                          {chargeStatusLabel[charge.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {canEmit && open && !emitted && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={emitCharge.isPending}
                              onClick={() => void handleEmit(charge.id)}
                              title="Emitir no provedor e gerar código PIX"
                            >
                              <Send className="h-4 w-4" />
                            </Button>
                          )}
                          {emitted && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void handleCopy(charge)}
                              title="Copiar código PIX"
                            >
                              {copiedId === charge.id ? (
                                <Check className="h-4 w-4 text-green-600" />
                              ) : (
                                <Copy className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={!open || cancelCharge.isPending}
                            onClick={() => void handleCancel(charge.id)}
                            title={open ? "Cancelar cobrança" : "Cobrança finalizada"}
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
    </div>
  )
}
