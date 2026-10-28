import { useWatch } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { maskCEP, maskCNPJ, maskCPF, maskPhone } from "@/lib/br-docs";
import { SelectField, TextField } from "./form-fields";
import {
  DOCUMENT_TYPES,
  MARITAL_STATUSES,
  MIN_DATE,
  NATIONALITIES,
  UFS,
  maxBirthISO,
  stepsFor,
  todayISO,
  type OnboardingFormValues,
} from "./onboarding-schema";

const GRID = "grid grid-cols-1 sm:grid-cols-2 gap-4";
const UF_OPTIONS = UFS.map((uf) => ({ value: uf, label: uf }));

function StepHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div className="space-y-1">
      <h2 className="text-lg font-semibold" data-step-heading tabIndex={-1}>
        {title}
      </h2>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}

// --- PF ----------------------------------------------------------------------

export function IdentificationStep() {
  return (
    <section className="space-y-4">
      <StepHeading title="Identificação" description="Seus dados pessoais, como constam no CPF." />
      <div className={GRID}>
        <TextField name="taxId" label="CPF" mask={maskCPF} inputMode="numeric" autoComplete="off" placeholder="000.000.000-00" />
        <TextField
          name="phone"
          label="Celular com DDD"
          mask={maskPhone}
          type="text"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder="(11) 98888-7777"
        />
        <TextField name="dateBirth" label="Data de nascimento" type="date" autoComplete="bday" min={MIN_DATE} max={maxBirthISO()} />
      </div>
    </section>
  );
}

function DocumentFields() {
  return (
    <div className={GRID}>
      <SelectField name="documentType" label="Tipo de documento" options={DOCUMENT_TYPES} />
      <TextField name="documentNumber" label="Número do documento" autoComplete="off" maxLength={30} />
      <TextField
        name="documentIssuingAgency"
        label="Órgão emissor"
        placeholder="SSP"
        autoComplete="off"
        maxLength={30}
      />
      <SelectField name="documentIssueState" label="UF de emissão" options={UF_OPTIONS} />
      <TextField
        name="documentIssueDate"
        label="Data de emissão"
        type="date"
        min={MIN_DATE}
        max={todayISO()}
      />
    </div>
  );
}

export function DocumentStep() {
  return (
    <section className="space-y-4">
      <StepHeading
        title="Documento de identidade"
        description="Informe o RG ou a CNH. Você enviará a foto do documento no passo seguinte ao cadastro."
      />
      <DocumentFields />
    </section>
  );
}

export function ProfileStep() {
  return (
    <section className="space-y-4">
      <StepHeading title="Renda e naturalidade" />
      <div className={GRID}>
        <SelectField
          name="nationality"
          label="Nacionalidade"
          options={NATIONALITIES.map((n) => ({ value: n, label: n }))}
        />
        <SelectField name="maritalStatus" label="Estado civil" options={MARITAL_STATUSES} />
        <TextField
          name="monthlyIncome"
          label="Renda mensal (R$)"
          inputMode="decimal"
          placeholder="5000,00"
          autoComplete="off"
        />
        <TextField name="hometown" label="Cidade de nascimento (naturalidade)" placeholder="São Paulo" autoComplete="off" maxLength={100} />
      </div>
    </section>
  );
}

// --- Compartilhado -----------------------------------------------------------

export function AddressStep({ isPF }: { isPF: boolean }) {
  return (
    <section className="space-y-4">
      <StepHeading title={isPF ? "Endereço residencial" : "Endereço da empresa"} />
      <div className={GRID}>
        <TextField name="zipcode" label="CEP" mask={maskCEP} inputMode="numeric" autoComplete="postal-code" placeholder="00000-000" />
        <TextField name="street" label="Logradouro" autoComplete="address-line1" maxLength={200} />
        <TextField name="number" label="Número" autoComplete="off" maxLength={20} hint="Sem número? Use S/N." />
        <TextField name="complement" label="Complemento" optional autoComplete="address-line2" maxLength={100} />
        <TextField name="district" label="Bairro" autoComplete="off" maxLength={100} />
        <TextField name="city" label="Cidade" autoComplete="address-level2" maxLength={100} />
        <SelectField name="state" label="UF" options={UF_OPTIONS} />
      </div>
    </section>
  );
}

// --- PJ ----------------------------------------------------------------------

export function CompanyStep() {
  return (
    <section className="space-y-4">
      <StepHeading title="Dados da empresa" description="Como constam no cartão CNPJ." />
      <div className={GRID}>
        <TextField name="taxId" label="CNPJ" mask={maskCNPJ} inputMode="numeric" autoComplete="off" placeholder="00.000.000/0000-00" />
        <TextField name="socialName" label="Razão social" autoComplete="organization" maxLength={140} />
        <TextField name="tradeName" label="Nome fantasia" autoComplete="off" maxLength={140} />
        <TextField name="openingDate" label="Data de abertura" type="date" min={MIN_DATE} max={todayISO()} />
        <TextField name="revenue" label="Faturamento mensal (R$)" inputMode="decimal" placeholder="100000,00" autoComplete="off" />
        <TextField
          name="phone"
          label="Celular da empresa com DDD"
          mask={maskPhone}
          inputMode="tel"
          autoComplete="tel-national"
          placeholder="(11) 98888-7777"
        />
      </div>
    </section>
  );
}

