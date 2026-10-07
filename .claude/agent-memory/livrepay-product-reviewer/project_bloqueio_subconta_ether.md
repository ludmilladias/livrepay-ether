---
name: bloqueio-subconta-ether
description: O único bloqueio que impede o LivrePay de movimentar dinheiro de cliente real é a falta de token operacional em nome da sub-conta Ether; tudo mais é consequência.
metadata:
  type: project
---

Desde 2026-10-02, `POST /charges/:id/emit` e `executePaymentForUser` retornam `503`
deliberadamente (código antigo preservado como `emit-disabled` /
`executePaymentForUserDisabled`). Criação de conta PF na Ether (`POST /users/profile-data`)
já funciona contra produção.

**Why:** emitir PIX/pagar boleto usava o token do participante (conta pool da LivrePay), o
que contradiz a exigência da Ether de conta individual por CPF/CNPJ. Não existe mecanismo
confirmado para obter token em nome da sub-conta criada via `profile-data`
(`authenticateSubAccount` exige senha do Cognito da sub-conta, que ninguém define no fluxo).

**How to apply:** ao priorizar ou estimar qualquer coisa de produto, tratar esse item como
pré-requisito de tudo que envolve dinheiro. Consequência em cadeia: sem emitir cobrança não
há `provider_charge_id`, sem isso o webhook não credita, logo saldo é sempre 0 e pagamento
cai em saldo insuficiente. Verificar o estado atual em `server/src/routes/charges.js` e
`server/src/routes/payments.js` antes de recomendar — pode ter sido religado.
Relacionado: [[lacunas-interface-livrepay]].
