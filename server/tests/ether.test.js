// Teste do cliente Ether contra um mock de `fetch` — sem framework, no mesmo
// espírito de db/tests e server/tests/e2e.sh (script simples, sem dependência
// nova). Nunca chama a Ether real: cobre exatamente a lacuna apontada no
// diagnóstico de 2026-08-20 ("retry/backoff sem teste algum").
//
// Uso: node server/tests/ether.test.js

process.env.ETHER_CLIENT_ID = "test-client";
process.env.ETHER_CLIENT_SECRET = "test-secret";
process.env.ETHER_BASE_URL = "https://ether.invalid";
process.env.JWT_SECRET = "test-jwt-secret-not-real-0123456789";
process.env.PGUSER = "test";
process.env.PGPASSWORD = "test";

let PASS = 0;
let FAIL = 0;
function ok(label) {
  console.log(`  OK   ${label}`);
  PASS++;
}
function bad(label, detail) {
  console.log(`  FALHA ${label}${detail ? " — " + detail : ""}`);
  FAIL++;
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function withMockFetch(responses, run) {
  const calls = [];
  const originalFetch = globalThis.fetch;
  let i = 0;
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    const next = responses[Math.min(i, responses.length - 1)];
    i++;
    if (typeof next === "function") return next(url, options);
    return next;
  };
  try {
    return { result: await run(), calls };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testRetryOnTokenExpired() {
  // 1ª chamada: autentica OK. 2ª: a chamada de negócio volta 401 (token
  // revogado antes da hora). 3ª: reautentica. 4ª: chamada de negócio OK.
  const ether = await import("../src/ether.js?retry=" + Date.now());
  const { result, calls } = await withMockFetch(
    [
      jsonResponse(201, { access_token: "tok-1", expires_in: 3600 }),
      jsonResponse(401, { error: "AUTH_KEY_001" }),
      jsonResponse(201, { access_token: "tok-2", expires_in: 3600 }),
      jsonResponse(200, { pixId: "abc", status: "CONFIRMED", amount: 500, feeAmount: 1 }),
    ],
    () => ether.withdrawPixToKey(500, "EMAIL", "a@b.com", "teste"),
  );

  if (result?.pixId === "abc") ok("retry após 401 reautentica e conclui a chamada");
  else bad("retry após 401", `resultado inesperado: ${JSON.stringify(result)}`);

  if (calls.length === 4) ok("exatamente 1 retry (não entra em loop)");
  else bad("contagem de chamadas", `esperava 4, veio ${calls.length}`);

  const authCalls = calls.filter((c) => c.url.endsWith("/auth/authenticate"));
  if (authCalls.length === 2) ok("reautentica com token novo, não reusa o expirado");
  else bad("reautenticação", `esperava 2 chamadas de auth, veio ${authCalls.length}`);
}

async function testNoInfiniteRetryOnPersistent401() {
  const ether = await import("../src/ether.js?persistent401=" + Date.now());
  const { result, calls } = await withMockFetch(
    [
      jsonResponse(201, { access_token: "tok-1", expires_in: 3600 }),
      jsonResponse(401, { error: "AUTH_KEY_001" }),
      jsonResponse(201, { access_token: "tok-2", expires_in: 3600 }),
      jsonResponse(401, { error: "AUTH_KEY_001" }),
    ],
    () => ether.withdrawPixToKey(500, "EMAIL", "a@b.com", "teste").catch((e) => e),
  );

  if (result instanceof ether.EtherError && result.status === 401) {
    ok("401 persistente propaga EtherError em vez de retry infinito");
  } else {
    bad("401 persistente", `esperava EtherError(401), veio ${result}`);
  }
  if (calls.length === 4) ok("para após 1 retry mesmo com 401 repetido");
  else bad("contagem de chamadas (401 persistente)", `esperava 4, veio ${calls.length}`);
}

async function testTimeoutBecomesEtherError() {
  const ether = await import("../src/ether.js?timeout=" + Date.now());
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) =>
    new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        reject(err);
      });
    });

  try {
    await ether.getBoletoStatus("abc").catch((e) => {
      if (e instanceof ether.EtherError && e.status === 504) {
        ok("timeout de rede vira EtherError(504), não trava a requisição");
      } else {
        bad("timeout de rede", `veio ${e}`);
      }
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function main() {
  // Cada teste importa o módulo com uma query string diferente para pegar
  // uma instância nova (cachedToken é estado a nível de módulo).
  await testRetryOnTokenExpired();
  await testNoInfiniteRetryOnPersistent401();
  await testTimeoutBecomesEtherError();

  console.log(`\n${PASS} ok, ${FAIL} falha(s)`);
  process.exit(FAIL > 0 ? 1 : 0);
}

main();
