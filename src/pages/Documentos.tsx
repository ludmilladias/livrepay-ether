import { KycDocuments } from "@/components/onboarding/kyc-documents";

/**
 * "Meus documentos" dentro do painel: mesma lista e mesmo envio da tela de abertura
 * de conta, mas sem sair do painel e disponível mesmo depois da aprovação.
 */
const Documentos = () => (
  <div className="space-y-6">
    <div>
      <h1 className="text-2xl font-bold">Meus documentos</h1>
      <p className="text-sm text-muted-foreground">
        Documentos da abertura da sua conta no banco parceiro: o que falta enviar, o que já foi enviado e o que foi
        recusado.
      </p>
    </div>
    <KycDocuments embedded />
  </div>
);

export default Documentos;
