# Handoff — Integração Ether: diagnóstico, correções e próximos passos

> Sessão de 2026-09-09/10, atualizada em 2026-09-17. Público: dev full-stack assumindo a
> integração. Leia junto com [PENDING.md](PENDING.md) (estado geral) e [SECURITY.md](SECURITY.md)
> (modelo de segurança — obrigatório antes de mexer em dinheiro/auth).

## ATUALIZAÇÃO 2026-10-02 — RESOLVIDO: criação de conta de cliente (`POST /users/profile-data`)

O bloqueio em `400 USR_MGT_007` **acabou**: era o payload incompleto (faltavam campos de
`profile`, `address` e `document`, conforme a documentação oficial PF/PJ obtida nesta data).
Teste real, PF, payload montado por `onboardingSchema` + `buildOnboardingPayload` (CPF de teste
gerado):

```
HTTP 201
userId:   63fcc67a-9d2c-46ea-b64c-7e1417dcfdee
tenantId: b5c908dc-69ac-4105-a579-2a49609e0ff8
status: pending_documents, recovery: false, document: null
documentChecklist.pending: CARTEIRA_IDENTIDADE, COMPROVANTE_RESIDENCIA, SELFIE_COM_DOC
address gravado (a Ether acrescenta complement: null, ibgeCode: null)
recoveryToken: JWT escopo "registration_recovery", sub = userId, ~48h
```

Respondido pelo teste: `city` aceita slug (`br-sp-sao-paulo`); `taxId` aceito sem máscara;
`maritalStatus` aceito como `SOLTEIRO(A)`. Segue aberta só a grafia de `education` (opcional, não
enviada). Sem teste real ainda: PJ, accept-terms, pep-declaration, upload, check-account.

**Armadilha achada e corrigida — não remova:** o WAF da Ether bloqueia o `User-Agent` padrão do
fetch do Node (responde HTML). `server/src/ether.js` agora manda `CLIENT_USER_AGENT`
(`Mozilla/5.0 (compatible; LivrePay-API/1.0; ...)`, o prefixo `Mozilla/5.0` é o que passa) em toda
requisição; sem isso **toda** chamada à Ether falha em produção. Respostas não-JSON agora viram
`EtherError` com o status preservado (`body.error = "RespostaNaoJSON"`). Ambos têm teste de
regressão (`npm run test:ether`, fetch mockado).

**Pista, não conclusão (token em nome da sub-conta):** o `recoveryToken` tem escopo
`registration_recovery` e ~48h — provavelmente retoma cadastro, não consulta saldo. Nada
implementado. Detalhes e o achado `ibgeCode` em [PENDING.md](PENDING.md).

O texto abaixo sobre o bloqueio de criação de conta é **histórico**.

---

## ATUALIZAÇÃO 2026-09-17 — DESBLOQUEADO: credencial de integração recebida e validada

O bloqueio que dominava este documento (e o TL;DR abaixo, mantido como histórico) **está
resolvido**. A Ether entregou um par de credenciais de integração novo e ele foi validado
contra a API real:

```
clientId/clientSecret: ver nao-subir-ether-apikey.txt (fora do git, modo 600)

POST /auth/api-key       -> HTTP 401 {"message":"Unauthorized"}
POST /auth/authenticate  -> HTTP 201, scope: https://api.etherprivatebank.com.br/tenant
GET /account-balance      -> HTTP 200
GET /pix/keys             -> HTTP 200
GET /users/document/types -> HTTP 200
```

Leitura: o escopo do token saiu de `.../user` (usuário final, o que causava todo o
`401 AUTH_KEY_001` documentado abaixo) para `.../tenant` — escopo de participant/integração.
Os mesmos endpoints que davam `401 AUTH_KEY_001` durante toda a investigação (`/account-balance`,
`/pix/keys`, `/users/document/types`) agora respondem `200`.

**Correção importante a uma instrução anterior deste documento — não "consertar de volta"
sem reler isto:** a seção "Script pronto" (mais abaixo) dizia que, após obter a credencial de
integração, seria preciso trocar a autenticação em `server/src/ether.js` de
`/auth/authenticate` para `/auth/api-key`. **Isso está errado, testado com evidência:**
`POST /auth/api-key` com o par novo devolve `401 Unauthorized`. O par novo autentica no
**mesmo** `/auth/authenticate` que o código já usa — a autenticação em código **não muda**,
só os valores de `ETHER_CLIENT_ID`/`ETHER_CLIENT_SECRET` no `.env`. Mesmo padrão do bloco de
regressão da seção 3: não troque isso de volta para `/auth/api-key` sem um teste real que
prove que passou a funcionar.

