# LIVREPAY — Modelo de Segurança

Sistema fintech em **Postgres puro** (sem BaaS). A segurança primária vive no **banco**, não
no front nem na API: o front é inspecionável por qualquer usuário e a API pode ter bugs — o
banco é a última linha e ela não depende de nenhuma das duas estar correta.

## Arquitetura

```
Browser ──JWT──> API (Node/Express) ──SET LOCAL ROLE authenticated──> Postgres (RLS)
                     │                 + set_config('request.jwt.claim.sub')
                     └──clientSecret──> API Ether (nunca no browser)
```

Três camadas, cada uma assumindo que a anterior pode falhar:

1. **Front** — conveniência de UX (rotas protegidas, botões desabilitados).
2. **API** — valida entrada (zod), autentica (JWT) e transporta a identidade.
3. **Postgres** — RLS, constraints e funções decidem o que de fato é permitido.

### Como a identidade chega ao banco

A API não confia em `WHERE user_id = ...` espalhado pelas queries. Cada transação abre com:

```sql
SELECT set_config('request.jwt.claim.sub', '<user-id>', true);
SET LOCAL ROLE authenticated;
```

O `true` do `set_config` torna o valor **local à transação** — obrigatório com pool de
conexões, senão a identidade de um usuário vazaria para a próxima requisição que reutilizasse
a conexão. `auth.uid()` lê esse valor, e todas as policies passam a filtrar sozinhas.

**A API conecta com uma role que NÃO é dona das tabelas** (`livrepay_app`). Dono de tabela
ignora RLS por padrão no Postgres — é exatamente por isso que a role de aplicação é separada
do superusuário que roda as migrations. Ela também é `NOINHERIT`: nenhum privilégio existe
sem um `SET ROLE` explícito, obrigando cada trecho de código a declarar em que contexto opera.

## O que está implementado

### Banco de dados

| Controle | Como |
|---|---|
| RLS deny-by-default | RLS em TODAS as tabelas; sem policy = sem acesso. Cada policy filtra por `user_id = auth.uid()` |
| Roles sem escalação | Roles em tabela separada (`user_roles`) + `has_role()` SECURITY DEFINER — nunca role em coluna do profile (o usuário editaria a própria) |
| Menor privilégio | Novo usuário nasce `viewer`; promoção só por admin (auditada) |
| Ledger imutável | `transactions` é append-only: sem policy de escrita para o cliente **e** trigger `forbid_change()` que barra até código privilegiado |
| Ordem do ledger | `seq` (identity), nunca `created_at` — `now()` devolve o horário da *transação*, então lançamentos simultâneos empatariam e a ordem do extrato seria indefinida |
| Movimentação atômica | Saldo só muda via `process_transaction()`: `FOR UPDATE` (lock), valida dono/status/saldo e grava ledger + saldo na mesma transação |
| Dinheiro íntegro | Centavos em `bigint`, `CHECK (amount_cents > 0)`, `CHECK (balance_cents >= 0)` — float nunca |
| Sem delete financeiro | Cobranças e pagamentos se **cancelam**; estados finais viram imutáveis por policy |
| Auditoria | `audit_log` append-only via trigger em charges/payments/accounts/cards/user_roles; leitura só admin |
| PCI DSS | Cartões guardam só `last4` + token do emissor; PAN/CVV jamais tocam o banco |
| Senhas isoladas | Schema `auth` inacessível a `authenticated`; hashes só via `service_role` |
| Conta única | `unique(user_id)` em `accounts` — todo o código assumia "uma conta por usuário" implicitamente (`order by created_at limit 1`); agora é garantia do banco, não convenção |
| Grants mínimos | `authenticated` não tem INSERT/UPDATE/DELETE em `transactions`, `card_transactions`, `audit_log` nem `provider_events` — só quem realmente escreve nessas tabelas (função SECURITY DEFINER ou `service_role`) pode |

### API

- **Senhas**: bcrypt (12 rounds). Login com mensagem idêntica para e-mail inexistente e senha
  errada (evita enumeração de contas) e comparação dummy para não vazar por timing.
- **Bloqueio progressivo**: 5 tentativas erradas travam a conta por 15 minutos. Durante o
  bloqueio o login responde o MESMO 401 genérico dos demais casos (sem 423, que enumeraria
  e-mails existentes), e o hash dummy (bcrypt real, 60 chars, mesmo custo) iguala o tempo.
- **Rate limit**: 10 req/15min nas rotas de autenticação, 120 req/min global,
  `POST /auth/onboarding` 5 tentativas/hora por usuário e por IP (cada recusa pode queimar o
  CPF/CNPJ na Ether). CPF/CNPJ têm dígito verificador validado antes de qualquer chamada externa.
