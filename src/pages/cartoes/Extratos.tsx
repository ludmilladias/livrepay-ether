import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Calendar, Download, Search, Filter, CreditCard, TrendingUp, TrendingDown, DollarSign } from "lucide-react"

const ExtratosCartoes = () => {
  const transacoes = [
    {
      id: "1",
      data: "22/02/2024",
      hora: "14:35",
      cartao: "**** **** **** 1234",
      nomeCartao: "Cartão Compras Online",
      estabelecimento: "Amazon Brasil",
      categoria: "E-commerce",
      valor: 129.90,
      tipo: "Débito",
      status: "Aprovada",
      mcc: "5732"
    },
    {
      id: "2",
      data: "21/02/2024",
      hora: "09:15",
      cartao: "**** **** **** 5678",
      nomeCartao: "Cartão Assinaturas",
      estabelecimento: "Netflix",
      categoria: "Streaming",
      valor: 45.90,
      tipo: "Débito",
      status: "Aprovada",
      mcc: "5815"
    },
    {
      id: "3",
      data: "20/02/2024",
      hora: "16:42",
      cartao: "**** **** **** 3456",
      nomeCartao: "Cartão Fornecedores",
      estabelecimento: "Fornecedor XYZ Ltda",
      categoria: "B2B",
      valor: 2500.00,
      tipo: "Débito",
      status: "Aprovada",
      mcc: "5399"
    },
    {
      id: "4",
      data: "19/02/2024",
      hora: "11:28",
      cartao: "**** **** **** 1234",
      nomeCartao: "Cartão Compras Online",
      estabelecimento: "Shopee",
      categoria: "E-commerce",
      valor: 89.00,
      tipo: "Débito",
      status: "Negada",
      mcc: "5732"
    },
    {
      id: "5",
      data: "18/02/2024",
      hora: "20:15",
      cartao: "**** **** **** 5678",
      nomeCartao: "Cartão Assinaturas",
      estabelecimento: "Spotify",
      categoria: "Streaming",
      valor: 16.90,
      tipo: "Débito",
      status: "Aprovada",
      mcc: "5815"
    },
    {
      id: "6",
      data: "17/02/2024",
      hora: "13:20",
      cartao: "**** **** **** 1234",
      nomeCartao: "Cartão Compras Online",
      estabelecimento: "Mercado Livre",
      categoria: "E-commerce",
      valor: 345.50,
      tipo: "Débito",
      status: "Aprovada",
      mcc: "5732"
    },
    {
      id: "7",
      data: "16/02/2024",
      hora: "08:45",
      cartao: "**** **** **** 3456",
      nomeCartao: "Cartão Fornecedores",
      estabelecimento: "Software House ABC",
      categoria: "Serviços TI",
      valor: 1200.00,
      tipo: "Débito",
      status: "Aprovada",
      mcc: "7372"
    },
    {
      id: "8",
      data: "15/02/2024",
      hora: "19:33",
      cartao: "**** **** **** 1234",
      nomeCartao: "Cartão Compras Online",
      estabelecimento: "iFood",
      categoria: "Alimentação",
      valor: 67.80,
      tipo: "Débito",
      status: "Aprovada",
      mcc: "5812"
    }
  ]

  const getStatusColor = (status: string) => {
    switch (status) {
      case "Aprovada": return "bg-green-100 text-green-800"
      case "Negada": return "bg-red-100 text-red-800"
      case "Pendente": return "bg-yellow-100 text-yellow-800"
      case "Estornada": return "bg-blue-100 text-blue-800"
      default: return "bg-gray-100 text-gray-800"
    }
  }

  const getCategoriaColor = (categoria: string) => {
    switch (categoria) {
      case "E-commerce": return "text-blue-600"
      case "Streaming": return "text-purple-600"
      case "B2B": return "text-orange-600"
      case "Alimentação": return "text-green-600"
      case "Serviços TI": return "text-indigo-600"
      default: return "text-gray-600"
    }
  }

  const formatarMoeda = (valor: number) => {
    return valor.toLocaleString('pt-BR', { 
      style: 'currency', 
      currency: 'BRL' 
    })
  }

  // Cálculos para os cards de estatísticas
  const totalTransacoes = transacoes.length
  const transacoesAprovadas = transacoes.filter(t => t.status === "Aprovada").length
  const valorTotal = transacoes
    .filter(t => t.status === "Aprovada")
    .reduce((acc, curr) => acc + curr.valor, 0)
  
  const hoje = new Date()
  const transacoesHoje = transacoes.filter(t => {
    const dataTransacao = new Date(t.data.split("/").reverse().join("-"))
    return dataTransacao.toDateString() === hoje.toDateString()
  }).length

  // Análise por categoria
  const gastosPorCategoria = transacoes
    .filter(t => t.status === "Aprovada")
    .reduce((acc, curr) => {
      acc[curr.categoria] = (acc[curr.categoria] || 0) + curr.valor
      return acc
    }, {} as Record<string, number>)

  return (
    <div className="space-y-8 max-w-7xl">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Extratos dos Cartões</h1>
          <p className="text-muted-foreground mt-2">
            Visualize e analise todas as transações dos seus cartões virtuais
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2">
            <Filter className="h-4 w-4" />
            Filtros
          </Button>
          <Button className="gap-2">
            <Download className="h-4 w-4" />
            Exportar
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total de Transações</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalTransacoes}</div>
            <p className="text-xs text-muted-foreground">
              {transacoesHoje} hoje
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Valor Total</CardTitle>
            <DollarSign className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatarMoeda(valorTotal)}</div>
            <p className="text-xs text-muted-foreground">
              Este mês
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Taxa de Aprovação</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {((transacoesAprovadas / totalTransacoes) * 100).toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground">
              {transacoesAprovadas} de {totalTransacoes}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ticket Médio</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatarMoeda(valorTotal / transacoesAprovadas)}
            </div>
            <p className="text-xs text-muted-foreground">
              Por transação
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filtros */}
      <Card>
        <CardHeader>
          <CardTitle>Filtrar Transações</CardTitle>
          <CardDescription>
            Use os filtros para encontrar transações específicas
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className="space-y-2">
              <Label htmlFor="dataInicio">Data Início</Label>
              <Input type="date" id="dataInicio" />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="dataFim">Data Fim</Label>
              <Input type="date" id="dataFim" />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="cartaoFiltro">Cartão</Label>
              <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background">
                <option value="">Todos os cartões</option>
                <option value="1234">**** 1234 - Compras Online</option>
                <option value="5678">**** 5678 - Assinaturas</option>
                <option value="3456">**** 3456 - Fornecedores</option>
              </select>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="statusFiltro">Status</Label>
              <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background">
                <option value="">Todos os status</option>
                <option value="aprovada">Aprovada</option>
                <option value="negada">Negada</option>
                <option value="pendente">Pendente</option>
              </select>
            </div>
            
            <div className="flex items-end">
              <Button className="w-full gap-2">
                <Search className="h-4 w-4" />
                Buscar
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Gastos por Categoria */}
      <Card>
        <CardHeader>
          <CardTitle>Gastos por Categoria</CardTitle>
          <CardDescription>
            Distribuição dos gastos por categoria de estabelecimento
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {Object.entries(gastosPorCategoria)
              .sort(([,a], [,b]) => b - a)
              .map(([categoria, valor]) => (
                <Card key={categoria}>
                  <CardContent className="p-4 text-center">
                    <div className={`text-sm font-medium ${getCategoriaColor(categoria)} mb-1`}>
                      {categoria}
                    </div>
                    <div className="text-lg font-bold">{formatarMoeda(valor)}</div>
                    <div className="text-xs text-muted-foreground">
                      {((valor / valorTotal) * 100).toFixed(1)}% do total
                    </div>
                  </CardContent>
                </Card>
              ))}
          </div>
        </CardContent>
      </Card>

      {/* Tabela de Transações */}
      <Card>
        <CardHeader>
          <CardTitle>Histórico de Transações</CardTitle>
          <CardDescription>
            Todas as transações realizadas com seus cartões virtuais
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data/Hora</TableHead>
                <TableHead>Cartão</TableHead>
                <TableHead>Estabelecimento</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>MCC</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transacoes.map((transacao) => (
                <TableRow key={transacao.id}>
                  <TableCell>
                    <div>
                      <div className="font-medium">{transacao.data}</div>
                      <div className="text-sm text-muted-foreground">{transacao.hora}</div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div>
                      <div className="font-mono text-sm">{transacao.cartao}</div>
                      <div className="text-xs text-muted-foreground">{transacao.nomeCartao}</div>
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">{transacao.estabelecimento}</TableCell>
                  <TableCell>
                    <span className={`text-sm ${getCategoriaColor(transacao.categoria)}`}>
                      {transacao.categoria}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className={`font-semibold ${
                      transacao.tipo === "Débito" 
                        ? transacao.status === "Aprovada" ? "text-red-600" : "text-muted-foreground"
                        : "text-green-600"
                    }`}>
                      {transacao.tipo === "Débito" ? "-" : "+"}
                      {formatarMoeda(transacao.valor)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge className={getStatusColor(transacao.status)} variant="secondary">
                      {transacao.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{transacao.mcc}</TableCell>
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

      {/* Resumo Mensal */}
      <Card>
        <CardHeader>
          <CardTitle>Resumo do Período</CardTitle>
          <CardDescription>
            Análise consolidada das transações no período selecionado
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Total de Transações:</span>
                <span className="font-bold">{totalTransacoes}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Transações Aprovadas:</span>
                <span className="font-bold text-green-600">{transacoesAprovadas}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Transações Negadas:</span>
                <span className="font-bold text-red-600">{totalTransacoes - transacoesAprovadas}</span>
              </div>
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Valor Total:</span>
                <span className="font-bold">{formatarMoeda(valorTotal)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Maior Transação:</span>
                <span className="font-bold">
                  {formatarMoeda(Math.max(...transacoes.filter(t => t.status === "Aprovada").map(t => t.valor)))}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Menor Transação:</span>
                <span className="font-bold">
                  {formatarMoeda(Math.min(...transacoes.filter(t => t.status === "Aprovada").map(t => t.valor)))}
                </span>
              </div>
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Categoria Principal:</span>
                <span className="font-bold">
                  {Object.entries(gastosPorCategoria).sort(([,a], [,b]) => b - a)[0]?.[0] || "N/A"}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Estabelecimentos:</span>
                <span className="font-bold">
                  {[...new Set(transacoes.map(t => t.estabelecimento))].length}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Cartões Utilizados:</span>
                <span className="font-bold">
                  {[...new Set(transacoes.map(t => t.cartao))].length}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default ExtratosCartoes