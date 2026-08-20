import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Shield, Car, Home, Heart, Briefcase, Search, Filter, Plus } from "lucide-react"

const Catalogo = () => {
  const seguros = [
    {
      id: "1",
      nome: "Seguro Auto Premium",
      seguradora: "Porto Seguro",
      categoria: "Automotivo",
      cobertura: "Compreensiva",
      valorMinimo: "R$ 89,90",
      valorMaximo: "R$ 450,00",
      descricao: "Cobertura completa para seu veículo com assistência 24h",
      beneficios: ["Assistência 24h", "Carro reserva", "Guincho ilimitado", "Vidros"],
      destaque: true
    },
    {
      id: "2",
      nome: "Residencial Completo",
      seguradora: "Allianz",
      categoria: "Residencial",
      cobertura: "Ampla",
      valorMinimo: "R$ 35,90",
      valorMaximo: "R$ 180,00",
      descricao: "Proteção total para sua casa e bens",
      beneficios: ["Incêndio e raio", "Roubo", "Danos elétricos", "Responsabilidade civil"],
      destaque: false
    },
    {
      id: "3",
      nome: "Vida Familiar",
      seguradora: "SulAmérica",
      categoria: "Vida",
      cobertura: "Básica + Acidentes",
      valorMinimo: "R$ 25,00",
      valorMaximo: "R$ 120,00",
      descricao: "Proteção para você e sua família",
      beneficios: ["Morte natural", "Morte acidental", "Invalidez", "Assistência funeral"],
      destaque: true
    },
    {
      id: "4",
      nome: "Saúde Empresarial",
      seguradora: "Bradesco Seguros",
      categoria: "Saúde",
      cobertura: "Nacional",
      valorMinimo: "R$ 180,00",
      valorMaximo: "R$ 850,00",
      descricao: "Plano de saúde corporativo com ampla rede",
      beneficios: ["Consultas ilimitadas", "Exames", "Internações", "Urgência e emergência"],
      destaque: false
    },
    {
      id: "5",
      nome: "Empresarial RC",
      seguradora: "Mapfre",
      categoria: "Empresarial",
      cobertura: "Responsabilidade Civil",
      valorMinimo: "R$ 45,00",
      valorMaximo: "R$ 380,00",
      descricao: "Responsabilidade civil para empresas",
      beneficios: ["RC geral", "RC profissional", "RC produtos", "Defesa jurídica"],
      destaque: false
    },
    {
      id: "6",
      nome: "Viagem Internacional",
      seguradora: "Travel Ace",
      categoria: "Viagem",
      cobertura: "Mundial",
      valorMinimo: "R$ 15,90",
      valorMaximo: "R$ 89,90",
      descricao: "Cobertura completa para suas viagens",
      beneficios: ["Despesas médicas", "Bagagem", "Cancelamento", "Assistência 24h"],
      destaque: true
    }
  ]

  const getCategoriaIcon = (categoria: string) => {
    switch (categoria) {
      case "Automotivo": return Car
      case "Residencial": return Home
      case "Vida": return Heart
      case "Saúde": return Heart
      case "Empresarial": return Briefcase
      case "Viagem": return Shield
      default: return Shield
    }
  }

  const getCategoriaColor = (categoria: string) => {
    switch (categoria) {
      case "Automotivo": return "text-blue-600 bg-blue-50"
      case "Residencial": return "text-green-600 bg-green-50"
      case "Vida": return "text-red-600 bg-red-50"
      case "Saúde": return "text-purple-600 bg-purple-50"
      case "Empresarial": return "text-orange-600 bg-orange-50"
      case "Viagem": return "text-cyan-600 bg-cyan-50"
      default: return "text-gray-600 bg-gray-50"
    }
  }

  return (
    <div className="space-y-8 max-w-7xl">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Catálogo de Seguros</h1>
          <p className="text-muted-foreground mt-2">
            Explore nossa completa linha de seguros e encontre a proteção ideal
          </p>
        </div>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          Solicitar Cotação
        </Button>
      </div>

      {/* Filtros */}
      <Card>
        <CardHeader>
          <CardTitle>Filtrar Seguros</CardTitle>
          <CardDescription>
            Use os filtros para encontrar o seguro ideal para suas necessidades
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label htmlFor="categoria">Categoria</Label>
              <Select>
                <SelectTrigger>
                  <SelectValue placeholder="Todas as categorias" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="automotivo">Automotivo</SelectItem>
                  <SelectItem value="residencial">Residencial</SelectItem>
                  <SelectItem value="vida">Vida</SelectItem>
                  <SelectItem value="saude">Saúde</SelectItem>
                  <SelectItem value="empresarial">Empresarial</SelectItem>
                  <SelectItem value="viagem">Viagem</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="seguradora">Seguradora</Label>
              <Select>
                <SelectTrigger>
                  <SelectValue placeholder="Todas as seguradoras" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="porto">Porto Seguro</SelectItem>
                  <SelectItem value="allianz">Allianz</SelectItem>
                  <SelectItem value="sulamerica">SulAmérica</SelectItem>
                  <SelectItem value="bradesco">Bradesco Seguros</SelectItem>
                  <SelectItem value="mapfre">Mapfre</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="valorMax">Valor Máximo</Label>
              <Input id="valorMax" placeholder="R$ 0,00" />
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

      {/* Categorias Populares */}
      <Card>
        <CardHeader>
          <CardTitle>Categorias Populares</CardTitle>
          <CardDescription>
            Acesse rapidamente as categorias mais procuradas
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {["Automotivo", "Residencial", "Vida", "Saúde", "Empresarial", "Viagem"].map((categoria) => {
              const Icon = getCategoriaIcon(categoria)
              const colorClass = getCategoriaColor(categoria)
              return (
                <Card key={categoria} className="cursor-pointer hover:shadow-md transition-shadow">
                  <CardContent className="p-4 text-center">
                    <div className={`w-12 h-12 rounded-full ${colorClass} flex items-center justify-center mx-auto mb-2`}>
                      <Icon className="h-6 w-6" />
                    </div>
                    <div className="text-sm font-medium">{categoria}</div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Lista de Seguros */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {seguros.map((seguro) => {
          const Icon = getCategoriaIcon(seguro.categoria)
          const colorClass = getCategoriaColor(seguro.categoria)
          return (
            <Card key={seguro.id} className={`relative ${seguro.destaque ? 'ring-2 ring-primary' : ''}`}>
              {seguro.destaque && (
                <div className="absolute -top-2 left-4">
                  <Badge className="bg-primary text-primary-foreground">Destaque</Badge>
                </div>
              )}
              
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full ${colorClass} flex items-center justify-center`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">{seguro.nome}</CardTitle>
                    <CardDescription>{seguro.seguradora}</CardDescription>
                  </div>
                </div>
              </CardHeader>
              
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <Badge variant="secondary" className={colorClass}>
                      {seguro.categoria}
                    </Badge>
                  </div>
                  
                  <p className="text-sm text-muted-foreground">{seguro.descricao}</p>
                  
                  <div>
                    <div className="text-sm text-muted-foreground mb-1">Cobertura:</div>
                    <div className="font-medium">{seguro.cobertura}</div>
                  </div>
                  
                  <div>
                    <div className="text-sm text-muted-foreground mb-2">Principais benefícios:</div>
                    <ul className="text-sm space-y-1">
                      {seguro.beneficios.slice(0, 3).map((beneficio, index) => (
                        <li key={index} className="flex items-center gap-2">
                          <Shield className="h-3 w-3 text-green-600" />
                          {beneficio}
                        </li>
                      ))}
                    </ul>
                  </div>
                  
                  <div className="border-t pt-4">
                    <div className="flex justify-between items-center mb-3">
                      <span className="text-sm text-muted-foreground">A partir de:</span>
                      <div className="text-right">
                        <div className="text-lg font-bold text-green-600">{seguro.valorMinimo}</div>
                        <div className="text-xs text-muted-foreground">por mês</div>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-2">
                      <Button variant="outline" size="sm">
                        Ver Detalhes
                      </Button>
                      <Button size="sm">
                        Cotar Agora
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Call to Action */}
      <Card className="bg-gradient-to-r from-primary/10 to-primary/5 border-primary/20">
        <CardContent className="p-8 text-center">
          <Shield className="h-12 w-12 text-primary mx-auto mb-4" />
          <h3 className="text-xl font-bold mb-2">Não encontrou o que procura?</h3>
          <p className="text-muted-foreground mb-4">
            Nossa equipe especializada pode ajudar você a encontrar a proteção ideal
          </p>
          <div className="flex gap-4 justify-center">
            <Button variant="outline">
              Falar com Especialista
            </Button>
            <Button>
              Cotação Personalizada
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default Catalogo