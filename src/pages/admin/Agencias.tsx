import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Building2 } from "lucide-react"
import { toast } from "sonner"
import {
  useAdminTenants, useAdminTenantMovement, useSetTenantLimits, useSuspendTenant, useReactivateTenant,
  type AdminTenant,
} from "@/hooks/use-admin"
import { useProfile } from "@/hooks/use-profile"
import { formatCents, parseToCents } from "@/lib/money"

const errorText = (error: unknown) =>
  error instanceof Error && error.message ? error.message : "Não foi possível concluir."

const limitText = (cents: number | null) => (cents === null ? "Sem limite" : formatCents(cents))
const toInput = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2).replace(".", ","))

/** Campo vazio = sem limite. Valor preenchido precisa ser um valor monetário válido. */
function parseLimit(raw: string): { ok: true; cents: number | null } | { ok: false } {
  if (!raw.trim()) return { ok: true, cents: null }
  const cents = parseToCents(raw)
  return cents === null ? { ok: false } : { ok: true, cents }
}

const Agencias = () => {
  const { data, isLoading, isError } = useAdminTenants()
  const { data: profile } = useProfile()
  const isAdmin = !!profile?.roles?.includes("admin")
  const setLimits = useSetTenantLimits()
  const suspend = useSuspendTenant()
  const reactivate = useReactivateTenant()

  const [editing, setEditing] = useState<AdminTenant | null>(null)
  const [fields, setFields] = useState({ receivable: "", exposure: "", daily: "" })
  const [suspending, setSuspending] = useState<AdminTenant | null>(null)
  const [reason, setReason] = useState("")
  const [movementOf, setMovementOf] = useState<AdminTenant | null>(null)
  const movement = useAdminTenantMovement(movementOf?.slug ?? null)
  const movementDays = (movement.data ?? []).filter((d) => d.credits_cents > 0 || d.debits_cents > 0).reverse()

  const rows = data ?? []

  function openLimits(tenant: AdminTenant) {
    setEditing(tenant)
    setFields({
      receivable: toInput(tenant.max_receivable_cents),
      exposure: toInput(tenant.max_exposure_cents),
      daily: toInput(tenant.max_daily_advance_cents),
    })
  }

  async function saveLimits() {
    if (!editing) return
    const receivable = parseLimit(fields.receivable)
    const exposure = parseLimit(fields.exposure)
    const daily = parseLimit(fields.daily)
    if (!receivable.ok || !exposure.ok || !daily.ok) {
      toast.error("Use valores como 10.000,00, ou deixe vazio para não ter limite.")
      return
    }
    const target = editing
    try {
      await setLimits.mutateAsync({
        slug: target.slug,
        limits: {
          max_receivable_cents: receivable.cents,
          max_exposure_cents: exposure.cents,
          max_daily_advance_cents: daily.cents,
        },
      })
      toast.success(`Limites de ${target.name} atualizados.`)
      setEditing(null)
    } catch (error) {
      toast.error(errorText(error))
    }
  }

  async function confirmSuspend() {
    if (!suspending) return
    if (reason.trim().length < 3) {
      toast.error("Informe o motivo da suspensão.")
      return
    }
    const target = suspending
    try {
      await suspend.mutateAsync({ slug: target.slug, reason: reason.trim() })
      toast.success(`${target.name} suspensa. As sessões foram encerradas.`)
      setSuspending(null)
      setReason("")
    } catch (error) {
      toast.error(errorText(error))
    }
  }

  async function handleReactivate(tenant: AdminTenant) {
    try {
      await reactivate.mutateAsync(tenant.slug)
      toast.success(`${tenant.name} reativada.`)
    } catch (error) {
      toast.error(errorText(error))
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Agências</h1>
        <p className="text-muted-foreground mt-1">
          Limites, suspensão e conciliação de cada agência. A Ether não conhece agência: estes controles
          valem só no LivrePay.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Building2 className="h-5 w-5" /> Conciliação e limites
          </CardTitle>
          <CardDescription>
            Saldo e movimento (30 dias) somados por agência; a soma dos saldos fecha com o total das contas.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : isError ? (
            <p className="text-sm text-destructive">Não foi possível carregar as agências.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agência</TableHead>
                  <TableHead className="text-right">Clientes</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                  <TableHead className="text-right">Entradas 30d</TableHead>
                  <TableHead className="text-right">Saídas 30d</TableHead>
                  <TableHead className="text-right">Exposição</TableHead>
                  <TableHead className="text-right">Antecipado hoje</TableHead>
                  <TableHead className="text-right">Aguardando verificação</TableHead>
                  <TableHead>Limites</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t) => (
                  <TableRow key={t.slug}>
                    <TableCell>
                      <div className="font-medium">{t.name}</div>
                      {t.status === "suspended" ? (
                        <Badge variant="destructive" title={t.suspended_reason ?? undefined}>Suspensa</Badge>
                      ) : (
                        <Badge variant="secondary">Ativa</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{t.customers}</TableCell>
                    <TableCell className="text-right">{formatCents(t.balance_cents)}</TableCell>
                    <TableCell className="text-right">{formatCents(t.credits_30d_cents)}</TableCell>
                    <TableCell className="text-right">{formatCents(t.debits_30d_cents)}</TableCell>
                    <TableCell className="text-right">{formatCents(t.advanced_exposure_cents)}</TableCell>
                    <TableCell className="text-right">{formatCents(t.advanced_today_cents)}</TableCell>
                    <TableCell className="text-right">{t.pending_receivables}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <div>Por recebível: {limitText(t.max_receivable_cents)}</div>
                      <div>Exposição: {limitText(t.max_exposure_cents)}</div>
                      <div>Por dia: {limitText(t.max_daily_advance_cents)}</div>
                      {t.status === "suspended" && t.suspended_reason && (
                        <div className="mt-1 text-destructive">Motivo: {t.suspended_reason}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => setMovementOf(t)}>Movimento</Button>
                        {isAdmin && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => openLimits(t)}>Limites</Button>
                            {t.slug !== "livrepay" &&
                              (t.status === "suspended" ? (
                                <Button size="sm" disabled={reactivate.isPending} onClick={() => handleReactivate(t)}>
                                  Reativar
                                </Button>
                              ) : (
                                <Button size="sm" variant="destructive" onClick={() => setSuspending(t)}>
                                  Suspender
                                </Button>
                              ))}
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!movementOf} onOpenChange={(open) => !open && setMovementOf(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Movimento de {movementOf?.name}</DialogTitle>
            <DialogDescription>Entradas e saídas por dia, últimos 30 dias (fuso de São Paulo).</DialogDescription>
          </DialogHeader>
          {movement.isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : movement.isError ? (
            <p className="text-sm text-destructive">Não foi possível carregar o movimento.</p>
          ) : movementDays.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Sem movimento no período.</p>
          ) : (
            <div className="max-h-96 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Dia</TableHead>
                    <TableHead className="text-right">Entradas</TableHead>
                    <TableHead className="text-right">Saídas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movementDays.map((d) => (
                    <TableRow key={d.day}>
                      <TableCell>{new Date(`${d.day.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR")}</TableCell>
                      <TableCell className="text-right">{formatCents(d.credits_cents)}</TableCell>
                      <TableCell className="text-right">{formatCents(d.debits_cents)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Limites de {editing?.name}</AlertDialogTitle>
            <AlertDialogDescription>
              Em reais. Deixe vazio para não ter limite. Valem na antecipação e na pré-aprovação.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="lim-receivable">Valor líquido máximo por recebível</Label>
              <Input id="lim-receivable" inputMode="decimal" value={fields.receivable}
                onChange={(e) => setFields({ ...fields, receivable: e.target.value })} placeholder="Sem limite" />
            </div>
            <div>
              <Label htmlFor="lim-exposure">Exposição total antecipada</Label>
              <Input id="lim-exposure" inputMode="decimal" value={fields.exposure}
                onChange={(e) => setFields({ ...fields, exposure: e.target.value })} placeholder="Sem limite" />
            </div>
            <div>
              <Label htmlFor="lim-daily">Antecipação por dia</Label>
              <Input id="lim-daily" inputMode="decimal" value={fields.daily}
                onChange={(e) => setFields({ ...fields, daily: e.target.value })} placeholder="Sem limite" />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <Button disabled={setLimits.isPending} onClick={saveLimits}>Salvar limites</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!suspending} onOpenChange={(open) => { if (!open) { setSuspending(null); setReason("") } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Suspender {suspending?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Os clientes e a equipe da agência não conseguem entrar, pagar nem antecipar, e as sessões abertas
              são encerradas. Nenhum dado é apagado e o dinheiro já recebido continua registrado. Dá para reativar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500}
            placeholder="Motivo da suspensão" aria-label="Motivo da suspensão" />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <Button variant="destructive" disabled={reason.trim().length < 3 || suspend.isPending} onClick={confirmSuspend}>
              Suspender agência
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default Agencias
