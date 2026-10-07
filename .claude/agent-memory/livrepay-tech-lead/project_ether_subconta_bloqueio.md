---
name: ether-subconta-bloqueio
description: O bloqueio central do LivrePay em 2026-10 é não existir token por sub-conta na API da Ether; movimentação de dinheiro está desligada (503) por isso.
metadata:
  type: project
---

Desde 2026-10-02, `POST /charges/:id/emit` e `executePaymentForUser` retornam 503 deliberadamente.
Causa: a API da Ether deriva a conta inteiramente do bearer token (`/pix/deposit`,
`/pix/withdraw/pix-key`, `/account-balance` não aceitam nenhum identificador de conta no corpo),
e não existe, na spec nem em teste real, um emissor de token em nome da sub-conta criada por
`POST /users/profile-data`. `authenticateSubAccount(email,password)` exige senha do Cognito que
nunca é definida; `recoveryToken` tem escopo `registration_recovery` (~48h), não operacional.

**Why:** a Ether confirmou que conta pool não é permitida (cada cliente precisa de conta própria),
então o modelo antigo (token do participante para todo mundo) era risco regulatório e de
isolamento, não só bug.

**How to apply:** tratar como risco de viabilidade do fornecedor, não como tarefa de engenharia.
Não desenhar nada em cima do `recoveryToken`. Antes de propor religar PIX/pagamento, confirmar
que a Ether entregou (a) emissor de token por sub-conta ou (b) endpoints que aceitem `userId`
com o token de tenant. Ver também [[livrepay-evidencia-tres-niveis]].
