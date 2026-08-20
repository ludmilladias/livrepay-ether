# LivrePay — Contexto do Produto

## Visão

O LivrePay é um sistema fintech de conta digital: cobrança (PIX), pagamentos (transferência PIX,
folha em lote, contas e tributos via boleto), cartões, recebíveis e relatórios, com o banco
(Postgres + RLS) como última linha de decisão sobre o que é permitido — não o front, não a API.

## Funcionalidades aprovadas

- Cadastro e autenticação de usuário (JWT + refresh token rotacionado).
- Conta com saldo em BRL, ledger imutável (`transactions`) e histórico auditável.
- Cobrança > PIX: emissão de cobrança PIX (copia-e-cola) via Ether.
- Pagamentos > Transferências: PIX para chave (CPF/CNPJ/e-mail/telefone/aleatória).
- Pagamentos > Folha: mesma via PIX, em lote atômico.
- Pagamentos > Contas e Tributos: pagamento de boleto por linha digitável via Ether.
- Webhook de confirmação de depósito e falha de saque, com idempotência.
- Recebíveis: agenda, contratos e adiantamento.
- Cartões: emissão/consulta com `last4` + token do emissor (nunca PAN/CVV completos).
- Relatórios e dashboard financeiro.
- Administração de usuários, papéis (roles) e auditoria.

## Stack

- Front: React + Vite + TypeScript + shadcn-ui + Tailwind.
- Back: Node.js/Express, validação com zod.
- Banco: Postgres puro (sem BaaS), RLS deny-by-default, roles sem escalação (`user_roles` +
  `has_role()` SECURITY DEFINER).
- Provedor bancário: Ether (autenticação, PIX, pagamento de boleto, câmbio/quotes, webhook).
- Infraestrutura: Docker Compose, custo controlado.

## Limites de escopo (fora do LivrePay hoje)

Não é bug, é decisão de produto ou limite do provedor Ether. Não implementar sem decisão formal:

- emissão de boleto para cobrar terceiros (a Ether só *paga* boleto, não *emite*);
- pagamento de boleto com saldo em cripto (o ledger do LivrePay é só BRL hoje);
- conta multi-moeda ou custódia de cripto própria;
- crédito, empréstimo ou antecipação automática sem regra de risco auditável;
- webhook com assinatura HMAC (não documentada pela Ether — usar segredo por header enquanto
  não disponível, e migrar assim que a Ether oferecer);
- qualquer chamada real de saque/pagamento contra a Ether de produção feita de forma automatizada
  por um agente — só o usuário, manualmente, com valor pequeno.
