import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Plus, Clock, CheckCircle, XCircle, FileText, Calculator } from "lucide-react"
import { PreviewBanner } from "@/components/shared/preview-banner"

const Cotacoes = () => {
  const cotacoes = [
    {
      id: "1",
      protocolo: "COT-2024-001",
      produto: "Seguro Auto Premium",
      seguradora: "Porto Seguro",
      cliente: "João Silva Santos",
      veiculo: "Honda Civic 2022",
      valorSeguro: "R$ 2.850,00",
      franquia: "R$ 2.800,00",
      vigencia: "12 meses",
      dataCotacao: "20/02/2024",
      validade: "05/03/2024",
      status: "Aguardando",
      observacoes: "Garage residencial"
    },
    {
      id: "2",
      protocolo: "COT-2024-002", 
      produto: "Residencial Completo",
      seguradora: "Allianz",
      cliente: "Maria Oliveira",
      veiculo: "-",
      valorSeguro: "R$ 1.280,00",
      franquia: "R$ 850,00",
      vigencia: "12 meses",
      dataCotacao: "18/02/2024",
      validade: "03/03/2024",
      status: "Aprovada",
      observacoes: "Casa de 150m²"
    },
    {
      id: "3",
      protocolo: "COT-2024-003",
      produto: "Vida Familiar",
      seguradora: "SulAmérica",
      cliente: "Pedro Costa",
      veiculo: "-",
      valorSeguro: "R$ 980,00",
      franquia: "-",
      vigencia: "12 meses",
      dataCotacao: "15/02/2024",
      validade: "Expirada",
      status: "Expirada",
      observacoes: "Cobertura para 3 pessoas"
    },
    {
      id: "4",
      protocolo: "COT-2024-004",
      produto: "Empresarial RC",
      seguradora: "Mapfre",
      cliente: "Tech Solutions LTDA",
      veiculo: "-",
      valorSeguro: "R$ 4.500,00",
      franquia: "R$ 1.500,00",
      vigencia: "12 meses",
      dataCotacao: "22/02/2024",
      validade: "07/03/2024",
      status: "Recusada",
      observacoes: "Empresa de tecnologia"
    }
  ]

  const getStatusColor = (status: string) => {
    switch (status) {
      case "Aprovada": return "bg-green-100 text-green-800"
      case "Aguardando": return "bg-yellow-100 text-yellow-800"
      case "Recusada": return "bg-red-100 text-red-800"
      case "Expirada": return "bg-gray-100 text-gray-800"
      case "Em Análise": return "bg-blue-100 text-blue-800"
      default: return "bg-gray-100 text-gray-800"
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "Aprovada": return CheckCircle
      case "Aguardando": return Clock
      case "Recusada": return XCircle
      case "Expirada": return Clock
      case "Em Análise": return Clock
      default: return Clock
    }
  }

  const getProdutoColor = (produto: string) => {
    if (produto.includes("Auto")) return "text-blue-600"
    if (produto.includes("Residencial")) return "text-green-600"
    if (produto.includes("Vida")) return "text-red-600"
    if (produto.includes("Empresarial")) return "text-orange-600"
    return "text-gray-600"
  }

  return (
    <div className="space-y-8 max-w-7xl">
      <PreviewBanner />
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Cotações de Seguros</h1>
          <p className="text-muted-foreground mt-2">
            Gerencie suas cotações e acompanhe o status das propostas
          </p>
        </div>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          Nova Cotação
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total de Cotações</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">67</div>
            <p className="text-xs text-muted-foreground">
              +12 este mês
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Aprovadas</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">45</div>
            <p className="text-xs text-muted-foreground">
              Taxa: 67.2%
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Aguardando</CardTitle>
            <Clock className="h-4 w-4 text-yellow-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">15</div>
            <p className="text-xs text-muted-foreground">
              Em análise
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Valor Médio</CardTitle>
            <Calculator className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">R$ 2.405</div>
            <p className="text-xs text-muted-foreground">
              Por cotação aprovada
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Processo de Cotação */}
      <Card>
        <CardHeader>
          <CardTitle>Como Funciona o Processo</CardTitle>
          <CardDescription>
            Entenda as etapas do processo de cotação de seguros
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="text-center">
              <div className="w-12 h-12 bg-primary rounded-full flex items-center justify-center mx-auto mb-3">
                <span className="text-white font-bold">1</span>
              </div>
              <h4 className="font-medium mb-2">Solicitação</h4>
              <p className="text-sm text-muted-foreground">
                Preencha os dados necessários para a cotação
              </p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 bg-primary rounded-full flex items-center justify-center mx-auto mb-3">
                <span className="text-white font-bold">2</span>
              </div>
              <h4 className="font-medium mb-2">Análise</h4>
              <p className="text-sm text-muted-foreground">
                A seguradora analisa seu perfil e calcula o prêmio
              </p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 bg-primary rounded-full flex items-center justify-center mx-auto mb-3">
                <span className="text-white font-bold">3</span>
              </div>
              <h4 className="font-medium mb-2">Proposta</h4>
              <p className="text-sm text-muted-foreground">
                Receba a proposta com valores e condições
              </p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 bg-primary rounded-full flex items-center justify-center mx-auto mb-3">
                <span className="text-white font-bold">4</span>
              </div>
              <h4 className="font-medium mb-2">Contratação</h4>
              <p className="text-sm text-muted-foreground">
                Aprove e efetue o pagamento para ativar a apólice
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lista de Cotações */}
      <Card>
        <CardHeader>
          <CardTitle>Suas Cotações</CardTitle>
          <CardDescription>
            Acompanhe o status de todas as suas cotações solicitadas
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Protocolo</TableHead>
                <TableHead>Produto/Cliente</TableHead>
                <TableHead>Seguradora</TableHead>
                <TableHead>Valor do Seguro</TableHead>
                <TableHead>Validade</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Observações</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cotacoes.map((cotacao) => {
                const StatusIcon = getStatusIcon(cotacao.status)
                return (
                  <TableRow key={cotacao.id}>
                    <TableCell>
                      <div className="font-medium font-mono">{cotacao.protocolo}</div>
                      <div className="text-sm text-muted-foreground">{cotacao.dataCotacao}</div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <div className={`font-medium ${getProdutoColor(cotacao.produto)}`}>
                          {cotacao.produto}
                        </div>
                        <div className="text-sm text-muted-foreground">{cotacao.cliente}</div>
                        {cotacao.veiculo !== "-" && (
                          <div className="text-xs text-muted-foreground">{cotacao.veiculo}</div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">{cotacao.seguradora}</TableCell>
                    <TableCell>
                      <div className="font-semibold text-green-600">{cotacao.valorSeguro}</div>
                      <div className="text-sm text-muted-foreground">
                        {cotacao.vigencia}
                      </div>
                      {cotacao.franquia !== "-" && (
                        <div className="text-xs text-muted-foreground">
                          Franquia: {cotacao.franquia}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className={cotacao.validade === "Expirada" ? "text-red-600" : ""}>
                        {cotacao.validade}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <StatusIcon className="h-4 w-4" />
                        <Badge className={getStatusColor(cotacao.status)} variant="secondary">
                          {cotacao.status}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {cotacao.observacoes}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="ghost" size="sm">
                          Ver Detalhes
                        </Button>
                        {cotacao.status === "Aprovada" && (
                          <Button size="sm">
                            Contratar
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

      {/* Dicas para Cotação */}
      <Card>
        <CardHeader>
          <CardTitle>Dicas para uma Boa Cotação</CardTitle>
          <CardDescription>
            Siga estas orientações para obter as melhores condições
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-medium mb-3">Informações Precisas:</h4>
              <ul className="text-sm text-muted-foreground space-y-2">
                <li>• Forneça dados exatos sobre o bem a ser segurado</li>
                <li>• Declare histórico de sinistros corretamente</li>
                <li>• Informe o perfil de uso (residencial, comercial, etc.)</li>
                <li>• Atualize dados cadastrais regularmente</li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium mb-3">Documentação:</h4>
              <ul className="text-sm text-muted-foreground space-y-2">
                <li>• Tenha documentos atualizados em mãos</li>
                <li>• Para veículos: CRLV, carteira de habilitação</li>
                <li>• Para imóveis: escritura, IPTU atualizado</li>
                <li>• Laudos técnicos quando aplicável</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default Cotacoes