#!/usr/bin/env bash
# Teste end-to-end da API contra a stack do docker-compose.
# Uso: bash server/tests/e2e.sh [base_url]
#
# --- Segurança: chamadas reais à Ether ---------------------------------------
# Desde que a Ether entregou credencial de integração válida (2026-09-17), o
# `.env` local pode autenticar de verdade contra a Ether de PRODUÇÃO. Duas
# asserções deste script chamam `POST /payments/:id/execute` (PIX e boleto),
# que é o mesmo endpoint que a aplicação usa para mover dinheiro de verdade.
#
# Elas continuam SEGURAS por construção mesmo com credencial válida — os
# usuários de teste (e-mail com timestamp, recriados a cada run) nunca têm
# saldo interno antes desse ponto do script, e `execute_payment()` (Postgres)
# recusa por saldo insuficiente ANTES de qualquer chamada à Ether para PIX; a
# única chamada real que chega a acontecer é `simulateBoleto()`
# (`isSimulation: true`, apenas consulta valor, nunca paga). Nenhum teste
# aqui alcança `withdrawPixToKey()` nem `payBoleto(isSimulation:false)` — as
# únicas duas chamadas que de fato tirariam dinheiro.
#
# Isso é verdade HOJE, pela ordem do script (saldo só é creditado, via ledger
# interno, na seção de Recebíveis, que roda DEPOIS). Não é uma garantia
# estrutural do código da API — é uma propriedade deste arquivo de teste, que
# pode quebrar em uma edição futura descuidada (ex: alguém adianta a seção de
# Recebíveis, ou credita saldo de outro jeito antes de chegar aqui). Por isso
# as dois blocos de "execute" ficam atrás de uma variável explícita: por
# padrão NÃO rodam (o resto da suíte roda normalmente, só essas duas
# asserções específicas são puladas com aviso). Só rodam chamando:
#
#   ETHER_ALLOW_REAL_PAYMENTS=1 bash server/tests/e2e.sh
#
# Rode assim só sabendo que a credencial Ether ativa no ambiente é a que você
# quer testar (nunca contra produção real sem intenção deliberada de validar
# o caminho ponta a ponta).
ETHER_ALLOW_REAL_PAYMENTS="${ETHER_ALLOW_REAL_PAYMENTS:-0}"

API="${1:-http://localhost:8081}"
PASS=0
FAIL=0
SKIP=0

ok()   { echo "  OK   $1"; PASS=$((PASS+1)); }
bad()  { echo "  FALHA $1"; FAIL=$((FAIL+1)); }
skip() { echo "  SKIP $1"; SKIP=$((SKIP+1)); }
check(){ if [ "$1" = "$2" ]; then ok "$3"; else bad "$3 (esperava '$2', veio '$1')"; fi; }

# Extrai um campo string de um JSON simples sem depender de jq.
field() { sed -n "s/.*\"$2\":\"\([^\"]*\)\".*/\1/p" <<<"$1"; }
num()   { sed -n "s/.*\"$2\":\([0-9-]*\).*/\1/p" <<<"$1"; }

req() { # req METHOD PATH TOKEN BODY -> "corpo|status"
  local method="$1" path="$2" token="${3:-}" body="${4:-}"
  local args=(-s -m 20 -X "$method" "$API$path" -H "Content-Type: application/json" -w $'\n%{http_code}')
  [ -n "$token" ] && args+=(-H "Authorization: Bearer $token")
  [ -n "$body" ] && args+=(-d "$body")
  curl "${args[@]}"
}

split_status() { tail -n1 <<<"$1"; }
split_body()   { sed '$d' <<<"$1"; }

STAMP=$(date +%s%N)
ALICE="alice-$STAMP@livrepay.test"
BOB="bob-$STAMP@livrepay.test"

if [ "$ETHER_ALLOW_REAL_PAYMENTS" = "1" ]; then
  echo "!! ETHER_ALLOW_REAL_PAYMENTS=1 — as asserções de execução de pagamento vão"
  echo "!! chamar a Ether de verdade (PIX real / simulação de boleto) usando a"
  echo "!! credencial ativa em .env. Confirme que é essa a intenção."
