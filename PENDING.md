# LIVREPAY — O que falta (checkpoint para retomar)

> Snapshot do estado real do código em 2026-08-11 (atualizado após completar a integração
> bancária com a Ether). Cada item foi verificado nos arquivos, não estimado.
>
> **2026-08-20**: diagnóstico completo com os 11 agentes do `.claude/` encontrou e corrigiu duas
> falhas financeiras críticas (auto-crédito via `/receivables/:id/advance` e liquidação de
> cobrança sem conferência de valor) + 4 achados médios (ver SECURITY.md, seção "Barreira
> crítica: quem pode creditar" e tabela "Banco de dados"). Migration
> `20260820000000_close_settlement_gaps.sql`, testes T2b e T29-T32 novos (32 no total).

## Como retomar uma sessão

```bash
docker compose up -d --build   # .env já existe e está preenchido, inclusive Ether
npm run db:test              # 32 asserções no banco
bash server/tests/e2e.sh     # 48 asserções na API (NUNCA rode contra a Ether de produção sem querer mover dinheiro real)
cd server && npm run test:ether && cd ..  # retry/timeout do cliente Ether contra mock
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

**Atualização 2026-09-04 — causa real confirmada pelo suporte técnico da Ether (WhatsApp,
Roger Ferreira, time tec):** o diagnóstico acima (status de conta/KYC) estava incompleto. A
causa raiz real do `AUTH_KEY_001` é que `POST /auth/authenticate` gera um token de **usuário
final** (Cognito), não de **parceiro** (LivrePay). O token decodificado confirmou: sem claim
`aud`, `scope` apontando para `api.etherprivatebank.com.br` (domínio de e-mail corporativo,
não atende API) em vez do domínio de API correto. O fluxo correto para parceiro é M2M com API
Key de Integrador:

- Endpoint: `POST /auth/api-key` (não documentado na spec OpenAPI local — confirmado apenas
  por essa conversa com o suporte; a spec só documenta `/auth/authenticate` e descreve o
  security scheme `ApiKeyAuth` como "Bearer Token JWT originado do fluxo M2M utilizando sua
  API Key de Integrador", o que é consistente com a explicação do suporte).
- Corpo: mesmo formato já usado (`{clientId, clientSecret}`).
- `/auth/authenticate` continua correto para autenticar **sub-conta/cliente final** via
  Cognito (`authenticateSubAccount()` em `server/src/ether.js`) — não mexer nesse caminho.

**Teste real contra produção (2026-09-04)**: `POST /auth/api-key` com `{clientId, clientSecret}`
retornou **401 `{"message":"Unauthorized"}`** (não 404 — o endpoint existe). Consistente com o
próprio aviso do suporte na mesma mensagem: *"Escopo: configuração correta é
`https://api.etherdex.com/user` (ou `/participant`). O scope atual tá apontando pra outro
domínio."* — ou seja, o scope do client `rscjgeg0vbsjgbgu6fpq8ntc9` ainda está configurado
errado **do lado da Ether**, não é algo que o nosso payload possa corrigir. **Bloqueador
externo, sem ação possível do nosso lado até a Ether corrigir o scope do client.**

**Resposta completa do suporte técnico (Roger Ferreira, Ether) em 2026-09-04 — registrar como
fonte de verdade sobre pontos não documentados na spec OpenAPI local:**

1. **Auth**: `POST /auth/api-key` com Client ID + Secret é o caminho certo pra parceiro (✅
   implementado). Scope precisa ser `https://api.etherdex.com/user` (ou `/participant`) — ainda
   não corrigido do lado deles (ver teste acima).
2. **Base URL**: `https://api.etherglobalassets.com.br` (já é o que `ETHER_BASE_URL` usa,
   confirmado correto). `etherprivatebank.com.br` é só domínio de e-mail corporativo, **não
   atende API** — não usar para nada.
3. **Cadastro de cliente final**: `POST /users/onboarding` (CPF/CNPJ) + `POST /kyc/submissions`
   (documentos). Conta some para status `FULL` só após aprovação do KYC; enquanto pendente,
   endpoints protegidos retornam erro (comportamento esperado, não bug).
4. **Chave PIX**: `POST /pix/keys` (Email, Aleatória, CPF, CNPJ, Telefone) — exige KYC aprovado
   no cliente.
5. **Webhook — HMAC**: assinatura `HMAC-SHA256` no header `X-Signature`, formato
   `t=<timestamp>,v1=<hex_digest>`. Gerar o secret com `POST /webhooks/secret` (aparece **uma
   única vez**, precisa salvar). Requisições com mais de 5 minutos de timestamp são rejeitadas.
   **Correção 2026-09-04: a validação HMAC já está implementada em
   `server/src/routes/webhook.js` (linhas 137-196)** — a nota anterior aqui ("sem assinatura
   HMAC, ainda não implementado") estava desatualizada/errada. O que falta confirmar é se o
   valor atual de `ETHER_WEBHOOK_SECRET` (`.env`/produção) é de fato o secret retornado por
   `POST /webhooks/secret` da Ether, ou um valor local/placeholder — se for placeholder, o HMAC
   nunca vai bater e todo webhook real será rejeitado com "assinatura inválida" mesmo o código
   estando correto. **Verificar a origem desse valor antes de considerar resolvido.**
6. **⚠️ Contradiz a tabela da seção 1 acima**: *"Cobranças PIX: o módulo nativo ainda não tá no
   ar. O caminho hoje é gerar QR Code via `POST /pix/deposit` e receber a confirmação por
   webhook."* — a tabela da seção 1 marca "Cobrança > PIX: Emitir cobrança PIX (copia-e-cola)"
   como `✅ completo, testado`, usando o endpoint COMEX `/charges` (documentado no OpenAPI). Ou
   seja: **o suporte está dizendo que o módulo de cobrança nativo (COMEX `/charges`) não está
   no ar em produção**, mesmo estando na spec — precisa reconfirmar com eles se isso se refere
   à cobrança PIX genérica ou é específico de algum caso. **Não presumir que `/charges` funciona
   em produção sem reconfirmar** — pode ter sido testado só contra sandbox/mock antes.
7. **Estrutura de contas**: confirma o que já foi feito no commit `c1211e8`
   ("adaptar integração Ether para sub-contas individuais") — conta pool não funciona, cada
   cliente final precisa de conta própria (CPF/CNPJ + carteira separada), modelo recomendado é
   **sub-participants** vinculados ao cadastro principal com limites compartilhados, migração
   gradual permitida.

**Próximo passo**: responder ao Roger confirmando o teste do `/auth/api-key` (401, mesmo scope
mal configurado) e pedir confirmação/ETA da correção de scope, e esclarecer o ponto 6 (cobrança
PIX nativa via `/charges` está ou não em produção).

**Atualização 2026-09-04 (2ª resposta do suporte) — SUPERSEDE os pontos 1 e 3 acima:**

1. O suporte agora afirma que **`AUTH_KEY_001` não existe no sistema deles** — apesar de a API
   retornar esse código literalmente em todo endpoint protegido (evidência real, testada
   inclusive em `GET /users/onboarding`). Hipótese deles: token rejeitado por `aud` divergente
   do `endUserLoginClientId` cadastrado no participant. Nosso token client_credentials **não
   tem claim `aud`** (Cognito não emite `aud` nesse fluxo, só `client_id`) — se o validador
   exige `aud`, todo token nosso falha por construção. Config do lado da Ether.
2. `POST /auth/api-key` foi testado com Bearer + 10 formatos: sempre 401 (`AUTH_KEY_001` com
   Bearer, `Unauthorized` genérico sem). **Revertido**: `getParticipantToken()` voltou a usar
   `POST /auth/authenticate` (único endpoint documentado na spec e que emite token).
3. **Não existem** endpoints `accept-terms` nem `pep-declaration` — removidos de
   `server/src/ether.js`. Fluxo real de onboarding: usuário no Cognito → `POST
   /users/onboarding` com `identityDocument` (CPF/CNPJ) → `POST /kyc/submissions` → aprovação
   da Ether muda a conta de BASIC para FULL. Implementado em `submitOnboarding()` /
   `submitKyc()` e na rota `POST /auth/onboarding` (`server/src/routes/auth.js`).
4. Suporte pediu o header `Authorization: Bearer` completo para diagnosticar — token de
   diagnóstico gerado em `ether-token-diagnostico.txt` (fora do git, validade 1h) com claims
   decodificados: `client_id=rscjgeg0vbsjgbgu6fpq8ntc9`, sem `aud`, scope
   `https://api.etherprivatebank.com.br/user`, iss Cognito `us-east-2_BcbqtNJM3`.
5. **Bloqueador continua 100% externo**: nada no nosso request muda o `aud`/scope do token —
   isso é configuração do App Client / participant no Cognito da Ether. Aguardando diagnóstico
   deles com o token enviado.

Testes: `server/tests/ether.test.js` 6/6 OK (mock atualizado para `/auth/authenticate`).

**Sem assinatura HMAC no webhook** — a Ether só permite configurar a URL, sem header
customizado documentado no OpenAPI estudado. O segredo hoje só é aceito via header
`x-webhook-secret` — o fallback anterior de token na URL (`POST /ether/:token`) foi removido
porque path/query de proxy e CDN costumam ir parar em log, o que vazaria o segredo. Se a Ether
não suportar header customizado na configuração dela, falar com o suporte antes de reabrir
esse fallback. Peça HMAC ao suporte da Ether e migre quando disponível.

---

## 2. Módulos com dado 100% fictício (maior pendência restante)

Estas 12 páginas ainda são as telas geradas originalmente (fora deste ciclo de correções): arrays
hardcoded no componente, sem tabela no banco, sem rota na API.

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

### Relatórios (`src/pages/relatorios/`) — ✅ completo (Extratos, Conciliação, Financeiro)

Rota `server/src/routes/reports.js` + hook `src/hooks/use-reports.ts` — dados reais agregados
sobre `transactions`/`charges`/`payments`, sem tabela nova. Sem verificação e2e (o rito
`server/tests/e2e.sh` ainda não cobre `/reports/*`), então **confirmar em ambiente rodando**
antes de considerar totalmente encerrado.

- `GET /reports/cashflow` — fluxo de caixa 30 dias (dashboard do cliente, `Index.tsx`).
- `GET /reports/statement` — extrato real do ledger por período (`Extratos.tsx`).
- `GET /reports/reconciliation` — checagem de integridade cobrança/pagamento × lançamento no
  ledger (`Conciliacao.tsx`) — não é conciliação contra extrato bancário externo (a Ether não
  expõe esse feed), é auditoria interna de que `process_transaction()` gravou tudo.
- `GET /reports/financials` — DRE simplificada por mês/tipo (`Financeiro.tsx`).
- `GET /admin/reports/volume` — volume agregado de todas as contas para o dashboard admin,
  liberado por nova policy `transactions: staff le todas` (só leitura, staff = admin/compliance)
  em `db/migrations/20260821010000_reports_staff_read.sql`.

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
2. ~~Recebíveis~~ — ✅ feito (Agenda, Contratos, Adiantamento).
3. ~~Relatórios~~ — ✅ feito (Extratos, Conciliação, Financeiro) — falta rodar e2e num
   ambiente com docker disponível para confirmar ponta a ponta.
4. **Decidir emissor de cartão** (bloqueio de produto) antes de tocar em Cartões.
5. **Seguros** — depende de decisão de negócio sobre cotação.
6. Só depois disso, itens de infraestrutura (CI, deploy, observabilidade — ver
   `ESTIMATIVA-INFRAESTRUTURA.md` para o plano completo de produção).

## Segredos já configurados neste projeto

O `.env` deste projeto (`LIVREPAY SISTEMA NOVO/.env`, fora do git) já está preenchido com:
senhas de banco geradas, `JWT_SECRET`, `ETHER_WEBHOOK_SECRET` gerado, e
`ETHER_CLIENT_ID`/`ETHER_CLIENT_SECRET` copiados do projeto `livrepaymongo8-main`. O `.env`
antigo (Supabase, do backend no-code substituído por Postgres puro) foi substituído — não existe
mais backup dele, era config morta sem uso no código atual.