**O que permanece aberto:** o segredo do webhook (`whsec_...` ou equivalente) — `POST
/webhooks/secret` continua devolvendo 404 e nunca foi entregue por outro canal. A validação
HMAC-SHA256 já está implementada em `server/src/routes/webhook.js`; falta só o valor real.

**Implicação de segurança já tratada**: com credencial válida, `server/tests/e2e.sh` deixou
de ter a proteção acidental de "toda chamada à Ether falha com 401" — o script foi ajustado
(gate `ETHER_ALLOW_REAL_PAYMENTS`, default desligado) para não arriscar mover dinheiro real
sem opt-in explícito. Ver `CLAUDE.md` (seção de comandos) e `README.md`.

---

## TL;DR (histórico — o bloqueio abaixo já foi resolvido, ver atualização acima)

A integração com a Ether estava **bloqueada por credencial, não por código**. As credenciais
que tínhamos eram de um App Client do Cognito para **login de pessoas**; a Ether exigia um
par separado de **integração**, que não tinha sido gerado. O caminho para gerá-lo dependia de
um JWT de usuário admin — só que o único usuário testado (`jandir@livrepay.app`) era `CLIENT`,
não admin do participant (ver seção 2). No fim, **a Ether gerou e entregou a credencial
diretamente**, sem precisar desse fluxo de self-service via `/participant/api-key`.

Todo o resto do sistema funciona: **29 testes de banco + 54 e2e passando**.

**Não refaça o diagnóstico abaixo** — foram várias rodadas e o suporte da Ether deu
informações contraditórias três vezes. As evidências estão documentadas com status HTTP.
Fica como histórico porque explica por que o código e os scripts de bootstrap existem e são
como são — não porque ainda representa o estado bloqueado.

---

## 1. Estado do código (alterações NÃO commitadas)

```
 M .gitignore                  glob nao-subir* (segredo não commitável)
 M PENDING.md                  diagnóstico completo registrado
 M docker-compose.yml          PGSSLMODE=disable (stack local voltou a subir)
 M server/src/ether.js         reverte regressão de endpoints (ver §3)
 M server/src/routes/auth.js   idem, no POST /auth/onboarding
 M server/tests/e2e.sh         testes atualizados ao modelo de segurança atual
?? server/scripts/             bootstrap-ether-apikey.js (novo)
```

Nada foi commitado — revise antes de subir.

---

## 2. Diagnóstico da Ether (com evidência)

### Matriz de endpoints, testada com token válido

| Endpoint | Status | Leitura |
|---|---|---|
| `POST /auth/authenticate` | **200** | Autentica OK, devolve token válido (1h) |
| `GET /exchange/quotes` | **200** | Público, retorna cotações reais |
| `POST /users/profile-data` | **400 USR_VAL_001** | **Rota existe e aceita nosso token** — chega na validação de corpo |
| `GET /account-balance` | 401 `AUTH_KEY_001` | Existe, mas credencial não autorizada |
| `GET /pix/keys` | 401 `AUTH_KEY_001` | idem |
| `GET /users/document/types` | 401 `AUTH_KEY_001` | idem |
| `POST /users/onboarding` | 404 | Não visível para o nosso token |
| `POST /kyc/submissions` | 404 | idem |
| `POST /participant/api-key` | 404 | idem |
| `POST /webhooks/secret` | 404 | idem |

### Armadilha de interpretação (não caia nela)

Sem token, **qualquer** rota devolve 401 — inclusive uma rota inventada. Testei
`/rota-inventada-xyz`: devolve `401` sem token e `404` com token, **idêntico** a
`/participant/api-key`. Ou seja: **401 sem token não prova que a rota existe.** Só o
resultado *com token válido* diz alguma coisa.

### Causa raiz

O token que a Ether emite tem:

```
scope     : https://api.etherprivatebank.com.br/user     <- escopo de USUÁRIO
client_id : rscjgeg0vbsjgbgu6fpq8ntc9
aud       : ausente
```

O gateway da Ether parece rotear por escopo. Nosso token é `/user`, então:
- rotas `/users/*` respondem (daí o 400 de validação em `profile-data`)
- rotas `/participant/*` são invisíveis → 404

O suporte confirmou: **esse Client ID é para autenticar pessoas, não para integração B2B.**
A credencial de integração precisa ser gerada e ainda não foi.

### Fluxo correto para gerar a credencial (segundo o suporte)

```
1. POST /participant/api-key    Bearer <JWT de um ADMIN humano>   -> clientId + secretToken
2. POST /auth/api-key/secret    { token: secretToken }  (5 min)   -> clientId + clientSecret
3. POST /auth/api-key           { clientId, clientSecret }        -> access_token
```

