import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Clock, FileUp, Loader2, RefreshCw, Repeat2, XCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { hasSupportChannel, SUPPORT_CONTACT } from "@/lib/support-contact";
import {
  replaceErrorMessage,
  uploadErrorMessage,
  useKycJourney,
  useUploadDocument,
  type ChecklistItem,
  type DocumentChecklist,
  type KycStage,
} from "@/hooks/use-onboarding";

/**
 * Validação de conveniência (erro imediato). NÃO é segurança: o servidor
 * confere tamanho, Content-Type e magic bytes de novo.
 */
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png"];

function validateKycFile(file: File): string | null {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return "Formato não aceito. Envie um PDF, JPG ou PNG.";
  }
  if (file.size === 0) return "O arquivo está vazio. Escolha outro arquivo.";
  if (file.size > MAX_FILE_BYTES) {
    return `O arquivo tem ${(file.size / 1024 / 1024).toFixed(1)} MB e o limite é 5 MB. Reduza o tamanho e tente de novo.`;
  }
  return null;
}

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR");
}

/** Linha de documento pendente ou recusado, com seleção e envio do arquivo. */
function UploadRow({ item, rejected }: { item: ChecklistItem; rejected: boolean }) {
  const upload = useUploadDocument();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);

  const inputId = `kyc-file-${item.type}`;
  const serverError = upload.isError ? uploadErrorMessage(upload.error) : null;
  const error = clientError ?? serverError;

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null;
    upload.reset();
    if (!picked) {
      setFile(null);
      setClientError(null);
      return;
    }
    const problem = validateKycFile(picked);
    setClientError(problem);
    setFile(problem ? null : picked);
    if (problem && inputRef.current) inputRef.current.value = "";
  }

  function send() {
    if (!file) return;
    upload.mutate({ type: item.type, file });
  }

  return (
    <li className="rounded-lg border p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="font-medium text-sm">{item.label}</p>
          {rejected && (
            <p className="text-xs text-destructive">
              {item.reason
                ? `Recusado: ${item.reason}`
                : "Este documento foi recusado. Envie um novo arquivo legível e completo."}
            </p>
          )}
        </div>
        {rejected ? (
          <Badge variant="destructive" className="shrink-0">
            <XCircle className="h-3 w-3 mr-1" /> Recusado
          </Badge>
        ) : (
          <Badge variant="outline" className="shrink-0">
            <Clock className="h-3 w-3 mr-1" /> Pendente
          </Badge>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
          onChange={onPick}
          disabled={upload.isPending}
          aria-label={`Escolher arquivo: ${item.label}`}
          aria-describedby={error ? `${inputId}-error` : undefined}
          className="block w-full max-w-xs text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm"
        />
        <Button type="button" size="sm" onClick={send} disabled={!file || upload.isPending}>
          {upload.isPending ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Enviando...
            </>
          ) : (
            <>
              <FileUp className="h-4 w-4 mr-2" /> {rejected ? "Reenviar" : "Enviar"}
            </>
          )}
        </Button>
      </div>

      {file && !upload.isPending && (
        <p className="text-xs text-muted-foreground">
          {file.name} ({formatSize(file.size)})
        </p>
      )}
      <p className="text-xs text-muted-foreground">PDF, JPG ou PNG, até 5 MB.</p>
      {error && (
        <p id={`${inputId}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </li>
  );
}

/**
 * Documento já enviado, que o cliente pode substituir (foto errada, página
 * errada, ilegível), com confirmação explícita antes.
 *
 * INCERTEZA CONHECIDA: não sabemos se a Ether substitui o arquivo ou recusa um
 * segundo envio do mesmo tipo. Por isso esta linha só afirma o que a resposta
 * prova: se a Ether recusou, diz que a troca NÃO foi feita; se aceitou, diz que
 * o envio foi aceito mas que não dá para confirmar daqui que ele substituiu o
 * anterior (e mostra se a data de envio registrada mudou, como indício).
 */
function UploadedRow({ item }: { item: ChecklistItem }) {
  const upload = useUploadDocument();
  const inputRef = useRef<HTMLInputElement>(null);
  const [replacing, setReplacing] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Data de envio registrada ANTES da troca, para comparar com a devolvida depois.
  const previousUploadedAt = useRef<string | undefined>(undefined);

  const inputId = `kyc-replace-${item.type}`;
  const serverError = upload.isError ? replaceErrorMessage(upload.error) : null;
  const error = clientError ?? serverError;

  function resetPicker() {
    upload.reset();
    setFile(null);
    setClientError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null;
    upload.reset();
    if (!picked) {
      setFile(null);
      setClientError(null);
      return;
    }
    const problem = validateKycFile(picked);
    setClientError(problem);
    setFile(problem ? null : picked);
    if (problem && inputRef.current) inputRef.current.value = "";
  }

  function confirmReplace() {
    if (!file) return;
    previousUploadedAt.current = item.uploadedAt;
    upload.mutate(
      { type: item.type, file },
      {
        onSuccess: () => {
          setFile(null);
          setReplacing(false);
        },
      },
    );
  }

  // Sem checklist na resposta, a data que temos é a antiga: não dá para comparar.
  const dateKnown = !!upload.data?.checklist;
  const dateChanged = dateKnown && !!item.uploadedAt && item.uploadedAt !== previousUploadedAt.current;

  return (
    <li className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium text-sm">{item.label}</p>
          {item.uploadedAt && (
            <p className="text-xs text-muted-foreground">Enviado em {formatDateTime(item.uploadedAt)}</p>
          )}
        </div>
        <Badge variant="secondary" className="shrink-0">
          <CheckCircle2 className="h-3 w-3 mr-1" /> Enviado
        </Badge>
      </div>

      {!replacing && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            upload.reset();
            setReplacing(true);
          }}
          disabled={upload.isPending}
        >
          <Repeat2 className="h-4 w-4 mr-2" /> Substituir documento
        </Button>
      )}

      {replacing && (
        <div className="space-y-3 rounded-md bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">
            Use isto se enviou o arquivo errado (documento de outra pessoa, página errada ou foto ilegível). Você
            confirma antes de enviar.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={inputRef}
              id={inputId}
              type="file"
              accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
              onChange={onPick}
              disabled={upload.isPending}
              aria-label={`Escolher novo arquivo: ${item.label}`}
              aria-describedby={error ? `${inputId}-error` : undefined}
              className="block w-full max-w-xs text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm"
            />
            <Button type="button" size="sm" onClick={() => setConfirmOpen(true)} disabled={!file || upload.isPending}>
              {upload.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Enviando...
                </>
              ) : (
                <>
                  <FileUp className="h-4 w-4 mr-2" /> Substituir
                </>
              )}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={upload.isPending}
              onClick={() => {
                resetPicker();
                setReplacing(false);
              }}
            >
              Cancelar
            </Button>
          </div>
          {file && !upload.isPending && (
            <p className="text-xs text-muted-foreground">
              {file.name} ({formatSize(file.size)})
            </p>
          )}
          <p className="text-xs text-muted-foreground">PDF, JPG ou PNG, até 5 MB.</p>
        </div>
      )}

      {error && (
        <p id={`${inputId}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {upload.isSuccess && (
        <p role="status" className="text-sm text-muted-foreground">
          O banco parceiro aceitou o novo envio. Não temos como confirmar por aqui se ele substituiu o arquivo
          anterior; quem define qual arquivo vale é a análise.{" "}
          {dateKnown &&
            (dateChanged
              ? `A data de envio registrada mudou para ${formatDateTime(item.uploadedAt as string)}.`
              : "A data de envio registrada não mudou, então a troca não está confirmada.")}
        </p>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Substituir este documento?</AlertDialogTitle>
            <AlertDialogDescription>
              O documento &quot;{item.label}&quot; já foi enviado e pode já ter chegado à análise. Ao continuar, o
              arquivo <strong>{file?.name}</strong> será enviado no lugar dele. Se o banco parceiro não aceitar a
              troca, avisaremos aqui, e nesse caso o que você já enviou continua como estava.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmReplace}>Sim, substituir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

/**
 * Conta recusada: o que sabemos (o cadastro foi recusado; documentos recusados
 * e motivo SE a Ether informou), o que o cliente pode fazer e o canal de
 * contato (definido em `lib/support-contact.ts`, hoje pendente).
 */
function RejectedPanel({ checklist }: { checklist: DocumentChecklist | null }) {
  const rejectedDocs = checklist?.rejected ?? [];
  const contact = SUPPORT_CONTACT;

  return (
    <div className="space-y-5">
      <section aria-labelledby="kyc-rejected-what" className="space-y-2">
        <h3 id="kyc-rejected-what" className="text-sm font-medium">
          O que foi recusado
        </h3>
        <p className="text-sm text-muted-foreground">O banco parceiro não aprovou a abertura desta conta.</p>
        {rejectedDocs.length > 0 ? (
          <ul className="space-y-2">
            {rejectedDocs.map((d) => (
              <li key={d.type} className="rounded-lg border p-3 text-sm">
                <p className="font-medium">{d.label}</p>
                <p className="text-xs text-muted-foreground">
                  {d.reason ? `Motivo informado: ${d.reason}` : "O banco parceiro não informou o motivo deste documento."}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            O banco parceiro não informou o motivo da recusa. O LivrePay não tem como ver o motivo por aqui.
          </p>
        )}
      </section>

      <section aria-labelledby="kyc-rejected-next" className="space-y-2">
        <h3 id="kyc-rejected-next" className="text-sm font-medium">
          O que você pode fazer
        </h3>
        <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
          <li>Não é possível reenviar documentos nem refazer o cadastro por aqui.</li>
          <li>Entre em contato com o atendimento do LivrePay para entender o motivo e saber se há como rever o caso.</li>
          <li>Tenha em mãos o CPF/CNPJ usado no cadastro e o e-mail desta conta.</li>
        </ul>
      </section>

      <section aria-labelledby="kyc-rejected-contact" className="space-y-2">
        <h3 id="kyc-rejected-contact" className="text-sm font-medium">
          Falar com o atendimento
        </h3>
        {hasSupportChannel(contact) ? (
          <ul className="space-y-1 text-sm">
            {contact.email && (
              <li>
                E-mail:{" "}
                <a className="underline" href={`mailto:${contact.email}`}>
                  {contact.email}
                </a>
              </li>
            )}
            {contact.phone && <li>Telefone: {contact.phone}</li>}
            {contact.url && (
              <li>
                <a className="underline" href={contact.url} target="_blank" rel="noopener noreferrer">
                  Abrir página de atendimento
                </a>
              </li>
            )}
            {contact.hours && <li className="text-muted-foreground">Horário: {contact.hours}</li>}
          </ul>
        ) : (
          <Alert>
            <AlertTitle>Canal de atendimento ainda não divulgado</AlertTitle>
            <AlertDescription>
              O LivrePay ainda não publicou um canal de atendimento nesta tela. Assim que ele for definido, aparecerá
              aqui. Seu cadastro continua registrado como recusado.
            </AlertDescription>
          </Alert>
        )}
      </section>
    </div>
  );
}

const HEADINGS: Record<Exclude<KycStage, "not_started">, { title: string; description: string }> = {
  awaiting_documents: {
    title: "Envie seus documentos",
    description:
      "Sua conta só é aberta depois que o banco parceiro receber e aprovar os documentos abaixo. Envie um por vez.",
  },
  in_analysis: {
    title: "Cadastro em análise",
    description:
      "Recebemos seus documentos e o banco parceiro está analisando. Você será liberado assim que a conta for aprovada. Esta página se atualiza sozinha enquanto estiver aberta.",
  },
  approved: {
    title: "Conta aprovada",
    description: "Seu cadastro foi aprovado. Você já pode usar o painel.",
  },
  rejected: {
    title: "Cadastro recusado",
    description: "O banco parceiro não aprovou este cadastro. Veja abaixo o que sabemos e como seguir.",
  },
  pending_unknown: {
    title: "Não conseguimos confirmar sua situação agora",
    description:
      "Seu cadastro foi iniciado, mas não conseguimos consultar o banco parceiro neste momento. Tentaremos de novo automaticamente.",
  },
};

/**
 * Tela da jornada de KYC depois do cadastro: documentos (pendentes, enviados,
 * recusados) e situação da conta. Toda a lista vem do backend. É o único lugar
 * (junto com o gate do painel, que nunca está montado ao mesmo tempo) que liga
 * a atualização automática do status.
 */
export function KycDocuments() {
  const { signOut } = useAuth();
  const { stage, checklist, isFetching, isError, refetch, dataUpdatedAt } = useKycJourney({ autoRefresh: true });

  if (!stage || stage === "not_started") return null;

  const heading = HEADINGS[stage];
  const canUpload = stage === "awaiting_documents" || stage === "in_analysis" || stage === "pending_unknown";
  const hasPendingWork = !!checklist && (checklist.pending.length > 0 || checklist.rejected.length > 0);
  // Quem ainda deve documento fica nesta tela; os demais podem ir ao painel.
  const canGoToDashboard = stage !== "awaiting_documents";
  const autoRefreshing = stage === "in_analysis" || stage === "pending_unknown";

  return (
    <div className="min-h-screen bg-background p-6 flex items-center justify-center">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>{heading.title}</CardTitle>
          <CardDescription>{heading.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {stage === "awaiting_documents" && (
            <p className="text-sm text-muted-foreground">
              Emissão de PIX e pagamentos só são liberados depois da aprovação da conta.
            </p>
          )}

          {isError && (
            <Alert variant="destructive">
              <AlertTitle>Não foi possível carregar</AlertTitle>
              <AlertDescription>
                Houve uma falha ao consultar sua situação. Verifique a conexão e tente atualizar.
              </AlertDescription>
            </Alert>
          )}

          {!checklist && !isError && stage !== "approved" && stage !== "rejected" && (
            <Alert>
              <AlertTitle>Lista de documentos indisponível agora</AlertTitle>
              <AlertDescription>
                Não conseguimos buscar no banco parceiro quais documentos faltam. Clique em Atualizar em alguns
                instantes. Nenhum documento é pedido sem essa confirmação.
              </AlertDescription>
            </Alert>
          )}

          {stage === "rejected" && <RejectedPanel checklist={checklist} />}

          {checklist && stage !== "rejected" && stage !== "approved" && (
            <>
              {checklist.rejected.length > 0 && (
                <section aria-labelledby="kyc-rejected" className="space-y-3">
                  <h3 id="kyc-rejected" className="text-sm font-medium text-destructive">
                    Recusados ({checklist.rejected.length}): reenvie
                  </h3>
                  <ul className="space-y-3">
                    {checklist.rejected.map((item) =>
                      canUpload ? (
                        <UploadRow key={item.type} item={item} rejected />
                      ) : (
                        <li key={item.type} className="rounded-lg border p-4 text-sm">{item.label}</li>
                      ),
                    )}
                  </ul>
                </section>
              )}

              {checklist.pending.length > 0 && (
                <section aria-labelledby="kyc-pending" className="space-y-3">
                  <h3 id="kyc-pending" className="text-sm font-medium text-muted-foreground">
                    Pendentes ({checklist.pending.length})
                  </h3>
                  <ul className="space-y-3">
                    {checklist.pending.map((item) => (
                      <UploadRow key={item.type} item={item} rejected={false} />
                    ))}
                  </ul>
                </section>
              )}

              {checklist.uploaded.length > 0 && (
                <section aria-labelledby="kyc-uploaded" className="space-y-3">
                  <h3 id="kyc-uploaded" className="text-sm font-medium text-muted-foreground">
                    Enviados ({checklist.uploaded.length})
                  </h3>
                  <ul className="space-y-3">
                    {checklist.uploaded.map((item) => (
                      <UploadedRow key={item.type} item={item} />
                    ))}
                  </ul>
                </section>
              )}

              {!hasPendingWork && (
                <Alert>
                  <AlertTitle>Nenhum documento pendente</AlertTitle>
                  <AlertDescription>
                    Todos os documentos pedidos foram enviados. Agora é só aguardar a análise; esta página
                    acompanha a situação sozinha.
                  </AlertDescription>
                </Alert>
              )}
            </>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-2 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={() => void refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
              Atualizar situação
            </Button>
            {canGoToDashboard && (
              <Button asChild>
                <Link to="/">Ir ao painel</Link>
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={() => void signOut()} className="ml-auto">
              Sair
            </Button>
          </div>
          {autoRefreshing && dataUpdatedAt > 0 && (
            <p className="text-xs text-muted-foreground">
              Atualização automática a cada minuto enquanto esta aba estiver aberta. Última verificação:{" "}
              {new Date(dataUpdatedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
