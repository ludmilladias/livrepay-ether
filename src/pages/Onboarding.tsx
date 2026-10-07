import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useOnboardingStatus, useSubmitOnboarding, type PersonType } from "@/hooks/use-onboarding";
import { KycDocuments } from "@/components/onboarding/kyc-documents";
import { useAuth } from "@/hooks/use-auth";
import { ApiError } from "@/lib/api";

/** Só dígitos — a Ether aceita CPF/CNPJ/telefone/CEP sem máscara. */
function onlyDigits(v: string) {
  return v.replace(/\D/g, "");
}

const initialPF = {
  taxId: "",
  personType: "FISICA" as PersonType,
  phone: "",
  dateBirth: "",
  documentNumber: "",
  documentIssuingAgency: "",
  documentIssueDate: "",
  documentIssueState: "",
  nationality: "Brasileiro",
  maritalStatus: "SOLTEIRO(A)",
  monthlyIncome: "",
  hometown: "",
  address: {
    addressType: "RESIDENCIAL",
    zipcode: "",
    street: "",
    number: "",
    complement: "",
    district: "",
    city: "",
    state: "",
  },
};

const initialPJ = {
  ...initialPF,
  personType: "JURIDICA" as PersonType,
  website: "",
  socialNetwork: "",
  address: { ...initialPF.address, addressType: "COMERCIAL" },
  companyInfo: {
    tradeName: "",
    openingDate: "",
    revenue: "",
    responsible: { fullName: "", email: "", phone: "" },
  },
};

/**
 * Cadastro de KYC conforme os guias oficiais da Ether ("Abertura de Conta
 * PF/PJ" + "Tipos de contas e dados usados na criação de contas", obtidos
 * 2026-10-02). Os nomes dos campos aqui são os mesmos que o backend espera
 * em `onboardingSchema` (server/src/routes/auth.js) — sem tradução no meio.
 */