Depois disso, `ETHER_CLIENT_ID`/`SECRET` viram esse novo par e a autenticação em
`server/src/ether.js` muda de `/auth/authenticate` para `/auth/api-key`.

> **Corrigido em 2026-09-17, com evidência — NÃO seguir esta última frase.** A Ether acabou
> entregando a credencial de integração diretamente (sem passar pelo fluxo de 3 passos
> acima), e testamos: `POST /auth/api-key` com o par novo devolve `401 Unauthorized`. Quem
> funciona é o `/auth/authenticate` de sempre — a autenticação em código não muda, só os
> valores de env. Ver "ATUALIZAÇÃO 2026-09-17" no topo do arquivo para a evidência completa.

### O bloqueio atual, exato — atualizado 2026-09-10 (login SRP implementado e testado; RESOLVIDO em 2026-09-17, ver topo do arquivo)

Falta o **JWT do admin** do passo 1. O suporte nunca disse como obtê-lo. Testei os fluxos
do Cognito (User Pool `us-east-2_BcbqtNJM3`, App Client `rscjgeg0vbsjgbgu6fpq8ntc9`):

| Fluxo | Resultado |
|---|---|
| `USER_PASSWORD_AUTH` | **"flow not enabled for this client"** |
| `USER_SRP_AUTH` | Reclama de `SECRET_HASH` → aparentemente **habilitado** |
| `CUSTOM_AUTH` | idem |
| `REFRESH_TOKEN_AUTH` | "Invalid Refresh Token" → habilitado |

Ou seja: dá para logar um humano, **mas só via SRP** (o handshake que o
`amazon-cognito-identity-js` / Amplify implementam), não via senha simples.

**Pergunta antes em aberto — agora RESPONDIDA (2026-09-10):** existe um usuário admin da
LivrePay cadastrado na Ether? **Existe um usuário** (`jandir@livrepay.app`) e o login SRP
com este App Client **funciona de ponta a ponta**, incluindo o desafio MFA (ver gotcha
abaixo) — mas esse usuário **não é admin do participant**, é usuário final comum.

Execução real, com TOTP válido, contra a Ether de produção:

