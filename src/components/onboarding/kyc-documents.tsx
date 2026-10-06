import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Clock, FileUp, Loader2, RefreshCw, XCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import {
  uploadErrorMessage,
  useKycJourney,
  useUploadDocument,
  type ChecklistItem,
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

function UploadedRow({ item }: { item: ChecklistItem }) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border p-4">
      <div>
        <p className="font-medium text-sm">{item.label}</p>
        {item.uploadedAt && (
          <p className="text-xs text-muted-foreground">
            Enviado em {new Date(item.uploadedAt).toLocaleString("pt-BR")}
          </p>
        )}
      </div>
      <Badge variant="secondary" className="shrink-0">
        <CheckCircle2 className="h-3 w-3 mr-1" /> Enviado
      </Badge>
    </li>
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
      "Recebemos seus documentos e o banco parceiro está analisando. Você será liberado assim que a conta for aprovada. Esta página mostra a situação mais recente.",
  },
  approved: {
    title: "Conta aprovada",
    description: "Seu cadastro foi aprovado. Você já pode usar o painel.",
  },
  rejected: {
    title: "Cadastro recusado",
    description:
      "O banco parceiro não aprovou este cadastro. Não é possível enviar novos documentos por aqui. Entre em contato com o suporte do LivrePay para entender o motivo e os próximos passos.",
  },
  pending_unknown: {
    title: "Não conseguimos confirmar sua situação agora",
    description:
      "Seu cadastro foi iniciado, mas não conseguimos consultar o banco parceiro neste momento. Tente atualizar em instantes.",
  },
};

/**
 * Tela da jornada de KYC depois do cadastro: documentos (pendentes, enviados,
 * recusados) e situação da conta. Toda a lista vem do backend.
 */
export function KycDocuments() {
  const { signOut } = useAuth();
  const { stage, checklist, isFetching, isError, refetch } = useKycJourney();

  if (!stage || stage === "not_started") return null;

  const heading = HEADINGS[stage];
  const canUpload = stage === "awaiting_documents" || stage === "in_analysis" || stage === "pending_unknown";
  const hasPendingWork = !!checklist && (checklist.pending.length > 0 || checklist.rejected.length > 0);
  // Quem ainda deve documento fica nesta tela; os demais podem ir ao painel.
  const canGoToDashboard = stage !== "awaiting_documents";

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
                    Todos os documentos pedidos foram enviados. Agora é só aguardar a análise; atualize esta página
                    para acompanhar.
                  </AlertDescription>
                </Alert>
              )}
            </>
          )}

          <div className="flex flex-wrap gap-3 pt-2 border-t">
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
        </CardContent>
      </Card>
    </div>
  );
}
