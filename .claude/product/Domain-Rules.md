# Regras de Domínio do LivrePay

## Conta e usuário

- Toda tabela de negócio pertence a um `user_id` e tem RLS habilitado desde o commit que a cria.
- Um usuário nunca acessa, lista ou movimenta dado de outro usuário — nem por bug de API, nem por
  query direta. A garantia final é do Postgres (policy), não do código da rota.
- Promoção de role (`viewer` → papel privilegiado) é auditada e nunca feita por coluna editável
  pelo próprio usuário.
- Exclusão/encerramento de conta deve considerar saldo remanescente, cobranças/pagamentos em
  aberto, cartões, tokens de sessão e `audit_log`.

## Ledger e saldo

- `transactions` é append-only: sem policy de escrita para o cliente e com trigger que barra
  qualquer `UPDATE`/`DELETE`, inclusive para código privilegiado por engano.
- Saldo só muda dentro de `process_transaction()` (ou equivalente): lock (`FOR UPDATE`), validação
  de dono/status/saldo e escrita do ledger na mesma transação.
- Ordem do ledger é dada por sequência monotônica (`seq`), nunca por `created_at` — lançamentos
  simultâneos podem ter o mesmo timestamp.
- Dinheiro é sempre inteiro (centavos, `bigint`). Nunca `float`/`double` em valor monetário, em
  nenhuma camada (banco, API, front).
- `balance_cents >= 0` e `amount_cents > 0` são invariantes de banco (`CHECK`), não só validação
  de formulário.

## Cobranças e pagamentos

- Cobrança e pagamento nunca são deletados — só cancelados. Estado final (`completed`, `failed`,
  `canceled`) é imutável por policy.
- Pagamento debita o saldo **antes** de chamar o provedor (Ether), nunca só na confirmação —
  senão N requisições concorrentes gastariam o mesmo saldo (double-spend). Recusa do provedor
  gera estorno explícito no ledger, nunca reversão silenciosa do lançamento original.
- Se o dinheiro efetivamente saiu na Ether mas a confirmação falhou ao gravar, **não se estorna**
  — o pagamento fica `processing` até o webhook resolver. Estornar aqui criaria saldo do nada.
- Execução de pagamento/folha em lote é atômica: um item que falha desfaz o lote inteiro, nunca
  "meio pago".
- Funções que creditam saldo por confirmação de provedor (`provider_settle`,
  `provider_confirm_charge`, `provider_complete_payment`, `provider_fail_payment`) só podem ser
  executadas por role de serviço — nunca pela role autenticada do usuário comum.

## Integração com provedor (Ether)

- Credenciais de provedor (`clientId`/`clientSecret`) só existem no servidor. Nenhuma variável
  exposta ao bundle do navegador (`VITE_*`) carrega segredo.
- Webhook: segredo comparado em tempo constante; evento persistido antes de processar; chave de
  idempotência (`provider`, `event_id`) única — reentrega nunca credita duas vezes.
- Escopo do provedor é limite de produto, não bug: a Ether paga boleto mas não emite boleto de
  cobrança de terceiros; pagamento de boleto é sempre em `FIAT` (o ledger do LivrePay é só BRL).
- Chamada real de saque/pagamento com dinheiro de verdade contra o provedor de produção nunca é
  feita de forma automatizada por um agente — apenas o usuário, manualmente, com valor pequeno.

## Cartões

- Armazenar só `last4` e token do emissor. PAN e CVV completos nunca tocam o banco do LivrePay
  (escopo PCI DSS).

## IA (quando aplicável a categorização, suporte ou análise de risco)

- Sugestão de IA (categorização de despesa, detecção de anomalia, etc.) é sempre recomendação —
  a decisão final de mover dinheiro é sempre do usuário ou de uma regra de negócio determinística.
- A IA não decide sozinha aprovação/reprovação de crédito, limite ou liberação de saque sem uma
  regra de negócio auditável por trás.
- A IA deve abster-se de concluir quando a informação disponível não permite uma resposta segura.

## Planos e limites

- Limites (valor de transação, número de cartões, sublimite de conta) vêm de configuração ou
  regra centralizada — nunca hardcoded espalhado pelo front.
- O backend/banco é a fonte de verdade; o front nunca decide se uma operação é permitida.
- Mudança de plano ou de limite nunca causa exclusão silenciosa de dado ou de histórico financeiro.
