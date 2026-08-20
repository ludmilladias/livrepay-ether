---
paths:
  - "backend/**/*"
  - "server/**/*"
  - "src/**/*.{ts,js}"
---

# Backend

- Use Node.js/Express conforme convenções do repositório; valide entrada com zod.
- Toda query de negócio abre a transação com `set_config('request.jwt.claim.sub', ...)` +
  `SET LOCAL ROLE authenticated` — nunca confie em `WHERE user_id = ...` solto sem RLS por trás.
- Use idempotência em webhook e em qualquer chamada ao provedor (Ether) que possa ser reentregue.
- Não permita acesso por ID sem verificação de propriedade via RLS.
- Nunca escreva direto em `accounts.balance_cents` ou em `transactions` — sempre pela função de
  movimentação (`process_transaction()` ou equivalente).
- Registre eventos e logs sem dados sensíveis (sem PAN/CVV, sem segredo de webhook, sem token).
- Centralize regras de limite/plano; não hardcode limite espalhado pelas rotas.
- Segredo de provedor (`clientId`/`clientSecret` da Ether) só existe no servidor — nunca em
  variável exposta ao bundle do navegador (`VITE_*`).