else
  echo "Execução real de pagamento (PIX/boleto) DESATIVADA por padrão."
  echo "Defina ETHER_ALLOW_REAL_PAYMENTS=1 para incluir essas asserções."
fi
echo

echo "== Autenticação =="
R=$(req POST /auth/register "" "{\"email\":\"$ALICE\",\"password\":\"SenhaForte123!\",\"fullName\":\"Alice\"}")
check "$(split_status "$R")" "201" "registro cria conta"
ALICE_TOKEN=$(field "$(split_body "$R")" access_token)
[ -n "$ALICE_TOKEN" ] && ok "access_token emitido" || bad "access_token ausente"
ALICE_REFRESH=$(field "$(split_body "$R")" refresh_token)

R=$(req POST /auth/register "" "{\"email\":\"$BOB\",\"password\":\"SenhaForte123!\",\"fullName\":\"Bob\"}")
BOB_TOKEN=$(field "$(split_body "$R")" access_token)

R=$(req POST /auth/register "" "{\"email\":\"$ALICE\",\"password\":\"SenhaForte123!\",\"fullName\":\"Dup\"}")
check "$(split_status "$R")" "409" "e-mail duplicado é recusado"

R=$(req POST /auth/register "" "{\"email\":\"fraco-$STAMP@x.com\",\"password\":\"123\",\"fullName\":\"X\"}")
check "$(split_status "$R")" "400" "senha curta é recusada"

R=$(req POST /auth/login "" "{\"email\":\"$ALICE\",\"password\":\"SenhaErrada999\"}")
check "$(split_status "$R")" "401" "senha errada é recusada"

R=$(req POST /auth/login "" "{\"email\":\"$ALICE\",\"password\":\"SenhaForte123!\"}")
check "$(split_status "$R")" "200" "login com senha correta"

R=$(req GET /auth/me "" "")
check "$(split_status "$R")" "401" "rota protegida exige token"

R=$(req GET /auth/me "token-invalido" "")
check "$(split_status "$R")" "401" "token inválido é recusado"

R=$(req GET /auth/me "$ALICE_TOKEN" "")
check "$(split_status "$R")" "200" "perfil próprio acessível"
grep -q '"viewer"' <<<"$(split_body "$R")" && ok "usuário nasce com role viewer" || bad "role viewer ausente"

echo "== Onboarding automático =="
R=$(req GET /accounts/balance "$ALICE_TOKEN" "")
check "$(split_status "$R")" "200" "conta criada no cadastro"
check "$(num "$(split_body "$R")" balance_cents)" "0" "saldo inicial zerado"

echo "== Cobranças e isolamento (RLS via API) =="
R=$(req POST /charges "$ALICE_TOKEN" '{"kind":"pix","description":"Consultoria","amount_cents":350000}')
check "$(split_status "$R")" "201" "alice cria cobrança"
CHARGE_ID=$(field "$(split_body "$R")" id)

R=$(req POST /charges "$ALICE_TOKEN" '{"kind":"pix","description":"Zero","amount_cents":0}')
check "$(split_status "$R")" "400" "cobrança de valor zero é recusada"

R=$(req POST /charges "$ALICE_TOKEN" '{"kind":"pix","description":"Neg","amount_cents":-500}')
check "$(split_status "$R")" "400" "cobrança de valor negativo é recusada"

R=$(req GET "/charges?kind=pix" "$ALICE_TOKEN" "")
[ "$(grep -c "$CHARGE_ID" <<<"$(split_body "$R")")" = "1" ] && ok "alice vê a própria cobrança" || bad "alice não vê a própria cobrança"

R=$(req GET "/charges?kind=pix" "$BOB_TOKEN" "")
check "$(split_body "$R")" "[]" "bob NÃO vê cobrança da alice (RLS)"