- **Access token de 15 min** + **refresh token rotacionado** com detecção de reuso: apresentar
  um refresh token já usado invalida a sessão (sinal de token roubado).
- **Refresh tokens hasheados** (SHA-256) no banco — vazamento da tabela não dá acesso.
- **CORS restrito** por `ALLOWED_ORIGINS`; sem `*`.
- `helmet`, corpo limitado a 100 KB, encerramento gracioso (não corta pagamento no meio).

### Front

Rotas protegidas, logout real, confirmação explícita antes de qualquer saída de dinheiro
(valor, favorecido, chave e saldo resultante). Nada disso é segurança — é UX. Quem decide é
o banco.

> **Tradeoff conhecido**: os tokens ficam em `localStorage`, vulnerável a XSS. Mitigações
> atuais: access token curto e rotação com detecção de reuso. Endurecimento futuro: mover o
> refresh token para cookie `httpOnly`+`SameSite`, o que exige tratar CSRF no servidor.

## Integração com a Ether

As credenciais (`clientId`/`clientSecret`) dão acesso total à conta bancária, então a Ether é
chamada **só do servidor**. Nenhuma variável `VITE_*` contém segredo — tudo ali vai para o
bundle do navegador.

### Operações cobertas

| Módulo | Endpoint Ether | Onde |
|---|---|---|
| Cobrança PIX (Cobrança > PIX) | `POST /pix/deposit` | `server/src/routes/charges.js` |
| Transferência PIX (Pagamentos > Transferências, Folha) | `POST /pix/withdraw/pix-key` | `server/src/routes/payments.js` |
| Pagamento de boleto (Pagamentos > Contas e Tributos) | `POST /boletos/pay-boleto` | `server/src/routes/payments.js` |
| Consulta de status do boleto | `GET /boletos/{identifier}` | `GET /payments/:id/boleto-status` |
| Webhook (confirmação de depósito, falha de saque) | — | `server/src/routes/webhook.js` |

**Fora do escopo, por decisão do provedor**: emissão de boleto para cobrar terceiros. A
Ether só **paga** boletos (`pay-boleto`), não **emite** boletos de cobrança — por isso
Cobrança > Boletos permanece um registro local sem integração real; não crie a expectativa
de que gera uma linha digitável de verdade sem antes decidir outro provedor para isso.

**Fora do escopo, por decisão de produto**: pagamento de boleto com saldo `CRYPTO`. A Ether
aceita as duas origens, mas o ledger do LIVREPAY só existe em BRL — pagar com cripto exigiria
uma conta cripto própria, que não existe neste sistema. Hoje `payBoleto()` sempre usa `FIAT`.

**Valor real do boleto é conferido antes de debitar.** A linha digitável não expõe o valor de
forma confiável no nosso lado — só a Ether sabe o valor real. Até 2026-08-20, o pagamento de
boleto debitava o `amount_cents` que o usuário digitou ao criar o pagamento e pagava à Ether o
valor real do boleto, que podia ser diferente (perda para o LivrePay, ou cobrança indevida do
usuário). Agora `POST /payments/:id/execute` chama `simulateBoleto()` (`isSimulation: true`)
antes de debitar e rejeita a execução (409) se o valor real (`boleto.netAmount`) divergir do
valor declarado — nada é debitado nesse caso.

**Tarifa do PIX é lançada no ledger.** A Ether cobra `feeAmount` sobre saques PIX; até
2026-08-20 esse valor só aparecia na resposta da API, nunca no ledger — o saldo do LivrePay
divergiria silenciosamente do saldo real na Ether a cada transferência. Agora a tarifa é
debitada via `provider_settle()` após a confirmação. Se essa segunda chamada falhar (ex.: saldo
já no limite), o PIX **já saiu** e não é revertido — o log grava `FALHA CRÍTICA: tarifa PIX não
registrada no ledger` para acerto manual.

### Barreira crítica: quem pode creditar

`provider_settle()`, `provider_confirm_charge()`, `provider_complete_payment()` e
`provider_fail_payment()` têm `EXECUTE` **revogado de `authenticated`** e concedido só a
`service_role`. Sem isso, um usuário logado chamaria a função e se creditaria à vontade.
Os testes **T14** e **T26** existem para quebrar a suíte se alguém remover essa revogação.

