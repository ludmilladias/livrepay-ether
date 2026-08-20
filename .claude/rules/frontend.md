---
paths:
  - "**/*.{ts,tsx,js,jsx,css,scss}"
  - "frontend/**/*"
---

# Frontend

- Use React/Vite/TypeScript e padrões atuais do repositório (shadcn-ui, Tailwind).
- Cubra loading, vazio, erro, saldo insuficiente e acesso negado.
- Exija confirmação explícita antes de qualquer saída de dinheiro: valor, favorecido, chave e
  saldo resultante visíveis antes de confirmar.
- Não considere controle visual (botão desabilitado, rota "protegida") como autorização — é UX,
  quem decide é o banco.
- Nunca exponha segredo de provedor nem token de sessão fora do fluxo de autenticação padrão.
- Preserve acessibilidade e responsividade.
