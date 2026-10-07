---
name: lacunas-interface-livrepay
description: Padrão recorrente no LivrePay — backend entrega dado/função que nenhuma tela consome (checklist de documentos, status de KYC, upload).
metadata:
  type: project
---

Casos confirmados por leitura de código em 2026-10-06:
- `POST /auth/onboarding` devolve `document_checklist`; `src/pages/Onboarding.tsx` navega para
  `/` e descarta. Nenhuma tela lista documentos pendentes.
- `uploadDocument()` existe em `server/src/ether.js` sem nenhuma rota Express que a exponha.
- `ether_account_status` é devolvido por `GET /auth/me` e `/auth/onboarding/status`, mas
  `ProtectedRoute`, sidebar e dashboard não leem — só o próprio `/onboarding` usa.

**Why:** o trabalho avançou pelo backend/integração e a interface ficou para trás; isso faz o
produto parecer mais pronto do que é e esconde o ponto exato onde a jornada quebra.

**How to apply:** em qualquer review, cruzar o que as rotas devolvem com o que as telas
consomem antes de classificar um item como "feito". Relacionado:
[[bloqueio-subconta-ether]].