`process_transaction()` (a RPC genérica de crédito/débito) também tem `EXECUTE` revogado de
`authenticated` desde 2026-08-20 — até então, `/receivables/:id/advance` a chamava direto sob a
role do próprio usuário para creditar `net_cents` **digitado pelo próprio usuário na criação do
recebível**, sem nenhuma verificação externa. Qualquer usuário podia criar um recebível com valor
arbitrário e antecipá-lo, creditando dinheiro que nunca existiu. Hoje a antecipação passa por
`advance_receivable()` (SECURITY DEFINER), que só libera o crédito se `receivables.verified_at`
estiver preenchido — e isso só pode ser setado por `verify_receivable()`, restrito a quem tem a
role `admin`. **Recebíveis continuam sendo dado auto-declarado pelo usuário**: a verificação
administrativa hoje é manual (não há conciliação automática com adquirente/contrato); não
libere `verify_receivable()` em massa sem checar a origem real do crédito. O teste **T2b** quebra
a suíte se `process_transaction()` voltar a ser chamável direto por `authenticated`; **T30/T31**
cobrem o fluxo de verificação.

`provider_confirm_charge()` também passou a validar que o valor liquidado no webhook
(`_paid_amount_cents`) é **igual** ao valor cobrado (`charges.amount_cents`) antes de creditar —
sem isso, um segredo de webhook vazado credita qualquer valor para uma cobrança existente. Teste
**T29**.

### Webhook

- Segredo comparado em **tempo constante** (`timingSafeEqual`).
- **Idempotência dupla**: `provider_events (provider, event_id)` é UNIQUE e as funções de
  liquidação retornam cedo se já processadas. Reentrega não credita duas vezes (T16).
- **Persistir antes de processar**: o payload é gravado primeiro; falha no processamento
  grava `error` para reprocessamento, sem perder o evento.

- **HMAC sobre o corpo cru** (desde 2026-10-06): quando há `X-Signature: t=<ts>,v1=<hex>`, o
  HMAC-SHA256 é calculado sobre `"<ts>." + bytes recebidos` (`req.rawBody`, capturado por
  `express.json({ verify })` só em `/webhooks`), nunca sobre `JSON.stringify(req.body)` — assinatura
  de emissor é sobre os bytes enviados. Sem o buffer cru, falha fechada. Timestamp: no máximo
  300 s no passado e 60 s no futuro (antes `Math.abs` aceitava 5 min adiante). Formato da
  assinatura **assumido**, ainda não confirmado pela Ether. Teste: `test:webhook`.

> ⚠️ **Limitação**: a Ether só permite configurar a URL do webhook — não há assinatura HMAC
> documentada nem entregue até aqui. O segredo é aceito via header `x-webhook-secret` ou, quando
> o painel não permite header, pela rota `POST /webhooks/ether/:token` (`ETHER_WEBHOOK_URL_TOKEN`,
> comparado em tempo constante; é a URL hoje cadastrada na Ether). O fallback por `?secret=` na
> query foi removido em 2026-08-20; **o token no path tem o mesmo risco** — path de proxy/CDN
> pode ir parar em log, então não logue URL completa de `/webhooks` e rode rotação do token se
> houver suspeita. **Peça HMAC à Ether** e migre quando disponível.

### Logs sem dado pessoal

Corpo de erro da Ether e `detail` do Postgres costumam **ecoar o valor rejeitado** (CPF,
nascimento, renda; em violação de constraint, a linha inteira de `profiles` com `tax_id` e
`phone`). Regra: erro de integração/banco só vai para log por `server/src/safeLog.js`
(`etherErrorFields` → status + código com forma de código; `errorLogFields` → `code`,
`constraint`, `table`, `routine`), **nunca** `error.body`, `error.detail`, `error.message` de
terceiros nem o objeto de erro cru. Teste: `test:privacy`.

### Cadastro na Ether — `address.city`

Texto livre nunca foi aceito em teste real e recusa pode queimar o CPF do lado da Ether
(`USR_DUP_005`: só trocar o CPF resolveu). O backend normaliza para slug
(`server/src/cityslug.js`); `hometown` ainda não (formato desconhecido — ver PENDING.md).

## Pagamentos — saída de dinheiro

```
draft/scheduled --execute_payment()------------> processing  (saldo JÁ debitado)
     processing --provider_complete_payment()--> completed
     processing --provider_fail_payment()------> failed      (ESTORNADO)
```

**Por que debitar antes de chamar o provedor**: se debitássemos só na confirmação, o usuário
dispararia N pagamentos concorrentes com saldo para um só — double-spend. O preço é ter de
estornar quando o provedor recusa, e o ledger guarda os **dois** lançamentos (débito e
estorno), preservando o histórico real.

