import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { ShieldCheck, ShieldX } from "lucide-react"
import { toast } from "sonner"
import {
  useAdminReceivables, useVerifyReceivable, useRejectReceivable,
  type AdminReceivable,
} from "@/hooks/use-admin"
import { receivableStatusLabel, receivableStatusClass } from "@/hooks/use-receivables"
import { formatCents } from "@/lib/money"

function formatDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split("-")
  return `${day}/${month}/${year}`
}

const VerificacaoRecebiveis = () => {
  const { data, isLoading, isError } = useAdminReceivables()
  const verify = useVerifyReceivable()
  const reject = useRejectReceivable()

  const [approving, setApproving] = useState<AdminReceivable | null>(null)
  const [rejecting, setRejecting] = useState<AdminReceivable | null>(null)
  const [reason, setReason] = useState("")

  const rows = data ?? []
  const pending = rows.filter((r) => !r.verified_at)
  const verified = rows.filter((r) => r.verified_at)

  async function handleApprove() {
    if (!approving) return
    const target = approving
    setApproving(null)
    try {
      await verify.mutateAsync(target.id)
      toast.success("Recebível verificado — o dono já pode antecipar.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível verificar.")
    }
  }

  async function handleReject() {
    if (!rejecting) return
    if (reason.trim().length < 3) {
      toast.error("Informe o motivo da recusa.")
      return
    }
    const target = rejecting
    setRejecting(null)
    const usedReason = reason
    setReason("")
    try {
      await reject.mutateAsync({ id: target.id, reason: usedReason })
      toast.success("Recebível recusado.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível recusar.")
    }
  }

  return (
    <div className="space-y-8 max-w-7xl">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Verificação de Recebíveis</h1>
        <p className="text-muted-foreground mt-2">
          Nenhum recebível é antecipado sem passar por aqui — é o que fecha o auto-crédito de
          2026-08-20.
        </p>
      </div>

      {isError && (
        <p className="text-sm text-destructive">Não foi possível carregar os recebíveis.</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Pendentes de verificação ({pending.length})</CardTitle>
          <CardDescription>
            Confirme que o valor corresponde a um crédito real (contrato/conciliação) antes de
            aprovar — a verificação libera a antecipação.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Carregando…</p>
          ) : pending.length === 0 ? (
            <div className="py-12 text-center">
              <ShieldCheck className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">Nada pendente de verificação.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Usuário</TableHead>
                  <TableHead>Contrato</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Bruto</TableHead>
                  <TableHead>Líquido (a creditar)</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.owner_name ?? r.user_id}</TableCell>
                    <TableCell>
                      {r.contract_name ?? "—"}
                      {r.contract_acquirer ? ` · ${r.contract_acquirer}` : ""}
                    </TableCell>
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
                    <TableCell className="text-right space-x-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1 text-destructive hover:text-destructive"
                        onClick={() => setRejecting(r)}
                      >
                        <ShieldX className="h-3.5 w-3.5" />
                        Recusar
                      </Button>
                      <Button size="sm" className="gap-1" onClick={() => setApproving(r)}>
                        <ShieldCheck className="h-3.5 w-3.5" />
                        Verificar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {verified.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Verificados, aguardando antecipação ({verified.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Usuário</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Líquido</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {verified.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.owner_name ?? r.user_id}</TableCell>
                    <TableCell>{formatDate(r.due_date)}</TableCell>
                    <TableCell>{formatCents(r.net_cents)}</TableCell>
                    <TableCell>
                      <Badge className={receivableStatusClass[r.status]} variant="secondary">
                        {receivableStatusLabel[r.status]}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <AlertDialog open={approving !== null} onOpenChange={(open) => !open && setApproving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Verificar recebível</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Confirmar que o recebível de{" "}
                  <strong>{approving ? formatCents(approving.gross_cents) : ""}</strong> de{" "}
                  <strong>{approving?.owner_name ?? approving?.user_id}</strong> corresponde a um
                  crédito real?
                </p>
                <p className="text-sm text-muted-foreground">
                  Depois disso, o dono pode antecipar e receber{" "}
                  {approving ? formatCents(approving.net_cents) : ""} imediatamente.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleApprove()}>Verificar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={rejecting !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRejecting(null)
            setReason("")
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Recusar recebível</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Recusar o recebível de{" "}
                  <strong>{rejecting ? formatCents(rejecting.gross_cents) : ""}</strong> de{" "}
                  <strong>{rejecting?.owner_name ?? rejecting?.user_id}</strong>?
                </p>
                <Textarea
                  placeholder="Motivo da recusa (obrigatório)"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleReject()}>Recusar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default VerificacaoRecebiveis
