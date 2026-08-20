---
paths:
  - "tests/**/*"
  - "**/*.{test,spec}.{ts,tsx,js,jsx}"
---

# Testes

- Teste comportamento observável.
- Use contas e valores sintéticos — nunca dado financeiro real.
- Cubra autorização negativa (isolamento entre usuários: Bob não lê/cancela/executa nada da Alice).
- Teste double-spend (duplo clique em pagar), saldo insuficiente, retry de webhook e idempotência.
- Teste chamada ao provedor (Ether) sempre contra mock/sandbox — nunca produção com dinheiro real
  de forma automatizada.
- Não enfraqueça assertions.
- Registre traces, screenshots, console e rede.
- Rode `npm run db:test` e `bash server/tests/e2e.sh` antes de qualquer deploy.