R=$(req PATCH "/charges/$CHARGE_ID/cancel" "$BOB_TOKEN" "")
check "$(split_status "$R")" "404" "bob NÃO cancela cobrança da alice"

R=$(req GET "/charges/stats?kind=pix" "$ALICE_TOKEN" "")
check "$(num "$(split_body "$R")" total)" "1" "estatísticas contam só as próprias"

echo "== Pagamentos: PIX =="
R=$(req POST /payments "$ALICE_TOKEN" '{"kind":"transferencia","amount_cents":50000,"recipient_name":"Fornecedor","recipient_key":"fornecedor@x.com"}')
check "$(split_status "$R")" "201" "alice cria pagamento PIX"
PAY_ID=$(field "$(split_body "$R")" id)

R=$(req POST /payments "$ALICE_TOKEN" '{"kind":"transferencia","amount_cents":1000,"recipient_key":"x@x.com"}')
check "$(split_status "$R")" "400" "pagamento PIX sem favorecido é recusado"

if [ "$ETHER_ALLOW_REAL_PAYMENTS" = "1" ]; then
  # Saldo é sempre 0 aqui (usuário recém-criado, ainda não passou pela seção
  # de Recebíveis) — execute_payment() recusa por saldo insuficiente ANTES de
  # chamar withdrawPixToKey(). Nenhum PIX real sai nesta asserção.
  R=$(req POST "/payments/$PAY_ID/execute" "$ALICE_TOKEN" "")
  check "$(split_status "$R")" "422" "pagamento sem saldo é bloqueado"

  R=$(req GET /accounts/balance "$ALICE_TOKEN" "")
  check "$(num "$(split_body "$R")" balance_cents)" "0" "saldo intacto após falha"
else
  skip "pagamento PIX sem saldo é bloqueado (ETHER_ALLOW_REAL_PAYMENTS!=1)"
  skip "saldo intacto após falha do PIX (ETHER_ALLOW_REAL_PAYMENTS!=1)"
fi

R=$(req GET "/payments?kind=transferencia" "$BOB_TOKEN" "")
check "$(split_body "$R")" "[]" "bob NÃO vê pagamento da alice (RLS)"

R=$(req POST "/payments/$PAY_ID/execute" "$BOB_TOKEN" "")
check "$(split_status "$R")" "404" "bob NÃO executa pagamento da alice"
BOB_ON_ALICE_BODY=$(split_body "$R")

# Execução está DESLIGADA (503, ver executePaymentForUser) — mas a propriedade é
# checada ANTES do 503, então o isolamento continua provado por esta rota.
# Id inexistente e id de outro dono têm de ser INDISTINGUÍVEIS (mesmo status e
# mesmo corpo): qualquer diferença vazaria a existência do pagamento.
R=$(req POST "/payments/00000000-0000-4000-8000-000000000000/execute" "$BOB_TOKEN" "")
check "$(split_status "$R")" "404" "id inexistente também dá 404"
check "$(split_body "$R")" "$BOB_ON_ALICE_BODY" "404 de id inexistente e de outro dono são idênticos (sem vazar existência)"

R=$(req POST "/payments/nao-e-uuid/execute" "$BOB_TOKEN" "")
check "$(split_status "$R")" "404" "id malformado dá 404, não 500"

# Dono do pagamento: passa pela checagem de propriedade e cai no 503. Seguro por
# construção — o 503 sai antes de qualquer débito ou chamada à Ether. Quando a
# execução for religada, o esperado aqui vira 422 (saldo 0), como na seção
# gated por ETHER_ALLOW_REAL_PAYMENTS acima.
R=$(req POST "/payments/$PAY_ID/execute" "$ALICE_TOKEN" "")
check "$(split_status "$R")" "503" "dono executa o próprio pagamento: 503 (execução desligada)"
R=$(req GET /accounts/balance "$ALICE_TOKEN" "")
check "$(num "$(split_body "$R")" balance_cents)" "0" "saldo intacto após o 503"