```
Login SRP: pool=us-east-2_BcbqtNJM3 client=rscjgeg0vbsjgbgu6fpq8ntc9 ...
     ok — sessão SRP obtida

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

Leitura da evidência:
- `groups: ["CLIENT"]` — o usuário está no grupo Cognito de usuário final, não de admin do
  participant.
- `scope: aws.cognito.signin.user.admin` — escopo padrão de auto-gerenciamento de conta do
  Cognito (trocar a própria senha, MFA etc.), **sem nenhum escopo de API** — nem sequer o
  `.../user` que o `/auth/authenticate` (client_credentials) devolve.
- `POST /participant/api-key` com esse token → **404**, mesmo padrão já documentado acima
  para tokens sem escopo de participant.
- Nenhuma credencial de integração foi emitida do lado da Ether — o fluxo parou no passo 1,
  antes de qualquer chamada que crie ou revele segredo.

**O que continua DESCONHECIDO (não tratar como resolvido):** não dá para separar, com a
evidência que temos, se o 404 acontece (a) só pelo **papel do usuário** (`jandir` está no
grupo `CLIENT`, não em um grupo de admin/participant), (b) só pela **forma do escopo do
token do SRP** (`aws.cognito.signin.user.admin`, que não é um escopo de API de jeito
nenhum, então talvez qualquer usuário — admin ou não — logando por SRP nesse App Client
receba um token sem acesso a `/participant/*`), ou (c) ambos. Só testando com um usuário
que seja **de fato admin do participant** (se existir um, ou depois que a Ether criar/
promover um) dá para isolar a causa.

**Gotcha novo — MFA TOTP obrigatório neste usuário:** `jandir@livrepay.app` tem
`SOFTWARE_TOKEN_MFA` configurado no Cognito. Quem for rodar o bootstrap precisa ter o app
autenticador (Google Authenticator/Authy/etc.) à mão — o código tem ~30s de validade, então
ele é pedido só no momento do login (prompt interativo), não antecipadamente. Ver "Script
pronto" abaixo.

### Pergunta pronta para o suporte da Ether

> Nosso usuário `jandir@livrepay.app` (grupo Cognito `CLIENT`, User Pool
> `us-east-2_BcbqtNJM3`) autentica com sucesso via SRP + MFA (TOTP), mas
> `POST /participant/api-key` com o token dele devolve `404 NOT_FOUND` — o mesmo
> comportamento que documentamos para tokens sem escopo de participant. Duas coisas que
> precisamos:
> 1. Promover este usuário a administrador do participant LivrePay, **ou** criar um usuário
>    admin do participant separado — o que for o processo correto do lado de vocês.
> 2. O segredo do webhook (`whsec_...` ou equivalente) — `POST /webhooks/secret` continua
>    devolvendo 404 para nós, e a validação HMAC-SHA256 já está implementada em
>    `server/src/routes/webhook.js`, só falta o valor real para não rejeitar tudo por engano.

### Script pronto — login SRP implementado e validado (2026-09-10)

`server/scripts/bootstrap-ether-apikey.js` executa o login SRP (com desafio MFA TOTP) e,
se o token tiver escopo de participant, os 3 passos do bootstrap. Rode uma vez:

```bash
node server/scripts/bootstrap-ether-apikey.js
```

Lê e-mail/senha do admin de `nao-subir-ether-admin.env` (raiz do repo, fora do git, nunca
por argumento de CLI) e pede o código TOTP no prompt (ou aceite `--totp 123456` para não
pausar, se o código for gerado na hora de rodar). Implementação do SRP com App Client com
secret (SECRET_HASH calculado manualmente, `amazon-cognito-identity-js` não suporta isso
nativamente) em `server/scripts/lib/cognito-srp.js` — **validado em execução real** contra
o Cognito de produção da Ether, incluindo o desafio `SOFTWARE_TOKEN_MFA`.

Ele grava as credenciais em `nao-subir-ether-apikey.txt` (modo 600, coberto pelo
`.gitignore`) **antes** de validar — o `clientSecret` só aparece uma vez, perder obriga a
refazer tudo. No fim testa `/account-balance`: se ainda der 401, o problema passa a ser
KYC/provisionamento, não credencial.

O login SRP **não é mais item pendente** — funciona de ponta a ponta. O que falta é a
Ether liberar um usuário com papel de admin do participant (ver pergunta ao suporte acima).

---

## 3. Regressão corrigida — leia antes de "consertar" de volta

Em 04/09 alguém trocou os endpoints de cadastro seguindo orientação do suporte por
WhatsApp. Os endpoints adotados **não existem** (404); os removidos **estão documentados**.

| | Antes (04/09, quebrado) | Agora (corrigido) |
|---|---|---|
| Cadastro | `POST /users/onboarding` → 404 | `POST /users/profile-data` → responde |
| KYC | `POST /kyc/submissions` → 404 | `POST /users/document/upload` |
| Termos | removido ("não existe") | `POST /users/{id}/accept-terms` — **está na doc** |
| PEP | removido | `POST /users/{id}/pep-declaration` — **está na doc** |

Fonte: `privatedocs.etherglobalassets.com.br` → *Ether Global Assets* (exige login; a conta
da Ludmilla tem acesso). Bate com a spec `Ether Global Assets.json` que já estava no repo.

**Regra:** só mude esse fluxo contra evidência de request real (status HTTP), não contra
mensagem de suporte. Deixei comentário no código dizendo isso.

---

## 4. Outras correções desta sessão

**Stack local não subia** — `docker-compose.yml` roda com `NODE_ENV=production`, o que
ativava SSL obrigatório (`config.isProduction`) contra um Postgres local sem TLS. Erro:
*"The server does not support SSL connections"*. Já existia a variável de escape
`PGSSLMODE`; o compose agora declara `PGSSLMODE=disable`. Produção (DO Managed Postgres)
não foi afetada.

**Testes e2e desatualizados** — cobravam comportamento que a migration
`20260820000000_close_settlement_gaps.sql` removeu de propósito. Antecipação de recebível
agora exige **verificação prévia por admin** (fecha auto-crédito: sem isso, qualquer usuário
cadastrava recebível fictício e se creditava). Reescrevi os testes para travar o modelo
seguro — agora promovem um segundo usuário a admin, ele verifica, e só então o dono
antecipa. Também travei o outro lado: admin **enxerga** todos os lançamentos
(`transactions: staff le todas`, intencional, para os gráficos do painel).

**Pagamento de boleto** agora chama `simulateBoleto()` (isSimulation, não move dinheiro)
para conferir o valor real **antes** de debitar — por isso retorna 502 quando a Ether está
bloqueada, em vez de 422 por saldo. O teste aceita os dois; o invariante é não sair dinheiro.

---

## 5. Gotchas que vão te custar tempo se não souber

1. **WAF bloqueia `curl`.** User-Agent padrão do curl → `403 Request blocked` (e o Cognito
   devolve `ForbiddenException: Request not allowed due to WAF block`). Use
   `-H "User-Agent: Mozilla/5.0 ..."`. Não afeta a API em Node.
2. **Doc divergente da API.** A doc do `/auth/authenticate` mostra a resposta em camelCase
   (`accessToken`); a API devolve **snake_case** (`access_token`). Nosso código usa
   snake_case — está certo, não "corrija".
3. **Rate limit derruba o e2e em execuções seguidas.** 10 req/15min nas rotas de auth. Como
   o limite é em memória, `docker compose restart api` zera. Rodar o e2e 2x seguidas faz a
   suíte inteira falhar com 429 — não é bug.
4. **`enum = text` precisa de cast explícito** em query parametrizada. Já quebrou uma rota
   (`GET /receivables?status=X` → 500). Use `$1::public.nome_do_enum`.
5. **Não rode `e2e.sh` com credenciais Ether de produção** sem ler o script antes. Hoje ele
   é seguro (pagamentos executam com saldo zero e param em 422/502 antes de mover dinheiro),
   mas isso pode mudar.
6. **MFA TOTP obrigatório no usuário `jandir@livrepay.app`.** Quem for rodar
   `bootstrap-ether-apikey.js` precisa ter o app autenticador em mãos — o código de 6
   dígitos vale ~30s, então é pedido no momento (prompt interativo, ou `--totp 123456` se
   gerado na hora de rodar o comando). Não adianta gerar o código com antecedência.

---

## 6. Próximos passos sugeridos

**Bloqueado na Ether — RESOLVIDO em 2026-09-17** (ver "ATUALIZAÇÃO 2026-09-17" no topo do
arquivo): a Ether entregou a credencial de integração diretamente, sem passar pelo fluxo de
`/participant/api-key` descrito abaixo. Os itens 1-2 abaixo ficam como histórico — não
precisaram ser concluídos pelo caminho previsto, mas explicam o trabalho feito no caminho.

1. ~~Confirmar se existe usuário admin da LivrePay na Ether~~ — feito (2026-09-10): existe
   `jandir@livrepay.app`, mas está no grupo `CLIENT` (usuário final), não admin do
   participant. Chegamos a pedir ao suporte que promovesse esse usuário — no fim a Ether
   resolveu de outra forma, gerando a credencial de integração sem precisar disso.
2. ~~Implementar login SRP~~ — feito e **validado em execução real** (2026-09-10),
   incluindo o desafio MFA (`SOFTWARE_TOKEN_MFA`/TOTP). Ver `server/scripts/lib/cognito-srp.js`
   e `server/scripts/bootstrap-ether-apikey.js` — o script continua funcional caso seja
   preciso repetir esse fluxo (ex.: rotação de credencial) no futuro, mas não foi o caminho
   usado para o desbloqueio final.
3. **Ainda aberto**: pedir o segredo do webhook (`whsec_...`) por outro canal —
   `POST /webhooks/secret` continua devolvendo 404. A validação HMAC-SHA256 já está
   implementada e no formato que eles pediram; falta só o valor real.

**Independe da Ether:**
4. **Relatórios** — sem schema novo, só agregação sobre `transactions`/`charges`/`payments`.
5. **Cartões/Seguros** — bloqueio de produto: falta decidir o emissor de cartão (a Ether não
   tem endpoint de cartão) e como funciona cotação de seguro.
6. **Infra de produção** — ver [ESTIMATIVA-INFRAESTRUTURA.md](ESTIMATIVA-INFRAESTRUTURA.md).
   Duas coisas que **já estão implementadas** (não refaça):
   - **Timeout nas chamadas à Ether**: `fetchWithTimeout()` em `server/src/ether.js`.
   - **Rate limit compartilhado**: `server/src/rateLimitStore.js` já usa `rate-limit-redis`.
     Só falta **configurar `REDIS_URL`** — sem ela a API cai no store em memória e loga um
     aviso na inicialização. É pré-requisito para rodar 2+ réplicas.

   Ainda pendente de verdade: **PgBouncer** (obrigatório a partir da 2ª réplica, senão o
   pool por instância esgota as conexões do Postgres) e **circuit breaker** para a Ether.

---

## 7. Como validar que está tudo de pé

```bash
docker compose up -d --build
npm run db:test                 # 29 asserções de segurança no banco
bash server/tests/e2e.sh        # 54 asserções na API (reinicie a api antes de repetir)
cd server && npm run test:ether # 6 testes unitários do cliente Ether (fetch mockado)
npm run typecheck && npm run lint
```
