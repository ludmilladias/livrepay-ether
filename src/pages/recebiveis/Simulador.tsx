import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Calculator, TrendingUp, DollarSign, Percent, Calendar } from "lucide-react"
import { useState } from "react"

const Simulador = () => {
  const [valor, setValor] = useState("")
  const [prazo, setPrazo] = useState("")
  const [taxa, setTaxa] = useState("")

  const valorAntecipar = parseFloat(valor.replace(/[^\d,]/g, '').replace(',', '.')) || 0
  const diasAntecipacao = parseInt(prazo) || 0
  const taxaMensal = parseFloat(taxa) || 2.5

  // Cálculo da simulação
  const taxaDiaria = taxaMensal / 30
  const desconto = (valorAntecipar * taxaDiaria * diasAntecipacao) / 100
  const valorLiquido = valorAntecipar - desconto
  const iof = valorAntecipar * 0.0038 // IOF aproximado
  const valorFinal = valorLiquido - iof

  const simulacoes = [
    {
      prazo: "30 dias",
      taxa: "2.5%",
      valor: "R$ 10.000,00",
      desconto: "R$ 250,00",
      liquido: "R$ 9.712,00",
      economia: "Receba hoje"
    },
    {
      prazo: "60 dias", 
      taxa: "2.5%",
      valor: "R$ 10.000,00",
      desconto: "R$ 500,00",
      liquido: "R$ 9.462,00",
      economia: "2 meses antes"
    },
    {
      prazo: "90 dias",
      taxa: "2.5%",
      valor: "R$ 10.000,00",
      desconto: "R$ 750,00",
      liquido: "R$ 9.212,00",
      economia: "3 meses antes"
    }
  ]

  return (
    <div className="space-y-8 max-w-7xl">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Simulador de Antecipação</h1>
          <p className="text-muted-foreground mt-2">
            Simule a antecipação dos seus recebíveis e veja quanto você pode receber hoje
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Simulador */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calculator className="h-5 w-5" />
              Simular Antecipação
            </CardTitle>
            <CardDescription>
              Insira os dados para calcular o valor da antecipação
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="valor">Valor a Antecipar</Label>
              <Input
                id="valor"
                placeholder="R$ 0,00"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="prazo">Prazo de Antecipação (dias)</Label>
              <Select value={prazo} onValueChange={setPrazo}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o prazo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">30 dias</SelectItem>
                  <SelectItem value="60">60 dias</SelectItem>
                  <SelectItem value="90">90 dias</SelectItem>
                  <SelectItem value="120">120 dias</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="taxa">Taxa Mensal (%)</Label>
              <Input
                id="taxa"
                placeholder="2,5"
                value={taxa}
                onChange={(e) => setTaxa(e.target.value)}
              />
            </div>

            <Button className="w-full">
              Calcular Simulação
            </Button>
          </CardContent>
        </Card>

        {/* Resultado */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Resultado da Simulação
            </CardTitle>
            <CardDescription>
              Valores calculados com base nos dados informados
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between items-center p-3 bg-muted/30 rounded-lg">
                <span className="text-sm font-medium">Valor Original:</span>
                <span className="font-bold">R$ {valorAntecipar.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
              </div>

              <div className="flex justify-between items-center p-3 bg-red-50 rounded-lg">
                <span className="text-sm font-medium">Desconto ({diasAntecipacao} dias):</span>
                <span className="font-bold text-red-600">- R$ {desconto.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
              </div>

              <div className="flex justify-between items-center p-3 bg-red-50 rounded-lg">
                <span className="text-sm font-medium">IOF:</span>
                <span className="font-bold text-red-600">- R$ {iof.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
              </div>

              <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg border border-green-200">
                <span className="text-sm font-medium">Valor Líquido:</span>
                <span className="font-bold text-green-600 text-lg">R$ {valorFinal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
              </div>

              <Button className="w-full" size="lg">
                Solicitar Antecipação
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Exemplos de Simulação */}
      <Card>
        <CardHeader>
          <CardTitle>Exemplos de Simulação</CardTitle>
          <CardDescription>
            Veja alguns exemplos de antecipação com diferentes prazos
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {simulacoes.map((simulacao, index) => (
              <Card key={index} className="border-l-4 border-l-primary">
                <CardContent className="p-4">
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Prazo:</span>
                      <span className="font-medium">{simulacao.prazo}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Taxa:</span>
                      <span className="font-medium">{simulacao.taxa}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Valor:</span>
                      <span className="font-medium">{simulacao.valor}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Desconto:</span>
                      <span className="font-medium text-red-600">{simulacao.desconto}</span>
                    </div>
                    <div className="flex justify-between items-center border-t pt-2">
                      <span className="text-sm font-medium">Você recebe:</span>
                      <span className="font-bold text-green-600">{simulacao.liquido}</span>
                    </div>
                    <div className="text-center">
                      <span className="text-xs text-primary font-medium">{simulacao.economia}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Informações Importantes */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Informações Importantes
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-medium mb-2">Como Funciona:</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Você antecipa seus recebíveis futuros</li>
                <li>• Recebe o valor hoje, descontada a taxa</li>
                <li>• Melhora seu fluxo de caixa imediatamente</li>
                <li>• Sem burocracia ou análise de crédito</li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium mb-2">Taxas e Custos:</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Taxa mensal a partir de 2,5%</li>
                <li>• IOF conforme legislação vigente</li>
                <li>• Sem taxas de abertura ou manutenção</li>
                <li>• Aprovação em até 24 horas</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default Simulador