echo "== Pagamentos: Boleto (Contas e Tributos) =="
VALID_LINE="34191790010104351004791020150008589370000002000"
R=$(req POST /payments "$ALICE_TOKEN" "{\"kind\":\"conta\",\"amount_cents\":15000,\"payment_method\":\"BOLETO\",\"recipient_key\":\"$VALID_LINE\"}")
check "$(split_status "$R")" "201" "alice cadastra boleto sem informar favorecido"
BOLETO_ID=$(field "$(split_body "$R")" id)
grep -q '"recipient_name":"Boleto"' <<<"$(split_body "$R")" && ok "favorecido default 'Boleto' aplicado" || bad "favorecido default ausente"

R=$(req POST /payments "$ALICE_TOKEN" '{"kind":"conta","amount_cents":15000,"payment_method":"BOLETO","recipient_key":"12345"}')
check "$(split_status "$R")" "400" "linha digitável curta é recusada"

R=$(req POST /payments "$ALICE_TOKEN" "{\"kind\":\"conta\",\"amount_cents\":15000,\"payment_method\":\"BOLETO\",\"recipient_key\":\"$VALID_LINE\"}" )
DUP_STATUS=$(split_status "$R")
check "$DUP_STATUS" "201" "linha digitável formatada com pontos também é aceita (revalidada em dígitos)"

if [ "$ETHER_ALLOW_REAL_PAYMENTS" = "1" ]; then
  # O pagamento de boleto consulta o valor real na Ether (simulateBoleto, com
  # isSimulation:true — NUNCA move dinheiro) ANTES de debitar. Com a linha
  # digitável fictícia deste teste, os desfechos possíveis contra a Ether real
  # são: 502 (provedor recusa a linha), 409 (valor simulado diverge do
  # informado) ou 422 (linha aceita mas saldo insuficiente — sempre 0 aqui).
  # Em NENHUM desses casos payBoleto(isSimulation:false) chega a ser chamado:
  # é a única chamada que de fato pagaria o boleto.
  R=$(req POST "/payments/$BOLETO_ID/execute" "$ALICE_TOKEN" "")
  BOLETO_EXEC=$(split_status "$R")
  { [ "$BOLETO_EXEC" = "422" ] || [ "$BOLETO_EXEC" = "502" ] || [ "$BOLETO_EXEC" = "409" ]; } \
    && ok "pagamento de boleto é bloqueado sem saldo/provedor ($BOLETO_EXEC)" \
    || bad "pagamento de boleto deveria ser bloqueado (veio $BOLETO_EXEC)"

  R=$(req GET /accounts/balance "$ALICE_TOKEN" "")
  check "$(num "$(split_body "$R")" balance_cents)" "0" "saldo intacto após falha do boleto"
else
  skip "pagamento de boleto é bloqueado sem saldo/provedor (ETHER_ALLOW_REAL_PAYMENTS!=1 — evita até a consulta real via simulateBoleto)"
  skip "saldo intacto após falha do boleto (ETHER_ALLOW_REAL_PAYMENTS!=1)"
fi

R=$(req GET "/payments/$BOLETO_ID/boleto-status" "$ALICE_TOKEN" "")
check "$(split_status "$R")" "409" "status do boleto indisponível antes de enviar ao provedor"

R=$(req GET "/payments/$BOLETO_ID/boleto-status" "$BOB_TOKEN" "")
check "$(split_status "$R")" "404" "bob NÃO consulta status do boleto da alice"

echo "== Recebíveis =="
R=$(req POST /receivable-contracts "$ALICE_TOKEN" '{"name":"Contrato Cielo Loja Centro","acquirer":"Cielo"}')
check "$(split_status "$R")" "201" "alice cria contrato de recebíveis"
CONTRACT_ID=$(field "$(split_body "$R")" id)

R=$(req GET /receivable-contracts "$BOB_TOKEN" "")
check "$(split_body "$R")" "[]" "bob NÃO vê contrato da alice (RLS)"

