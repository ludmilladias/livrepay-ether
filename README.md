# LivrePay

Plataforma financeira: cobrança (PIX, boleto, link, assinatura), pagamentos (transferência PIX,
folha em lote, contas e tributos), recebíveis, cartões e relatórios — com Postgres puro (RLS)
como última linha de segurança e a [Ether Global Assets](https://etherglobalassets.com.br) como
provedor bancário (PIX e pagamento de boleto).

- [SECURITY.md](SECURITY.md) — modelo de segurança. Leia antes de tocar em dinheiro, autenticação
  ou na integração com a Ether.
- [PENDING.md](PENDING.md) — checkpoint do estado real do código (o que é dado real, o que ainda
  é tela de demonstração).
- [CLAUDE.md](CLAUDE.md) — comandos e arquitetura para quem for desenvolver no repositório.

## Stack

- Front: React + Vite + TypeScript + shadcn-ui + Tailwind.
- API: Node.js/Express (`server/`), validação com zod.
- Banco: Postgres 16 puro, sem BaaS — RLS deny-by-default em toda tabela de negócio.
- Provedor bancário: Ether Global Assets (PIX, boleto, webhook).

## Rodando localmente

```sh
cp .env.example .env    # preencha senhas, JWT_SECRET (32+ caracteres) e credenciais da Ether
docker compose up -d --build   # Postgres + API

cd server && npm install && cd ..
npm install
npm run dev              # front em http://localhost:8080, API em http://localhost:8081
```

Testes:

```sh
npm run db:test                    # segurança do banco (RLS, ledger, double-spend...)
bash server/tests/e2e.sh           # ponta a ponta contra a stack real — NUNCA em produção
cd server && npm run test:ether    # retry/timeout do cliente Ether, contra mock
```

## Comandos

```sh
npm run dev          # dev server (Vite)
npm run build        # build de produção
npm run lint          # eslint
npm run typecheck     # tsc --noEmit
npm run db:backup     # dump do Postgres (bash db/backup.sh)
```
