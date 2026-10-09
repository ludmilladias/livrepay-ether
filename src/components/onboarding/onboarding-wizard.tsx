import { useEffect, useMemo, useRef, useState } from "react";
import { FormProvider, useForm, useWatch, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSubmitOnboarding, type PersonType } from "@/hooks/use-onboarding";
import { useAuth } from "@/hooks/use-auth";
import { ApiError } from "@/lib/api";
import { clearOnboardingDraft, loadOnboardingDraft, saveOnboardingDraft } from "@/lib/onboarding-draft";
import {
  AddressStep,
  CompanyStep,
  DigitalStep,
  DocumentStep,
  IdentificationStep,
  ProfileStep,
  RepresentativeStep,
  ReviewStep,
} from "./onboarding-steps";
import {
  EMPTY_VALUES,
  buildPayload,
  fieldId,
  schemaFor,
  stepsFor,
  type OnboardingFormValues,
} from "./onboarding-schema";

const resolver: Resolver<OnboardingFormValues> = (values, context, options) =>
  zodResolver(schemaFor(values.personType))(values, context, options) as ReturnType<Resolver<OnboardingFormValues>>;

function StepBody({ id, isPF, onEdit }: { id: string; isPF: boolean; onEdit: (s: number) => void }) {
  switch (id) {
    case "identificacao":
      return <IdentificationStep />;
    case "documento":
      return <DocumentStep />;
    case "perfil":
      return <ProfileStep />;
    case "endereco":
      return <AddressStep isPF={isPF} />;
    case "empresa":
      return <CompanyStep />;
    case "representante":
      return <RepresentativeStep />;
    case "digital":
      return <DigitalStep />;
    default:
      return <ReviewStep onEdit={onEdit} />;
  }
}

/**
 * Cadastro de abertura de conta em passos. Os nomes e o formato do payload são os
 * de `onboardingSchema` (server/src/routes/auth.js) — ver `buildPayload`.
 */