| Risco | Proteção | Teste |
|---|---|---|
| Duplo clique em "Pagar" | `FOR UPDATE` + retorno antecipado se já `processing` | T21 |
| Pagar acima do saldo | `process_transaction` aborta a transação inteira | T22 |
| Pagar em nome de outro | `execute_payment` filtra por `auth.uid()` | T23 |
| Folha pagar "pela metade" | Lote é uma transação só: um erro desfaz tudo | T24 |
| Estorno duplicado | Retorno antecipado se já `failed` | T27 |
| Estornar pagamento concluído | Só `processing` pode falhar | T28 |

### O caso que deliberadamente não estorna

Se o PIX **sai** na Ether mas falha ao gravar `completed`, **não estornamos** — o dinheiro
saiu de fato, e estornar criaria dinheiro do nada. Fica em `processing` (HTTP 202) para o
webhook fechar. O cenário ruim de verdade (debitado, não enviado, não estornado) só ocorre se
a própria chamada de estorno falhar; aí o log grava `FALHA CRÍTICA`.

**Configure alerta para o termo `FALHA CRÍTICA` nos logs da API.**

## Multi-tenant (um app por marca, ex.: VARKI)

LivrePay e VARKI compartilham **API e banco**; cada tenant tem o **próprio front** (o da VARKI é
o repositório `varki-app`). Migration `20261111000000_tenants.sql`, testes `T44`–`T53`.

| Regra | Onde vive |
|---|---|
| O tenant do usuário é `profiles.tenant_id`, gravado no cadastro (trigger `handle_new_user`) | banco |
| `tenant_id` **não muda** por `authenticated`, `anon` nem `service_role`: mover alguém de tenant é manual (dono/doadmin) | trigger `prevent_tenant_change` (T45) |
| A equipe de um tenant fica em **`tenant_staff`**, não em `user_roles`. `has_role()`, `requireRole()` e `/admin` continuam sendo da **plataforma** | banco + API (T49) |
| Equipe de tenant só existe para usuário **do próprio tenant** | trigger `tenant_staff_same_tenant` (T46) |
| O painel `/tenant/*` só chama funções `tenant_*()` (`SECURITY DEFINER`), que exigem `tenant_staff` e filtram por tenant no SQL; recebível de outro tenant é "inexistente" (404) | banco (T47–T52) |
| **Controle duplo no crédito:** a equipe do tenant só **pré-aprova** (`tenant_reviewed_at`); `verified_at` (que libera `advance_receivable`) continua só de admin/compliance da **plataforma**. Pré-aprovação é única (não sobrescreve o aprovador) | banco (T50, T54) |
| Ninguém pré-aprova o **próprio** recebível, por função nem por UPDATE direto | função + guard de trigger (T50) |
| Recebível pré-aprovado/verificado é **imutável** (valor, vencimento, contrato) | trigger `receivables_immutable_after_review` (T55) |
| Trilha de auditoria: `receivables`, concessão de `tenant_staff` e **leitura de PII** pela equipe (`audit_log`, ação `READ`) | triggers + `tenant_list_customers` (T56) |
| Equipe vê documento **mascarado** (4 últimos dígitos) e pagamento sem chave PIX/linha digitável/documento do destinatário | funções `tenant_list_customers`/`tenant_payments_list` (T47, T52) |
| Cada app só loga conta do próprio tenant (401 genérico, sem revelar a conta); o link de reset vai para o app do tenant | API (`auth.js`) |

A API decide o tenant do **cadastro** pelo cabeçalho `Origin` mapeado em `TENANT_VARKI_ORIGINS`
(`server/src/tenants.js`). `Origin` é falsificável fora do navegador, então ele **nunca** concede
acesso: só escolhe o tenant na criação da conta e barra o login no app errado. O isolamento de dado
é do banco. Sem `Origin` ou origem desconhecida = tenant `livrepay`. A origem do app do tenant
também entra no CORS automaticamente.

Conceder equipe (manual, como o bootstrap de admin — ninguém se promove por código):

```sql
insert into public.tenant_staff (user_id, tenant_id, role)
select u.id, t.id, 'admin' from auth.users u, public.tenants t
 where u.email = 'pessoa@varki.com.br' and t.slug = 'varki';
```

**Ordem de deploy:** aplicar cada migration **antes** de publicar o código da API que depende dela
(`tenants`: o login consulta `public.tenants`; `agency_controls`: o `requireAuth` consulta
`tenants.status` e redefine `advance_receivable`/`execute_payment`; código sem a coluna = erro em toda
requisição autenticada). Admin/compliance **globais** continuam vendo todos os tenants e são
quem **libera o crédito** (`verify_receivable`); o painel da plataforma mostra a pré-aprovação e o tenant.