DUE=$(date -u -d "+10 days" +%Y-%m-%d 2>/dev/null || date -u -v+10d +%Y-%m-%d)
R=$(req POST /receivables "$ALICE_TOKEN" "{\"contract_id\":\"$CONTRACT_ID\",\"gross_cents\":100000,\"net_cents\":97000,\"due_date\":\"$DUE\"}")
check "$(split_status "$R")" "201" "alice agenda recebível"
RECV_ID=$(field "$(split_body "$R")" id)

R=$(req POST /receivables "$ALICE_TOKEN" "{\"gross_cents\":1000,\"net_cents\":2000,\"due_date\":\"$DUE\"}")
check "$(split_status "$R")" "400" "recebível com líquido maior que bruto é recusado"

R=$(req GET "/receivables?status=scheduled" "$BOB_TOKEN" "")
check "$(split_body "$R")" "[]" "bob NÃO vê recebível da alice (RLS)"

R=$(req POST "/receivables/$RECV_ID/advance" "$BOB_TOKEN" "")
check "$(split_status "$R")" "422" "bob NÃO antecipa recebível da alice"

# --- Separação de responsabilidades (migration 20260820000000) --------------
# Antecipar credita saldo real. Por isso o recebível precisa ser VERIFICADO por
# um admin antes — senão qualquer usuário cadastraria um recebível fictício e
# se creditaria sozinho. Estes testes travam essa regra.

BAL_BEFORE=$(split_body "$(req GET /accounts/balance "$ALICE_TOKEN" "")")
BAL_BEFORE=$(num "$BAL_BEFORE" balance_cents)

R=$(req POST "/receivables/$RECV_ID/advance" "$ALICE_TOKEN" "")
check "$(split_status "$R")" "422" "recebível NÃO verificado não pode ser antecipado"

R=$(req GET /accounts/balance "$ALICE_TOKEN" "")
check "$(num "$(split_body "$R")" balance_cents)" "$BAL_BEFORE" "saldo intacto após antecipação recusada"

# Alice não pode verificar o próprio recebível (não é admin).
R=$(req POST "/admin/receivables/$RECV_ID/verify" "$ALICE_TOKEN" "")
[ "$(split_status "$R")" = "403" ] || [ "$(split_status "$R")" = "401" ] \
  && ok "não-admin NÃO verifica recebível (separação de responsabilidades)" \
  || bad "não-admin conseguiu verificar recebível (veio $(split_status "$R"))"

# Enquanto bob é usuário comum, o extrato dele tem de estar vazio (RLS).
# Depois da promoção a admin isso muda legitimamente (staff read) — por isso a
# checagem precisa vir ANTES.
R=$(req GET /transactions "$BOB_TOKEN" "")
check "$(split_body "$R")" "[]" "extrato de bob vazio enquanto é usuário comum (RLS)"

# Promove bob a admin direto no banco — não existe (nem deve existir) rota
# pública de autopromoção.
docker exec livrepay-novo-db psql -U postgres -d livrepay -q -c \
  "insert into public.user_roles (user_id, role)
   select id, 'admin' from auth.users where email = '$BOB'
   on conflict do nothing;" >/dev/null 2>&1 \
  && ok "bob promovido a admin (via banco, para o teste)" \
  || bad "não consegui promover bob a admin"

R=$(req POST "/admin/receivables/$RECV_ID/verify" "$BOB_TOKEN" "")
check "$(split_status "$R")" "200" "admin verifica o recebível"

R=$(req POST "/receivables/$RECV_ID/advance" "$ALICE_TOKEN" "")
check "$(split_status "$R")" "200" "após verificado, alice antecipa"

R=$(req GET /accounts/balance "$ALICE_TOKEN" "")
BAL_AFTER=$(num "$(split_body "$R")" balance_cents)
[ "$BAL_AFTER" = "$((BAL_BEFORE + 97000))" ] && ok "antecipação credita o valor líquido no saldo" \
  || bad "antecipação NÃO creditou corretamente ($BAL_BEFORE -> $BAL_AFTER, esperava +97000)"

