// Teste offline de "esqueci a senha" e do reCAPTCHA (sem banco, sem rede externa).
// Banco falso em pool.connect; fetch interceptado só para Google e Resend.
// Uso: node server/tests/password-reset.test.js
process.env.ETHER_CLIENT_ID = "test-client";
process.env.ETHER_CLIENT_SECRET = "test-secret";
process.env.ETHER_BASE_URL = "https://ether.invalid";
process.env.JWT_SECRET = "test-jwt-secret-not-real-0123456789";
process.env.PGUSER = "test";
process.env.PGPASSWORD = "test";
process.env.BCRYPT_ROUNDS = "4";
process.env.RECAPTCHA_SECRET = "recaptcha-secret-de-teste";
process.env.RESEND_API_KEY = "re_chave_de_teste";
process.env.APP_URL = "https://app.teste.invalid";

import crypto from "node:crypto";
import express from "express";

const { pool } = await import("../src/db.js");
const { authRouter } = await import("../src/routes/auth.js");
const { errorHandler } = await import("../src/middleware.js");

let FAIL = 0;
const check = (label, cond, detail) => {
  console.log(`  ${cond ? "OK  " : "FALHA"} ${label}${!cond && detail ? " — " + detail : ""}`);
  if (!cond) FAIL++;
};
const sha256 = (v) => crypto.createHash("sha256").update(v).digest("hex");

// --- banco falso -------------------------------------------------------------
const USER = { id: "u-ana", email: "ana@example.com" };
const tokens = new Map(); // hash -> { used }
const queries = [];
pool.connect = async () => ({
  query: async (sql, params) => {
    const q = String(sql);
    if (/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL)/i.test(q)) return { rows: [] };
    queries.push({ q, params });
    if (q.includes("select id, email from auth.users where email")) {
      return { rows: params[0] === USER.email ? [USER] : [] };
    }
    if (q.includes("insert into auth.password_reset_tokens")) {
      tokens.set(params[1], { used: false });
      return { rows: [] };
    }
    if (q.includes("with t as")) {
      const t = tokens.get(params[0]);
      if (!t || t.used) return { rows: [] };
      t.used = true;
      return { rows: [USER] };
    }
    return { rows: [] };
  },
  release: () => {},
});

// --- fetch: intercepta Google e Resend; o resto (127.0.0.1) é real -------------
const realFetch = globalThis.fetch;
const sentMails = [];
let googleMode = "ok"; // ok | fail | down
let googleCalls = 0;
globalThis.fetch = async (url, options) => {
  const u = String(url);
  if (u.includes("google.com/recaptcha")) {
    googleCalls++;
    if (googleMode === "down") throw new Error("rede fora");
    return new Response(JSON.stringify({ success: googleMode === "ok" }), { status: 200 });
  }
  if (u.includes("api.resend.com")) {
    sentMails.push(JSON.parse(options.body));
    return new Response("{}", { status: 200 });
  }
  return realFetch(url, options);
};

const logs = [];
for (const m of ["log", "error", "warn"]) {
  const orig = console[m].bind(console);
  console[m] = (...a) => {
    logs.push(JSON.stringify(a));
    if (m === "log" && a[0]?.startsWith?.("  ")) orig(...a);
  };
}
const say = (...a) => process.stdout.write(a.join(" ") + "\n");

