// Teste offline das rotas de admin para credenciais da Ether por cliente.
// Banco falso em pool.connect; fetch interceptado para a Ether.
// Uso: node server/tests/admin-ether-credentials.test.js
import crypto from "node:crypto";

process.env.ETHER_CLIENT_ID = "tenant-client-id";
process.env.ETHER_CLIENT_SECRET = "tenant-secret-nao-usar";
process.env.ETHER_BASE_URL = "https://ether.invalid";
process.env.JWT_SECRET = "test-jwt-secret-not-real-0123456789";
process.env.PGUSER = "test";
process.env.PGPASSWORD = "test";
process.env.ETHER_CREDENTIALS_KEY = crypto.randomBytes(32).toString("base64");

import express from "express";

const { pool } = await import("../src/db.js");
const { adminRouter } = await import("../src/routes/admin.js");
const { errorHandler } = await import("../src/middleware.js");
const { signAccessToken } = await import("../src/tokens.js");

let FAIL = 0;
const report = [];
const check = (label, cond, detail) => {
  report.push(`  ${cond ? "OK  " : "FALHA"} ${label}${!cond && detail ? " — " + detail : ""}`);
  if (!cond) FAIL++;
};

const ADMIN = "11111111-1111-1111-1111-111111111111";
const COMPLIANCE = "22222222-2222-2222-2222-222222222222";
const CLIENTE = "33333333-3333-3333-3333-333333333333";
const LIGADO = "44444444-4444-4444-4444-444444444444";
const ETHER_CLIENTE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ETHER_OUTRO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SECRET = "segredo-do-cliente-xyz";

const roles = { [ADMIN]: ["admin"], [COMPLIANCE]: ["compliance"] };
const profiles = {
  [CLIENTE]: { id: CLIENTE, tax_id: "52998224725", ether_user_id: null },
  [LIGADO]: { id: LIGADO, tax_id: "11144477735", ether_user_id: ETHER_OUTRO },
};
const vaultRows = [];
const profileUpdates = [];

pool.connect = async () => {
  let claim = null;
  return {
    query: async (sql, params = []) => {
      const q = String(sql).replace(/\s+/g, " ").trim();
      if (q.startsWith("SELECT set_config")) { claim = params[0]; return { rows: [] }; }
      if (/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL)/i.test(q)) return { rows: [] };
      if (q.includes("from public.user_roles")) return { rows: [{ roles: roles[claim] ?? [] }] };
      if (q.includes("from public.profiles where id")) return { rows: profiles[params[0]] ? [profiles[params[0]]] : [] };
      if (q.includes("update public.profiles set ether_user_id")) { profileUpdates.push(params); return { rows: [] }; }
      if (q.includes("update vault.ether_credentials")) {
        for (const r of vaultRows) if (r.user_id === params[0] && r.status !== "revoked") { r.status = "revoked"; r.revoked_at = new Date(); }
        return { rows: [] };
      }
      if (q.includes("insert into vault.ether_credentials")) {
        const [user_id, ether_user_id, client_id, ciphertext, , , , created_by] = params;
        const r = { id: `cred-${vaultRows.length + 1}`, user_id, ether_user_id, client_id, ciphertext, created_by, status: "active", created_at: new Date() };
        vaultRows.push(r);
        return { rows: [{ id: r.id, user_id, ether_user_id, client_id, status: "active", created_at: r.created_at }] };
      }
      if (q.includes("from vault.ether_credentials c")) {
        return { rows: vaultRows.filter((r) => r.status !== "revoked").map(({ user_id, ether_user_id, client_id, status, created_at }) => ({ user_id, ether_user_id, client_id, status, created_at })) };
      }
      throw new Error(`query inesperada: ${q.slice(0, 90)}`);
    },
    release: () => {},
  };
};

// Ether falsa: cada clientId "pertence" a um cliente.
const OWNERS = {
  "client-ok": { id: ETHER_CLIENTE, taxId: "529.982.247-25" },
  "client-de-outro": { id: ETHER_OUTRO, taxId: "529.982.247-25" },
  "client-cpf-diferente": { id: ETHER_CLIENTE, taxId: "111.444.777-35" },
};
const realFetch = globalThis.fetch;
const etherCalls = [];
globalThis.fetch = async (url, options = {}) => {
  const u = String(url);
  if (u.startsWith("https://ether.invalid/auth/authenticate")) {
    const { clientId, clientSecret } = JSON.parse(options.body);
    etherCalls.push(`auth:${clientId}`);
    if (!OWNERS[clientId] || clientSecret !== SECRET) {
      return new Response(JSON.stringify({ message: "invalid" }), { status: 400 });
    }
    return new Response(JSON.stringify({ access_token: `tok:${clientId}`, expires_in: 3600 }), { status: 200 });
  }
  if (u.startsWith("https://ether.invalid/users/bank-account/details")) {
    const token = String(options.headers?.Authorization ?? "").replace("Bearer tok:", "");
    etherCalls.push(`details:${token}`);
    const owner = OWNERS[token];
    return new Response(JSON.stringify({ user: { id: owner.id, userProfiles: [{ taxId: owner.taxId }] } }), { status: 200 });
  }
  return realFetch(url, options);
};