R=$(req POST "/receivables/$RECV_ID/advance" "$ALICE_TOKEN" "")
check "$(split_status "$R")" "422" "recebível já antecipado não antecipa de novo"

R=$(req PATCH "/receivables/$RECV_ID/cancel" "$ALICE_TOKEN" "")
check "$(split_status "$R")" "404" "recebível já antecipado não pode mais ser cancelado"

echo "== Extrato e ledger =="
R=$(req GET /transactions "$ALICE_TOKEN" "")
# Neste ponto alice já tem 1 lançamento: o crédito da antecipação de recebível.
grep -q '"description":"Antecipação de recebível"' <<<"$(split_body "$R")" \
  && ok "extrato mostra o crédito da antecipação" \
  || bad "extrato não mostra o crédito da antecipação"

# Bob agora é admin, mas GET /transactions é rota PESSOAL (só requireAuth,
# sem filtro de conta na query — RLS "usuário lê as próprias" é o único
# isolamento). Até 2026-10-06 a policy "transactions: staff le todas"
# (20260821010000) vazava aqui e também em /reports/statement e
# /reports/financials para qualquer admin/compliance — corrigido em
# 20260906010000 (policy removida; volume agregado de staff agora só via
# admin_transactions_volume(), chamada por GET /admin/reports/volume).
# NÃO reverta esta asserção achando "admin devia ver tudo": a visão agregada
# de staff tem rota própria e isolada, testada mais abaixo.
R=$(req GET /transactions "$BOB_TOKEN" "")
grep -q '"description":"Antecipação de recebível"' <<<"$(split_body "$R")" \
  && bad "admin NÃO deveria ver lançamento de outro usuário em /transactions (rota pessoal)" \
  || ok "admin não enxerga lançamentos de outros usuários em /transactions (rota pessoal isolada)"

echo "== Relatórios (/reports/*) e volume admin =="
# Soma todos os valores numéricos de um campo num JSON (sem jq). Os campos de
# dinheiro chegam como número (o driver converte bigint) e nunca negativos.
sumf()  { grep -o "\"$2\":[0-9]*" <<<"$1" | sed 's/.*://' | awk '{s+=$1} END {print s+0}'; }
countf(){ grep -o "\"$2\":" <<<"$1" | wc -l | tr -d ' '; }

# Carol: usuária comum e SEM movimentação — prova de que não enxerga a alice.
CAROL="carol-$STAMP@livrepay.test"
R=$(req POST /auth/register "" "{\"email\":\"$CAROL\",\"password\":\"SenhaForte123!\",\"fullName\":\"Carol\"}")
CAROL_TOKEN=$(field "$(split_body "$R")" access_token)
[ -n "$CAROL_TOKEN" ] && ok "carol (usuária comum, sem movimento) registrada" || bad "carol não registrada"

# Movimento conhecido da alice, pelos MESMOS caminhos de produção (funções de
# serviço — a API não tem rota que credite/debite): a cobrança de 350000 é
# liquidada (provider_confirm_charge) e uma tarifa de 20000 é debitada
# (provider_settle). Com o crédito da antecipação (97000) o ledger da alice fica:
#   +97000 (antecipação)  +350000 (cobrança paga)  -20000 (tarifa)
# => entradas 447000, saídas 20000, saldo final 427000, 3 lançamentos.
# Nenhuma chamada à Ether: é SQL direto no banco do compose.
docker exec livrepay-novo-db psql -U postgres -d livrepay -q -c \
  "select public.provider_confirm_charge('$CHARGE_ID', 350000, 'PAID');
   select public.provider_settle((select id from auth.users where email = '$ALICE'),
          'debit', 20000, 'Tarifa e2e', null, null);" >/dev/null 2>&1 \
  && ok "movimento conhecido lançado para a alice (+350000 cobrança, -20000 tarifa)" \
  || bad "não consegui lançar o movimento de teste da alice"

R=$(req GET /accounts/balance "$ALICE_TOKEN" "")
check "$(num "$(split_body "$R")" balance_cents)" "427000" "saldo da alice = 97000 + 350000 - 20000"

