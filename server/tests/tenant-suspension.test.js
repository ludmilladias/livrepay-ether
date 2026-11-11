// Teste da checagem de agência suspensa no requireAuth (server/src/middleware.js), com o
// banco simulado. Nada de rede.
//
// Uso: node server/tests/tenant-suspension.test.js

process.env.JWT_SECRET = "test-jwt-secret-not-real-0123456789";
process.env.PGUSER = "test";
process.env.PGPASSWORD = "test";

let PASS = 0;
let FAIL = 0;
const check = (cond, label, detail) => {
  if (cond) {
    console.log(`  OK   ${label}`);
    PASS++;
  } else {
    console.log(`  FALHA ${label}${detail ? " — " + detail : ""}`);
    FAIL++;
  }
};

const { pool } = await import("../src/db.js");
const { signAccessToken } = await import("../src/tokens.js");
const { requireAuth, isTenantSuspended, clearSuspensionCache } = await import("../src/middleware.js");

// --- banco falso -------------------------------------------------------------
const status = new Map([
  ["u-ativo", "active"],
  ["u-suspenso", "suspended"],
]);
let statusQueries = 0;
let failDb = false;
pool.connect = async () => ({
  query: async (sql, params) => {
    const q = String(sql);
    if (/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL)/i.test(q)) return { rows: [] };
    if (q.includes("join public.tenants t on t.id = p.tenant_id")) {
      statusQueries++;
      if (failDb) throw new Error("banco fora");
      const s = status.get(params[0]);
      return { rows: s ? [{ status: s }] : [] };
    }
    return { rows: [] };
  },
  release: () => {},
});

const run = (token) =>
  new Promise((resolve) => {
    const req = { headers: token ? { authorization: `Bearer ${token}` } : {} };
    requireAuth(req, {}, (error) => resolve({ error, req }));
  });

// 1) agência ativa passa
let r = await run(signAccessToken("u-ativo"));
check(!r.error && r.req.userId === "u-ativo", "usuario de agencia ativa passa e recebe req.userId");

// 2) suspensa: 403 TENANT_SUSPENDED, sem userId
clearSuspensionCache();
r = await run(signAccessToken("u-suspenso"));
check(r.error?.status === 403 && r.error?.code === "TENANT_SUSPENDED", "usuario de agencia suspensa recebe 403 TENANT_SUSPENDED");
check(r.req.userId === undefined, "agencia suspensa nao recebe req.userId");

// 3) cache: segunda chamada nao consulta; depois do TTL consulta e enxerga a reativacao
clearSuspensionCache();
statusQueries = 0;
const t0 = 1_000_000;
check((await isTenantSuspended("u-suspenso", t0)) === true, "primeira consulta le o banco");
await isTenantSuspended("u-suspenso", t0 + 5_000);
check(statusQueries === 1, "dentro do TTL (15 s) nao consulta de novo", `consultas: ${statusQueries}`);
status.set("u-suspenso", "active");
check((await isTenantSuspended("u-suspenso", t0 + 5_000)) === true, "dentro do TTL ainda vale o valor em cache");
check((await isTenantSuspended("u-suspenso", t0 + 16_000)) === false, "depois do TTL enxerga a reativacao");
status.set("u-suspenso", "suspended");

// 4) falha fechada: erro do banco vira erro (nao libera)
clearSuspensionCache();
failDb = true;
r = await run(signAccessToken("u-ativo"));
check(!!r.error && r.req.userId === undefined, "erro do banco NAO libera a requisicao (falha fechada)");
failDb = false;

// 5) sem perfil = ativo (conta ainda sem profile nao e bloqueada por este controle)
clearSuspensionCache();
r = await run(signAccessToken("u-sem-perfil"));
check(!r.error && r.req.userId === "u-sem-perfil", "usuario sem perfil/tenant nao e tratado como suspenso");

// 6) token invalido / ausente: 401 e nenhuma consulta ao banco
clearSuspensionCache();
statusQueries = 0;
r = await run("token-invalido");
check(r.error?.status === 401, "token invalido continua 401");
r = await run(null);
check(r.error?.status === 401, "sem token continua 401");
check(statusQueries === 0, "token invalido/ausente nao consulta o banco", `consultas: ${statusQueries}`);

console.log(`\n${PASS} ok, ${FAIL} falha(s)`);
process.exit(FAIL ? 1 : 0);
