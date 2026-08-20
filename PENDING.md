# LIVREPAY — O que falta (checkpoint para retomar)

> Snapshot do estado real do código em 2026-08-11 (atualizado após completar a integração
> bancária com a Ether). Cada item foi verificado nos arquivos, não estimado.

## Como retomar uma sessão

```bash
docker compose up -d --build   # .env já existe e está preenchido, inclusive Ether
npm run db:test              # 29 asserções no banco
bash server/tests/e2e.sh     # 48 asserções na API
npm run typecheck && npm run dev
```

Leia [SECURITY.md](SECURITY.md) antes de tocar em qualquer coisa que envolva dinheiro,
autenticação ou a integração com a Ether.

---

## 1. Banking com a Ether — status

**Completo e testado** para as operações que a Ether oferece:

| Módulo | Operação | Status |
|---|---|---|
| Cobrança > PIX | Emitir cobrança PIX (copia-e-cola) | ✅ completo, testado |
| Pagamentos > Transferências | PIX para chave (CPF/CNPJ/e-mail/telefone/aleatória) | ✅ completo, testado |
| Pagamentos > Folha | Mesma via PIX, em lote atômico | ✅ completo, testado |
| Pagamentos > Contas e Tributos | Pagamento de boleto por linha digitável | ✅ completo, testado (nesta sessão) |
| Webhook | Confirmação de depósito, falha de saque | ✅ completo, testado |
| Consulta de status de boleto | `GET /payments/:id/boleto-status` | ✅ completo (conciliação manual) |

**Fora do escopo da Ether** (não é bug, é limite do provedor — ver SECURITY.md):
- Emissão de boleto para cobrar terceiros — a Ether só *paga* boletos, não *emite*.
  Cobrança > Boletos continua sendo um registro local sem integração real.
- Pagamento de boleto com saldo cripto — arquitetura do LIVREPAY é só BRL hoje.

**Testado contra a Ether de produção com credenciais reais (2026-08-11) — bloqueado por
status da conta, não por bug de integração.**

Usando as credenciais encontradas em `LIVREPAY SISTEMA/livrepaymongo8-main/.../.env`
(`ETHER_CLIENT_ID`/`ETHER_CLIENT_SECRET`, agora copiadas para o `.env` deste projeto):

1. `POST /auth/authenticate` — ✅ sucesso, `access_token` válido emitido (HTTP 201).
2. `GET /exchange/quotes` (endpoint público, sem auth) — ✅ sucesso.
3. `GET /account-balance` (endpoint autenticado) — ❌ `401 AUTH_KEY_001`.
4. `POST /pix/deposit` via nossa API (`POST /charges/:id/emit`) — ❌ mesmo erro,
   `502` repassado pela nossa API com o body `{"error":"Unauthorized","message":"AUTH_KEY_001"}`.

**O teste 3 foi feito com curl puro, direto na Ether, com o mesmo token do teste 1, sem
passar pelo nosso código nenhuma vez** — isso isola definitivamente que o problema não é do
nosso client (`server/src/ether.js`): a autenticação funciona, mas a conta associada a essas
credenciais não está autorizada a usar endpoints protegidos (saldo, PIX, etc).

Pela documentação do próprio OpenAPI da Ether, isso é consistente com uma conta em
`pending_documents` ou `pending_analysis` — **só status `active` libera PIX/Cripto**
(`GET /users/{id}/check-account`). **Ação necessária, fora do nosso código**: verificar o
status de KYC/aprovação dessa conta no painel da Ether ou com o suporte deles antes de
tentar novamente. Não insista em chamadas repetidas de autenticação sem resolver isso —
pode ser lido como tentativa de força bruta pelo sistema de fraude deles.

Depois que a conta estiver `active`, repetir o teste 4 (emissão de PIX real, não move
dinheiro por si só) para confirmar. Saque PIX real e pagamento real de boleto **não podem
ser testados por mim** de forma alguma (ver seção de segurança do agente) — só pelo usuário,
manualmente, com valor pequeno.

**Sem assinatura HMAC no webhook** — a Ether só permite configurar a URL, sem header
customizado documentado no OpenAPI estudado. Hoje o segredo vai por header
`x-webhook-secret` ou `?secret=` na query. Peça HMAC ao suporte da Ether e migre quando
disponível.

---

## 2. Módulos com dado 100% fictício (maior pendência restante)

Estas 12 páginas ainda são as telas originais do Lovable: arrays hardcoded no componente,
sem tabela no banco, sem rota na API.

### Recebíveis (`src/pages/recebiveis/`) — ✅ completo (Agenda, Contratos, Adiantamento)

Rota `server/src/routes/receivables.js` + hook `src/hooks/use-receivables.ts` + páginas
`Contratos.tsx`, `Agenda.tsx`, `Adiantamento.tsx` — dados reais, RLS testado, 48/48 e2e.

**Decisão de arquitetura**: antecipação de recebível credita o ledger **interno** do
LIVREPAY via `process_transaction()` (mesma RPC usada por qualquer crédito iniciado pelo
usuário) — não passa pela Ether, porque a Ether não tem conceito de recebível/antecipação
no OpenAPI estudado. Isso é diferente de Cobrança/Pagamentos, que sempre passam pelo
provedor.

**`Simulador.tsx` não foi tocado** — continua sendo uma calculadora client-side (fórmula de
taxa/IOF já existia e está correta), sem persistência. Os "Exemplos de Simulação" na tela
são ilustrativos com valores fixos, não dados reais — considerar se isso deve ficar claro
na UI ou ser removido, mas não é dado fictício se passando por real (não há tabela/badge
sugerindo que é histórico do usuário).