export function OnboardingWizard({ initialType }: { initialType: PersonType | null }) {
  const { user, signOut } = useAuth();
  const submit = useSubmitOnboarding();
  const userId = user?.id;

  // Rascunho só vale se for do mesmo tipo escolhido agora (?tipo= tem prioridade).
  const [initial] = useState(() => {
    const draft = userId ? loadOnboardingDraft(userId) : null;
    const draftType = draft?.values.personType as PersonType | undefined;
    const useDraft = !!draft && (!initialType || draftType === initialType);
    const personType: PersonType = initialType ?? draftType ?? "FISICA";
    const values: OnboardingFormValues = {
      ...EMPTY_VALUES,
      ...(useDraft ? draft!.values : {}),
      personType,
    };
    const lastStep = stepsFor(personType).length - 1;
    return { values, step: useDraft ? Math.min(draft!.step, lastStep - 1) : 0, restored: useDraft };
  });

  const form = useForm<OnboardingFormValues>({
    resolver,
    defaultValues: initial.values,
    mode: "onTouched",
    shouldFocusError: false,
  });

  const [step, setStep] = useState(initial.step);
  const [serverError, setServerError] = useState<string | null>(null);
  const [summaryTick, setSummaryTick] = useState(0); // >0 => mostrar e focar o resumo de erros
  const summaryRef = useRef<HTMLDivElement>(null);
  const serverErrorRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);

  const personType = useWatch({ control: form.control, name: "personType" });
  const steps = useMemo(() => stepsFor(personType), [personType]);
  const current = steps[Math.min(step, steps.length - 1)];
  const isLast = current.id === "revisao";
  const isPF = personType === "FISICA";

  // Rascunho (só campos não sensíveis; ver lib/onboarding-draft).
  const allValues = useWatch({ control: form.control }) as OnboardingFormValues;
  useEffect(() => {
    if (userId) saveOnboardingDraft(userId, allValues as unknown as Record<string, unknown>, step);
  }, [allValues, step, userId]);

  // Ao trocar de passo, leva o foco ao título dele (leitor de tela e teclado).
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    bodyRef.current?.querySelector<HTMLElement>("[data-step-heading]")?.focus();
  }, [step]);

  useEffect(() => {
    if (summaryTick > 0) summaryRef.current?.focus();
  }, [summaryTick]);

  useEffect(() => {
    if (serverError) serverErrorRef.current?.focus();
  }, [serverError]);

  // Erros do passo atual (os de outros passos não poluem o resumo).
  const errors = form.formState.errors;
  const stepErrors = current.fields
    .filter((name) => errors[name])
    .map((name) => ({ name, message: String(errors[name]?.message ?? "Campo inválido") }));

  function focusField(name: string) {
    document.getElementById(fieldId(name))?.focus();
  }

  function goTo(index: number) {
    setSummaryTick(0);
    setStep(index);
  }

  async function validateStep(): Promise<boolean> {
    const ok = await form.trigger(current.fields);
    if (!ok) setSummaryTick((t) => t + 1);
    return ok;
  }

  async function next() {
    setServerError(null);
    if (await validateStep()) goTo(step + 1);
  }

  async function send() {
    setServerError(null);
    // Revalida tudo: o rascunho pode ter pulado passos e o resolver é o do tipo atual.
    const ok = await form.trigger();
    if (!ok) {
      const firstBad = steps.findIndex((s) => s.fields.some((f) => form.getFieldState(f).invalid));
      if (firstBad >= 0) {
        setStep(firstBad);
        setSummaryTick((t) => t + 1);
      }
      return;
    }
    try {
      // O hook grava o checklist do 201 no cache; ao terminar, a página mostra a
      // tela de documentos (KycDocuments), sem navegar.
      await submit.mutateAsync(buildPayload(form.getValues()));
      if (userId) clearOnboardingDraft(userId);
    } catch (err) {
      setServerError(
        err instanceof ApiError ? err.message : "Não foi possível enviar o cadastro. Tente novamente.",
      );
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submit.isPending) return;
    if (isLast) void send();
    else void next();
  }

  function changeType(value: string) {
    const type = value as PersonType;
    if (type === personType) return;
    // CPF e CNPJ, e o telefone (da pessoa x da empresa), não valem de um tipo para o outro.
    form.setValue("personType", type);
    form.setValue("taxId", "");
    form.setValue("phone", "");
    form.clearErrors();
    setSummaryTick(0);
  }

  const percent = Math.round(((step + 1) / steps.length) * 100);

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle className="text-2xl">Complete seu cadastro</CardTitle>
        <CardDescription>
          Esses dados seguem para a verificação de identidade do banco parceiro. Cobranças e pagamentos só
          funcionam depois da aprovação da conta.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">
              Passo {step + 1} de {steps.length}: {current.title}
            </span>
            <span className="text-muted-foreground">{percent}%</span>
          </div>
          <Progress value={percent} aria-label="Progresso do cadastro" />
          <ol className="hidden sm:flex items-center justify-between gap-2 text-xs">
            {steps.map((s, i) => (
              <li
                key={s.id}
                aria-current={i === step ? "step" : undefined}
                className={`flex items-center gap-1 ${i === step ? "font-semibold text-foreground" : "text-muted-foreground"}`}
              >
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] ${
                    i < step ? "bg-primary text-primary-foreground border-primary" : ""
                  }`}
                  aria-hidden="true"
                >
                  {i < step ? <Check className="h-3 w-3" /> : i + 1}
                </span>
                <span>
                  {i < step && <span className="sr-only">Concluído: </span>}
                  {s.title}
                </span>
              </li>
            ))}
          </ol>
        </div>

        {step === 0 && (
          <Tabs value={personType} onValueChange={changeType}>
            <TabsList className="grid w-full grid-cols-2" aria-label="Tipo de conta">
              <TabsTrigger value="FISICA">Pessoa física</TabsTrigger>
              <TabsTrigger value="JURIDICA">Pessoa jurídica</TabsTrigger>
            </TabsList>
          </Tabs>
        )}

        {initial.restored && step > 0 && (
          <p className="text-xs text-muted-foreground" role="status">
            Retomamos de onde você parou. Por segurança, CPF/CNPJ, documento, telefone, renda e endereço não
            ficam salvos: se algum campo estiver vazio, preencha de novo.
          </p>
        )}

        <FormProvider {...form}>
          <form onSubmit={onSubmit} noValidate className="space-y-6">
            {serverError && (
              <div ref={serverErrorRef} tabIndex={-1}>
                <Alert variant="destructive">
                  <AlertTitle>Não foi possível enviar</AlertTitle>
                  <AlertDescription>{serverError}</AlertDescription>
                </Alert>
              </div>
            )}

            {summaryTick > 0 && stepErrors.length > 0 && (
              <div ref={summaryRef} tabIndex={-1}>
                <Alert variant="destructive">
                  <AlertTitle>
                    {stepErrors.length === 1 ? "Corrija 1 campo para continuar" : `Corrija ${stepErrors.length} campos para continuar`}
                  </AlertTitle>
                  <AlertDescription>
                    <ul className="mt-2 list-disc pl-5 space-y-1">
                      {stepErrors.map((e) => (
                        <li key={e.name}>
                          <button type="button" className="underline text-left" onClick={() => focusField(e.name)}>
                            {e.message}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              </div>
            )}

            <div ref={bodyRef}>
              <StepBody id={current.id} isPF={isPF} onEdit={goTo} />
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
              <Button type="button" variant="outline" onClick={() => goTo(step - 1)} disabled={step === 0 || submit.isPending}>
                Voltar
              </Button>
              <Button type="submit" disabled={submit.isPending}>
                {isLast ? (submit.isPending ? "Enviando..." : "Enviar cadastro") : "Continuar"}
              </Button>
            </div>
          </form>
        </FormProvider>

        <div className="border-t pt-4 space-y-2">
          <p className="text-xs text-muted-foreground">
            Se a página recarregar, voltamos ao seu passo com os dados não sensíveis (tipo de conta, UF, nome da
            empresa). CPF/CNPJ, documento, telefone, renda e endereço você digita de novo. Ao sair da conta, o
            rascunho é apagado.
          </p>
          <Button type="button" variant="ghost" className="w-full sm:w-auto" onClick={() => void signOut()}>
            Sair da conta
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
