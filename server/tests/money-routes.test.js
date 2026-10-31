// Teste offline das rotas que movimentam dinheiro: POST /charges/:id/emit e
// POST /payments/:id/execute. Banco falso em pool.connect (RLS emulada pelo
// claim do JWT); fetch interceptado para a Ether. Nenhuma chamada real.
// Cobre: isolamento entre usuários, conta não habilitada (403 sem débito nem
// chamada de dinheiro), token certo na Ether, estorno quando a Ether recusa.
// Uso: node server/tests/money-routes.test.js
import crypto from "node:crypto";

process.env.ETHER_CLIENT_ID = "tenant-client-id";
process.env.ETHER_CLIENT_SECRET = "tenant-secret-nao-usar";
process.env.ETHER_BASE_URL = "https://ether.invalid";
process.env.JWT_SECRET = "test-jwt-secret-not-real-0123456789";
process.env.PGUSER = "test";
process.env.PGPASSWORD = "test";
process.env.ETHER_CREDENTIALS_KEY = crypto.randomBytes(32).toString("base64");
process.env.ETHER_HOUSE_USER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

import express from "express";

const { pool } = await import("../src/db.js");
const { chargesRouter } = await import("../src/routes/charges.js");
const { paymentsRouter } = await import("../src/routes/payments.js");
const { errorHandler } = await import("../src/middleware.js");
const { signAccessToken } = await import("../src/tokens.js");

let FAIL = 0;
const report = [];
const check = (label, cond, detail) => {
  report.push(`  ${cond ? "OK  " : "FALHA"} ${label}${!cond && detail ? " — " + detail : ""}`);
  if (!cond) FAIL++;
};

const CASA = "11111111-1111-4111-8111-111111111111"; // admin ligado à conta da casa
const CLIENTE = "22222222-2222-4222-8222-222222222222"; // sem conta habilitada
const OUTRO = "33333333-3333-4333-8333-333333333333";

const profiles = {
  [CASA]: { ether_user_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", is_admin: true },
  [CLIENTE]: { ether_user_id: null, is_admin: false },
  [OUTRO]: { ether_user_id: null, is_admin: false },
};
const uid = () => crypto.randomUUID();
const charges = {};
const payments = {};
const ledger = []; // execute_payment / provider_* chamados
function addCharge(owner, over = {}) {
  const id = uid();
  charges[id] = { id, user_id: owner, kind: "pix", status: "pending", amount_cents: 100, provider_charge_id: null, ...over };
  return id;
}
function addPayment(owner, over = {}) {
  const id = uid();
  payments[id] = {
    id, user_id: owner, status: "draft", amount_cents: 10, recipient_name: "Fulano",
    recipient_key: "fulano@exemplo.com", metadata: { payment_method: "PIX", pix_key_type: "EMAIL" }, ...over,
  };
  return id;
}

pool.connect = async () => {
  let claim = null;
  return {
    query: async (sql, params = []) => {
      const q = String(sql).replace(/\s+/g, " ").trim();
      if (q.startsWith("SELECT set_config")) { claim = params[0]; return { rows: [] }; }
      if (/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL)/i.test(q)) return { rows: [] };
      // RLS emulada: o usuário só enxerga as próprias linhas.
      if (q.includes("from public.charges where id")) {
        const c = charges[params[0]];
        return { rows: c && c.user_id === claim ? [c] : [] };
      }
      if (q.includes("update public.charges")) {
        const c = charges[params[0]];
        Object.assign(c, { provider_charge_id: params[1], provider_status: params[2] });
        return { rows: [] };
      }
      if (q.includes("from public.payments where id")) {
        const p = payments[params[0]];
        return { rows: p && p.user_id === claim ? [p] : [] };
      }
      if (q.includes("public.execute_payment")) { ledger.push(["debit", params[0]]); payments[params[0]].status = "processing"; return { rows: [] }; }
      if (q.includes("public.provider_complete_payment")) { ledger.push(["complete", params[0], params[1]]); return { rows: [] }; }
      if (q.includes("public.provider_fail_payment")) { ledger.push(["refund", params[0]]); return { rows: [] }; }
      if (q.includes("public.provider_settle")) { ledger.push(["fee", params[3], params[1]]); return { rows: [] }; }
      if (q.includes("as is_admin") && q.includes("from public.profiles p")) {
        const p = profiles[params[0]];
        return { rows: p ? [p] : [] };
      }
      if (q.includes("from vault.ether_credentials")) return { rows: [] };
      throw new Error(`query inesperada: ${q.slice(0, 90)}`);
    },
    release: () => {},
  };
};

const realFetch = globalThis.fetch;
const etherCalls = [];
let withdrawMode = "ok";
globalThis.fetch = async (url, options = {}) => {
  const u = String(url);
  if (!u.startsWith("https://ether.invalid")) return realFetch(url, options);
  const auth = options.headers?.Authorization;
  etherCalls.push({ path: u.replace("https://ether.invalid", ""), auth, body: options.body });
  if (u.endsWith("/auth/authenticate")) {
    return new Response(JSON.stringify({ access_token: "tok-tenant", expires_in: 3600 }), { status: 200 });
  }
  if (u.endsWith("/pix/deposit")) {
    return new Response(JSON.stringify({ uuid: "dep-1", status: "PENDING", qrCodeId: "qr-1", pixKey: "000201copiaecola", expireAt: "2026-10-31T00:00:00Z" }), { status: 201 });
  }
  if (u.endsWith("/pix/withdraw/pix-key")) {
    if (withdrawMode === "reject") return new Response(JSON.stringify({ code: "PIX_VAL_001" }), { status: 400 });
    return new Response(JSON.stringify({ pixId: "pix-1", status: "PROCESSING", e2e: "E2E1", feeAmount: 1 }), { status: 201 });
  }
  return new Response("{}", { status: 404 });
};

