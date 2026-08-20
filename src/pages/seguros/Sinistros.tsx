import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Plus, AlertTriangle, Clock, CheckCircle, XCircle, FileText, Camera, Upload } from "lucide-react"
import { PreviewBanner } from "@/components/shared/preview-banner"

const Sinistros = () => {
  const sinistros = [
    {
      id: "1",
      protocolo: "SIN-2024-001",
      apolice: "AP-2024-001",
      produto: "Seguro Auto Premium",
      seguradora: "Porto Seguro",
      tipoSinistro: "Colisão",
      dataOcorrencia: "10/02/2024",
      dataAbertura: "11/02/2024",
      valorEstimado: "R$ 8.500,00",
      valorAprovado: "R$ 7.200,00",
      status: "Aprovado",
      descricao: "Colisão traseira em cruzamento",
      franquia: "R$ 2.800,00"
    },
    {
      id: "2",
      protocolo: "SIN-2024-002", 
      apolice: "AP-2024-002",
      produto: "Residencial Completo",
      seguradora: "Allianz",
      tipoSinistro: "Roubo",
      dataOcorrencia: "05/02/2024",
      dataAbertura: "06/02/2024",
      valorEstimado: "R$ 15.000,00",
      valorAprovado: "-",
      status: "Em Análise",
      descricao: "Roubo de eletrônicos e móveis",
      franquia: "R$ 850,00"
    },
    {
      id: "3",
      protocolo: "SIN-2024-003",
      apolice: "AP-2023-089",
      produto: "Vida Familiar",
      seguradora: "SulAmérica",
      tipoSinistro: "Invalidez Parcial",
      dataOcorrencia: "25/01/2024",
      dataAbertura: "28/01/2024",
      valorEstimado: "R$ 50.000,00",
      valorAprovado: "-",
      status: "Documentação Pendente",
      descricao: "Acidente de trabalho com lesão no braço",
      franquia: "-"
    },
    {
      id: "4",
      protocolo: "SIN-2023-125",
      apolice: "AP-2023-045",
      produto: "Seguro Auto",
      seguradora: "Porto Seguro", 
      tipoSinistro: "Furto",
      dataOcorrencia: "15/12/2023",
      dataAbertura: "16/12/2023",
      valorEstimado: "R$ 45.000,00",
      valorAprovado: "R$ 42.000,00",
      status: "Pago",
      descricao: "Furto do veículo em estacionamento",
      franquia: "R$ 3.000,00"
    }
  ]

  const getStatusColor = (status: string) => {
    switch (status) {
      case "Aprovado": return "bg-green-100 text-green-800"
      case "Pago": return "bg-blue-100 text-blue-800"
      case "Em Análise": return "bg-yellow-100 text-yellow-800"
      case "Documentação Pendente": return "bg-orange-100 text-orange-800"
      case "Negado": return "bg-red-100 text-red-800"
      case "Cancelado": return "bg-gray-100 text-gray-800"
      default: return "bg-gray-100 text-gray-800"
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "Aprovado": return CheckCircle
      case "Pago": return CheckCircle
      case "Em Análise": return Clock
      case "Documentação Pendente": return FileText
      case "Negado": return XCircle
      case "Cancelado": return XCircle
      default: return Clock
    }
  }

  const getTipoColor = (tipo: string) => {
    switch (tipo) {
      case "Colisão": return "text-red-600"
      case "Roubo": return "text-orange-600"
      case "Furto": return "text-purple-600"
      case "Invalidez Parcial": return "text-blue-600"
      case "Incêndio": return "text-red-600"
      case "Danos Elétricos": return "text-yellow-600"
      default: return "text-gray-600"
    }
  }

  return (
    <div className="space-y-8 max-w-7xl">
      <PreviewBanner />
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Sinistros</h1>
          <p className="text-muted-foreground mt-2">
            Gerencie seus sinistros e acompanhe o andamento das indenizações
          </p>
        </div>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          Comunicar Sinistro
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total de Sinistros</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">23</div>
            <p className="text-xs text-muted-foreground">
              Este ano
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Aprovados</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">18</div>
            <p className="text-xs text-muted-foreground">
              Taxa: 78.3%
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Em Andamento</CardTitle>
            <Clock className="h-4 w-4 text-yellow-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">3</div>
            <p className="text-xs text-muted-foreground">
              Aguardando análise
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Valor Indenizado</CardTitle>
            <FileText className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">R$ 285.400</div>
            <p className="text-xs text-muted-foreground">
              Total recebido
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Comunicar Novo Sinistro */}
      <Card>
        <CardHeader>
          <CardTitle>Comunicar Novo Sinistro</CardTitle>
          <CardDescription>
            Relate um novo sinistro de forma rápida e fácil
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="apolice">Número da Apólice</Label>
                <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background">
                  <option value="">Selecione a apólice</option>
                  <option value="AP-2024-001">AP-2024-001 - Seguro Auto</option>
                  <option value="AP-2024-002">AP-2024-002 - Residencial</option>
                  <option value="AP-2024-003">AP-2024-003 - Empresarial</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="tipoSinistro">Tipo de Sinistro</Label>
                <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background">
                  <option value="">Selecione o tipo</option>
                  <option value="colisao">Colisão</option>
                  <option value="roubo">Roubo</option>
                  <option value="furto">Furto</option>
                  <option value="incendio">Incêndio</option>
                  <option value="danos-eletricos">Danos Elétricos</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="dataOcorrencia">Data da Ocorrência</Label>
                <input 
                  type="date" 
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                />
              </div>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="descricao">Descrição do Ocorrido</Label>
                <Textarea 
                  id="descricao" 
                  placeholder="Descreva detalhadamente o que aconteceu..." 
                  className="min-h-[120px]"
                />
              </div>
              <div className="space-y-2">
                <Label>Anexar Documentos</Label>
                <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-6 text-center">
                  <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground mb-2">
                    Arraste arquivos ou clique para selecionar
                  </p>
                  <p className="text-xs text-muted-foreground">
                    BO, fotos, laudos técnicos (PDF, JPG, PNG)
                  </p>
                </div>
              </div>
            </div>
          </div>
          <div className="flex gap-4 mt-6">
            <Button className="gap-2">
              <FileText className="h-4 w-4" />
              Comunicar Sinistro
            </Button>
            <Button variant="outline" className="gap-2">
              <Camera className="h-4 w-4" />
              Tirar Fotos
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Lista de Sinistros */}
      <Card>
        <CardHeader>
          <CardTitle>Histórico de Sinistros</CardTitle>
          <CardDescription>
            Acompanhe todos os seus sinistros e o status das indenizações
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Protocolo</TableHead>
                <TableHead>Apólice/Produto</TableHead>
                <TableHead>Tipo de Sinistro</TableHead>
                <TableHead>Data Ocorrência</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sinistros.map((sinistro) => {
                const StatusIcon = getStatusIcon(sinistro.status)
                return (
                  <TableRow key={sinistro.id}>
                    <TableCell>
                      <div className="font-medium font-mono">{sinistro.protocolo}</div>
                      <div className="text-sm text-muted-foreground">{sinistro.dataAbertura}</div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <div className="font-medium">{sinistro.apolice}</div>
                        <div className="text-sm text-muted-foreground">{sinistro.produto}</div>
                        <div className="text-xs text-muted-foreground">{sinistro.seguradora}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className={`font-medium ${getTipoColor(sinistro.tipoSinistro)}`}>
                        {sinistro.tipoSinistro}
                      </span>
                    </TableCell>
                    <TableCell>{sinistro.dataOcorrencia}</TableCell>
                    <TableCell>
                      <div>
                        <div className="font-semibold text-green-600">
                          {sinistro.valorAprovado !== "-" ? sinistro.valorAprovado : sinistro.valorEstimado}
                        </div>
                        {sinistro.valorAprovado !== "-" && sinistro.valorEstimado !== sinistro.valorAprovado && (
                          <div className="text-xs text-muted-foreground">
                            Est: {sinistro.valorEstimado}
                          </div>
                        )}
                        {sinistro.franquia !== "-" && (
                          <div className="text-xs text-muted-foreground">
                            Franquia: {sinistro.franquia}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <StatusIcon className="h-4 w-4" />
                        <Badge className={getStatusColor(sinistro.status)} variant="secondary">
                          {sinistro.status}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-xs">
                      <p className="text-sm text-muted-foreground truncate">
                        {sinistro.descricao}
                      </p>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="ghost" size="sm">
                          Ver Detalhes
                        </Button>
                        {sinistro.status === "Documentação Pendente" && (
                          <Button size="sm">
                            Enviar Docs
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

      {/* Guia de Sinistros */}
      <Card>
        <CardHeader>
          <CardTitle>Como Comunicar um Sinistro</CardTitle>
          <CardDescription>
            Passo a passo para comunicar seu sinistro corretamente
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-medium mb-3">Documentos Necessários:</h4>
              <ul className="text-sm text-muted-foreground space-y-2">
                <li>• Boletim de Ocorrência (quando aplicável)</li>
                <li>• Fotos do local e dos danos</li>
                <li>• Documentos do bem segurado</li>
                <li>• Laudo técnico (se necessário)</li>
                <li>• Comprovantes de propriedade</li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium mb-3">Prazos Importantes:</h4>
              <ul className="text-sm text-muted-foreground space-y-2">
                <li>• Comunicação: até 7 dias após o sinistro</li>
                <li>• Entrega de documentos: até 15 dias</li>
                <li>• Análise da seguradora: até 30 dias</li>
                <li>• Pagamento da indenização: até 30 dias após aprovação</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default Sinistros