const logs = [];
for (const m of ["log", "error", "warn"]) console[m] = (...a) => logs.push(JSON.stringify(a));

const app = express();
app.use(express.json());
app.use("/admin", adminRouter);
app.use(errorHandler);
const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (method, path, userId, body) => {
  const res = await realFetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", ...(userId ? { Authorization: `Bearer ${signAccessToken(userId)}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, text, json: text ? JSON.parse(text) : null };
};
const body = (clientId, over = {}) => ({ etherUserId: ETHER_CLIENTE, clientId, clientSecret: SECRET, ...over });

// --- quem pode ------------------------------------------------------------------
let r = await call("POST", `/admin/users/${CLIENTE}/ether-credential`, null, body("client-ok"));
check("sem login -> 401", r.status === 401, r.text);
r = await call("POST", `/admin/users/${CLIENTE}/ether-credential`, CLIENTE, body("client-ok"));
check("cliente comum -> 403", r.status === 403, r.text);
r = await call("POST", `/admin/users/${CLIENTE}/ether-credential`, COMPLIANCE, body("client-ok"));
check("compliance (sem admin) -> 403", r.status === 403, r.text);
check("nenhuma chamada à Ether antes de autorizar", etherCalls.length === 0, JSON.stringify(etherCalls));

// --- validações -----------------------------------------------------------------
r = await call("POST", `/admin/users/${CLIENTE}/ether-credential`, ADMIN, body("client-ok", { etherUserId: "nao-e-uuid" }));
check("userId da Ether inválido -> 400", r.status === 400, r.text);
r = await call("POST", `/admin/users/${CLIENTE}/ether-credential`, ADMIN, body("client-ok", { clientSecret: "errado-123" }));
check("Ether recusa a credencial -> 422 e nada gravado", r.status === 422 && r.json.code === "ETHER_CREDENTIAL_INVALID" && vaultRows.length === 0, r.text);
r = await call("POST", `/admin/users/${CLIENTE}/ether-credential`, ADMIN, body("client-de-outro"));
check("credencial de outro cliente da Ether -> 422 e nada gravado", r.status === 422 && r.json.code === "ETHER_CREDENTIAL_OWNER_MISMATCH" && vaultRows.length === 0, r.text);
r = await call("POST", `/admin/users/${CLIENTE}/ether-credential`, ADMIN, body("client-cpf-diferente"));
check("CPF da Ether diferente do da LivrePay -> 422 e nada gravado", r.status === 422 && r.json.code === "ETHER_CREDENTIAL_TAXID_MISMATCH" && vaultRows.length === 0, r.text);
r = await call("POST", `/admin/users/${LIGADO}/ether-credential`, ADMIN, body("client-ok"));
check("usuário já ligado a outro cliente da Ether -> 409", r.status === 409 && r.json.code === "ETHER_USER_MISMATCH", r.text);
r = await call("POST", `/admin/users/99999999-9999-9999-9999-999999999999/ether-credential`, ADMIN, body("client-ok"));
check("usuário inexistente -> 404", r.status === 404, r.text);

// --- sucesso --------------------------------------------------------------------
r = await call("POST", `/admin/users/${CLIENTE}/ether-credential`, ADMIN, body("client-ok"));
check("admin cadastra credencial válida -> 201", r.status === 201 && r.json.client_id === "client-ok" && r.json.ether_user_id === ETHER_CLIENTE, r.text);
check("resposta não traz o segredo nem texto cifrado", !r.text.includes(SECRET) && !("secret" in (r.json ?? {})) && !r.text.includes("ciphertext"));
check("cofre guarda o segredo cifrado, com o admin como autor",
  vaultRows.length === 1 && vaultRows[0].created_by === ADMIN && !Buffer.from(vaultRows[0].ciphertext).toString("latin1").includes(SECRET));
check("perfil ligado ao cliente da Ether", profileUpdates.length === 1 && profileUpdates[0][1] === ETHER_CLIENTE);

r = await call("GET", "/admin/ether-credentials", ADMIN);
check("lista de credenciais só com metadados", r.status === 200 && r.json.length === 1 && !r.text.includes(SECRET) && !r.text.includes("ciphertext"), r.text);
r = await call("GET", "/admin/ether-credentials", COMPLIANCE);
check("compliance não lista credenciais -> 403", r.status === 403, r.text);

r = await call("POST", `/admin/users/${CLIENTE}/ether-credential/revoke`, ADMIN);
check("admin revoga -> 204 e credencial sai da lista", r.status === 204 && vaultRows[0].status === "revoked", r.text);
r = await call("POST", `/admin/users/${CLIENTE}/ether-credential/revoke`, COMPLIANCE);
check("compliance não revoga -> 403", r.status === 403, r.text);

// --- logs -----------------------------------------------------------------------
const logText = logs.join("\n");
check("log não contém segredo nem token", !logText.includes(SECRET) && !logText.includes("tok:client"));

server.close();
globalThis.fetch = realFetch;
process.stdout.write(report.join("\n") + (FAIL ? `\n\n${FAIL} falha(s)\n` : "\n\nTodos os testes passaram.\n"));
process.exit(FAIL ? 1 : 0);