const logs = [];
for (const m of ["log", "error", "warn"]) console[m] = (...a) => logs.push(JSON.stringify(a));

const app = express();
app.use(express.json());
app.use("/charges", chargesRouter);
app.use("/payments", paymentsRouter);
app.use(errorHandler);
const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}`;
const post = async (path, userId) => {
  const res = await realFetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${signAccessToken(userId)}` },
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* corpo não-JSON */ }
  return { status: res.status, text, json };
};
const moneyCalls = () => etherCalls.filter((c) => /\/pix\/|\/boletos\//.test(c.path));

// --- cobrança Pix (entrada) ---------------------------------------------------------
const chargeCasa = addCharge(CASA);
const chargeCliente = addCharge(CLIENTE);

let r = await post(`/charges/${chargeCasa}/emit`, OUTRO);
const rInexistente = await post(`/charges/${uid()}/emit`, OUTRO);
check("cobrança de outro dono responde igual a inexistente (404)", r.status === 404 && rInexistente.status === 404 && r.text === rInexistente.text, r.text);
r = await post(`/charges/nao-e-uuid/emit`, CASA);
check("id malformado -> 404 (não 500)", r.status === 404, r.text);
r = await post(`/charges/${chargeCliente}/emit`, CLIENTE);
check("cliente sem conta habilitada -> 403 ACCOUNT_NOT_ENABLED", r.status === 403 && r.json?.code === "ACCOUNT_NOT_ENABLED", r.text);
check("nenhuma chamada de dinheiro à Ether até aqui", moneyCalls().length === 0, JSON.stringify(etherCalls));

r = await post(`/charges/${chargeCasa}/emit`, CASA);
const dep = moneyCalls().find((c) => c.path === "/pix/deposit");
check("operador da casa emite a cobrança Pix -> 200 com copia e cola", r.status === 200 && r.json?.pix_copy_paste === "000201copiaecola", r.text);
check("depósito Pix enviado com o token do tenant", dep?.auth === "Bearer tok-tenant");
check("valor e chave de idempotência da própria cobrança",
  dep && JSON.parse(dep.body).amount === 100 && JSON.parse(dep.body).idempotencyKey === chargeCasa.replace(/-/g, "").slice(0, 25));
check("cobrança gravada com o id do provedor", charges[chargeCasa].provider_charge_id === "dep-1");
r = await post(`/charges/${chargeCasa}/emit`, CASA);
check("emitir de novo -> 409 (sem segundo depósito)", r.status === 409 && moneyCalls().filter((c) => c.path === "/pix/deposit").length === 1, r.text);

// --- pagamento Pix (saída) ------------------------------------------------------------
const payCasa = addPayment(CASA);
const payCliente = addPayment(CLIENTE);

r = await post(`/payments/${payCasa}/execute`, OUTRO);
check("pagamento de outro dono -> 404, sem débito", r.status === 404 && ledger.length === 0, r.text);
r = await post(`/payments/${payCliente}/execute`, CLIENTE);
check("cliente sem conta habilitada -> 403 e NADA debitado", r.status === 403 && r.json?.code === "ACCOUNT_NOT_ENABLED" && ledger.length === 0, r.text);
check("nenhum saque Pix enviado para cliente sem conta", !moneyCalls().some((c) => c.path === "/pix/withdraw/pix-key"));

r = await post(`/payments/${payCasa}/execute`, CASA);
const wd = moneyCalls().find((c) => c.path === "/pix/withdraw/pix-key");
check("operador da casa executa o Pix -> 200 concluído", r.status === 200 && r.json?.status === "completed", r.text);
check("debita ANTES de enviar e conclui depois", ledger[0]?.[0] === "debit" && ledger[1]?.[0] === "complete" && ledger[1][2] === "pix-1", JSON.stringify(ledger));
check("saque Pix enviado com o token do tenant e o valor do pagamento", wd?.auth === "Bearer tok-tenant" && JSON.parse(wd.body).amount === 10);
check("tarifa da Ether lançada no ledger", ledger.some((l) => l[0] === "fee" && l[2] === 1));

// Ether recusa: estorno.
const payRecusado = addPayment(CASA);
withdrawMode = "reject";
ledger.length = 0;
r = await post(`/payments/${payRecusado}/execute`, CASA);
check("Ether recusa o Pix -> estorna o débito", ledger[0]?.[0] === "debit" && ledger.some((l) => l[0] === "refund" && l[1] === payRecusado) && r.status >= 400, JSON.stringify(ledger));
withdrawMode = "ok";

// --- logs -----------------------------------------------------------------------------
const logText = logs.join("\n");
check("log não contém token nem segredo do tenant", !logText.includes("tok-tenant") && !logText.includes("tenant-secret-nao-usar"));

server.close();
globalThis.fetch = realFetch;
process.stdout.write(report.join("\n") + (FAIL ? `\n\n${FAIL} falha(s)\n` : "\n\nTodos os testes passaram.\n"));
process.exit(FAIL ? 1 : 0);
