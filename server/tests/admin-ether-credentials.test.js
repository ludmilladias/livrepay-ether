// Teste offline das rotas de admin para credenciais da Ether: vínculo da conta da
// casa (credencial e ID no ambiente do servidor) e lista/revogação do cofre.
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
process.env.ETHER_HOUSE_USER_ID = "CCCCCCCC-cccc-4ccc-8ccc-cccccccccccc"; // normalizado para minúsculas

import express from "express";

const { pool } = await import("../src/db.js");
const { adminRouter } = await import("../src/routes/admin.js");
const { errorHandler } = await import("../src/middleware.js");
const { signAccessToken } = await import("../src/tokens.js");
const { config } = await import("../src/config.js");

let FAIL = 0;
const report = [];
const check = (label, cond, detail) => {
  report.push(`  ${cond ? "OK  " : "FALHA"} ${label}${!cond && detail ? " — " + detail : ""}`);
  if (!cond) FAIL++;
};

const ADMIN = "11111111-1111-1111-1111-111111111111";
const COMPLIANCE = "22222222-2222-2222-2222-222222222222";
const CLIENTE = "33333333-3333-3333-3333-333333333333";
const ADMIN_LIGADO_OUTRA = "44444444-4444-4444-4444-444444444444";
const ADMIN_2 = "55555555-5555-5555-5555-555555555555";
const ETHER_CASA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ETHER_OUTRO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const roles = {
  [ADMIN]: ["admin"],
  [COMPLIANCE]: ["compliance"],
  [ADMIN_LIGADO_OUTRA]: ["admin"],
  [ADMIN_2]: ["admin"],
};
const profiles = {
  [ADMIN]: { id: ADMIN, ether_user_id: null },
  [COMPLIANCE]: { id: COMPLIANCE, ether_user_id: null },
  [CLIENTE]: { id: CLIENTE, ether_user_id: null },
  [ADMIN_LIGADO_OUTRA]: { id: ADMIN_LIGADO_OUTRA, ether_user_id: ETHER_OUTRO },
  [ADMIN_2]: { id: ADMIN_2, ether_user_id: null },
};
const vaultRows = [
  { user_id: CLIENTE, ether_user_id: ETHER_OUTRO, client_id: "client-x", status: "active", created_at: new Date() },
];
const profileUpdates = [];
const unlinks = [];

pool.connect = async () => {
  let claim = null;
  return {
    query: async (sql, params = []) => {
      const q = String(sql).replace(/\s+/g, " ").trim();
      if (q.startsWith("SELECT set_config")) { claim = params[0]; return { rows: [] }; }
      if (/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL)/i.test(q)) return { rows: [] };
      if (q.includes("as is_admin")) {
        const p = profiles[params[0]];
        return { rows: p ? [{ ...p, is_admin: (roles[p.id] ?? []).includes("admin") }] : [] };
      }
      if (q.includes("from public.user_roles")) return { rows: [{ roles: roles[claim] ?? [] }] };
      if (q.includes("where ether_user_id = $1 and id <> $2")) {
        return { rows: Object.values(profiles).filter((p) => p.ether_user_id === params[0] && p.id !== params[1]) };
      }
      if (q.includes("select id from public.profiles where ether_user_id = $1")) {
        return { rows: Object.values(profiles).filter((p) => p.ether_user_id === params[0]) };
      }
      if (q.includes("update public.profiles set ether_user_id = null")) {
        const p = Object.values(profiles).find((x) => x.ether_user_id === params[0]);
        if (p) { p.ether_user_id = null; unlinks.push(p.id); }
        return { rows: p ? [{ id: p.id }] : [] };
      }
      if (q.includes("update public.profiles set ether_user_id")) {
        profileUpdates.push(params);
        const p = profiles[params[0]];
        if (p && p.ether_user_id === null) p.ether_user_id = params[1];
        return { rows: [] };
      }
      if (q.includes("update vault.ether_credentials")) {
        for (const r of vaultRows) if (r.user_id === params[0] && r.status !== "revoked") { r.status = "revoked"; r.revoked_at = new Date(); }
        return { rows: [] };
      }
      if (q.includes("from vault.ether_credentials c")) {
        return { rows: vaultRows.filter((r) => r.status !== "revoked").map(({ user_id, ether_user_id, client_id, status, created_at }) => ({ user_id, ether_user_id, client_id, status, created_at })) };
      }
      throw new Error(`query inesperada: ${q.slice(0, 90)}`);
    },
    release: () => {},
  };
};

