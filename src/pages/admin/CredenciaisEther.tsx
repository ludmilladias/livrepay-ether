import { useState } from "react"
import { Building2, ShieldAlert } from "lucide-react"
import { toast } from "sonner"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  useAdminUsers, useEtherCredentials, useHouseAccount, useLinkHouseAccount, useRevokeEtherCredential,
  useUnlinkHouseAccount, useHouseBalance,
  type AdminUser, type EtherCredential,
} from "@/hooks/use-admin"

const statusLabel: Record<EtherCredential["status"], string> = {
  active: "Ativa",
  suspect: "Recusada pela Ether",
}

const userLabel = (user?: AdminUser) => (user ? `${user.full_name ?? user.email} (${user.email})` : "—")

/**
 * Credenciais da Ether. Ninguém digita clientId/clientSecret aqui: a credencial
 * da conta da LivrePay já está no servidor, e o admin só escolhe quem a opera.
 */
const CredenciaisEther = () => {
  const users = useAdminUsers()
  const house = useHouseAccount()
  const credentials = useEtherCredentials()
  const link = useLinkHouseAccount()
  const revoke = useRevokeEtherCredential()
  const unlink = useUnlinkHouseAccount()
  const balance = useHouseBalance(Boolean(house.data?.linked_user_id))

  const [operatorId, setOperatorId] = useState<string>("")
  const [confirming, setConfirming] = useState(false)
  const [unlinking, setUnlinking] = useState(false)
  const [revoking, setRevoking] = useState<AdminUser | null>(null)

  const allUsers = users.data ?? []
  const admins = allUsers.filter((u) => u.roles.includes("admin"))
  const byId = new Map(allUsers.map((u) => [u.id, u]))
  const linkedUser = house.data?.linked_user_id ? byId.get(house.data.linked_user_id) : undefined
  const selected = byId.get(operatorId)

  async function confirmLink() {
    if (!selected) return
    try {
      await link.mutateAsync(selected.id)
      toast.success(`Conta da LivrePay vinculada a ${selected.email}.`)
      setOperatorId("")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível vincular.")
    } finally {
      setConfirming(false)
    }
  }

  async function confirmUnlink() {
    try {
      await unlink.mutateAsync()
      toast.success("Conta da LivrePay desvinculada.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível desvincular.")
    } finally {
      setUnlinking(false)
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
          As chaves de acesso à Ether ficam só no servidor. Aqui você define quem opera cada conta.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Conta da LivrePay
          </CardTitle>
          <CardDescription>
            Credencial e ID da conta configurados no servidor. Só um usuário admin pode operá-la.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {house.isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : house.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {house.error instanceof Error ? house.error.message : "Não foi possível carregar a conta da LivrePay."}
            </p>
          ) : house.data ? (
            <>
              <dl className="text-sm">
                <dt className="text-muted-foreground">ID da conta na Ether</dt>
                <dd className="font-mono text-xs break-all">{house.data.ether_user_id}</dd>
              </dl>

              {house.data.linked_user_id ? (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Operada por:</span>
                  <Badge variant="secondary">{userLabel(linkedUser)}</Badge>
                  <Button size="sm" variant="ghost" disabled={unlink.isPending} onClick={() => setUnlinking(true)}>
                    Desvincular
                  </Button>
                  <div className="basis-full pt-3">
                    <p className="text-muted-foreground mb-1">Conferência de saldo</p>
                    {balance.isLoading ? (
                      <p className="text-muted-foreground">Consultando a Ether…</p>
                    ) : balance.isError ? (
                      <p role="alert" className="text-destructive">
                        {balance.error instanceof Error ? balance.error.message : "Não foi possível consultar o saldo."}
                      </p>
                    ) : balance.data ? (
                      <dl className="grid gap-2 sm:grid-cols-2">
                        <div>
                          <dt className="text-muted-foreground">Ether (valor devolvido pela API)</dt>
                          <dd className="font-mono">{String(balance.data.ether_balance_raw ?? "—")}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">LivrePay (ledger)</dt>
                          <dd className="font-mono">
                            {balance.data.local_balance_cents === null
                              ? "—"
                              : (balance.data.local_balance_cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                          </dd>
                        </div>
                      </dl>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <div className="flex-1 space-y-2">
                    <p className="text-sm text-muted-foreground">Ainda não vinculada. Escolha o usuário admin que vai operá-la:</p>
                    <Select value={operatorId} onValueChange={setOperatorId}>
                      <SelectTrigger aria-label="Usuário admin que opera a conta da LivrePay">
                        <SelectValue placeholder={admins.length ? "Selecione um admin" : "Nenhum usuário admin"} />
                      </SelectTrigger>
                      <SelectContent>
                        {admins.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {userLabel(u)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button disabled={!selected || link.isPending} onClick={() => setConfirming(true)}>
                    {link.isPending ? "Vinculando…" : "Vincular conta da LivrePay"}
                  </Button>
                </div>
              )}
            </>
          ) : null}
        </CardContent>
      </Card>

      <Alert>
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>Contas de clientes</AlertTitle>
        <AlertDescription>
          A credencial de cada cliente é gerada pela Ether e precisa chegar ao servidor por integração, sem passar por
          pessoas. Enquanto essa integração não existe, clientes não fazem Pix nem boleto de saída.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Credenciais de clientes no cofre</CardTitle>
          <CardDescription>Só metadados. O segredo fica cifrado e nunca é mostrado.</CardDescription>
        </CardHeader>
        <CardContent>
          {credentials.isLoading ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Carregando…</p>
          ) : credentials.isError ? (
            <p className="text-sm text-destructive">Não foi possível carregar as credenciais.</p>
          ) : (credentials.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Nenhuma credencial de cliente no cofre.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Usuário</TableHead>
                  <TableHead>Cliente na Ether</TableHead>
                  <TableHead>clientId</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(credentials.data ?? []).map((cred) => {
                  const user = byId.get(cred.user_id)
                  return (
                    <TableRow key={cred.user_id}>
                      <TableCell>{userLabel(user)}</TableCell>
                      <TableCell className="font-mono text-xs">{cred.ether_user_id}</TableCell>
                      <TableCell className="font-mono text-xs">{cred.client_id}</TableCell>
                      <TableCell>
                        <Badge variant={cred.status === "active" ? "secondary" : "destructive"}>
                          {statusLabel[cred.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {user && (
                          <Button size="sm" variant="ghost" onClick={() => setRevoking(user)}>
                            Revogar
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirming} onOpenChange={(open) => !open && setConfirming(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Vincular a conta da LivrePay?</AlertDialogTitle>
            <AlertDialogDescription>
              {userLabel(selected)} passa a operar a conta da LivrePay na Ether. Quem tiver o login desse usuário movimenta o dinheiro da
              LivrePay. Só um usuário pode ficar vinculado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmLink()}>Vincular</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={unlinking} onOpenChange={(open) => !open && setUnlinking(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desvincular a conta da LivrePay?</AlertDialogTitle>
            <AlertDialogDescription>
              {userLabel(linkedUser)} deixa de operar a conta da LivrePay na hora. Depois, outro admin pode ser vinculado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmUnlink()}>Desvincular</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!revoking} onOpenChange={(open) => !open && setRevoking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revogar credencial?</AlertDialogTitle>
            <AlertDialogDescription>
              {revoking?.full_name ?? revoking?.email} deixa de operar a conta na Ether pela LivrePay. Peça também à
              Ether para desativar a credencial do lado dela.
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
