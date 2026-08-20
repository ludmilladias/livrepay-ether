import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { FileSearch } from "lucide-react"
import { useAdminAuditLog } from "@/hooks/use-admin"

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("pt-BR")
}

const actionClass: Record<string, string> = {
  INSERT: "bg-green-100 text-green-800",
  UPDATE: "bg-blue-100 text-blue-800",
  DELETE: "bg-red-100 text-red-800",
}

const Auditoria = () => {
  const [table, setTable] = useState("")
  const { data, isLoading, isError } = useAdminAuditLog(table || undefined)

  const rows = data ?? []

  return (
    <div className="space-y-8 max-w-7xl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Auditoria</h1>
          <p className="text-muted-foreground mt-2">
            Toda alteração em charges, payments, accounts, cards e user_roles — trilha
            append-only, não pode ser apagada nem editada.
          </p>
        </div>
        <Input
          placeholder="Filtrar por tabela (ex: payments)"
          value={table}
          onChange={(e) => setTable(e.target.value)}
          className="max-w-xs"
        />
      </div>

      {isError && (
        <p className="text-sm text-destructive">Não foi possível carregar a auditoria.</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{rows.length} registro(s)</CardTitle>
          <CardDescription>Mais recentes primeiro, até 500 por consulta.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Carregando…</p>
          ) : rows.length === 0 ? (
            <div className="py-12 text-center">
              <FileSearch className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">Nenhum registro encontrado.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quando</TableHead>
                  <TableHead>Tabela</TableHead>
                  <TableHead>Ação</TableHead>
                  <TableHead>Registro</TableHead>
                  <TableHead>Usuário</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>{formatDateTime(entry.created_at)}</TableCell>
                    <TableCell className="font-mono text-xs">{entry.table_name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={actionClass[entry.action] ?? ""}>
                        {entry.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {entry.record_id ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {entry.user_id ?? "sistema"}
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

export default Auditoria
