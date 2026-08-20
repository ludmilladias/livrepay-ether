import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { AlertCircle, FileText, Plus } from "lucide-react"
import { toast } from "sonner"
import { useReceivableContracts, useCreateReceivableContract } from "@/hooks/use-receivables"
import { formatCents } from "@/lib/money"

const Contratos = () => {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [name, setName] = useState("")
  const [acquirer, setAcquirer] = useState("")
  const [formError, setFormError] = useState<string | null>(null)

  const contracts = useReceivableContracts()
  const createContract = useCreateReceivableContract()

  function resetForm() {
    setName("")
    setAcquirer("")
    setFormError(null)
  }

  async function handleCreate() {
    const trimmed = name.trim()
    if (!trimmed) return setFormError("Informe o nome do contrato.")

    setFormError(null)
    try {
      await createContract.mutateAsync({ name: trimmed, acquirer: acquirer.trim() || undefined })
      toast.success("Contrato cadastrado.")
      setDialogOpen(false)
      resetForm()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Não foi possível cadastrar o contrato.")
    }
  }

  const rows = contracts.data ?? []
  const totalPending = rows.reduce((sum, c) => sum + c.pending_cents, 0)

  return (
    <div className="space-y-8 max-w-7xl">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Contratos de Recebíveis</h1>
          <p className="text-muted-foreground mt-2">
            Cadastre os contratos com suas credenciadoras/adquirentes para organizar a agenda
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
              Novo Contrato
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[480px]">
            <DialogHeader>
              <DialogTitle>Novo Contrato</DialogTitle>
              <DialogDescription>
                Identifique o contrato — os recebíveis da Agenda podem ser vinculados a ele.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="nome">Nome do contrato</Label>
                <Input
                  id="nome"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Contrato Cielo - Loja Centro"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="adquirente">Credenciadora/adquirente</Label>
                <Input
                  id="adquirente"
                  value={acquirer}
                  onChange={(e) => setAcquirer(e.target.value)}
                  placeholder="Ex: Cielo, Stone, Rede..."
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
              <Button onClick={() => void handleCreate()} disabled={createContract.isPending}>
                {createContract.isPending ? "Salvando..." : "Salvar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Contratos Cadastrados</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {contracts.isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">{rows.length}</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">A Receber (agendado/atrasado)</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {contracts.isLoading ? (
              <Skeleton className="h-8 w-28" />
            ) : (
              <div className="text-2xl font-bold">{formatCents(totalPending)}</div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Seus Contratos</CardTitle>
          <CardDescription>Vínculos com credenciadoras/adquirentes usados na Agenda</CardDescription>
        </CardHeader>
        <CardContent>
          {contracts.isError ? (
            <div className="py-8 text-center text-sm text-destructive">
              Não foi possível carregar os contratos.
            </div>
          ) : contracts.isLoading ? (
            <div className="space-y-3">
              {[0, 1].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="py-12 text-center">
              <FileText className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">
                Nenhum contrato ainda. Cadastre o primeiro usando o botão acima.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Adquirente</TableHead>
                  <TableHead>A receber</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((contract) => (
                  <TableRow key={contract.id}>
                    <TableCell className="font-medium">{contract.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {contract.acquirer ?? "—"}
                    </TableCell>
                    <TableCell className="font-semibold text-green-600">
                      {formatCents(contract.pending_cents)}
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

export default Contratos
