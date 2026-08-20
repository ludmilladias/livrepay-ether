import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Calendar, Download, Filter, FileText, TrendingUp, DollarSign } from "lucide-react"

const ExtratosRelatorios = () => {
  const extratos = [
    {
      id: "1",
      periodo: "Fevereiro 2024",
      tipo: "Extrato Completo",
      saldoInicial: "R$ 45.230,50",
      entradas: "R$ 125.890,00",
      saidas: "R$ 89.450,80",
      saldoFinal: "R$ 81.669,70",
      status: "Disponível",
      dataGeracao: "01/03/2024"
    }
  ]

  return (
    <div className="space-y-8 max-w-7xl">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Extratos</h1>
          <p className="text-muted-foreground mt-2">
            Visualize extratos detalhados de movimentações financeiras
          </p>
        </div>
        <Button className="gap-2">
          <Download className="h-4 w-4" />
          Gerar Extrato
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Saldo Atual</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">R$ 81.669,70</div>
            <p className="text-xs text-muted-foreground">
              +15.2% vs mês anterior
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Entradas</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">R$ 125.890</div>
            <p className="text-xs text-muted-foreground">
              Este mês
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Saídas</CardTitle>
            <TrendingUp className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">R$ 89.450</div>
            <p className="text-xs text-muted-foreground">
              Este mês
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Extratos Gerados</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">24</div>
            <p className="text-xs text-muted-foreground">
              Este ano
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Gerar Novo Extrato</CardTitle>
          <CardDescription>
            Configure e gere extratos personalizados
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="dataInicio">Data Início</Label>
              <Input type="date" id="dataInicio" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dataFim">Data Fim</Label>
              <Input type="date" id="dataFim" />
            </div>
            <div className="flex items-end">
              <Button className="w-full gap-2">
                <FileText className="h-4 w-4" />
                Gerar Extrato
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default ExtratosRelatorios