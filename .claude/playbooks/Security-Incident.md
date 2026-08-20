# Playbook — Security Incident

1. Rotacionar segredo comprometido (`JWT_SECRET`, senha do banco, credenciais Ether).
2. Revisar `audit_log` e `provider_events` para escopo do incidente.
3. `logout-all` nas contas afetadas.
4. Verificar `RLS`/policies não foram contornadas (procurar "Privilégio negado pelo banco" nos
   logs como sinal de tentativa).
5. Se houver dado pessoal exposto, avaliar comunicação à ANPD em até 72h (LGPD art. 48).
6. Security Reviewer produz relatório do incidente.
7. Registrar em Decision Ledger e Knowledge Capture.
