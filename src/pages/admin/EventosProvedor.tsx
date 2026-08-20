import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { RefreshCw, CheckCircle2 } from "lucide-react"
import { toast } from "sonner"
import { useAdminProviderEvents, useReprocessProviderEvent } from "@/hooks/use-admin"

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("pt-BR")
}

const EventosProvedor = () => {
  const [onlyErrors, setOnlyErrors] = useState(true)
  const { data, isLoading, isError } = useAdminProviderEvents(onlyErrors)
  const reprocess = useReprocessProviderEvent(onlyErrors)

  const rows = data ?? []

  async function handleReprocess(id: string) {
    try {
      const result = await reprocess.mutateAsync(id)
      if ((result as { status?: string })?.status === "ok") {
        toast.success("Evento reprocessado com sucesso.")
      } else {
        toast.error("Reprocessado, mas ainda com erro — veja o detalhe na linha.")
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível reprocessar.")
    }
  }

  return (
    <div className="space-y-8 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Eventos do Provedor</h1>
          <p className="text-muted-foreground mt-2">
            Webhooks recebidos da Ether — reprocessar chama a mesma lógica idempotente do
            webhook, nunca credita duas vezes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="only-errors" checked={onlyErrors} onCheckedChange={setOnlyErrors} />
          <Label htmlFor="only-errors" className="text-sm">Só com erro</Label>
        </div>
      </div>

      {isError && (
        <p className="text-sm text-destructive">Não foi possível carregar os eventos.</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{rows.length} evento(s)</CardTitle>
          <CardDescription>
            Persistido antes de processar — mesmo que o processamento falhe, o evento fica salvo
            para reprocessamento.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Carregando…</p>
          ) : rows.length === 0 ? (
            <div className="py-12 text-center">
              <CheckCircle2 className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">
                {onlyErrors ? "Nenhum evento com erro pendente." : "Nenhum evento recebido ainda."}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recebido em</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Erro</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell>{formatDateTime(event.received_at)}</TableCell>
                    <TableCell className="font-mono text-xs">{event.event_type}</TableCell>
                    <TableCell className="max-w-md truncate text-sm text-destructive">
                      {event.error ?? "—"}
                    </TableCell>
                    <TableCell>
                      {event.processed_at ? (
                        <Badge variant="secondary" className="bg-green-100 text-green-800">
                          Processado
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">
                          Pendente
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1"
                        disabled={reprocess.isPending}
                        onClick={() => void handleReprocess(event.id)}
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Reprocessar
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

export default EventosProvedor