export function RepresentativeStep() {
  return (
    <section className="space-y-6">
      <StepHeading
        title="Representante legal"
        description="Pessoa que responde pela empresa perante o banco parceiro."
      />
      <div className={GRID}>
        <TextField name="respFullName" label="Nome completo do representante" autoComplete="off" maxLength={140} />
        <TextField name="respEmail" label="E-mail do representante" type="email" inputMode="email" autoComplete="off" />
        <TextField
          name="respPhone"
          label="Telefone do representante"
          mask={maskPhone}
          inputMode="tel"
          autoComplete="off"
          placeholder="(11) 98888-7777"
        />
        <TextField
          name="dateBirth"
          label="Data de nascimento do representante"
          type="date"
          min={MIN_DATE}
          max={maxBirthISO()}
        />
      </div>
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground">Documento de identidade do representante</h3>
        <DocumentFields />
      </div>
    </section>
  );
}

export function DigitalStep() {
  return (
    <section className="space-y-4">
      <StepHeading
        title="Presença digital"
        description="O banco parceiro exige o site e uma rede social da empresa para a análise."
      />
      <div className={GRID}>
        <TextField name="website" label="Site" type="url" inputMode="url" autoComplete="url" placeholder="https://www.empresa.com.br" />
        <TextField
          name="socialNetwork"
          label="Rede social"
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="https://instagram.com/empresa"
        />
      </div>
    </section>
  );
}

// --- Revisão -----------------------------------------------------------------

function label(options: readonly { value: string; label: string }[], value: string): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col sm:flex-row sm:justify-between gap-0.5 py-1.5 text-sm">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-medium sm:text-right break-words">{v || "—"}</dd>
    </div>
  );
}

function ReviewGroup({
  title,
  stepIndex,
  onEdit,
  children,
}: {
  title: string;
  stepIndex: number;
  onEdit: (step: number) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Button type="button" variant="ghost" size="sm" onClick={() => onEdit(stepIndex)} aria-label={`Editar ${title}`}>
          Editar
        </Button>
      </div>
      <dl className="divide-y">{children}</dl>
    </div>
  );
}

export function ReviewStep({ onEdit }: { onEdit: (step: number) => void }) {
  const v = useWatch() as OnboardingFormValues;
  const isPF = v.personType === "FISICA";
  const steps = stepsFor(v.personType);
  const at = (id: string) => steps.findIndex((s) => s.id === id);
  const address = `${v.street}, ${v.number}${v.complement ? ` – ${v.complement}` : ""} – ${v.district}, ${v.city}/${v.state} – CEP ${v.zipcode}`;

  return (
    <section className="space-y-4">
      <StepHeading
        title="Revise antes de enviar"
        description="Confira os dados com atenção: depois do envio, eles seguem para a análise do banco parceiro."
      />
      {isPF ? (
        <>
          <ReviewGroup title="Identificação" stepIndex={at("identificacao")} onEdit={onEdit}>
            <Row k="CPF" v={v.taxId} />
            <Row k="Celular" v={v.phone} />
            <Row k="Data de nascimento" v={v.dateBirth.split("-").reverse().join("/")} />
          </ReviewGroup>
          <ReviewGroup title="Documento" stepIndex={at("documento")} onEdit={onEdit}>
            <Row k="Tipo" v={label(DOCUMENT_TYPES, v.documentType)} />
            <Row k="Número" v={v.documentNumber} />
            <Row k="Órgão emissor / UF" v={`${v.documentIssuingAgency} / ${v.documentIssueState}`} />
            <Row k="Data de emissão" v={v.documentIssueDate.split("-").reverse().join("/")} />
          </ReviewGroup>
          <ReviewGroup title="Renda e naturalidade" stepIndex={at("perfil")} onEdit={onEdit}>
            <Row k="Nacionalidade" v={v.nationality} />
            <Row k="Estado civil" v={label(MARITAL_STATUSES, v.maritalStatus)} />
            <Row k="Renda mensal" v={`R$ ${v.monthlyIncome}`} />
            <Row k="Naturalidade" v={v.hometown} />
          </ReviewGroup>
          <ReviewGroup title="Endereço" stepIndex={at("endereco")} onEdit={onEdit}>
            <Row k="Endereço" v={address} />
          </ReviewGroup>
        </>
      ) : (
        <>
          <ReviewGroup title="Empresa" stepIndex={at("empresa")} onEdit={onEdit}>
            <Row k="CNPJ" v={v.taxId} />
            <Row k="Razão social" v={v.socialName} />
            <Row k="Nome fantasia" v={v.tradeName} />
            <Row k="Data de abertura" v={v.openingDate.split("-").reverse().join("/")} />
            <Row k="Faturamento mensal" v={`R$ ${v.revenue}`} />
            <Row k="Celular da empresa" v={v.phone} />
          </ReviewGroup>
          <ReviewGroup title="Endereço" stepIndex={at("endereco")} onEdit={onEdit}>
            <Row k="Endereço" v={address} />
          </ReviewGroup>
          <ReviewGroup title="Representante legal" stepIndex={at("representante")} onEdit={onEdit}>
            <Row k="Nome" v={v.respFullName} />
            <Row k="E-mail" v={v.respEmail} />
            <Row k="Telefone" v={v.respPhone} />
            <Row k="Data de nascimento" v={v.dateBirth.split("-").reverse().join("/")} />
            <Row k="Documento" v={`${label(DOCUMENT_TYPES, v.documentType)} ${v.documentNumber}`} />
          </ReviewGroup>
          <ReviewGroup title="Presença digital" stepIndex={at("digital")} onEdit={onEdit}>
            <Row k="Site" v={v.website} />
            <Row k="Rede social" v={v.socialNetwork} />
          </ReviewGroup>
        </>
      )}
    </section>
  );
}
