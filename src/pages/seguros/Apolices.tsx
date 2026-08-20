import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Shield, Calendar, Download, Eye, RefreshCw, FileText, AlertTriangle } from "lucide-react"
import { PreviewBanner } from "@/components/shared/preview-banner"

const Apolices = () => {
  const apolices = [
    {
      id: "1",
      numero: "AP-2024-001",
      produto: "Seguro Auto Premium",
      seguradora: "Porto Seguro",
      segurado: "João Silva Santos",
      objeto: "Honda Civic 2022 - ABC-1234",
      valorSegurado: "R$ 85.000,00",
      premio: "R$ 2.850,00",
      franquia: "R$ 2.800,00",
      vigenciaInicio: "15/01/2024",
      vigenciaFim: "15/01/2025",
      status: "Ativa",
      proximoVencimento: "15/03/2024",
      formaPagamento: "Mensal"
    },
    {
      id: "2", 
      numero: "AP-2024-002",
      produto: "Residencial Completo",
      seguradora: "Allianz",
      segurado: "Maria Oliveira",
      objeto: "Residência - Rua das Flores, 123",
      valorSegurado: "R$ 350.000,00",
      premio: "R$ 1.280,00",
      franquia: "R$ 850,00",
      vigenciaInicio: "01/02/2024",
      vigenciaFim: "01/02/2025",
      status: "Ativa",
      proximoVencimento: "01/04/2024",
      formaPagamento: "Anual"
    },
    {
      id: "3",
      numero: "AP-2023-089",
      produto: "Vida Familiar",
      seguradora: "SulAmérica",
      segurado: "Pedro Costa",
      objeto: "Seguro de Vida",
      valorSegurado: "R$ 200.000,00",
      premio: "R$ 980,00",
      franquia: "-",
      vigenciaInicio: "10/12/2023",
      vigenciaFim: "10/12/2024",
      status: "Vencida",
      proximoVencimento: "-",
      formaPagamento: "Anual"
    },
    {
      id: "4",
      numero: "AP-2024-003",
      produto: "Empresarial RC",
      seguradora: "Mapfre",
      segurado: "Tech Solutions LTDA",
      objeto: "Responsabilidade Civil Geral",
      valorSegurado: "R$ 500.000,00",
      premio: "R$ 4.500,00",
      franquia: "R$ 1.500,00",
      vigenciaInicio: "01/03/2024",
      vigenciaFim: "01/03/2025",
      status: "Pendente",
      proximoVencimento: "01/04/2024",
      formaPagamento: "Trimestral"
    }
  ]

  const getStatusColor = (status: string) => {
    switch (status) {
      case "Ativa": return "bg-green-100 text-green-800"
      case "Pendente": return "bg-yellow-100 text-yellow-800"
      case "Vencida": return "bg-red-100 text-red-800"
      case "Cancelada": return "bg-gray-100 text-gray-800"
      case "Suspensa": return "bg-orange-100 text-orange-800"
      default: return "bg-blue-100 text-blue-800"
    }
  }

  const getProdutoColor = (produto: string) => {
    if (produto.includes("Auto")) return "text-blue-600"
    if (produto.includes("Residencial")) return "text-green-600"
    if (produto.includes("Vida")) return "text-red-600"
    if (produto.includes("Empresarial")) return "text-orange-600"
    return "text-gray-600"
  }

  const diasParaVencimento = (data: string) => {
    if (data === "-") return 0
    const hoje = new Date()
    const vencimento = new Date(data.split("/").reverse().join("-"))
    const diffTime = vencimento.getTime() - hoje.getTime()
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
  }

  return (
    <div className="space-y-8 max-w-7xl">
      <PreviewBanner />
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Apólices de Seguro</h1>
          <p className="text-muted-foreground mt-2">
            Gerencie suas apólices ativas e acompanhe vencimentos
          </p>
        </div>
        <Button className="gap-2">
          <Shield className="h-4 w-4" />
          Nova Apólice
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Apólices Ativas</CardTitle>
            <Shield className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">18</div>
            <p className="text-xs text-muted-foreground">
              +3 este mês
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Valor Segurado</CardTitle>
            <Shield className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">R$ 2.8M</div>
            <p className="text-xs text-muted-foreground">
              Total protegido
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Próximos Vencimentos</CardTitle>
            <Calendar className="h-4 w-4 text-yellow-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">5</div>
            <p className="text-xs text-muted-foreground">
              Próximos 30 dias
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Prêmio Anual</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">R$ 45.890</div>
            <p className="text-xs text-muted-foreground">
              Total investido
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Alertas de Vencimento */}
      <Card className="border-yellow-200 bg-yellow-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-yellow-800">
            <AlertTriangle className="h-5 w-5" />
            Atenção: Vencimentos Próximos
          </CardTitle>
          <CardDescription className="text-yellow-700">
            Algumas apólices têm parcelas vencendo nos próximos dias
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex justify-between items-center p-3 bg-white rounded-lg border">
              <div>
                <div className="font-medium">Seguro Auto Premium - AP-2024-001</div>
                <div className="text-sm text-muted-foreground">João Silva Santos</div>
              </div>
              <div className="text-right">
                <div className="font-semibold text-red-600">15/03/2024</div>
                <div className="text-sm text-muted-foreground">R$ 237,50</div>
              </div>
            </div>
            <div className="flex justify-between items-center p-3 bg-white rounded-lg border">
              <div>
                <div className="font-medium">Empresarial RC - AP-2024-003</div>
                <div className="text-sm text-muted-foreground">Tech Solutions LTDA</div>
              </div>
              <div className="text-right">
                <div className="font-semibold text-yellow-600">01/04/2024</div>
                <div className="text-sm text-muted-foreground">R$ 1.125,00</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lista de Apólices */}
      <Card>
        <CardHeader>
          <CardTitle>Suas Apólices</CardTitle>
          <CardDescription>
            Visualize e gerencie todas as suas apólices de seguro
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Apólice/Produto</TableHead>
                <TableHead>Segurado/Objeto</TableHead>
                <TableHead>Seguradora</TableHead>
                <TableHead>Valor Segurado</TableHead>
                <TableHead>Vigência</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Próximo Venc.</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {apolices.map((apolice) => {
                const diasVenc = diasParaVencimento(apolice.proximoVencimento)
                return (
                  <TableRow key={apolice.id}>
                    <TableCell>
                      <div>
                        <div className="font-medium font-mono">{apolice.numero}</div>
                        <div className={`text-sm ${getProdutoColor(apolice.produto)}`}>
                          {apolice.produto}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <div className="font-medium">{apolice.segurado}</div>
                        <div className="text-sm text-muted-foreground">{apolice.objeto}</div>
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">{apolice.seguradora}</TableCell>
                    <TableCell>
                      <div className="font-semibold text-green-600">{apolice.valorSegurado}</div>
                      <div className="text-sm text-muted-foreground">
                        Prêmio: {apolice.premio}
                      </div>
                      {apolice.franquia !== "-" && (
                        <div className="text-xs text-muted-foreground">
                          Franquia: {apolice.franquia}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        <div>{apolice.vigenciaInicio}</div>
                        <div>até {apolice.vigenciaFim}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={getStatusColor(apolice.status)} variant="secondary">
                        {apolice.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {apolice.proximoVencimento !== "-" ? (
                        <div className={diasVenc <= 7 ? "text-red-600" : diasVenc <= 30 ? "text-yellow-600" : ""}>
                          <div>{apolice.proximoVencimento}</div>
                          <div className="text-xs text-muted-foreground">
                            {diasVenc > 0 ? `${diasVenc} dias` : "Vencido"}
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="ghost" size="sm">
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm">
                          <Download className="h-4 w-4" />
                        </Button>
                        {apolice.status === "Ativa" && (
                          <Button variant="ghost" size="sm">
                            <RefreshCw className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Resumo por Categoria */}
      <Card>
        <CardHeader>
          <CardTitle>Resumo por Categoria</CardTitle>
          <CardDescription>
            Distribuição das suas apólices por tipo de seguro
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center">
                    <Shield className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Automotivo</div>
                    <div className="text-lg font-bold">6 apólices</div>
                    <div className="text-xs text-green-600">R$ 980K segurados</div>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-green-100 text-green-600 rounded-full flex items-center justify-center">
                    <Shield className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Residencial</div>
                    <div className="text-lg font-bold">4 apólices</div>
                    <div className="text-xs text-green-600">R$ 1.2M segurados</div>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-red-100 text-red-600 rounded-full flex items-center justify-center">
                    <Shield className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Vida</div>
                    <div className="text-lg font-bold">5 apólices</div>
                    <div className="text-xs text-green-600">R$ 850K segurados</div>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center">
                    <Shield className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Empresarial</div>
                    <div className="text-lg font-bold">3 apólices</div>
                    <div className="text-xs text-green-600">R$ 1.5M segurados</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default Apolices