const app = express();
app.use(express.json());
app.use("/auth", authRouter);
app.use(errorHandler);
const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}`;
const post = async (path, body) => {
  const res = await realFetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text, json: text ? JSON.parse(text) : null };
};
const waitFor = async (fn, ms = 1000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 10)); }
  return fn();
};
const CAPTCHA = { captchaToken: "token-de-captcha-valido-123" };

// --- reCAPTCHA ----------------------------------------------------------------
let r = await post("/auth/login", { email: "x@example.com", password: "qualquer-senha-123" });
check("login sem captchaToken -> 400 CAPTCHA_REQUIRED", r.status === 400 && r.json.code === "CAPTCHA_REQUIRED", r.text);

googleMode = "fail";
r = await post("/auth/login", { email: "x@example.com", password: "qualquer-senha-123", ...CAPTCHA });
check("Google recusa o token -> 400 CAPTCHA_FAILED", r.status === 400 && r.json.code === "CAPTCHA_FAILED", r.text);

googleMode = "down";
r = await post("/auth/login", { email: "x@example.com", password: "qualquer-senha-123", ...CAPTCHA });
check("Google fora do ar -> 503 (falha fechado)", r.status === 503 && r.json.code === "CAPTCHA_UNAVAILABLE", r.text);

googleMode = "ok";
r = await post("/auth/login", { email: "x@example.com", password: "qualquer-senha-123", ...CAPTCHA });
check("captcha válido segue para o login (401 de credencial)", r.status === 401, r.text);

// --- esqueci a senha ----------------------------------------------------------
const known = await post("/auth/forgot-password", { email: "Ana@Example.com", ...CAPTCHA });
const unknown = await post("/auth/forgot-password", { email: "ninguem@example.com", ...CAPTCHA });
check("e-mail com conta -> 202", known.status === 202, known.text);
check("e-mail sem conta -> 202 com o MESMO corpo (sem enumeração)", unknown.status === 202 && unknown.text === known.text, `${known.text} | ${unknown.text}`);

await waitFor(() => sentMails.length > 0);
await new Promise((r) => setTimeout(r, 100));
check("e-mail enviado só para a conta existente", sentMails.length === 1 && sentMails[0].to[0] === USER.email, JSON.stringify(sentMails.map((m) => m.to)));
const link = /https:\/\/app\.teste\.invalid\/redefinir-senha#token=([A-Za-z0-9_-]+)/.exec(sentMails[0]?.text ?? "");
check("link usa o fragmento #token= (não vai em query string)", !!link, sentMails[0]?.text);
const token = link?.[1];
check("o banco guarda só o SHA-256 do token", !!token && tokens.has(sha256(token)) && ![...queries].some((x) => JSON.stringify(x.params).includes(token)));
check("link anterior ainda aberto é invalidado antes de criar o novo",
  queries.some((x) => x.q.includes("update auth.password_reset_tokens set used_at = now() where user_id = $1")));

r = await post("/auth/forgot-password", { email: "nao-e-email", ...CAPTCHA });
check("e-mail inválido -> 400", r.status === 400, r.text);
r = await post("/auth/forgot-password", { email: "ana@example.com" });
check("forgot-password sem captcha -> 400 CAPTCHA_REQUIRED", r.status === 400 && r.json.code === "CAPTCHA_REQUIRED", r.text);

// 3 por e-mail/hora: ana já usou 1 (+1 do captcha ausente não conta: barrado antes)
await post("/auth/forgot-password", { email: "ana@example.com", ...CAPTCHA });
await post("/auth/forgot-password", { email: "ana@example.com", ...CAPTCHA });
r = await post("/auth/forgot-password", { email: "ana@example.com", ...CAPTCHA });
check("4ª solicitação do mesmo e-mail na hora -> 429", r.status === 429, String(r.status));

// --- redefinir ----------------------------------------------------------------
const current = [...tokens.keys()].at(-1);
check("há token ativo para redefinir", !!current);
r = await post("/auth/reset-password", { token: "x".repeat(43), password: "nova-senha-segura-1" });
check("token desconhecido -> 400 RESET_TOKEN_INVALID", r.status === 400 && r.json.code === "RESET_TOKEN_INVALID", r.text);
r = await post("/auth/reset-password", { token, password: "curta" });
check("senha curta -> 400", r.status === 400, r.text);

// Token do e-mail ainda em uso? (os dois últimos pedidos invalidaram o primeiro no banco real;
// aqui o banco falso não simula isso, então usamos o token do último e-mail.)
const lastMail = sentMails.at(-1);
const lastToken = /#token=([A-Za-z0-9_-]+)/.exec(lastMail.text)[1];
queries.length = 0;
sentMails.length = 0;
r = await post("/auth/reset-password", { token: lastToken, password: "nova-senha-segura-1" });
check("token válido -> 204", r.status === 204, r.text);
check("sessões abertas revogadas", queries.some((x) => x.q.includes("auth.refresh_tokens") && x.q.includes("revoked_at")));
check("senha gravada como hash bcrypt (nunca em claro)",
  queries.some((x) => x.q.includes("set password_hash") && /^\$2[aby]\$/.test(x.params[1]) && x.params[1] !== "nova-senha-segura-1"));
check("conta destravada na mesma instrução", queries.some((x) => x.q.includes("failed_login_attempts = 0") && x.q.includes("locked_until = null")));
await waitFor(() => sentMails.length > 0);
check("e-mail de aviso de senha alterada enviado", sentMails.length === 1 && /alterada/.test(sentMails[0].subject));

r = await post("/auth/reset-password", { token: lastToken, password: "outra-senha-segura-2" });
check("reutilizar o mesmo link -> 400 (uso único)", r.status === 400 && r.json.code === "RESET_TOKEN_INVALID", r.text);

// --- logs ---------------------------------------------------------------------
const logText = logs.join("\n");
check("log não contém o token nem a senha", !logText.includes(lastToken) && !logText.includes("nova-senha-segura-1"));
check("log não contém a chave do Resend nem o segredo do reCAPTCHA", !logText.includes("re_chave_de_teste") && !logText.includes("recaptcha-secret-de-teste"));

server.close();
globalThis.fetch = realFetch;
say(FAIL ? `\n${FAIL} falha(s)` : "\nTodos os testes passaram.");
process.exit(FAIL ? 1 : 0);