# Sem token nenhuma rota de relatório responde.
for P in cashflow statement reconciliation financials; do
  R=$(req GET "/reports/$P" "" "")
  check "$(split_status "$R")" "401" "/reports/$P exige autenticação"
done

# --- cashflow
R=$(req GET /reports/cashflow "$ALICE_TOKEN" "")
check "$(split_status "$R")" "200" "alice lê o próprio cashflow"
B=$(split_body "$R")
check "$(countf "$B" day)" "30" "cashflow cobre 30 dias"
check "$(sumf "$B" in_cents)" "447000" "cashflow: entradas batem com o ledger (447000)"
check "$(sumf "$B" out_cents)" "20000" "cashflow: saídas batem com o ledger (20000)"

# --- statement
R=$(req GET /reports/statement "$ALICE_TOKEN" "")
check "$(split_status "$R")" "200" "alice lê o próprio extrato"
B=$(split_body "$R")
check "$(num "$B" opening_balance_cents)" "0" "extrato: saldo inicial = 0"
check "$(num "$B" closing_balance_cents)" "427000" "extrato: saldo final = saldo da conta"
check "$(num "$B" total_in_cents)" "447000" "extrato: total de entradas"
check "$(num "$B" total_out_cents)" "20000" "extrato: total de saídas"
check "$(num "$B" transaction_count)" "3" "extrato: 3 lançamentos"
grep -q '"description":"Tarifa e2e"' <<<"$B" && ok "extrato lista a tarifa lançada" || bad "extrato não lista a tarifa"

TOMORROW=$(date -u -d "+1 day" +%Y-%m-%d 2>/dev/null || date -u -v+1d +%Y-%m-%d)
R=$(req GET "/reports/statement?from=$TOMORROW&to=$TOMORROW" "$ALICE_TOKEN" "")
B=$(split_body "$R")
check "$(num "$B" transaction_count)" "0" "extrato de período sem movimento: 0 lançamentos"
check "$(num "$B" opening_balance_cents)" "427000" "extrato vazio: saldo inicial = saldo atual"
check "$(num "$B" closing_balance_cents)" "427000" "extrato vazio: saldo final = saldo atual"

R=$(req GET "/reports/statement?from=2026-13-45&to=2026-13-46" "$ALICE_TOKEN" "")
check "$(split_status "$R")" "400" "extrato com data impossível (mês 13) é recusado, não vira 500"
R=$(req GET "/reports/statement?from=ontem" "$ALICE_TOKEN" "")
check "$(split_status "$R")" "400" "extrato com data fora do formato é recusado"
R=$(req GET "/reports/statement?from=$TOMORROW&to=2000-01-01" "$ALICE_TOKEN" "")
check "$(split_status "$R")" "400" "extrato com from depois de to é recusado"

# --- reconciliation: a cobrança paga tem exatamente um lançamento no ledger
R=$(req GET /reports/reconciliation "$ALICE_TOKEN" "")
check "$(split_status "$R")" "200" "alice lê a própria conciliação"
B=$(split_body "$R")
check "$(num "$B" total)" "1" "conciliação: 1 item liquidado (a cobrança paga)"
check "$(num "$B" reconciled_count)" "1" "conciliação: o item tem lançamento no ledger"
check "$(num "$B" divergent_count)" "0" "conciliação: nenhuma divergência"

# --- financials
R=$(req GET /reports/financials "$ALICE_TOKEN" "")
check "$(split_status "$R")" "200" "alice lê o próprio financeiro"
B=$(split_body "$R")
check "$(num "$B" balance_cents)" "427000" "financeiro: saldo"
check "$(num "$B" revenue_cents)" "447000" "financeiro: receita 30d (créditos do ledger)"
check "$(num "$B" expense_cents)" "20000" "financeiro: despesa 30d (débitos do ledger)"
check "$(num "$B" net_cents)" "427000" "financeiro: líquido = receita - despesa"
check "$(countf "$B" month)" "12" "financeiro: 12 meses por padrão"
grep -q '"revenue_by_kind":\[{"kind":"pix","total_cents":350000}\]' <<<"$B" \
  && ok "financeiro: receita por tipo = cobrança pix de 350000" || bad "financeiro: receita por tipo divergente"
