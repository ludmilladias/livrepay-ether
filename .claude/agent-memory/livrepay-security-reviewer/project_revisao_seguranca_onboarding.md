---
name: revisao-seguranca-onboarding-ether
description: Revisão de segurança de 2026-10-06 do onboarding Ether/PII — achados principais e pendências de higiene de credencial
metadata:
  type: project
---

Em 2026-10-06 foi feita a primeira revisão de segurança independente do bloco de onboarding
Ether (PII pesada) e da higiene de credenciais. Achados estruturais que tendem a reaparecer:

- O trigger `prevent_ether_field_tampering` (migration `20260901000000_ether_subaccounts.sql`)
  decide quem é serviço lendo a GUC `request.jwt.claim.role`, mas `withService()` em
  `server/src/db.js` só faz `SET LOCAL ROLE service_role` e nunca seta essa GUC. Qualquer
  gravação em `profiles.ether_*` por serviço cai no `raise exception`. Verificar isso antes de
  concluir que o onboarding persiste.
- Credenciais da Ether vivem em `nao-subir-ether-admin.env` (e-mail + senha do admin em texto
  claro) e `nao-subir-ether-apikey.txt` (clientId/clientSecret), ambos fora do git (glob
  `nao-subir*`) mas dentro de pasta sincronizada com OneDrive. Rotação do clientSecret e troca
  da senha do admin ficaram recomendadas e pendentes.
- Segredo de webhook ainda não entregue pela Ether; o código rejeita tudo quando vazio
  (guard correto) — logo o webhook está inoperante, não inseguro.

**Why:** a usuária pediu explicitamente que segurança não ficasse de fora do levantamento, e
esse diff (onboarding/PII/provedor) nunca tinha passado por revisão.

**How to apply:** em revisões futuras desse domínio, começar por [[SECURITY.md]] e checar se
esses três pontos foram fechados antes de relatar algo novo.
