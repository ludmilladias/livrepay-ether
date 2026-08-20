import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { CheckCircle, XCircle, Clock, AlertTriangle, FileText, TrendingUp } from "lucide-react"

const Conciliacao = () => {
  const conciliacoes = [
    {
      id: "1",
      data: "20/02/2024",
      periodo: "Fevereiro 2024",
      transacoes: 156,
      conciliadas: 148,
      divergencias: 8,
      valorTotal: "R$ 45.890,00",
      status: "Concluída"
    }
  ]

  return (
    <div className="space-y-8 max-w-7xl">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Conciliação Bancária</h1>
          <p className="text-muted-foreground mt-2">
            Concilie automaticamente suas transações bancárias
          </p>
        </div>
        <Button className="gap-2">
          <FileText className="h-4 w-4" />
          Nova Conciliação
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Taxa de Conciliação</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">94.9%</div>
            <p className="text-xs text-muted-foreground">
              148 de 156 transações
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Divergências</CardTitle>
            <AlertTriangle className="h-4 w-4 text-yellow-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">8</div>
            <p className="text-xs text-muted-foreground">
              Requerem atenção
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Valor Conciliado</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">R$ 43.250</div>
            <p className="text-xs text-muted-foreground">
              94.2% do total
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Última Conciliação</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">2 dias</div>
            <p className="text-xs text-muted-foreground">
              20/02/2024
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Histórico de Conciliações</CardTitle>
          <CardDescription>
            Acompanhe o histórico das conciliações realizadas
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Período</TableHead>
                <TableHead>Transações</TableHead>
                <TableHead>Conciliadas</TableHead>
                <TableHead>Divergências</TableHead>
                <TableHead>Valor Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {conciliacoes.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.data}</TableCell>
                  <TableCell>{item.periodo}</TableCell>
                  <TableCell>{item.transacoes}</TableCell>
                  <TableCell className="text-green-600">{item.conciliadas}</TableCell>
                  <TableCell className="text-red-600">{item.divergencias}</TableCell>
                  <TableCell className="font-semibold">{item.valorTotal}</TableCell>
                  <TableCell>
                    <Badge className="bg-green-100 text-green-800" variant="secondary">
                      {item.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm">
                      Ver Detalhes
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

export default Conciliacao