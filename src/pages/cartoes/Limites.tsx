import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Settings, TrendingUp, AlertTriangle, CreditCard, DollarSign, Plus } from "lucide-react"

const Limites = () => {
  const cartoes = [
    {
      id: "1",
      nome: "Cartão Compras Online",
      numero: "**** **** **** 1234",
      limiteTotal: 2500,
      limiteUtilizado: 650,
      limiteDisponivel: 1850,
      limiteDiario: 500,
      gastoDiario: 129.90,
      categoria: "E-commerce",
      status: "Normal"
    },
    {
      id: "2",
      nome: "Cartão Assinaturas",
      numero: "**** **** **** 5678",
      limiteTotal: 1000,
      limiteUtilizado: 280,
      limiteDisponivel: 720,
      limiteDiario: 200,
      gastoDiario: 45.90,
      categoria: "Serviços",
      status: "Normal"
    },
    {
      id: "3",
      nome: "Cartão Fornecedores",
      numero: "**** **** **** 3456",
      limiteTotal: 10000,
      limiteUtilizado: 6800,
      limiteDisponivel: 3200,
      limiteDiario: 2000,
      gastoDiario: 1800,
      categoria: "B2B",
      status: "Atenção"
    },
    {
      id: "4",
      nome: "Cartão Viagens",
      numero: "**** **** **** 9012",
      limiteTotal: 5000,
      limiteUtilizado: 0,
      limiteDisponivel: 5000,
      limiteDiario: 1000,
      gastoDiario: 0,
      categoria: "Turismo",
      status: "Bloqueado"
    }
  ]

  const alertasLimite = [
    {
      id: "1",
      cartao: "Cartão Fornecedores",
      tipo: "Limite Diário",
      percentual: 90,
      valor: "R$ 1.800,00",
      limite: "R$ 2.000,00",
      severidade: "Alto"
    },
    {
      id: "2",
      cartao: "Cartão Compras Online",
      tipo: "Limite Mensal",
      percentual: 75,
      valor: "R$ 650,00",
      limite: "R$ 2.500,00",
      severidade: "Médio"
    }
  ]

  const getStatusColor = (status: string) => {
    switch (status) {
      case "Normal": return "bg-green-100 text-green-800"
      case "Atenção": return "bg-yellow-100 text-yellow-800"
      case "Crítico": return "bg-red-100 text-red-800"
      case "Bloqueado": return "bg-gray-100 text-gray-800"
      default: return "bg-blue-100 text-blue-800"
    }
  }

  const getSeveridadeColor = (severidade: string) => {
    switch (severidade) {
      case "Alto": return "bg-red-100 text-red-800"
      case "Médio": return "bg-yellow-100 text-yellow-800"
      case "Baixo": return "bg-green-100 text-green-800"
      default: return "bg-blue-100 text-blue-800"
    }
  }

  const getCategoriaColor = (categoria: string) => {
    switch (categoria) {
      case "E-commerce": return "text-blue-600"
      case "Serviços": return "text-green-600"
      case "Turismo": return "text-orange-600"
      case "B2B": return "text-purple-600"
      default: return "text-gray-600"
    }
  }

  const calcularPercentual = (utilizado: number, total: number) => {
    return (utilizado / total) * 100
  }

  const formatarMoeda = (valor: number) => {
    return valor.toLocaleString('pt-BR', { 
      style: 'currency', 
      currency: 'BRL' 
    })
  }

  return (
    <div className="space-y-8 max-w-7xl">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Gestão de Limites</h1>
          <p className="text-muted-foreground mt-2">
            Controle e ajuste os limites dos seus cartões virtuais
          </p>
        </div>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          Solicitar Aumento
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Limite Total</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">R$ 18.500</div>
            <p className="text-xs text-muted-foreground">
              Todos os cartões
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Limite Utilizado</CardTitle>
            <DollarSign className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">R$ 7.730</div>
            <p className="text-xs text-muted-foreground">
              41.8% do total
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Limite Disponível</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">R$ 10.770</div>
            <p className="text-xs text-muted-foreground">
              58.2% do total
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Alertas Ativos</CardTitle>
            <AlertTriangle className="h-4 w-4 text-yellow-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">2</div>
            <p className="text-xs text-muted-foreground">
              Requerem atenção
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Alertas de Limite */}
      {alertasLimite.length > 0 && (
        <Card className="border-yellow-200 bg-yellow-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-yellow-800">
              <AlertTriangle className="h-5 w-5" />
              Alertas de Limite
            </CardTitle>
            <CardDescription className="text-yellow-700">
              Alguns cartões estão próximos do limite estabelecido
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {alertasLimite.map((alerta) => (
                <div key={alerta.id} className="flex justify-between items-center p-3 bg-white rounded-lg border">
                  <div>
                    <div className="font-medium">{alerta.cartao}</div>
                    <div className="text-sm text-muted-foreground">{alerta.tipo}</div>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center gap-2">
                      <Badge className={getSeveridadeColor(alerta.severidade)} variant="secondary">
                        {alerta.severidade}
                      </Badge>
                      <span className="font-semibold">{alerta.percentual}%</span>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {alerta.valor} de {alerta.limite}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Limites por Cartão */}
      <Card>
        <CardHeader>
          <CardTitle>Limites por Cartão</CardTitle>
          <CardDescription>
            Visualize e gerencie os limites de cada cartão virtual
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {cartoes.map((cartao) => {
              const percentualMensal = calcularPercentual(cartao.limiteUtilizado, cartao.limiteTotal)
              const percentualDiario = calcularPercentual(cartao.gastoDiario, cartao.limiteDiario)
              
              return (
                <Card key={cartao.id} className="p-4">
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <div>
                        <h3 className="font-medium text-lg">{cartao.nome}</h3>
                        <p className="text-sm text-muted-foreground">{cartao.numero}</p>
                        <span className={`text-sm ${getCategoriaColor(cartao.categoria)}`}>
                          {cartao.categoria}
                        </span>
                      </div>
                      <div className="text-right">
                        <Badge className={getStatusColor(cartao.status)} variant="secondary">
                          {cartao.status}
                        </Badge>
                        <div className="text-sm text-muted-foreground mt-1">
                          {formatarMoeda(cartao.limiteDisponivel)} disponível
                        </div>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* Limite Mensal */}
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="font-medium">Limite Mensal</span>
                          <span>{percentualMensal.toFixed(1)}% utilizado</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-3">
                          <div 
                            className={`h-3 rounded-full transition-all ${
                              percentualMensal >= 80 ? 'bg-red-500' : 
                              percentualMensal >= 60 ? 'bg-yellow-500' : 'bg-green-500'
                            }`}
                            style={{ width: `${percentualMensal}%` }}
                          ></div>
                        </div>
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>{formatarMoeda(cartao.limiteUtilizado)} utilizados</span>
                          <span>{formatarMoeda(cartao.limiteTotal)} total</span>
                        </div>
                      </div>
                      
                      {/* Limite Diário */}
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="font-medium">Limite Diário</span>
                          <span>{percentualDiario.toFixed(1)}% utilizado</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-3">
                          <div 
                            className={`h-3 rounded-full transition-all ${
                              percentualDiario >= 80 ? 'bg-red-500' : 
                              percentualDiario >= 60 ? 'bg-yellow-500' : 'bg-green-500'
                            }`}
                            style={{ width: `${percentualDiario}%` }}
                          ></div>
                        </div>
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>{formatarMoeda(cartao.gastoDiario)} gastos hoje</span>
                          <span>{formatarMoeda(cartao.limiteDiario)} limite diário</span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex gap-2 pt-2">
                      <Button variant="outline" size="sm" className="gap-1">
                        <Settings className="h-3 w-3" />
                        Ajustar Limite
                      </Button>
                      <Button variant="outline" size="sm">
                        Ver Histórico
                      </Button>
                      <Button variant="outline" size="sm">
                        Configurar Alertas
                      </Button>
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Configurações de Limite */}
      <Card>
        <CardHeader>
          <CardTitle>Configurar Novos Limites</CardTitle>
          <CardDescription>
            Ajuste os limites mensais e diários dos seus cartões
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="cartaoSelect">Selecionar Cartão</Label>
                <select 
                  id="cartaoSelect"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                >
                  <option value="">Escolha um cartão</option>
                  <option value="1">Cartão Compras Online - **** 1234</option>
                  <option value="2">Cartão Assinaturas - **** 5678</option>
                  <option value="3">Cartão Fornecedores - **** 3456</option>
                  <option value="4">Cartão Viagens - **** 9012</option>
                </select>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="limiteMensal">Novo Limite Mensal</Label>
                <Input id="limiteMensal" placeholder="R$ 0,00" />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="limiteDiario">Novo Limite Diário</Label>
                <Input id="limiteDiario" placeholder="R$ 0,00" />
              </div>
            </div>
            
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Configurações de Alerta</Label>
                <div className="space-y-2">
                  <label className="flex items-center space-x-2">
                    <input type="checkbox" className="rounded" defaultChecked />
                    <span className="text-sm">Alertar ao atingir 80% do limite</span>
                  </label>
                  <label className="flex items-center space-x-2">
                    <input type="checkbox" className="rounded" defaultChecked />
                    <span className="text-sm">Alertar ao atingir 90% do limite</span>
                  </label>
                  <label className="flex items-center space-x-2">
                    <input type="checkbox" className="rounded" />
                    <span className="text-sm">Bloquear automaticamente ao atingir 100%</span>
                  </label>
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="justificativa">Justificativa</Label>
                <textarea 
                  id="justificativa"
                  className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                  placeholder="Motivo para alteração do limite..."
                />
              </div>
            </div>
          </div>
          
          <div className="flex gap-4 mt-6">
            <Button className="gap-2">
              <Settings className="h-4 w-4" />
              Aplicar Alterações
            </Button>
            <Button variant="outline">
              Cancelar
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default Limites