export default function Onboarding() {
  const { signOut } = useAuth();
  const { data: status, isLoading: statusLoading, isError: statusError, refetch } = useOnboardingStatus();
  const submit = useSubmitOnboarding();

  const [personType, setPersonType] = useState<PersonType>("FISICA");
  const [pf, setPf] = useState(initialPF);
  const [pj, setPj] = useState(initialPJ);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const base = personType === "FISICA" ? pf : pj;
    const payload: Record<string, unknown> = {
      taxId: onlyDigits(base.taxId),
      personType,
      phone: onlyDigits(base.phone),
      dateBirth: base.dateBirth,
      documentNumber: base.documentNumber,
      documentIssuingAgency: base.documentIssuingAgency || undefined,
      documentIssueDate: base.documentIssueDate || undefined,
      documentIssueState: base.documentIssueState || undefined,
      address: { ...base.address, zipcode: onlyDigits(base.address.zipcode) },
    };

    if (personType === "FISICA") {
      Object.assign(payload, {
        nationality: pf.nationality,
        maritalStatus: pf.maritalStatus,
        monthlyIncome: pf.monthlyIncome,
        hometown: pf.hometown,
      });
    } else {
      Object.assign(payload, {
        website: pj.website,
        socialNetwork: pj.socialNetwork,
        companyInfo: {
          ...pj.companyInfo,
          responsible: { ...pj.companyInfo.responsible, phone: onlyDigits(pj.companyInfo.responsible.phone) },
        },
      });
    }

    try {
      // O hook grava o checklist do 201 no cache; ao terminar, esta mesma rota
      // passa a mostrar a tela de documentos (KycDocuments), sem navegar.
      await submit.mutateAsync(payload as never);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Não foi possível enviar o cadastro. Tente novamente.",
      );
    }
  }

  if (statusLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background" role="status" aria-label="Carregando">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  // Sem status confiável não mostramos o formulário: poderia ser alguém que já se cadastrou.
  if (statusError || !status) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Não foi possível carregar seu cadastro</CardTitle>
            <CardDescription>Verifique sua conexão e tente de novo.</CardDescription>
          </CardHeader>
          <CardContent className="flex gap-3">
            <Button onClick={() => void refetch()}>Tentar novamente</Button>
            <Button variant="ghost" onClick={() => void signOut()}>Sair</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Cadastro já enviado (inclusive logo após o submit): documentos e situação da conta.
  if (status.status !== "not_started") return <KycDocuments />;

  const current = personType === "FISICA" ? pf : pj;
  const setCurrent = personType === "FISICA" ? setPf : (setPj as typeof setPf);

  return (
    <div className="min-h-screen bg-background p-6 flex items-center justify-center">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>Complete seu cadastro</CardTitle>
          <CardDescription>
            Esses dados vão direto para a verificação de identidade (KYC) do provedor bancário.
            Emissão de PIX e pagamentos só liberam depois da aprovação.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Tabs value={personType} onValueChange={(v) => setPersonType(v as PersonType)}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="FISICA">Pessoa física</TabsTrigger>
              <TabsTrigger value="JURIDICA">Pessoa jurídica</TabsTrigger>
            </TabsList>
          </Tabs>

          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <Alert variant="destructive">
                <AlertTitle>Não foi possível enviar</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <section className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground">
                {personType === "FISICA" ? "Dados pessoais" : "Dados do representante legal"}
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="taxId">{personType === "FISICA" ? "CPF" : "CNPJ"}</Label>
                  <Input
                    id="taxId"
                    value={current.taxId}
                    onChange={(e) => setCurrent({ ...current, taxId: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Telefone (DDD + número)</Label>
                  <Input
                    id="phone"
                    value={current.phone}
                    onChange={(e) => setCurrent({ ...current, phone: e.target.value })}
                    placeholder="11988887777"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dateBirth">
                    {personType === "FISICA" ? "Data de nascimento" : "Data de nascimento do representante"}
                  </Label>
                  <Input
                    id="dateBirth"
                    type="date"
                    value={current.dateBirth}
                    onChange={(e) => setCurrent({ ...current, dateBirth: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="documentNumber">Nº do documento (RG/CNH)</Label>
                  <Input
                    id="documentNumber"
                    value={current.documentNumber}
                    onChange={(e) => setCurrent({ ...current, documentNumber: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="documentIssuingAgency">Órgão emissor</Label>
                  <Input
                    id="documentIssuingAgency"
                    value={current.documentIssuingAgency}
                    onChange={(e) => setCurrent({ ...current, documentIssuingAgency: e.target.value })}
                    placeholder="SSP/SP"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="documentIssueDate">Data de emissão</Label>
                  <Input
                    id="documentIssueDate"
                    type="date"
                    value={current.documentIssueDate}
                    onChange={(e) => setCurrent({ ...current, documentIssueDate: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="documentIssueState">UF de emissão</Label>
                  <Input
                    id="documentIssueState"
                    maxLength={2}
                    value={current.documentIssueState}
                    onChange={(e) => setCurrent({ ...current, documentIssueState: e.target.value.toUpperCase() })}
                    placeholder="SP"
                  />
                </div>
              </div>
            </section>

            {personType === "FISICA" ? (
              <section className="space-y-3">
                <h3 className="text-sm font-medium text-muted-foreground">Perfil</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Nacionalidade</Label>
                    <Select value={pf.nationality} onValueChange={(v) => setPf({ ...pf, nationality: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Brasileiro">Brasileiro</SelectItem>
                        <SelectItem value="Brasileira">Brasileira</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Estado civil</Label>
                    <Select value={pf.maritalStatus} onValueChange={(v) => setPf({ ...pf, maritalStatus: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="SOLTEIRO(A)">Solteiro(a)</SelectItem>
                        <SelectItem value="CASADO(A)">Casado(a)</SelectItem>
                        <SelectItem value="DIVORCIADO(A)">Divorciado(a)</SelectItem>
                        <SelectItem value="VIUVO(A)">Viúvo(a)</SelectItem>
                        <SelectItem value="UNIÃO ESTÁVEL">União estável</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="monthlyIncome">Renda mensal (R$)</Label>
                    <Input
                      id="monthlyIncome"
                      value={pf.monthlyIncome}
                      onChange={(e) => setPf({ ...pf, monthlyIncome: e.target.value })}
                      placeholder="5000.00"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="hometown">Naturalidade</Label>
                    <Input
                      id="hometown"
                      value={pf.hometown}
                      onChange={(e) => setPf({ ...pf, hometown: e.target.value })}
                      placeholder="São Paulo"
                      required
                    />
                  </div>
                </div>
              </section>
            ) : (
              <section className="space-y-3">
                <h3 className="text-sm font-medium text-muted-foreground">Dados da empresa</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="tradeName">Nome fantasia</Label>
                    <Input
                      id="tradeName"
                      value={pj.companyInfo.tradeName}
                      onChange={(e) =>
                        setPj({ ...pj, companyInfo: { ...pj.companyInfo, tradeName: e.target.value } })
                      }
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="openingDate">Data de abertura</Label>
                    <Input
                      id="openingDate"
                      type="date"
                      value={pj.companyInfo.openingDate}
                      onChange={(e) =>
                        setPj({ ...pj, companyInfo: { ...pj.companyInfo, openingDate: e.target.value } })
                      }
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="revenue">Faturamento mensal (R$)</Label>
                    <Input
                      id="revenue"
                      value={pj.companyInfo.revenue}
                      onChange={(e) =>
                        setPj({ ...pj, companyInfo: { ...pj.companyInfo, revenue: e.target.value } })
                      }
                      placeholder="100000.00"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="website">Site</Label>
                    <Input
                      id="website"
                      value={pj.website}
                      onChange={(e) => setPj({ ...pj, website: e.target.value })}
                      placeholder="https://www.empresa.com.br"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="socialNetwork">Rede social</Label>
                    <Input
                      id="socialNetwork"
                      value={pj.socialNetwork}
                      onChange={(e) => setPj({ ...pj, socialNetwork: e.target.value })}
                      placeholder="https://linkedin.com/company/empresa"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="respFullName">Nome do responsável</Label>
                    <Input
                      id="respFullName"
                      value={pj.companyInfo.responsible.fullName}
                      onChange={(e) =>
                        setPj({
                          ...pj,
                          companyInfo: {
                            ...pj.companyInfo,
                            responsible: { ...pj.companyInfo.responsible, fullName: e.target.value },
                          },
                        })
                      }
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="respEmail">E-mail do responsável</Label>
                    <Input
                      id="respEmail"
                      type="email"
                      value={pj.companyInfo.responsible.email}
                      onChange={(e) =>
                        setPj({
                          ...pj,
                          companyInfo: {
                            ...pj.companyInfo,
                            responsible: { ...pj.companyInfo.responsible, email: e.target.value },
                          },
                        })
                      }
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="respPhone">Telefone do responsável</Label>
                    <Input
                      id="respPhone"
                      value={pj.companyInfo.responsible.phone}
                      onChange={(e) =>
                        setPj({
                          ...pj,
                          companyInfo: {
                            ...pj.companyInfo,
                            responsible: { ...pj.companyInfo.responsible, phone: e.target.value },
                          },
                        })
                      }
                      required
                    />
                  </div>
                </div>
              </section>
            )}

            <section className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground">Endereço</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="zipcode">CEP</Label>
                  <Input
                    id="zipcode"
                    value={current.address.zipcode}
                    onChange={(e) => setCurrent({ ...current, address: { ...current.address, zipcode: e.target.value } })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="street">Logradouro</Label>
                  <Input
                    id="street"
                    value={current.address.street}
                    onChange={(e) => setCurrent({ ...current, address: { ...current.address, street: e.target.value } })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="number">Número</Label>
                  <Input
                    id="number"
                    value={current.address.number}
                    onChange={(e) => setCurrent({ ...current, address: { ...current.address, number: e.target.value } })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="complement">Complemento</Label>
                  <Input
                    id="complement"
                    value={current.address.complement}
                    onChange={(e) => setCurrent({ ...current, address: { ...current.address, complement: e.target.value } })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="district">Bairro</Label>
                  <Input
                    id="district"
                    value={current.address.district}
                    onChange={(e) => setCurrent({ ...current, address: { ...current.address, district: e.target.value } })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="city">Cidade</Label>
                  <Input
                    id="city"
                    value={current.address.city}
                    onChange={(e) => setCurrent({ ...current, address: { ...current.address, city: e.target.value } })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="state">UF</Label>
                  <Input
                    id="state"
                    maxLength={2}
                    value={current.address.state}
                    onChange={(e) =>
                      setCurrent({ ...current, address: { ...current.address, state: e.target.value.toUpperCase() } })
                    }
                    required
                  />
                </div>
              </div>
            </section>

            <Button type="submit" className="w-full" disabled={submit.isPending}>
              {submit.isPending ? "Enviando..." : "Enviar cadastro"}
            </Button>
            <Button type="button" variant="ghost" className="w-full" onClick={() => void signOut()}>
              Sair e continuar depois
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