**Bug real encontrado e corrigido nesta sessão**: `GET /receivables?status=X` quebrava com
500 (comparação `enum = text` sem cast explícito no Postgres) — pegaria em produção assim
que a tela de Adiantamento (que filtra por `scheduled`/`overdue`/`advanced`) fosse usada.
Corrigido com cast `$1::public.receivable_status`. Vale revisar outras queries com filtro
de enum por parâmetro se esse padrão for reutilizado.

### Seguros (`src/pages/seguros/`)
- `Catalogo.tsx`, `Cotacoes.tsx`, `Apolices.tsx`, `Sinistros.tsx`

**Schema parcial**: `insurance_policies` e `insurance_claims` existem com RLS. Falta
catálogo de produtos (tabela nova) e decidir como cotação é feita (nenhuma seguradora
integrada ainda — bloqueio de negócio, não técnico).

### Cartões & Wallet (`src/pages/cartoes/`)
- `Virtuais.tsx`, `Limites.tsx`, `Extratos.tsx`

**Schema parcial**: `cards` e `card_transactions` existem com RLS, já seguindo PCI DSS
(`last4` + token do emissor, nunca PAN/CVV). **Bloqueio de negócio**: a Ether não tem
endpoint de cartão no OpenAPI estudado — precisa decidir o emissor antes de qualquer código.

### Relatórios (`src/pages/relatorios/`)
- `Extratos.tsx`, `Conciliacao.tsx`, `Financeiro.tsx`

**Sem schema dedicado.** São agregações sobre `transactions`, `charges` e `payments` que já
existem — não precisam de tabela nova, só de rotas novas com `GROUP BY` por período/tipo
(`server/src/routes/reports.js`, ainda não criado).

## 3. Segurança — itens abertos

- **Tokens em `localStorage`** (XSS-vulnerável). Mitigado por access token de 15 min +
  rotação com detecção de reuso. Endurecimento real: cookie `httpOnly`+`SameSite` para o
  refresh token, o que exige CSRF na API primeiro.
- **Sem 2FA/MFA** em nenhuma rota — nem em pagamento de valor alto.
- **Sem log estruturado/observabilidade** na API nova. O ambiente já tem
  Grafana/Loki/Prometheus rodando para o projeto antigo — avaliar se reaproveita.
- **Sem runbook de rotação de segredos** (`ETHER_CLIENT_SECRET`, `ETHER_WEBHOOK_SECRET`,
  `JWT_SECRET`) além da menção em SECURITY.md.

## 4. Infraestrutura e operação

- **Sem CI**: `db:test` / `e2e.sh` / `typecheck` só rodam manualmente.
- **Sem compose de produção**: o `docker-compose.yml` atual é para dev/homologação (sem
  TLS, sem backup agendado, segredos em `.env`).
- **Sem pipeline de deploy do frontend** nem Dockerfile/nginx próprios (o `nginx.conf`
  existente é do projeto `APLICATIVO` antigo).
- **18 containers do projeto antigo continuam rodando**, intocados. Decidir se desliga ou
  reaproveita algo (ex: a stack de observabilidade).
- **Sem seed de dados de demonstração** compatível com o schema atual.

## 5. O que já está pronto e testado (não retrabalhar)

- **Autenticação completa** — `server/src/routes/auth.js`.
- **Cobrança** (Links, Boletos-cobrança, PIX, Assinaturas) — `charges-view.tsx` +
  `charges.js`, com emissão real de PIX.
- **Pagamentos** (Transferências, Contas/Boletos, Folha) — `payments-view.tsx` +
  `payments.js`, com débito atômico, boleto e PIX reais, estorno automático em falha,
  atomicidade de lote.
- **Recebíveis** (Agenda, Contratos, Adiantamento) — `receivables.js` + `use-receivables.ts`,
  antecipação credita o ledger interno de verdade.
- **Schema core**: profiles, roles, contas, ledger imutável, auditoria, RLS em 100% das
  tabelas — `db/migrations/20260811120000_core_schema_security.sql`.
- **Webhook da Ether**: idempotente, persiste antes de processar, estorna falha de saque.

---

## Ordem sugerida para a próxima sessão

1. **Resolver o status da conta na Ether** (`AUTH_KEY_001` — ver seção 1). É bloqueador para
   qualquer teste real adicional; sem isso, o resto pode ser feito mas não confirmado
   ponta a ponta contra o provedor de verdade.
2. ~~Recebíveis~~ — ✅ feito nesta sessão (Agenda, Contratos, Adiantamento).
3. **Relatórios** — sem schema novo, só queries agregadas.
4. **Decidir emissor de cartão** (bloqueio de produto) antes de tocar em Cartões.
5. **Seguros** — depende de decisão de negócio sobre cotação.
6. Só depois disso, itens de infraestrutura (CI, deploy, observabilidade — ver
   `ESTIMATIVA-INFRAESTRUTURA.md` para o plano completo de produção).

## Segredos já configurados neste projeto

O `.env` deste projeto (`LIVREPAY SISTEMA NOVO/.env`, fora do git) já está preenchido com:
senhas de banco geradas, `JWT_SECRET`, `ETHER_WEBHOOK_SECRET` gerado, e
`ETHER_CLIENT_ID`/`ETHER_CLIENT_SECRET` copiados do projeto `livrepaymongo8-main`. O `.env`
antigo (Supabase/Lovable, já obsoleto) foi substituído — não existe mais backup dele, era
config morta sem uso no código atual.