R=$(req GET "/reports/financials?months=3" "$ALICE_TOKEN" "")
check "$(countf "$(split_body "$R")" month)" "3" "financeiro: months=3 devolve 3 meses"

# --- isolamento: carol (comum) NÃO enxerga nada da alice em nenhum relatório
R=$(req GET /reports/cashflow "$CAROL_TOKEN" "")
B=$(split_body "$R")
check "$(sumf "$B" in_cents)$(sumf "$B" out_cents)" "00" "carol NÃO vê o cashflow da alice (RLS)"
R=$(req GET /reports/statement "$CAROL_TOKEN" "")
check "$(num "$(split_body "$R")" transaction_count)" "0" "carol NÃO vê o extrato da alice (RLS)"
R=$(req GET /reports/reconciliation "$CAROL_TOKEN" "")
check "$(num "$(split_body "$R")" total)" "0" "carol NÃO vê a conciliação da alice (RLS)"
R=$(req GET /reports/financials "$CAROL_TOKEN" "")
B=$(split_body "$R")
check "$(num "$B" revenue_cents)$(num "$B" expense_cents)$(num "$B" balance_cents)" "000" "carol NÃO vê o financeiro da alice (RLS)"
grep -q '"revenue_by_kind":\[\]' <<<"$B" && ok "carol: receita por tipo vazia" || bad "carol vê receita por tipo da alice"

# --- GET /admin/reports/volume (bob já é admin; alice e carol não)
R=$(req GET /admin/reports/volume "" "")
check "$(split_status "$R")" "401" "volume admin exige autenticação"
R=$(req GET /admin/reports/volume "$CAROL_TOKEN" "")
check "$(split_status "$R")" "403" "usuário comum NÃO lê o volume admin"
R=$(req GET /admin/reports/volume "$ALICE_TOKEN" "")
check "$(split_status "$R")" "403" "alice (viewer, com movimento) NÃO lê o volume admin"
R=$(req GET /admin/reports/volume "$BOB_TOKEN" "")
check "$(split_status "$R")" "200" "admin lê o volume"
B=$(split_body "$R")
check "$(countf "$B" day)" "30" "volume admin cobre 30 dias"
# O banco persiste entre execuções do script e o staff vê TODOS os usuários,
# então o total é >= ao movimento desta execução (não igual).
[ "$(sumf "$B" in_cents)" -ge 447000 ] && ok "volume admin inclui as entradas da alice (>= 447000)" || bad "volume admin não inclui as entradas da alice"
[ "$(sumf "$B" out_cents)" -ge 20000 ] && ok "volume admin inclui as saídas da alice (>= 20000)" || bad "volume admin não inclui as saídas da alice"

echo "== Sessão =="
R=$(req POST /auth/refresh "" "{\"refresh_token\":\"$ALICE_REFRESH\"}")
check "$(split_status "$R")" "200" "refresh token rotaciona a sessão"

R=$(req POST /auth/refresh "" "{\"refresh_token\":\"$ALICE_REFRESH\"}")
check "$(split_status "$R")" "401" "refresh token reutilizado é recusado"

echo "== Webhook =="
R=$(req POST /webhooks/ether "" '{"id":"evt-1","eventType":"pix.created","data":{}}')
check "$(split_status "$R")" "401" "webhook sem segredo é recusado"

echo
echo "Passou: $PASS   Falhou: $FAIL   Pulado: $SKIP"
[ "$SKIP" -eq 0 ] || echo "(pulado = asserções de execução real de pagamento; rode com ETHER_ALLOW_REAL_PAYMENTS=1 para incluí-las)"
[ "$FAIL" -eq 0 ] || exit 1
