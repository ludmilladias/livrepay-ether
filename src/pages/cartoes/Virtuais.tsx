import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Plus, CreditCard, Eye, Lock, Unlock, Copy, Settings, Shield } from "lucide-react"

const Virtuais = () => {
  const cartoes = [
    {
      id: "1",
      numero: "**** **** **** 1234",
      nome: "Cartão Compras Online",
      categoria: "E-commerce",
      limite: "R$ 2.500,00",
      limiteDisponivel: "R$ 1.850,00",
      status: "Ativo",
      dataCriacao: "15/02/2024",
      dataExpiracao: "15/02/2025",
      cvv: "***",
      cor: "bg-gradient-to-r from-blue-500 to-purple-600",
      gastoMes: "R$ 650,00"
    },
    {
      id: "2",
      numero: "**** **** **** 5678",
      nome: "Cartão Assinaturas",
      categoria: "Serviços",
      limite: "R$ 1.000,00",
      limiteDisponivel: "R$ 720,00",
      status: "Ativo",
      dataCriacao: "10/02/2024",
      dataExpiracao: "10/02/2025",
      cvv: "***",
      cor: "bg-gradient-to-r from-green-500 to-teal-600",
      gastoMes: "R$ 280,00"
    },
    {
      id: "3",
      numero: "**** **** **** 9012",
      nome: "Cartão Viagens",
      categoria: "Turismo",
      limite: "R$ 5.000,00",
      limiteDisponivel: "R$ 5.000,00",
      status: "Bloqueado",
      dataCriacao: "20/01/2024",
      dataExpiracao: "20/01/2025",
      cvv: "***",
      cor: "bg-gradient-to-r from-orange-500 to-red-600",
      gastoMes: "R$ 0,00"
    },
    {
      id: "4",
      numero: "**** **** **** 3456",
      nome: "Cartão Fornecedores",
      categoria: "B2B",
      limite: "R$ 10.000,00",
      limiteDisponivel: "R$ 3.200,00",
      status: "Ativo",
      dataCriacao: "05/02/2024",
      dataExpiracao: "05/02/2025",
      cvv: "***",
      cor: "bg-gradient-to-r from-purple-500 to-pink-600",
      gastoMes: "R$ 6.800,00"
    }
  ]

  const transacoes = [
    {
      id: "1",
      cartao: "**** 1234",
      estabelecimento: "Amazon Brasil",
      valor: "R$ 129,90",
      data: "22/02/2024",
      status: "Aprovada",
      categoria: "E-commerce"
    },
    {
      id: "2",
      cartao: "**** 5678",
      estabelecimento: "Netflix",
      valor: "R$ 45,90",
      data: "21/02/2024",
      status: "Aprovada",
      categoria: "Serviços"
    },
    {
      id: "3",
      cartao: "**** 3456",
      estabelecimento: "Fornecedor XYZ",
      valor: "R$ 2.500,00",
      data: "20/02/2024",
      status: "Aprovada",
      categoria: "B2B"
    },
    {
      id: "4",
      cartao: "**** 1234",
      estabelecimento: "Shopee",
      valor: "R$ 89,00",
      data: "19/02/2024",
      status: "Negada",
      categoria: "E-commerce"
    }
  ]

  const getStatusColor = (status: string) => {
    switch (status) {
      case "Ativo": return "bg-green-100 text-green-800"
      case "Bloqueado": return "bg-red-100 text-red-800"
      case "Suspenso": return "bg-yellow-100 text-yellow-800"
      case "Expirado": return "bg-gray-100 text-gray-800"
      case "Aprovada": return "bg-green-100 text-green-800"
      case "Negada": return "bg-red-100 text-red-800"
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

  const calcularPercentualGasto = (gasto: string, limite: string) => {
    const gastoNum = parseFloat(gasto.replace(/[^\d,]/g, '').replace(',', '.'))
    const limiteNum = parseFloat(limite.replace(/[^\d,]/g, '').replace(',', '.'))
    return (gastoNum / limiteNum) * 100
  }

  return (
    <div className="space-y-8 max-w-7xl">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Cartões Virtuais</h1>
          <p className="text-muted-foreground mt-2">
            Crie e gerencie cartões virtuais para diferentes finalidades
          </p>
        </div>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          Criar Cartão Virtual
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Cartões Ativos</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">12</div>
            <p className="text-xs text-muted-foreground">
              +3 este mês
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Limite Total</CardTitle>
            <CreditCard className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">R$ 45.500</div>
            <p className="text-xs text-muted-foreground">
              Todos os cartões
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Gasto Este Mês</CardTitle>
            <CreditCard className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">R$ 12.850</div>
            <p className="text-xs text-muted-foreground">
              28.2% do limite
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Transações</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">89</div>
            <p className="text-xs text-muted-foreground">
              Este mês
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Cartões Virtuais */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {cartoes.map((cartao) => {
          const percentualGasto = calcularPercentualGasto(cartao.gastoMes, cartao.limite)
          return (
            <Card key={cartao.id} className="relative overflow-hidden">
              <div className={`h-48 ${cartao.cor} text-white p-6 flex flex-col justify-between`}>
                <div className="flex justify-between items-start">
                  <div>
                    <div className="text-sm opacity-80">VIRTUAL CARD</div>
                    <div className="font-bold text-lg mt-1">{cartao.nome}</div>
                  </div>
                  <Badge 
                    className={cartao.status === "Ativo" ? "bg-white/20 text-white" : "bg-red-500 text-white"} 
                    variant="secondary"
                  >
                    {cartao.status}
                  </Badge>
                </div>
                
                <div>
                  <div className="text-xl font-mono tracking-wider mb-2">{cartao.numero}</div>
                  <div className="flex justify-between text-sm">
                    <div>
                      <div className="opacity-80">VÁLIDO ATÉ</div>
                      <div>{cartao.dataExpiracao.split("/").slice(1).join("/")}</div>
                    </div>
                    <div>
                      <div className="opacity-80">CVV</div>
                      <div>{cartao.cvv}</div>
                    </div>
                  </div>
                </div>
              </div>
              
              <CardContent className="p-4">
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Categoria:</span>
                    <span className={`text-sm font-medium ${getCategoriaColor(cartao.categoria)}`}>
                      {cartao.categoria}
                    </span>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Limite:</span>
                      <span className="font-medium">{cartao.limite}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Disponível:</span>
                      <span className="font-medium text-green-600">{cartao.limiteDisponivel}</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div 
                        className="bg-green-600 h-2 rounded-full transition-all" 
                        style={{ width: `${100 - percentualGasto}%` }}
                      ></div>
                    </div>
                  </div>
                  
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Gasto este mês:</span>
                    <span className="font-medium">{cartao.gastoMes}</span>
                  </div>
                  
                  <div className="flex gap-2 pt-2">
                    <Button variant="outline" size="sm" className="flex-1 gap-1">
                      <Eye className="h-3 w-3" />
                      Ver
                    </Button>
                    <Button variant="outline" size="sm" className="gap-1">
                      <Copy className="h-3 w-3" />
                    </Button>
                    <Button variant="outline" size="sm" className="gap-1">
                      {cartao.status === "Ativo" ? (
                        <Lock className="h-3 w-3" />
                      ) : (
                        <Unlock className="h-3 w-3" />
                      )}
                    </Button>
                    <Button variant="outline" size="sm" className="gap-1">
                      <Settings className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Criar Novo Cartão */}
      <Card>
        <CardHeader>
          <CardTitle>Criar Novo Cartão Virtual</CardTitle>
          <CardDescription>
            Configure um novo cartão virtual para suas necessidades específicas
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="nomeCartao">Nome do Cartão</Label>
                <Input id="nomeCartao" placeholder="Ex: Cartão Marketing Online" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="categoria">Categoria</Label>
                <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background">
                  <option value="">Selecione a categoria</option>
                  <option value="ecommerce">E-commerce</option>
                  <option value="servicos">Serviços</option>
                  <option value="turismo">Turismo</option>
                  <option value="b2b">B2B</option>
                  <option value="pessoal">Pessoal</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="limite">Limite do Cartão</Label>
                <Input id="limite" placeholder="R$ 0,00" />
              </div>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="validade">Período de Validade</Label>
                <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background">
                  <option value="12">12 meses</option>
                  <option value="6">6 meses</option>
                  <option value="3">3 meses</option>
                  <option value="1">1 mês</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cor">Cor do Cartão</Label>
                <div className="flex gap-2">
                  <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-purple-600 rounded cursor-pointer border-2 border-transparent hover:border-primary"></div>
                  <div className="w-8 h-8 bg-gradient-to-r from-green-500 to-teal-600 rounded cursor-pointer border-2 border-transparent hover:border-primary"></div>
                  <div className="w-8 h-8 bg-gradient-to-r from-orange-500 to-red-600 rounded cursor-pointer border-2 border-transparent hover:border-primary"></div>
                  <div className="w-8 h-8 bg-gradient-to-r from-purple-500 to-pink-600 rounded cursor-pointer border-2 border-transparent hover:border-primary"></div>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Configurações de Segurança</Label>
                <div className="space-y-2">
                  <label className="flex items-center space-x-2">
                    <input type="checkbox" className="rounded" />
                    <span className="text-sm">Bloquear compras internacionais</span>
                  </label>
                  <label className="flex items-center space-x-2">
                    <input type="checkbox" className="rounded" />
                    <span className="text-sm">Notificações por email</span>
                  </label>
                  <label className="flex items-center space-x-2">
                    <input type="checkbox" className="rounded" />
                    <span className="text-sm">Limite diário personalizado</span>
                  </label>
                </div>
              </div>
            </div>
          </div>
          <div className="flex gap-4 mt-6">
            <Button className="gap-2">
              <CreditCard className="h-4 w-4" />
              Criar Cartão Virtual
            </Button>
            <Button variant="outline">
              Cancelar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Últimas Transações */}
      <Card>
        <CardHeader>
          <CardTitle>Últimas Transações</CardTitle>
          <CardDescription>
            Acompanhe as transações mais recentes dos seus cartões virtuais
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cartão</TableHead>
                <TableHead>Estabelecimento</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transacoes.map((transacao) => (
                <TableRow key={transacao.id}>
                  <TableCell className="font-mono">{transacao.cartao}</TableCell>
                  <TableCell className="font-medium">{transacao.estabelecimento}</TableCell>
                  <TableCell className="font-semibold text-green-600">{transacao.valor}</TableCell>
                  <TableCell>{transacao.data}</TableCell>
                  <TableCell>
                    <span className={`text-sm ${getCategoriaColor(transacao.categoria)}`}>
                      {transacao.categoria}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge className={getStatusColor(transacao.status)} variant="secondary">
                      {transacao.status}
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

export default Virtuais