**Deploy da migration de controles (humano):** aplicar `20261111120000_agency_controls.sql` **antes**
de publicar a API (o `requireAuth` passa a consultar `tenants.status`; código sem a coluna = erro em
toda requisição autenticada). Ela redefine `advance_receivable` e `execute_payment`.
MFA para `tenant_staff`, dupla aprovação acima de um corte de valor (os **limites por agência** já existem;
a VARKI está **sem limite** por decisão da Ludmilla em 2026-11-11 — defina antes de operar de verdade),
contrato + DPA com a VARKI e confirmação escrita da Ether sobre o modelo multi-marca.

## Testes

```bash
npm run db:test              # 38 blocos numerados (T1-T38; 43 mensagens OK) de segurança no banco
bash server/tests/e2e.sh     # 54 asserções ponta a ponta na API (4 puladas por padrão; ver PENDING.md)
cd server && npm run test:ether      # retry/timeout do cliente Ether contra mock (nunca a Ether real)
cd server && npm run test:onboarding # schema/payload do cadastro, normalização de address.city
cd server && npm run test:documents  # rota de upload de documento de KYC (banco e Ether falsos)
cd server && npm run test:privacy    # PII não vai para log nem resposta (onboarding + handler genérico)
cd server && npm run test:webhook    # HMAC do webhook sobre o corpo cru, janela de timestamp, idempotência
cd server && npm run test:tenants    # resolução de tenant por origem (sufixo malicioso não herda o tenant)
cd server && npm run test:captcha    # reCAPTCHA com mais de um secret (LivrePay + VARKI)
```

`db:test` sobe um Postgres 16 descartável, aplica todas as migrations e valida: onboarding,
isolamento por RLS, atomicidade de crédito/débito, saldo insuficiente, movimentação de conta
alheia, imutabilidade do ledger nas duas camadas, escalação de privilégio, auditoria,
idempotência do provedor, double-spend, atomicidade da folha, estorno único, rejeição de
liquidação com valor divergente e recebível não creditar sem verificação administrativa.

`e2e.sh` valida contra a stack real: cadastro/login, bloqueio de senha fraca e duplicada,
rotação de refresh token com detecção de reuso, e — o mais importante — **isolamento entre
usuários através da API** (Bob não lê, não cancela e não executa nada da Alice).

**Rode ambos antes de qualquer deploy.**

## Operação

### Subir a stack

```bash
cp .env.example .env    # preencha as senhas e o JWT_SECRET
docker compose up -d --build
```

Gere o `JWT_SECRET` com:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

### Checklist de produção

1. `POSTGRES_PASSWORD` e `APP_DB_PASSWORD` **diferentes** e fortes.
2. A porta do Postgres fica em `127.0.0.1` — não exponha à rede.
3. TLS obrigatório no proxy à frente da API (HSTS incluso).
4. `ALLOWED_ORIGINS` só com os domínios oficiais.
5. Rotacionar `JWT_SECRET` invalida todas as sessões — planeje a janela.
6. Backup com `npm run db:backup` (gera dump em `db/backups/`, fora do volume — nunca versione o
   diretório) agendado por cron/scheduler externo, **com teste de restauração periódico**
   (`bash db/backup.sh --restore ARQUIVO` contra um banco descartável, nunca contra produção).
7. Monitorar nos logs: `FALHA CRÍTICA`, `Privilégio negado pelo banco` (tentativa de burlar RLS).

### Regras para evoluir o código

- Nova tabela: habilitar RLS **no mesmo commit**, com policy explícita por operação e
  `user_id uuid not null references auth.users`.
- Acesso a dado de negócio: **sempre** via `withUser()`. `withService()` só para o que o
  usuário legitimamente não pode fazer — e nunca para servir uma requisição autenticada.
- Nunca escrever direto em `accounts.balance_cents` nem em `transactions`.
- Regra de negócio crítica (saldo, status, limite) vive em constraint/policy/função do banco,
  não só na API.
- Tabela de negócio nova precisa responder "de que tenant é?" (via `profiles.tenant_id` do dono).
  Nunca dar acesso de equipe de tenant com policy ampla por sessão: use função `tenant_*()`
  `SECURITY DEFINER` que filtra por tenant (mesma lição de `transactions`/`receivables`).
- Não reaproveite `/admin` nem `user_roles` para equipe de tenant.

## Incidentes

Vazou segredo? 1) Rotacione (`JWT_SECRET`, senha do banco, credenciais Ether); 2) revise
`audit_log` e `provider_events`; 3) `logout-all` nas contas afetadas; 4) havendo dado pessoal
exposto, avalie comunicação à ANPD em até 72h (LGPD art. 48).
