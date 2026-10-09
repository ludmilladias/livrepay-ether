// Teste offline de endurecimento de /auth e do handler de erro (sem Ether, sem banco).
// Cobre: hash dummy do login, 401 genérico com conta bloqueada (sem 423),
// rate limit de POST /auth/onboarding (por usuário e por IP), máscara do token
// de /webhooks/* no log e /health sem err.message.
// Uso: node server/tests/auth-hardening.test.js
process.env.ETHER_CLIENT_ID = "test-client";
process.env.ETHER_CLIENT_SECRET = "test-secret";
process.env.ETHER_BASE_URL = "https://ether.invalid";
process.env.JWT_SECRET = "test-jwt-secret-not-real-0123456789";
process.env.PGUSER = "test";
process.env.PGPASSWORD = "test";
process.env.BCRYPT_ROUNDS = "4"; // custo baixo só para o teste ser rápido

import express from "express";

const { pool } = await import("../src/db.js");
const { authRouter, DUMMY_HASH } = await import("../src/routes/auth.js");
const { errorHandler, asyncRoute, safeLogPath } = await import("../src/middleware.js");
const { signAccessToken } = await import("../src/tokens.js");
const bcrypt = (await import("bcryptjs")).default;

let FAIL = 0;
const check = (label, cond, detail) => {
  console.log(`  ${cond ? "OK  " : "FALHA"} ${label}${!cond && detail ? " — " + detail : ""}`);
  if (!cond) FAIL++;
};

// --- M1: hash dummy ----------------------------------------------------------
check("DUMMY_HASH tem 60 chars", DUMMY_HASH.length === 60, String(DUMMY_HASH.length));
check("DUMMY_HASH é bcrypt válido (compare computa, retorna false p/ senha diferente)",
  (await bcrypt.compare("outra-senha", DUMMY_HASH)) === false && (await bcrypt.compare("livrepay-dummy-password", DUMMY_HASH)) === true);

// --- banco falso para /login -------------------------------------------------
const lockedUntil = new Date(Date.now() + 10 * 60_000).toISOString();
const realHash = await bcrypt.hash("senha-correta-123", 4);
pool.connect = async () => ({ query: async () => ({ rows: [] }), release: () => {} });
const origQuery = pool.query.bind(pool);
pool.query = async (sql, params) => {
  const q = String(sql);
  if (q.includes("from auth.users where email")) {
    if (params[0] === "locked@example.com") {
      return { rows: [{ id: "u1", email: params[0], password_hash: realHash, raw_user_meta_data: {}, failed_login_attempts: 0, locked_until: lockedUntil }] };
    }
    return { rows: [] }; // e-mail inexistente
  }
  return origQuery(sql, params);
};

// --- captura de log ----------------------------------------------------------
const logs = [];
for (const m of ["error", "warn"]) console[m] = (...a) => { logs.push(JSON.stringify(a)); };

const app = express();
app.use(express.json());
app.use("/auth", authRouter);
app.get("/webhooks/ether/SEGREDO-NO-PATH", asyncRoute(async () => { throw new Error("falha qualquer"); }));
app.use(errorHandler);
const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}`;

const post = async (path, body, token) => {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text, json: text ? JSON.parse(text) : null };
};

// --- M2: login com conta bloqueada = mesmo 401 -------------------------------
const wrong = await post("/auth/login", { email: "naoexiste@example.com", password: "qualquer-senha-123" });
const locked = await post("/auth/login", { email: "locked@example.com", password: "senha-correta-123" });
check("e-mail inexistente -> 401", wrong.status === 401, String(wrong.status));
check("conta bloqueada (senha certa) -> 401, não 423", locked.status === 401, String(locked.status));
check("corpo idêntico entre inexistente e bloqueada", wrong.text === locked.text, `${wrong.text} | ${locked.text}`);

// --- B3: token de /webhooks/* mascarado no log -------------------------------
logs.length = 0;
const wh = await fetch(`${base}/webhooks/ether/SEGREDO-NO-PATH?x=1`);
await wh.text();
const logText = logs.join("\n");
check("webhook com erro -> 500 genérico", wh.status === 500, String(wh.status));
check("log não contém o token do path", !logText.includes("SEGREDO-NO-PATH"), logText);
check("log mantém provedor e marca :token", logText.includes("/webhooks/ether/:token"), logText);
check("safeLogPath: rota sem token fica intacta", safeLogPath({ originalUrl: "/webhooks/ether", path: "/ether" }) === "/webhooks/ether");
check("safeLogPath: rota fora de /webhooks usa req.path", safeLogPath({ originalUrl: "/charges/abc", path: "/charges/abc" }) === "/charges/abc");

// --- B4: /health sem err.message ---------------------------------------------
const indexSrc = await (await import("node:fs/promises")).readFile(new URL("../src/index.js", import.meta.url), "utf8");
check("index.js: /health não devolve err.message", !/res\.status\(503\)\.json\([^)]*err\.message/.test(indexSrc));

// --- Rate limit de /auth/onboarding ------------------------------------------
// Corpo inválido de propósito: a tentativa conta mesmo rejeitada por validação.
const tokA = signAccessToken("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
const tokB = signAccessToken("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
const statuses = [];
for (let i = 0; i < 5; i++) statuses.push((await post("/auth/onboarding", {}, tokA)).status);
check("5 tentativas por usuário passam pelo limitador (400 de validação)", statuses.every((s) => s === 400), statuses.join(","));
const sixth = await post("/auth/onboarding", {}, tokA);
check("6ª tentativa em 1h -> 429 em português",
  sixth.status === 429 && /Muitas tentativas/.test(sixth.json?.error ?? ""), `${sixth.status} ${sixth.text}`);
// Mesmo IP, outro usuário: o teto por IP é mais folgado (30/h), então um usuário
// legítimo atrás do mesmo IP (CGNAT/escritório) ainda passa depois das 6 acima...
const other = await post("/auth/onboarding", {}, tokB);
check("outro usuário no mesmo IP ainda passa (IP tem teto maior que o usuário)", other.status === 400, String(other.status));
// ...mas o teto por IP existe: tokens distintos esgotam os 30/h do IP (já gastos: 7; a 31ª tentativa é barrada).
let ipStatus = 0;
for (let i = 0; i < 24; i++) {
  const t = signAccessToken(`cccccccc-cccc-cccc-cccc-${String(i).padStart(12, "0")}`);
  ipStatus = (await post("/auth/onboarding", {}, t)).status;
}
check("teto por IP (30/h) barra usuários distintos -> 429", ipStatus === 429, String(ipStatus));

server.close();
console.log(FAIL ? `\n${FAIL} falha(s)` : "\ntudo ok");
process.exit(FAIL ? 1 : 0);
