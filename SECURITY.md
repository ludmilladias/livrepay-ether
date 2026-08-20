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

### API

- **Senhas**: bcrypt (12 rounds). Login com mensagem idêntica para e-mail inexistente e senha
  errada (evita enumeração de contas) e comparação dummy para não vazar por timing.
- **Bloqueio progressivo**: 5 tentativas erradas travam a conta por 15 minutos.
- **Rate limit**: 10 req/15min nas rotas de autenticação, 120 req/min global.
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

### Barreira crítica: quem pode creditar

`provider_settle()`, `provider_confirm_charge()`, `provider_complete_payment()` e
`provider_fail_payment()` têm `EXECUTE` **revogado de `authenticated`** e concedido só a
`service_role`. Sem isso, um usuário logado chamaria a função e se creditaria à vontade.
Os testes **T14** e **T26** existem para quebrar a suíte se alguém remover essa revogação.

### Webhook

- Segredo comparado em **tempo constante** (`timingSafeEqual`).
- **Idempotência dupla**: `provider_events (provider, event_id)` é UNIQUE e as funções de
  liquidação retornam cedo se já processadas. Reentrega não credita duas vezes (T16).
- **Persistir antes de processar**: o payload é gravado primeiro; falha no processamento
  grava `error` para reprocessamento, sem perder o evento.

> ⚠️ **Limitação**: a Ether só permite configurar a URL do webhook — não há assinatura HMAC
> documentada. Aceitamos o segredo via header `x-webhook-secret` (preferido) ou `?secret=`.
> Segredo em query string pode aparecer em log de proxy — **peça HMAC à Ether** e migre.

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

## Testes

```bash
npm run db:test              # 29 asserções de segurança no banco
bash server/tests/e2e.sh     # 37 asserções ponta a ponta na API
```

`db:test` sobe um Postgres 16 descartável, aplica todas as migrations e valida: onboarding,
isolamento por RLS, atomicidade de crédito/débito, saldo insuficiente, movimentação de conta
alheia, imutabilidade do ledger nas duas camadas, escalação de privilégio, auditoria,
idempotência do provedor, double-spend, atomicidade da folha e estorno único.

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
6. Backup do volume `livrepay_novo_pgdata` com teste de restauração periódico.
7. Monitorar nos logs: `FALHA CRÍTICA`, `Privilégio negado pelo banco` (tentativa de burlar RLS).

### Regras para evoluir o código

- Nova tabela: habilitar RLS **no mesmo commit**, com policy explícita por operação e
  `user_id uuid not null references auth.users`.
- Acesso a dado de negócio: **sempre** via `withUser()`. `withService()` só para o que o
  usuário legitimamente não pode fazer — e nunca para servir uma requisição autenticada.
- Nunca escrever direto em `accounts.balance_cents` nem em `transactions`.
- Regra de negócio crítica (saldo, status, limite) vive em constraint/policy/função do banco,
  não só na API.

## Incidentes

Vazou segredo? 1) Rotacione (`JWT_SECRET`, senha do banco, credenciais Ether); 2) revise
`audit_log` e `provider_events`; 3) `logout-all` nas contas afetadas; 4) havendo dado pessoal
exposto, avalie comunicação à ANPD em até 72h (LGPD art. 48).
