import { useState } from "react"
import { KeyRound, ShieldAlert } from "lucide-react"
import { toast } from "sonner"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  useAdminUsers, useEtherCredentials, useRevokeEtherCredential, useStoreEtherCredential,
  type AdminUser, type EtherCredential,
} from "@/hooks/use-admin"

const statusLabel: Record<EtherCredential["status"], string> = {
  active: "Ativa",
  suspect: "Recusada pela Ether",
}

/**
 * Cadastro da credencial da Ether (clientId + clientSecret) de cada cliente.
 * O servidor confere a credencial na própria Ether antes de guardar, cifra o
 * segredo e nunca o devolve. Esta tela só envia e mostra metadados.
 */
const CredenciaisEther = () => {
  const users = useAdminUsers()
  const credentials = useEtherCredentials()
  const store = useStoreEtherCredential()
  const revoke = useRevokeEtherCredential()

  const [target, setTarget] = useState<AdminUser | null>(null)
  const [etherUserId, setEtherUserId] = useState("")
  const [clientId, setClientId] = useState("")
  const [clientSecret, setClientSecret] = useState("")
  const [formError, setFormError] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<AdminUser | null>(null)

  const byUser = new Map((credentials.data ?? []).map((c) => [c.user_id, c]))
  const rows = users.data ?? []

  function openForm(user: AdminUser) {
    const current = byUser.get(user.id)
    setTarget(user)
    setEtherUserId(current?.ether_user_id ?? "")
    setClientId("")
    setClientSecret("")
    setFormError(null)
  }

  function closeForm() {
    setTarget(null)
    setClientSecret("")
    setFormError(null)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!target) return
    if (!etherUserId.trim() || !clientId.trim() || !clientSecret) {
      setFormError("Preencha o ID do cliente na Ether, o clientId e o clientSecret.")
      return
    }
    setFormError(null)
    try {
      await store.mutateAsync({
        userId: target.id,
        etherUserId: etherUserId.trim(),
        clientId: clientId.trim(),
        clientSecret,
      })
      toast.success(`Credencial conferida e guardada para ${target.full_name ?? target.email}.`)
      closeForm()
    } catch (error) {
      // Limpa o segredo do campo mesmo no erro: ele não deve ficar na tela.
      setClientSecret("")
      setFormError(error instanceof Error ? error.message : "Não foi possível guardar a credencial.")
    }
  }

  async function confirmRevoke() {
    if (!revoking) return
    try {
      await revoke.mutateAsync(revoking.id)
      toast.success(`Credencial revogada para ${revoking.full_name ?? revoking.email}.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível revogar.")
    } finally {
      setRevoking(null)
    }
  }

  return (
    <div className="space-y-8 max-w-7xl">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Credenciais da Ether</h1>
        <p className="text-muted-foreground mt-2">
          Cada cliente opera a própria conta na Ether com uma credencial própria, gerada pela Ether e entregue por
          canal seguro.
        </p>
      </div>

      <Alert>
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>Como funciona</AlertTitle>
        <AlertDescription>
          Ao salvar, o servidor entra na Ether com a credencial recebida e confere se ela pertence ao cliente informado
          e se o CPF/CNPJ bate. Só então o segredo é cifrado e guardado. Ele nunca é mostrado de novo, nem para admin.
          Depois de colar, apague a mensagem em que a credencial chegou.
        </AlertDescription>
      </Alert>

      {(users.isError || credentials.isError) && (
        <p className="text-sm text-destructive">Não foi possível carregar os usuários ou as credenciais.</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{rows.length} usuário(s)</CardTitle>
          <CardDescription>O ID do cliente na Ether é o que aparece na URL do cliente no backoffice.</CardDescription>
        </CardHeader>
        <CardContent>
          {users.isLoading || credentials.isLoading ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Carregando…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Usuário</TableHead>
                  <TableHead>Cliente na Ether</TableHead>
                  <TableHead>clientId</TableHead>
                  <TableHead>Credencial</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((user) => {
                  const cred = byUser.get(user.id)
                  return (
                    <TableRow key={user.id}>
                      <TableCell>
                        <div className="font-medium">{user.full_name ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{user.email}</div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{cred?.ether_user_id ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{cred?.client_id ?? "—"}</TableCell>
                      <TableCell>
                        {cred ? (
                          <Badge variant={cred.status === "active" ? "secondary" : "destructive"}>
                            {statusLabel[cred.status]}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">Sem credencial</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => openForm(user)}>
                            <KeyRound className="h-4 w-4 mr-1" />
                            {cred ? "Trocar" : "Cadastrar"}
                          </Button>
                          {cred && (
                            <Button size="sm" variant="ghost" onClick={() => setRevoking(user)}>
                              Revogar
                            </Button>
                          )}
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

      <Dialog open={!!target} onOpenChange={(open) => !open && closeForm()}>
        <DialogContent>
          <form onSubmit={submit} noValidate className="space-y-4">
            <DialogHeader>
              <DialogTitle>Credencial da Ether</DialogTitle>
              <DialogDescription>
                {target ? `${target.full_name ?? target.email}. ` : ""}
                Se já existir uma credencial, ela será substituída e a antiga deixa de valer.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2">
              <Label htmlFor="ether-user-id">ID do cliente na Ether</Label>
              <Input
                id="ether-user-id"
                value={etherUserId}
                onChange={(e) => setEtherUserId(e.target.value)}
                placeholder="00000000-0000-0000-0000-000000000000"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="client-id">clientId</Label>
              <Input
                id="client-id"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="client-secret">clientSecret</Label>
              <Input
                id="client-secret"
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                autoComplete="new-password"
                spellCheck={false}
              />
            </div>

            {formError && (
              <p role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={closeForm}>
                Cancelar
              </Button>
              <Button type="submit" disabled={store.isPending}>
                {store.isPending ? "Conferindo na Ether…" : "Conferir e guardar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!revoking} onOpenChange={(open) => !open && setRevoking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revogar credencial?</AlertDialogTitle>
            <AlertDialogDescription>
              {revoking?.full_name ?? revoking?.email} deixa de operar a conta na Ether pela LivrePay até uma nova
              credencial ser cadastrada. Peça também à Ether para desativar a credencial do lado dela.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmRevoke()}>Revogar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default CredenciaisEther
