# Playbook — Payment Incident

1. Identificar o pagamento/cobrança afetado (`id`, `status`, valor, provedor).
2. Verificar logs por `FALHA CRÍTICA` (débito sem envio e sem estorno) — tratar como prioridade
   máxima.
3. Confirmar no ledger (`transactions`) se houve débito, estorno ou crédito duplicado.
4. Se `processing` preso: consultar status na Ether antes de qualquer ação manual.
5. Nunca estornar manualmente um pagamento que efetivamente saiu na Ether — só o webhook ou
   reconciliação confirmada resolve.
6. Registrar causa raiz em Decision Ledger.
7. Security Reviewer + Compliance Reviewer validam antes de fechar o incidente.
8. Knowledge Capture com o cenário e a correção.
