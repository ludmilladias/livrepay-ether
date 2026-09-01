import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { CheckCircle, AlertTriangle, ListChecks } from "lucide-react"
import { useReconciliation } from "@/hooks/use-reports"
import { formatCents } from "@/lib/money"

function formatDateTime(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
}

const sourceLabel: Record<string, string> = { charge: "Cobrança", payment: "Pagamento" }

const Conciliacao = () => {
  const { data, isLoading, isError } = useReconciliation()
  const rate = data && data.total > 0 ? (data.reconciled_count / data.total) * 100 : null

  return (
    <div className="space-y-8 max-w-7xl">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Conciliação</h1>
        <p className="text-muted-foreground mt-2">
          Checagem de integridade: toda cobrança paga e todo pagamento concluído precisa ter um
          lançamento correspondente no ledger. Não há extrato bancário externo para comparar — a
          Ether não oferece esse feed hoje, então isto é uma auditoria interna, não uma
          conciliação com o banco.
        </p>
      </div>

      {isError && (
        <p className="text-sm text-destructive">Não foi possível carregar a conciliação.</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Taxa de Conciliação</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold">
                {rate === null ? "—" : `${rate.toFixed(1)}%`}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-2">
              {data ? `${data.reconciled_count} de ${data.total} registro(s)` : "carregando…"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Divergências</CardTitle>
            <AlertTriangle
              className="h-4 w-4"
              style={{ color: (data?.divergent_count ?? 0) > 0 ? "hsl(var(--warning))" : undefined }}
            />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-12" />
            ) : (
              <div className="text-2xl font-bold">{data?.divergent_count ?? 0}</div>
            )}
            <p className="text-xs text-muted-foreground mt-2">
              {(data?.divergent_count ?? 0) > 0 ? "requerem investigação" : "nenhuma pendência"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Registros Verificados</CardTitle>
            <ListChecks className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-12" />
            ) : (
              <div className="text-2xl font-bold">{data?.total ?? 0}</div>
            )}
            <p className="text-xs text-muted-foreground mt-2">cobranças pagas + pagamentos concluídos</p>
          </CardContent>
        </Card>
      </div>

      {!isLoading && !isError && (data?.divergent_count ?? 0) > 0 && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-destructive">Divergências encontradas</CardTitle>
            <CardDescription>
              Cobrança/pagamento marcado como liquidado sem lançamento correspondente no ledger —
              isto não deveria acontecer por construção; trate como bug de dados, não como
              diferença bancária normal.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Origem</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Liquidado em</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.divergent_items.map((item) => (
                  <TableRow key={`${item.source}-${item.id}`}>
                    <TableCell>{sourceLabel[item.source] ?? item.source}</TableCell>
                    <TableCell>{item.description}</TableCell>
                    <TableCell>{formatDateTime(item.settled_at)}</TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCents(item.amount_cents)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Últimos registros verificados</CardTitle>
          <CardDescription>Cobranças pagas e pagamentos concluídos mais recentes</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading && <Skeleton className="h-40 w-full" />}

          {!isLoading && !isError && data?.items.length === 0 && (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Nenhuma cobrança paga ou pagamento concluído ainda.
            </p>
          )}

          {!isLoading && !isError && data && data.items.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Origem</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Liquidado em</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.slice(0, 50).map((item) => (
                  <TableRow key={`${item.source}-${item.id}`}>
                    <TableCell>{sourceLabel[item.source] ?? item.source}</TableCell>
                    <TableCell>{item.description}</TableCell>
                    <TableCell>{formatDateTime(item.settled_at)}</TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCents(item.amount_cents)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge
                        variant="secondary"
                        className={
                          item.reconciled
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-red-100 text-red-800"
                        }
                      >
                        {item.reconciled ? "Conciliado" : "Divergente"}
                      </Badge>
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

export default Conciliacao