// Ether falsa: a credencial do tenant opera a conta da casa.
const realFetch = globalThis.fetch;
const etherCalls = [];
let etherDown = false;
globalThis.fetch = async (url, options = {}) => {
  const u = String(url);
  if (u.startsWith("https://ether.invalid/auth/authenticate")) {
    const { clientId, clientSecret } = JSON.parse(options.body);
    etherCalls.push(`auth:${clientId}`);
    if (etherDown) return new Response("{}", { status: 500 });
    if (clientId !== "tenant-client-id" || clientSecret !== "tenant-secret-nao-usar") {
      return new Response(JSON.stringify({ message: "invalid" }), { status: 400 });
    }
    return new Response(JSON.stringify({ access_token: "tok:tenant", expires_in: 3600 }), { status: 200 });
  }
  if (u.startsWith("https://ether.invalid/users/bank-account/details")) {
    etherCalls.push(`details:${options.headers?.Authorization}`);
    return new Response(
      JSON.stringify({ user: { id: ETHER_CASA, userProfiles: [{ name: "LIVREPAY TECNOLOGIA FINANCEIRA LTDA", taxId: "12.345.678/0001-90" }] } }),
      { status: 200 },
    );
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
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* 404 padrão do Express é HTML */ }
  return { status: res.status, text, json };
};
const link = (target, actor) => call("POST", `/admin/users/${target}/link-house-account`, actor);

// --- quem pode ------------------------------------------------------------------
let r = await link(ADMIN, null);
check("sem login -> 401", r.status === 401, r.text);
r = await link(ADMIN, CLIENTE);
check("cliente comum -> 403", r.status === 403, r.text);
r = await link(ADMIN, COMPLIANCE);
check("compliance (sem admin) -> 403", r.status === 403, r.text);
r = await call("GET", "/admin/house-account", COMPLIANCE);
check("compliance não vê a conta da casa -> 403", r.status === 403, r.text);
check("nenhuma chamada à Ether antes de autorizar", etherCalls.length === 0, JSON.stringify(etherCalls));

// --- a rota antiga de colar credencial não existe mais ---------------------------
r = await call("POST", `/admin/users/${CLIENTE}/ether-credential`, ADMIN, { etherUserId: ETHER_CASA, clientId: "x", clientSecret: "y" });
check("POST de clientId/clientSecret colado não existe mais -> 404", r.status === 404, String(r.status));

// --- validações -----------------------------------------------------------------
r = await link(CLIENTE, ADMIN);
check("cliente comum não pode operar a conta da casa -> 422", r.status === 422 && r.json.code === "HOUSE_OPERATOR_NOT_ADMIN", r.text);
r = await link(ADMIN_LIGADO_OUTRA, ADMIN);
check("admin já ligado a outra conta da Ether -> 409", r.status === 409 && r.json.code === "ETHER_USER_MISMATCH", r.text);
r = await link("99999999-9999-9999-9999-999999999999", ADMIN);
check("usuário inexistente -> 404", r.status === 404, r.text);
r = await link("nao-e-uuid", ADMIN);
check("ID de usuário malformado -> 400 (não 500)", r.status === 400, r.text);
check("nada foi gravado nas recusas", profileUpdates.length === 0, JSON.stringify(profileUpdates));

