---
paths:
  - "data/**/*"
  - "migrations/**/*"
  - "**/*.{sql,prisma,json}"
---

# Dados

- Defina dono, fonte, schema e retenção.
- Toda tabela nova habilita RLS no mesmo commit, com policy explícita por operação e
  `user_id uuid not null references auth.users`.
- Dinheiro é sempre `bigint` (centavos); nunca `float`/`double` em coluna monetária.
- Valide integridade e unicidade (ex.: `(provider, event_id)` único em eventos de webhook).
- Não usar dados financeiros reais em fixtures/testes.
- Mudança de schema exige compatibilidade e rollback.
- Exclusão/encerramento de conta deve considerar saldo, cobranças/pagamentos em aberto, cartões,
  tokens de sessão e `audit_log`.
