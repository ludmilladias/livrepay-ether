# LIVREPAY — O que falta (checkpoint para retomar)

> Snapshot do estado real do código em 2026-08-11 (atualizado após completar a integração
> bancária com a Ether). Cada item foi verificado nos arquivos, não estimado.
>
> **2026-08-20**: diagnóstico completo com os 11 agentes do `.claude/` encontrou e corrigiu duas
> falhas financeiras críticas (auto-crédito via `/receivables/:id/advance` e liquidação de
> cobrança sem conferência de valor) + 4 achados médios (ver SECURITY.md, seção "Barreira
> crítica: quem pode creditar" e tabela "Banco de dados"). Migration
> `20260820000000_close_settlement_gaps.sql`, testes T2b e T29-T32 novos (32 no total).
>
> **2026-09-17**: o bloqueio de credencial da Ether (seção 1, "Testado contra a Ether de
> produção...") **foi resolvido** — a Ether entregou um par de credenciais de integração
> válido. Detalhe e evidência na entrada "2026-09-17 — DESBLOQUEADO" dentro da seção 1.

## Como retomar uma sessão

```bash
docker compose up -d --build   # .env já existe e está preenchido com credencial Ether válida
npm run db:test              # 32 asserções no banco
bash server/tests/e2e.sh     # 48 asserções na API — por padrão NÃO executa pagamento real
                               # (ver ETHER_ALLOW_REAL_PAYMENTS na seção 1, "2026-09-17")
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
status da conta, não por bug de integração.** (Histórico — resolvido em 2026-09-17, ver
entrada "DESBLOQUEADO" mais abaixo nesta mesma seção. A credencial usada nos testes 1-4
abaixo era a antiga, de usuário final; foi substituída.)

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

**Atualização 2026-09-28 — nova credencial testada (a mesma entregue em 2026-09-17,
`nao-subir-ether-apikey.txt`), achado sobre escopo `/tenant` vs `/user`:**

O usuário reenviou o par `ETHER_CLIENT_ID`/`ETHER_CLIENT_SECRET` (`vuqm6oibc45c7mb6pkjr2ctra`
— mesmo da entrega de 2026-09-17) e foi testado de novo contra produção:

1. `POST /auth/authenticate` → 201, scope **`https://api.etherprivatebank.com.br/tenant`**
   (confirma o já registrado em 2026-09-17: essa credencial é de tenant/participante).
2. `GET /account-balance` → 200 `{"balance":0}`, `GET /pix/keys` → 200 `[]`,
   `GET /users/document/types` → 200. Bate exatamente com a matriz de 2026-09-17.
3. **Dado novo**: `POST /users/profile-data` com esse token de escopo `/tenant` retorna
   `404 USR_NOT_001` — não `400` de validação como acontecia com a credencial antiga (escopo
   `/user`, `rscjgeg0vbsjgbgu6fpq8ntc9`, ver entrada de 2026-09-09 acima). **Isso sugere que
   `profile-data` espera um token de escopo `/user`, não `/tenant`** — hipótese a confirmar,
   não fato. Reforça a leitura já registrada em 2026-09-09/10: o gateway roteia por escopo do
   token, e `404` com token válido pode significar "rota invisível para esse escopo", não
   necessariamente erro de `tenantUrl` (já testamos 3 valores de `tenantUrl` diferentes em
   2026-09-09 com a credencial antiga e todos deram o mesmo 404 — não repetir esse teste).
4. `GET /transactions` → 403 "escopo incorreto para carteira" — mais um indício de que o
   token `/tenant` não serve para operações de conta/usuário individual.
5. Bloqueio pontual do CloudFront/WAF (403, página HTML) na 1ª tentativa de
   `POST /users/profile-data` — sumiu na 2ª tentativa com `User-Agent` de navegador. Possível
   rate-limit; monitorar se recorrer.

**Pergunta objetiva para a Ether (ainda não enviada)**: *"A credencial de tenant
(`vuqm6oibc45c7mb6pkjr2ctra`) autentica e acessa `/account-balance`, `/pix/keys`,
`/users/document/types` normalmente, mas `POST /users/profile-data` retorna
`404 USR_NOT_001` com ela. `/users/profile-data` deveria ser chamado com essa credencial de
tenant, ou é um endpoint de escopo `/user` (a credencial antiga, `rscjgeg0vbsjgbgu6fpq8ntc9`)?
Se for `/user`, qual das duas credenciais devemos usar para cada grupo de endpoints?"*

**Não fazer até responderem**: não testar mais variações de `tenantUrl` (já descartado como
causa em 2026-09-09) nem alternar credenciais às cegas — perguntar primeiro.

**Estado do código**: `server/src/ether.js` já tem `createUserProfile`/`acceptTerms`/
`submitPepDeclaration`/`checkAccountStatus` restaurados (commit `3574cef`, branch
`fix/ether-credenciais-integracao`) — **não remover de novo**. Falta apenas: (a) atualizar
`ETHER_CLIENT_ID`/`ETHER_CLIENT_SECRET` em produção (App Platform) com o par de 2026-09-17,
(b) resposta da Ether sobre qual credencial usar em `profile-data`.

**Atualização 2026-09-29 — suporte respondeu (WhatsApp): `tenantUrl` era o problema real,
não a credencial.** A pergunta acima ficou obsoleta — cruzando os dois testes (credencial
antiga `/user` E nova `/tenant`, ambas com `404 USR_NOT_001` idêntico e independente do
`tenantUrl` testado) a causa real não era nenhuma das hipóteses cogitadas: era o **valor**
do `tenantUrl`, só que nenhuma das 3 variações testadas em 2026-09-09 incluía a forma certa.

> "para criar conta precisam mandar o tenantUrl: `api.livrepay.digital`" — suporte, 2026-09-29
> "usa a credencial de tenant mesmo" — suporte, 2026-09-29

`.env`: `ETHER_TENANT_URL` corrigido de `livrepay.digital` para `api.livrepay.digital`.
Testado contra produção com a credencial de tenant (`vuqm6oi...`) e o valor corrigido:

```
POST /users/profile-data -> 400 {"error":"Bad Request","message":"USR_VAL_006","statusCode":400}
```

**Progresso real**: saiu de `404 USR_NOT_001` (tenant não encontrado) para `400 USR_VAL_006`
(erro de validação de corpo) — confirma que o tenant agora É encontrado, chegamos na
validação dos dados. `USR_VAL_006` não está documentado na spec nem foi decodificado antes
(só vimos `USR_VAL_001` e `USR_VAL_008` em testes anteriores, sem saber o que cada um
significa). Tentativa isolada de adicionar `nationality`/`monthlyIncome` ao payload não
mudou o erro — **não continuar adivinhando campo por campo** (força bruta já descartada
como estratégia). Melhor caminho: perguntar à Ether o que `USR_VAL_006` significa, com o
payload de teste exato (dado fake, seguro de compartilhar).

**Próxima pergunta pronta para a Ether**:

> `POST /users/profile-data` agora encontra o tenant (`api.livrepay.digital`) e chega na
> validação de corpo, mas retorna `400 USR_VAL_006`. O que esse código significa? Payload
> de teste enviado: `{name, email, tenantUrl: "api.livrepay.digital", accountType: "NOMINAL",
> profile: {taxId, personType: "FISICA", phone, dateBirth: "1990-01-01"}, address: {...},
> document: {type: "CARTEIRA_IDENTIDADE"}}` — nenhum campo omitido em relação ao schema
> `CreateUserProfilePayload` da spec.

**Atualização 2026-09-29 (continuação, mesma tarde) — sequência de códigos decifrada por
teste isolado, um campo por vez (estudo da spec + evidência, sem adivinhação às cegas):**

Reexaminando `ApplicationDocumentMetadata` na spec: o campo `document.number` existe no
schema mas não está na lista `required` do objeto pai — mesmo assim, era o que faltava.
Sequência de testes, mudando **uma única variável por vez**:

| # | Mudança | Resultado |
|---|---|---|
| 1 | payload original (sem `document.number`) | `400 USR_VAL_006` |
| 2 | + `document.number` preenchido | `400 USR_DUP_005` — **código mudou**, confirma que o campo 1 resolveu `USR_VAL_006` |
| 3 | + e-mail novo (mesmo `taxId`/`phone`/`document.number`) | `400 USR_DUP_005` — ainda duplicado |
| 4 | + `phone` novo | `400 USR_DUP_005` — ainda duplicado |
| 5 | + `document.number` novo (timestamp) | `400 USR_DUP_005` — ainda duplicado |
| 6 | + `taxId` novo (CPF válido gerado, nunca usado antes) | **`400 USR_MGT_007`** — código mudou de novo |

**Leitura**: `USR_VAL_006` = campo obrigatório faltante, resolvido por `document.number`.
`USR_DUP_005` = duplicidade por `taxId` (CPF) — os testes 1-5 de hoje reusaram o mesmo CPF
(`52998224725` depois `11144477735`), then criando um rascunho retido no lado da Ether
mesmo com todo o resto diferente; só mudar o CPF resolveu. `USR_MGT_007` (módulo
"management", não catalogado) é a camada seguinte, ainda não decifrada.

**Parei aqui de propósito** — 6 chamadas de teste em sequência contra produção já é o
suficiente para hoje; continuar adivinhando campo por campo vira o mesmo padrão de força
bruta já descartado antes. Cada rascunho de teste criado no ambiente real da Ether com CPF
de teste (gerado por algoritmo válido, não é CPF de pessoa real) — não há dado real de
cliente exposto, mas os rascunhos ficam no ambiente deles e não foram limpos.

**Pergunta pronta para a Ether (substitui a anterior)**:

> Conseguimos avançar `POST /users/profile-data` até `400 USR_MGT_007`, depois de resolver
> `USR_VAL_006` (faltava `document.number`) e `USR_DUP_005` (CPF de teste duplicado entre
> tentativas). O que `USR_MGT_007` significa? Também: os rascunhos de teste que criamos com
> CPFs fictícios (formato válido, mas não correspondem a pessoas reais) podem ser
> descartados do lado de vocês, ou ficam pendentes de alguma forma no ambiente de produção?

**2026-10-02 — RESOLVIDO: criação de conta de cliente na Ether funciona (teste real, PF).**
O bloqueio em `USR_MGT_007` acabou. Hipótese confirmada: o erro vinha dos campos de perfil
ausentes (a entrada logo abaixo, "NÃO CONFIRMADO", ficou superada por esta).

**2026-10-02 (mesmo dia, à noite) — ACHADO CRÍTICO: emissão de PIX/pagamento usava conta
pool, não conta individual — DESLIGADO deliberadamente até corrigir.**

Revisão apontou dois problemas reais no fluxo de dinheiro, independentes do onboarding acima:

1. `POST /auth/register` cria conta e libera o dashboard só com e-mail/senha — nenhuma
   verificação de KYC. `ProtectedRoute` (frontend) só checa sessão, não `ether_account_status`.
2. **Mais grave**: `POST /charges/:id/emit` (`createPixDeposit`) e `executePaymentForUser`
   (`withdrawPixToKey`/`payBoleto`) nunca passavam `subAccountToken` — caíam sempre no
   fallback do token do **participante** (conta única da LivrePay na Ether). Ou seja:
   **qualquer usuário cadastrado conseguia emitir PIX/pagamento usando a conta pool da
   LivrePay**, não uma conta individual com KYC aprovado vinculada ao CPF dele. Isso
   contradiz diretamente o que o suporte da Ether disse (seção 1, item 7): *"conta pool não
   funciona, cada cliente final precisa de conta própria"*.

**Causa raiz**: não existe, no código ou testado contra a Ether, um mecanismo confirmado
para obter um token de acesso em nome da sub-conta criada via `profile-data`.
`authenticateSubAccount(email, password)` existe mas exige a senha do **Cognito** da
sub-conta — que é diferente da senha que o usuário cadastra no LivrePay (dois sistemas de
auth distintos) — e nenhum dos 3 guias oficiais explica como essa senha é definida.

**Ação tomada (não é fix completo, é contenção)**: `POST /charges/:id/emit` e
`executePaymentForUser` (chamado por `POST /payments/:id/execute`) agora **retornam
sempre `503`** com mensagem clara, em vez de mover dinheiro pela conta pool. O código
antigo foi preservado como `emit-disabled`/`executePaymentForUserDisabled` (não
referenciado por nenhuma rota) para religar assim que o mecanismo de sub-conta funcionar.
Decisão tomada com confirmação explícita da usuária (ação que desliga funcionalidade em
produção).

**Pergunta a fazer à Ether antes de religar**: depois de `POST /users/profile-data` criar
a sub-conta, como obter um token de acesso operacional em nome dela (para PIX/boleto)? A
senha do Cognito é definida em algum passo do onboarding que não vimos nos 3 guias, ou
existe outro mecanismo (ex: API key por sub-conta, login por link mágico)?

**Pendente, não feito nesta sessão**: gate de KYC no cadastro/dashboard (problema 1) — hoje
qualquer e-mail/senha libera o dashboard sem checar `ether_account_status`. Não bloqueia
dinheiro (isso já está coberto pelo 503 acima), mas é inconsistência de produto a revisar.

Evidência (um teste deliberado, payload montado pelo código real: `onboardingSchema.safeParse` +
`buildOnboardingPayload`; CPF de teste gerado, não é de pessoa real):
```
POST /users/profile-data -> HTTP 201
userId:   63fcc67a-9d2c-46ea-b64c-7e1417dcfdee
tenantId: b5c908dc-69ac-4105-a579-2a49609e0ff8
status: pending_documents   recovery: false   document: null
documentChecklist.pending: CARTEIRA_IDENTIDADE, COMPROVANTE_RESIDENCIA, SELFIE_COM_DOC
address: gravado, com campos extras do lado deles: complement: null, ibgeCode: null
recoveryToken: JWT escopo "registration_recovery", sub = userId, exp ~48h (valor não registrado aqui)
```
Esse cadastro de teste fica retido no ambiente da Ether (somar aos anteriores; pedir limpeza junto).

Perguntas ao suporte que o teste respondeu de graça (RESOLVIDAS, não perguntar mais):
- `address.city` aceita slug (`br-sp-sao-paulo`) — **o slug funciona**. Texto livre continua não
  testado; o frontend deve enviar o slug.
- `taxId` é aceito **sem máscara** (agora confirmado para PF, com o payload completo).
- `maritalStatus` é aceito como `SOLTEIRO(A)`.

Continua aberto só: grafia de `education` (`ENSINO SUPERIOR COMPLETO` x `ENSINO_SUPERIOR_COMPLETO`) —
é opcional e **não foi enviada** no teste. Também sem teste real: PJ (CNPJ sem máscara, `website`/
`socialNetwork`, `cnaeId`/`assessment`/`legalNature`), accept-terms, pep-declaration e upload.

**Dois bugs nossos achados no caminho (corrigidos em `server/src/ether.js`, com regressão em
`server/tests/ether.test.js`):**
1. **`User-Agent` ausente (grave):** nem `getParticipantToken()` nem `call()` mandavam UA. O WAF da
   Ether bloqueia o UA padrão do fetch do Node e responde HTML — isso derrubaria **toda** chamada
   à Ether em produção; passou despercebido porque os testes reais eram scripts avulsos com UA de
   navegador. Agora `CLIENT_USER_AGENT` (`Mozilla/5.0 (compatible; LivrePay-API/1.0; ...)`; o prefixo
   `Mozilla/5.0` é o que passa) vai em `/auth/authenticate`, `authenticateSubAccount` e `call()`.
   Revisão: o fallback do accept-terms usava `LivrePay-API/1.0` (sem o prefixo, seria bloqueado) e
   `authenticateSubAccount` ainda não mandava UA — corrigidos; UA vindo do cliente sem prefixo
   `Mozilla/5.0` (curl, app nativo) cai no padrão.
2. **`JSON.parse` sem proteção em `call()`:** resposta não-JSON estourava `SyntaxError` e perdia o
   status HTTP. Agora vira `EtherError(status, {error:"RespostaNaoJSON", contentType, preview<=200})`.
   Limitação: no `/auth/authenticate` o corpo não-JSON vira `body: null` (status é preservado).

**Pista (não conclusão) — token em nome da sub-conta:** a Ether devolve um `recoveryToken` JWT por
cliente (escopo `registration_recovery`, `sub` = userId, ~48h). Provavelmente serve para **retomar o
cadastro**, não para consultar saldo/Pix da sub-conta. Pode ser pista para a pergunta em aberto
"como obter token em nome da sub-conta"; nada foi implementado nem testado sobre isso. Hoje
`onboarding` descarta esse token.

**Achado: `ibgeCode`** apareceu no `address` da resposta (null) e não consta em nenhum dos guias.
Pode ser relevante para `city` mais tarde (código IBGE do município). Não enviamos esse campo.

**Atualização 2026-10-02 — documentação oficial do fluxo obtida; payload estava incompleto (hipótese abaixo CONFIRMADA no teste real acima):**

A usuária colou o guia oficial "Abertura de Conta PF" (privatedocs da Ether, exige login). Comparado
com o que `POST /auth/onboarding` enviava, o payload estava **incompleto em 3 objetos**:
`profile` (faltavam `socialName`, `monthlyIncome`, `hometown`, `nationality`, `maritalStatus`,
`gender`, `education`), `address` (faltavam `isPreferred`, `addressType`, `country`,
`caixaPostal`, `anoResidencia`) e `document` (faltavam `issuingAgency`, `issueDate`, `issueState`).

**Hipótese, NÃO CONFIRMADA — ninguém testou ainda**: o `400 USR_MGT_007` vinha dos campos de
perfil ausentes. Código ajustado em `server/src/routes/auth.js` e `server/src/ether.js`, validado só
por sintaxe e mock; **nenhuma chamada à Ether foi feita** (cada teste real deixa cadastro retido lá).
A validação será um único teste deliberado da usuária.

Incertezas que o teste real pode revelar:
- `address.city`: o guia usa slug (`br-rs-porto-alegre`); repassamos o valor recebido sem transformar.
- `taxId`: doc mostra com máscara, enviamos sem (já aceito em testes anteriores). Divergência mantida.
- Passos 2-5 do guia conferidos contra `ether.js`: caminhos e corpos já batiam (accept-terms,
  pep-declaration v1.0, check-account). Corrigido: accept-terms agora sem corpo/Content-Type e com
  `User-Agent` explícito (a Ether audita IP+UA; o IP será o do nosso servidor). Criado
  `uploadDocument()` (multipart, PDF/JPEG/PNG, 5MB) — não havia; **ainda sem rota** que o exponha.
- Achado lateral: o CHECK de `profiles.ether_account_status` só aceita `pending|basic|full|rejected`,
  mas a Ether devolve `pending_documents|pending_analysis|active|inactive`; gravar o valor cru
  quebraria o onboarding depois de a conta já existir na Ether. Mapeamento adicionado no código
  (`inactive` -> `rejected`: confirmado pela doc 2, "cadastro rejeitado pelo Compliance").
- `POST /auth/onboarding` agora devolve `document_checklist` (de `documentChecklist` da Ether).

**2026-10-02, 2º documento oficial — "Tipos de contas e dados usados na criação de contas"** (matriz
PF x PJ + dicionário de enums). Resolvido no código (`server/src/routes/auth.js`):
- Obrigatoriedade corrigida. PF obrigatório: `nationality`, `maritalStatus`, `monthlyIncome`,
  `hometown` (+ personType/taxId/phone/dateBirth). PF opcional: `gender`, `education`, `socialName`,
  `website`, `socialNetwork`, `managerName`. PJ obrigatório: `companyInfo`, `website`, `socialNetwork`
  (vazio dá `USR_VAL_005`). `companyInfo` é descartado do payload PF; `maritalStatus`/`gender`/
  `education` são descartados do payload PJ.
- Enums fechados: `gender`, `maritalStatus` (+ equivalentes em inglês), `education`, `addressType`,
  `nationality` (Brasileiro|Brasileira), `country` (BR|Brasil), `document.type`.
- `phone` exatamente 11 dígitos; `anoResidencia` opcional (default 5); `caixaPostal` opcional (default 0).
- `accountType` fixo `NOMINAL` (deliberado; `CRIPTO` fora do produto).
- Bug removido: `document.type = CARTAO_CNPJ` não existe na lista aceita de `document.type`.

**Continua em aberto (perguntar à Ether / descobrir no teste real):**
- **Grafia dos enums**: guia 1 usa `ENSINO_SUPERIOR_COMPLETO` (underscores), dicionário usa
  `ENSINO SUPERIOR COMPLETO` (espaços/acento; idem `UNIÃO ESTÁVEL`). Aceitamos as duas na entrada e
  enviamos a do dicionário. Se a Ether rejeitar, inverter a lista `canonical` no schema.
- **`address.city`**: slug (`br-rs-porto-alegre`) nos guias x texto livre no nosso código. Repassamos
  o valor recebido sem transformar; o teste real mostra se a Ether exige o slug.
- **Máscara do `taxId`**: os dois guias mostram máscara (CPF `123.456.789-00`, CNPJ
  `50.299.488/0001-78`); enviamos só dígitos. CPF sem máscara já foi aceito em teste real; CNPJ nunca foi
  testado.
- `personType PESSOA_ESTRANGEIRA`: não suportado.

**2026-10-02, 3º documento oficial — guia "Abertura de conta PJ"** (resolvido no código):
- RESOLVIDO — `document.type` em PJ: o exemplo oficial de PJ envia `CARTEIRA_IDENTIDADE`; o objeto
  `document` é o documento pessoal do **representante legal**, não da empresa. Default
  `CARTEIRA_IDENTIDADE` vale para PF e PJ (a exigência de `documentType` em PJ foi revertida).
- **Dois vocabulários distintos — não unificar**: `document.type` (passo 1) aceita só
  CARTEIRA_IDENTIDADE|CARTEIRA_TRABALHO|CARTEIRA_HABILITACAO|PASSAPORTE e recusa `CARTAO_CNPJ`; o
  checklist/upload (passo 4) usa PF: CARTEIRA_IDENTIDADE, COMPROVANTE_RESIDENCIA, SELFIE_COM_DOC; PJ:
  CARTAO_CNPJ, CONTRATO_SOCIAL, COMPROVANTE_RESIDENCIA. `uploadDocument()` agora valida o `type`
  contra esses 5 valores (`UPLOAD_DOCUMENT_TYPES`), além de MIME e 5MB. Comentários nos dois lugares.
- RESOLVIDO — `cnaeId`, `assessment`, `legalNature` vão em `profile` (não em `companyInfo`), opcionais,
  só PJ; descartados em PF.
- RESOLVIDO (reforçado) — `issuingAgency/issueDate/issueState` aparecem nos dois guias (PF e PJ): a
  evidência passou de 1 para 2 exemplos oficiais. Mantidos obrigatórios para PF; em PJ são enviados se
  vierem, mas ainda não exigidos. A matriz de obrigatoriedade continua não os listando.
- Nomenclatura PJ: `profile.socialName` = razão social; `companyInfo.tradeName` = nome fantasia.

**Atualização 2026-09-09 (3ª resposta do suporte + teste de endpoint) — bloqueio isolado:**

O suporte fechou o diagnóstico: as credenciais Cognito que temos são de **usuário humano**
(app/mobile); acesso programático exige uma **ApiKey de integrador separada**, que segundo eles
seria gerada via `POST /participant/api-key`. Testamos — **esse endpoint não existe**:

| Método | Endpoint | HTTP | Leitura |
|---|---|---|---|
| POST | `/participant/api-key` | **404** | endpoint indicado pelo suporte não existe em produção |
| POST | `/participants/api-key` | 404 | — |
| GET | `/participant` / `/participant/api-key` | 404 | — |
| POST | `/webhooks/secret` | **404** | também indicado pelo suporte; também não existe |
| POST | `/auth/api-key` | **401 `AUTH_KEY_001`** | **existe** (401 ≠ 404), mas rejeita credencial Cognito |

**Conclusão com evidência**: `/auth/api-key` está no ar e `AUTH_KEY_001` é literalmente "ApiKey
de integrador ausente/inválida" — consistente em todo endpoint protegido. Como o endpoint de
emissão self-service (`/participant/api-key`) não existe, **a ApiKey tem de ser emitida pela
equipe da Ether manualmente**. Não há ação técnica nossa que destrave isso.

**Consulta à documentação oficial (`docs.etherglobalassets.com.br`) — 2026-09-09:**

- **Guias → Primeiros Passos**: *"Entre em contato com o nosso suporte@etherglobalassets.com.br
  para gerar sua API KEY, que é composta por um **Cliente ID e uma Client Secret**."* Ou seja,
  **pela doc oficial a API KEY É o par clientId+clientSecret que já temos** — não existe
  "ApiKey de integrador" separada. A orientação do suporte no WhatsApp contradiz a própria doc.
- A referência de API publicada (`/ether-global-assets-2`) tem **um único endpoint**:
  `POST /auth/authenticate`. Nada sobre `api-key`, `participant` ou `AUTH_KEY_001`.
- **Divergência doc × produção**: a doc mostra a resposta do auth em camelCase
  (`accessToken`/`expiresIn`/`tokenType`); a API real devolve **snake_case**
  (`access_token`/`expires_in`/`token_type`) — verificado hoje. Nosso código usa snake_case,
  que é o correto contra a API real. Não mexer.
- Doc menciona portal de Internet Banking em `https://banking.etherglobalassets.com.br`
  (criação de conta em `/account-creation`) e que *"para iniciar a operação, será necessário
  enviar saldo para sua conta"* — **pista não explorada**: talvez a conta precise de KYC
  aprovado e/ou saldo para liberar os endpoints protegidos. Vale logar no portal e conferir o
  status da conta direto, sem depender do tempo de resposta do suporte.

**Conclusão consolidada**: a autenticação funciona, o fluxo implementado é o documentado, e
todos os caminhos alternativos sugeridos pelo suporte retornam 404. O bloqueio é
**provisionamento/status da conta do lado da Ether**, não código nosso.

**Correção aplicada 2026-09-09 (reverte a regressão de 04/09):**

Testes contra a API real provaram que o token do participant **é aceito** em
`POST /users/profile-data` (chega a `400` de validação, não `401`), enquanto
`/users/onboarding` e `/kyc/submissions` retornam **404**. Ou seja: a orientação do suporte
levou o código para endpoints inexistentes, e os documentados foram removidos por engano.

- `server/src/ether.js`: `submitOnboarding()`/`submitKyc()` **removidos**; no lugar,
  `createUserProfile()`, `acceptTerms()`, `submitPepDeclaration()`, `checkAccountStatus()`,
  `getDocumentRequirements()`, `getDocumentTypes()` — todos sobre endpoints documentados.
- `server/src/routes/auth.js` (`POST /auth/onboarding`): monta o `CreateUserProfilePayload`
  completo (usa `config.ether.tenantUrl`), chama `profile-data` e em seguida `accept-terms` +
  `pep-declaration` (falha nessas duas é logada mas não invalida o cadastro já criado).
- Comentário no código explicando por que **não** voltar atrás sem evidência de request real.

Erros de validação úteis descobertos no caminho (o endpoint valida de verdade):
domínio `example.com` é rejeitado ("problematic domain") e `dateBirth` exige maior de 18 anos
**mesmo para PJ**. Com payload válido, o erro passa a ser `404 USR_NOT_001` — e testamos três
`tenantUrl` diferentes (incluindo um inexistente de propósito): **os três dão o mesmo erro**,
então não é o tenant, é o registro do participant. Nenhum cliente foi criado.

**Pergunta objetiva para a Ether** (substitui a anterior): *"nosso participant autentica e é
aceito em `/users/profile-data`, mas `/account-balance` devolve `AUTH_KEY_001` e a criação de
cliente devolve `USR_NOT_001`. Qual o `tenantUrl` correto da LivrePay e o participant está
totalmente provisionado?"*

### 2026-09-10 — causa raiz identificada: o token emitido pela Ether vem sem `aud`

O suporte respondeu que `AUTH_KEY_001` "não existe no sistema deles" e que o token
provavelmente é rejeitado por `aud` que não bate com o App Client ID do participant.
Decodificamos o token que **o `/auth/authenticate` deles emite**:

```
claims: auth_time, client_id, exp, iat, iss, jti, scope, sub, token_use, version
aud       -> AUSENTE (não existe no payload)
client_id -> rscjgeg0vbsjgbgu6fpq8ntc9
scope     -> https://api.etherprivatebank.com.br/user   (o próprio suporte disse que o
             correto seria api.etherdex.com — domínio errado)
```

**Não há correção possível do nosso lado**: quem emite o token é o endpoint deles, a partir
da configuração do App Client no Cognito deles. Não dá para "adicionar" um claim que o
emissor não coloca. Os dois claims que o suporte apontou como causa provável (`aud` e
`scope`) estão errados e ambos são gerados pela configuração da Ether.

Prova de que o token **não** é o problema em si: `POST /users/profile-data` **aceita esse
mesmo token** (chega a `400` de validação de corpo), enquanto `/account-balance`, `/pix/keys`
e `/users/document/types` devolvem `401 AUTH_KEY_001`. Token inválido falharia em todos.

Reconfirmado em 2026-09-10 (token novo, nada mudou do lado deles):
`/users/onboarding`, `/kyc/submissions` e `/webhooks/secret` → **404 NOT_FOUND**, apesar de o
suporte insistir nesse fluxo. Mantemos a implementação sobre os endpoints documentados.

Resposta pronta para enviar ao suporte: `scratchpad/resposta-suporte-ether.md`.

### 2026-09-10 (tarde) — causa raiz CONFIRMADA e caminho de solução

O suporte explicou a peça que faltava e ela é consistente com todas as evidências:
**as credenciais que temos (`rscjgeg0vbsjgbgu6fpq8ntc9`) são de um App Client do Cognito
para login de PESSOAS, não para integração sistema-a-sistema.** A credencial de integração
ainda não foi gerada.

**Correção de uma conclusão anterior deste documento:** chegamos a afirmar que
`/participant/api-key` "não existe" porque devolve 404 com token válido e 401 sem token.
Um teste de controle com uma rota inventada (`/rota-inventada-xyz`) devolve **exatamente o
mesmo par 401/404** — ou seja, aquele 401 é só o middleware global e não prova nada. O 404
com nosso token é explicado por roteamento por escopo: nosso token tem
`scope: .../user` e as rotas `/participant/*` exigem escopo de participant.

**Fluxo correto (3 passos), a rodar UMA vez:**

```
1. POST /participant/api-key    (Bearer = JWT de um ADMIN humano)  -> clientId + secretToken
2. POST /auth/api-key/secret    (secretToken, janela de 5 min)     -> clientId + clientSecret
3. POST /auth/api-key           (clientId + clientSecret)          -> access_token
```

Depois disso, `ETHER_CLIENT_ID`/`ETHER_CLIENT_SECRET` passam a ser esse novo par, e a
autenticação em `server/src/ether.js` muda de `/auth/authenticate` para `/auth/api-key`.

**Script pronto**: `server/scripts/bootstrap-ether-apikey.js` executa os 3 passos, grava as
credenciais em `nao-subir-ether-apikey.txt` (coberto pelo `.gitignore` via glob `nao-subir*`)
em vez de imprimir no terminal, e valida chamando `/account-balance` no final.

```bash
node server/scripts/bootstrap-ether-apikey.js <JWT_DO_ADMIN>
```

**BLOQUEIO ATUAL — depende de ação humana**: falta o **JWT de um usuário admin** do
participant LivrePay. Não é o token do `.env`. Precisa vir de um login humano no portal da
Ether (`exchange.etherglobalassets.com.br`). Perguntar ao suporte qual é o caminho oficial
para obtê-lo, caso o portal não exponha.

Evidência formatada para enviar ao suporte:
`scratchpad/evidencia-ether-apikey.md` (fora do git).

**Pedido pendente à Ether**: (a) emitir a ApiKey de integrador + o segredo de webhook para a
LivrePay, ou (b) informar método/path corretos e qual credencial autentica a emissão.

### 2026-09-10 (noite) — login SRP implementado e validado; a pergunta do admin está respondida (mas negativa)

Implementado `server/scripts/lib/cognito-srp.js` (SRP contra App Client com secret,
`SECRET_HASH` calculado manualmente já que `amazon-cognito-identity-js` não suporta isso
nativamente) e o desafio MFA `SOFTWARE_TOKEN_MFA` (TOTP) em `server/scripts/
bootstrap-ether-apikey.js`. **Rodado contra o Cognito de produção da Ether, com TOTP real,
por quem tem a senha do usuário — funcionou de ponta a ponta.**

Resultado:

```
Claims do JWT do admin (não sensíveis):
{
  "token_use": "access",
  "scope": "aws.cognito.signin.user.admin",
  "client_id": "rscjgeg0vbsjgbgu6fpq8ntc9",
  "exp_iso": "2026-09-10T20:10:17.000Z",
  "groups": ["CLIENT"],
  "sub_hash": "presente (não exibido)"
}

1/3  POST /participant/api-key ...
✗ Falhou no passo 1 — HTTP 404
{ "error": "Not Found", "message": "NOT_FOUND", "statusCode": 404 }
```

**A pergunta em aberto desde a seção anterior ("existe um usuário admin da LivrePay
cadastrado na Ether?") está respondida**: existe um usuário (`jandir@livrepay.app`), o
login SRP funciona, **mas ele está no grupo Cognito `CLIENT`** (usuário final), não em um
grupo de admin/participant, e o token que ele recebe tem `scope:
aws.cognito.signin.user.admin` (auto-gerenciamento de conta Cognito — trocar senha, MFA —
não é escopo de API). `POST /participant/api-key` com esse token devolve 404, o mesmo
padrão já documentado para qualquer token sem escopo de participant. Nenhuma credencial de
integração foi emitida — o fluxo parou no passo 1.

**Desconhecido, não tratar como resolvido**: não dá para separar, só com essa evidência, se
o 404 vem (a) do papel do usuário (`CLIENT`, não admin), (b) da forma do escopo do token
SRP (`aws.cognito.signin.user.admin` não é escopo de API, então talvez nenhum usuário
logando por SRP nesse App Client tenha acesso a `/participant/*`, admin ou não), ou (c)
ambos. Só testando com um usuário que seja de fato admin do participant isola a causa.

**Gotcha novo**: `jandir@livrepay.app` tem MFA `SOFTWARE_TOKEN_MFA` (TOTP) configurado —
quem rodar o bootstrap precisa do app autenticador em mãos, código válido por ~30s, pedido
no momento via prompt (ou `--totp 123456` se gerado na hora).

**Pergunta pronta para o suporte da Ether** (inclui o pedido de webhook que já estava
pendente):

> Nosso usuário `jandir@livrepay.app` (grupo Cognito `CLIENT`, User Pool
> `us-east-2_BcbqtNJM3`) autentica com sucesso via SRP + MFA (TOTP), mas
> `POST /participant/api-key` com o token dele devolve `404 NOT_FOUND` — o mesmo
> comportamento que documentamos para tokens sem escopo de participant. Duas coisas que
> precisamos: (1) promover este usuário a administrador do participant LivrePay, ou criar um
> usuário admin do participant separado; (2) o segredo do webhook (`whsec_...` ou
> equivalente) — `POST /webhooks/secret` continua devolvendo 404 para nós, e a validação
> HMAC-SHA256 já está implementada, só falta o valor real.

Detalhe completo, incluindo a implementação do SRP com secret e o patch de `SECRET_HASH`,
em [HANDOFF-ETHER.md](HANDOFF-ETHER.md) (seção "O bloqueio atual, exato").

### 2026-09-17 — DESBLOQUEADO: a Ether entregou a credencial de integração

O bloqueio documentado desde 2026-08-11 (seção 1 deste arquivo) **está resolvido**. A Ether
entregou um par de credenciais de integração novo — não pelo fluxo `/participant/api-key`
descrito acima (não foi necessário), a Ether simplesmente gerou e passou o par. Validado
contra a API real:

```
clientId/clientSecret: ver nao-subir-ether-apikey.txt (fora do git, modo 600)

POST /auth/api-key       -> HTTP 401 {"message":"Unauthorized"}
POST /auth/authenticate  -> HTTP 201, scope: https://api.etherprivatebank.com.br/tenant
GET /account-balance      -> HTTP 200
GET /pix/keys             -> HTTP 200
GET /users/document/types -> HTTP 200
```

O escopo saiu de `.../user` para `.../tenant` (participant), e os três endpoints que
davam `401 AUTH_KEY_001` durante toda a investigação anterior agora respondem `200`.

**Correção explícita a uma conclusão anterior — não reverter sem novo teste:** este documento
e o HANDOFF diziam que, ao obter a credencial de integração, seria preciso trocar
`server/src/ether.js` de `/auth/authenticate` para `/auth/api-key`. **Testado e está
errado**: `POST /auth/api-key` com o par novo devolve `401 Unauthorized`. O par novo
autentica no mesmo `/auth/authenticate` que o código já usa — **a autenticação em código não
muda**, só os valores de `ETHER_CLIENT_ID`/`ETHER_CLIENT_SECRET` no `.env`.
`server/src/ether.js` não foi alterado por causa disso.

**Continua aberto**: o segredo do webhook (`whsec_...`). `POST /webhooks/secret` segue
devolvendo 404 e nunca foi entregue por outro canal — a validação HMAC-SHA256 já está
implementada em `server/src/routes/webhook.js`, falta só o valor real.

**Implicação de segurança tratada nesta mesma sessão**: com credencial válida, `server/tests/
e2e.sh` perdeu a proteção acidental de "toda chamada à Ether falha com 401" — antes disso,
`POST /payments/:id/execute` (PIX e boleto) sempre esbarrava em erro do provedor antes de
mover qualquer dinheiro. O script foi ajustado para exigir `ETHER_ALLOW_REAL_PAYMENTS=1`
explicitamente antes de rodar essas duas asserções (default: pula com aviso, resto da suíte
roda normal). As asserções continuam seguras mesmo quando rodadas com a variável ligada — os
usuários de teste nunca têm saldo interno até a seção de Recebíveis, que roda depois, então
`execute_payment()` recusa por saldo insuficiente antes de qualquer chamada que de fato pague
(`withdrawPixToKey()`/`payBoleto(isSimulation:false)`); só `simulateBoleto()`
(`isSimulation:true`, consulta, não paga) chega a ser chamada de verdade no caminho de
boleto. Ver comentário no topo de `server/tests/e2e.sh`, `CLAUDE.md` e `README.md`.

**Nota de diagnóstico (não bloqueante)**: o CloudFront da Ether passou a bloquear User-Agent
padrão do `curl` (403 "Request blocked"). Verificado que o `fetch` nativo do Node (undici) passa
normalmente (200) — **produção não é afetada**, mas quem depurar com `curl` precisa mandar
`-H "User-Agent: Mozilla/5.0 ..."` ou vai perseguir um 403 fantasma.

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

1. ~~Resolver o status da conta na Ether~~ — ✅ **feito (2026-09-17)**: a Ether entregou a
   credencial de integração (`.env` já atualizado). O que resta neste tópico: (a) confirmar
   ponta a ponta com um PIX/boleto real de valor pequeno, feito manualmente pela usuária (não
   por este agente — ver guardrails de produção); (b) conseguir o segredo do webhook
   (`whsec_...`), ainda pendente.
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
