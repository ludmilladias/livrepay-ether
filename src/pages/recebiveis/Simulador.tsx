import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Calculator, TrendingUp, DollarSign, Percent, Calendar } from "lucide-react"
import { useState } from "react"
import { Link } from "react-router-dom"

/** Valores de referência só para a conta da tela; as condições reais saem do contrato de antecipação. */
const TAXA_REFERENCIA = 2.5 // % ao mês, usada quando a pessoa não informa uma taxa
const IOF_REFERENCIA = 0.0038

const Simulador = () => {
  const [valor, setValor] = useState("")
  const [prazo, setPrazo] = useState("")
  const [taxa, setTaxa] = useState("")

  const valorAntecipar = parseFloat(valor.replace(/[^\d,]/g, '').replace(',', '.')) || 0
  const diasAntecipacao = parseInt(prazo) || 0
  // Aceita vírgula ("2,5"): parseFloat("2,5") sozinho daria 2.
  const taxaInformada = parseFloat(taxa.replace(",", "."))
  const taxaMensal = taxaInformada > 0 ? taxaInformada : TAXA_REFERENCIA

  // Cálculo da simulação — ESTIMATIVA DE REFERÊNCIA, não é oferta nem taxa contratada.
  const taxaDiaria = taxaMensal / 30
  const desconto = (valorAntecipar * taxaDiaria * diasAntecipacao) / 100
  const valorLiquido = valorAntecipar - desconto
  const iof = valorAntecipar * IOF_REFERENCIA // IOF aproximado (não é o valor real do contrato)
  const valorFinal = valorLiquido - iof

  return (
    <div className="space-y-8 max-w-7xl">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Simulador de Antecipação</h1>
          <p className="text-muted-foreground mt-2">
            Estime o desconto da antecipação dos seus recebíveis. É uma simulação de referência:
            não é uma oferta nem garante as condições do contrato.
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
              <Label htmlFor="taxa">Taxa mensal de referência (%)</Label>
              <Input
                id="taxa"
                inputMode="decimal"
                placeholder="2,5"
                value={taxa}
                onChange={(e) => setTaxa(e.target.value)}
                aria-describedby="taxa-hint"
              />
              <p id="taxa-hint" className="text-xs text-muted-foreground">
                Em branco, usamos {TAXA_REFERENCIA.toString().replace(".", ",")}% ao mês só como referência.
                A taxa real é definida na análise do recebível.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Resultado */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Resultado estimado
            </CardTitle>
            <CardDescription>
              Estimativa de referência com base nos dados informados. O resultado atualiza enquanto você digita.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between items-center p-3 bg-muted/30 rounded-lg">
                <span className="text-sm font-medium">Valor Original:</span>
                <span className="font-bold">R$ {valorAntecipar.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
              </div>

              <div className="flex justify-between items-center p-3 bg-destructive/10 rounded-lg">
                <span className="text-sm font-medium">Desconto ({diasAntecipacao} dias):</span>
                <span className="font-bold text-destructive">- R$ {desconto.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
              </div>

              <div className="flex justify-between items-center p-3 bg-destructive/10 rounded-lg">
                <span className="text-sm font-medium">IOF (estimativa):</span>
                <span className="font-bold text-destructive">- R$ {iof.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
              </div>

              <div className="flex justify-between items-center p-3 bg-success/10 rounded-lg border border-success/30">
                <span className="text-sm font-medium">Valor líquido estimado:</span>
                <span className="font-bold text-success text-lg">R$ {valorFinal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
              </div>

              <Button asChild className="w-full" size="lg">
                <Link to="/recebiveis/adiantamento">Ir para Adiantamento</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

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
                <li>• Melhora seu fluxo de caixa</li>
                <li>• Só recebíveis verificados podem ser antecipados</li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium mb-2">Taxas e custos:</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• A taxa e o IOF desta tela são estimativas de referência</li>
                <li>• As condições reais valem apenas as do contrato de antecipação</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default Simulador