// --- conta da casa (antes do vínculo) ---------------------------------------------
r = await call("GET", "/admin/house-account", ADMIN);
check("mostra a conta configurada no servidor, ainda sem vínculo",
  r.status === 200 && r.json.ether_user_id === ETHER_CASA && r.json.linked_user_id === null, r.text);
check("ver/vincular a conta da casa não chama a Ether", etherCalls.length === 0, JSON.stringify(etherCalls));

// --- sucesso --------------------------------------------------------------------
r = await link(ADMIN, ADMIN);
check("admin vincula a conta da casa a um admin -> 200", r.status === 200 && r.json.linked_user_id === ADMIN && r.json.ether_user_id === ETHER_CASA, r.text);
check("perfil gravado com o ID vindo da Ether (não digitado)", profileUpdates.length === 1 && profileUpdates[0][0] === ADMIN && profileUpdates[0][1] === ETHER_CASA);
r = await call("GET", "/admin/house-account", ADMIN);
check("conta da casa aparece ligada ao admin", r.status === 200 && r.json.linked_user_id === ADMIN, r.text);
r = await link(ADMIN, ADMIN);
check("vincular de novo o mesmo usuário é idempotente", r.status === 200, r.text);
r = await link(ADMIN_2, ADMIN);
check("segundo usuário não pega a conta da casa -> 409", r.status === 409 && r.json.code === "HOUSE_ALREADY_LINKED", r.text);
check("o segundo usuário continua sem vínculo", profiles[ADMIN_2].ether_user_id === null);

// --- desvínculo -----------------------------------------------------------------
r = await call("POST", "/admin/house-account/unlink", COMPLIANCE);
check("compliance não desvincula -> 403", r.status === 403 && unlinks.length === 0, r.text);
r = await call("POST", "/admin/house-account/unlink", ADMIN);
check("admin desvincula -> 200 e o operador perde o vínculo", r.status === 200 && unlinks[0] === ADMIN && profiles[ADMIN].ether_user_id === null, r.text);
r = await link(ADMIN_2, ADMIN);
check("depois do desvínculo, outro admin pode assumir", r.status === 200 && profiles[ADMIN_2].ether_user_id === ETHER_CASA, r.text);

// --- conta da casa não configurada -------------------------------------------------
const houseBackup = config.ether.houseUserId;
config.ether.houseUserId = "";
r = await call("GET", "/admin/house-account", ADMIN);
check("sem ETHER_HOUSE_USER_ID -> 424 com mensagem (não 502, que a borda troca por HTML)", r.status === 424 && r.json.code === "HOUSE_ACCOUNT_NOT_CONFIGURED", r.text);
r = await link(ADMIN, ADMIN);
check("sem ETHER_HOUSE_USER_ID não vincula ninguém", r.status === 424, r.text);
config.ether.houseUserId = houseBackup;

// --- cofre: lista e revogação ---------------------------------------------------
r = await call("GET", "/admin/ether-credentials", ADMIN);
check("lista de credenciais só com metadados", r.status === 200 && r.json.length === 1 && !r.text.includes("ciphertext"), r.text);
r = await call("GET", "/admin/ether-credentials", COMPLIANCE);
check("compliance não lista credenciais -> 403", r.status === 403, r.text);
r = await call("POST", `/admin/users/${CLIENTE}/ether-credential/revoke`, COMPLIANCE);
check("compliance não revoga -> 403", r.status === 403, r.text);
r = await call("POST", `/admin/users/${CLIENTE}/ether-credential/revoke`, ADMIN);
check("admin revoga -> 204", r.status === 204 && vaultRows[0].status === "revoked", r.text);

// --- logs -----------------------------------------------------------------------
const logText = logs.join("\n");
check("log não contém segredo nem token do tenant", !logText.includes("tenant-secret-nao-usar") && !logText.includes("tok:tenant"));

server.close();
globalThis.fetch = realFetch;
process.stdout.write(report.join("\n") + (FAIL ? `\n\n${FAIL} falha(s)\n` : "\n\nTodos os testes passaram.\n"));
process.exit(FAIL ? 1 : 0);
