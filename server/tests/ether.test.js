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

async function testKycStepsMatchOfficialGuide() {
  // Guia "Abertura de Conta PF": accept-terms sem corpo (a Ether registra
  // IP/User-Agent), pep-declaration com declarationVersion, upload multipart.
  const ether = await import("../src/ether.js?kyc=" + Date.now());
  // Resposta nova a cada chamada (Response só pode ser lida uma vez); o token fica em cache
  // no módulo, então olhamos sempre a ÚLTIMA chamada, que é a do endpoint testado.
  const auth = () => jsonResponse(200, { access_token: "tok", expires_in: 3600 });
  const last = (calls) => calls[calls.length - 1];

  let { calls } = await withMockFetch([auth, auth], () =>
    ether.acceptTerms("u-1", { userAgent: "Mozilla/5.0 (Teste)\u0000\n" }),
  );
  let c = last(calls);
  if (c.url.endsWith("/users/u-1/accept-terms") && c.options.method === "POST") ok("accept-terms: caminho e método");
  else bad("accept-terms: caminho", c.url);
  if (c.options.body === undefined && !("Content-Type" in c.options.headers)) ok("accept-terms: sem corpo e sem Content-Type");
  else bad("accept-terms: corpo", JSON.stringify(c.options));
  if (c.options.headers["User-Agent"] === "Mozilla/5.0 (Teste)") ok("accept-terms: User-Agent repassado e sanitizado");
  else bad("accept-terms: User-Agent", c.options.headers["User-Agent"]);

  ({ calls } = await withMockFetch([auth, auth], () => ether.acceptTerms("u-1")));
  if (last(calls).options.headers["User-Agent"] === "Mozilla/5.0 (compatible; LivrePay-API/1.0; +https://livrepay.digital)") ok("accept-terms: User-Agent padrão (com prefixo Mozilla/5.0) quando ausente");
  else bad("accept-terms: UA padrão", last(calls).options.headers["User-Agent"]);

  ({ calls } = await withMockFetch([auth, auth], () => ether.submitPepDeclaration("u-1")));
  if (last(calls).options.body === JSON.stringify({ declarationVersion: "v1.0" })) ok("pep-declaration: corpo declarationVersion v1.0");
  else bad("pep-declaration: corpo", last(calls).options.body);

  ({ calls } = await withMockFetch([auth, auth], () =>
    ether.uploadDocument("u-1", "SELFIE_COM_DOC", Buffer.from("x"), { filename: "a.png", mimeType: "image/png" }),
  ));
  const form = last(calls).options.body;
  if (last(calls).url.endsWith("/users/document/upload") && form instanceof FormData
      && form.get("userId") === "u-1" && form.get("type") === "SELFIE_COM_DOC" && form.get("file")) {
    ok("upload: multipart com userId, type e file");
  } else bad("upload: multipart", last(calls).url);
  if (!("Content-Type" in last(calls).options.headers)) ok("upload: Content-Type deixado ao fetch (boundary)");
  else bad("upload: Content-Type manual", "quebraria o boundary");

  const tooBig = await ether.uploadDocument("u-1", "SELFIE_COM_DOC", Buffer.alloc(5 * 1024 * 1024 + 1), { mimeType: "image/png" }).catch((e) => e);
  const badMime = await ether.uploadDocument("u-1", "SELFIE_COM_DOC", Buffer.from("x"), { mimeType: "text/plain" }).catch((e) => e);
  if (tooBig instanceof Error && /5MB/.test(tooBig.message)) ok("upload: rejeita >5MB antes de chamar a Ether");
  else bad("upload: tamanho", String(tooBig?.message));
  if (badMime instanceof Error && /PDF, JPEG ou PNG/.test(badMime.message)) ok("upload: rejeita MIME fora de PDF/JPEG/PNG");
  else bad("upload: MIME", String(badMime?.message));

  // Vocabulário de UPLOAD (distinto de document.type do profile-data): aceita os 5 tipos.
  const types = ["CARTEIRA_IDENTIDADE", "COMPROVANTE_RESIDENCIA", "SELFIE_COM_DOC", "CARTAO_CNPJ", "CONTRATO_SOCIAL"];
  let accepted = 0;
  for (const t of types) {
    const { calls: c } = await withMockFetch([auth, auth], () =>
      ether.uploadDocument("u-1", t, Buffer.from("x"), { filename: "a.pdf", mimeType: "application/pdf" }),
    );
    if (last(c).options.body.get("type") === t) accepted++;
  }
  if (accepted === types.length) ok("upload: aceita os 5 tipos (3 de PJ + CARTEIRA_IDENTIDADE e SELFIE_COM_DOC de PF)");
  else bad("upload: tipos aceitos", `${accepted}/${types.length}`);
  const badType = await ether.uploadDocument("u-1", "FOTO_DO_GATO", Buffer.from("x"), { mimeType: "image/png" }).catch((e) => e);
  if (badType instanceof Error && /Tipo de documento/.test(badType.message)) ok("upload: rejeita tipo de documento desconhecido");
  else bad("upload: tipo desconhecido", String(badType?.message));
}

const WAF_UA = "Mozilla/5.0 (compatible; LivrePay-API/1.0; +https://livrepay.digital)";
const tokenOk = () => jsonResponse(201, { access_token: "tok", expires_in: 3600 });

async function testUserAgentOnEveryRequest() {
  // Regressão (2026-10-02, teste real): o WAF da Ether bloqueia o UA padrão do
  // fetch do Node com uma página HTML. Toda requisição precisa de UA com prefixo
  // "Mozilla/5.0" — inclusive o /auth/authenticate.
  const ether = await import("../src/ether.js?ua=" + Date.now());
  const { calls } = await withMockFetch([tokenOk, () => jsonResponse(200, { ok: true })], () => ether.getBoletoStatus("abc"));
  const authCall = calls.find((c) => c.url.endsWith("/auth/authenticate"));
  const bizCall = calls.find((c) => c.url.endsWith("/boletos/abc"));
  if (authCall?.options.headers["User-Agent"] === WAF_UA) ok("User-Agent presente em /auth/authenticate (participant)");
  else bad("UA em /auth/authenticate", String(authCall?.options.headers["User-Agent"]));
  if (bizCall?.options.headers["User-Agent"] === WAF_UA) ok("User-Agent presente em chamada autenticada (call)");
  else bad("UA em call()", String(bizCall?.options.headers["User-Agent"]));

  const sub = await withMockFetch([tokenOk], () => ether.authenticateSubAccount("a@b.com", "x"));
  if (sub.calls[0].options.headers["User-Agent"] === WAF_UA) ok("User-Agent presente em authenticateSubAccount");
  else bad("UA em authenticateSubAccount", String(sub.calls[0].options.headers["User-Agent"]));

  // UA do cliente sem prefixo Mozilla/5.0 (curl, app nativo) cairia no WAF: usa o padrão.
  const terms = await withMockFetch([tokenOk, () => jsonResponse(200, {})], () => ether.acceptTerms("u-1", { userAgent: "curl/8.0" }));
  if (terms.calls[terms.calls.length - 1].options.headers["User-Agent"] === WAF_UA) ok("accept-terms: UA de cliente sem Mozilla/5.0 cai no padrão (evita WAF)");
  else bad("accept-terms: UA sem prefixo", "repassou UA que o WAF bloqueia");
}

async function testNonJsonResponses() {
  const html = (status) => () =>
    new Response("<html><body>Request blocked</body></html>", { status, headers: { "Content-Type": "text/html" } });

  // (b) HTML com 403 numa chamada autenticada: EtherError com status preservado, não SyntaxError.
  let ether = await import("../src/ether.js?html403=" + Date.now());
  let { result } = await withMockFetch([tokenOk, html(403)], () => ether.getBoletoStatus("abc").catch((e) => e));
  if (result instanceof ether.EtherError && result.status === 403) ok("HTML 403 vira EtherError(403), status preservado");
  else bad("HTML 403", `veio ${result?.name}: ${result?.message}`);
  if (result?.body?.error === "RespostaNaoJSON" && /text\/html/.test(result.body.contentType ?? "") && /Request blocked/.test(result.body.preview ?? "")) {
    ok("EtherError traz RespostaNaoJSON com contentType e preview");
  } else bad("corpo do erro não-JSON", JSON.stringify(result?.body));

  // preview limitado (não despeja página inteira em log)
  ether = await import("../src/ether.js?bigpreview=" + Date.now());
  ({ result } = await withMockFetch(
    [tokenOk, () => new Response("x".repeat(5000), { status: 502, headers: { "Content-Type": "text/html" } })],
    () => ether.getBoletoStatus("abc").catch((e) => e),
  ));
  if (result?.status === 502 && result.body.preview.length <= 200) ok("preview do corpo não-JSON limitado a 200 caracteres");
  else bad("preview", `status ${result?.status}, tamanho ${result?.body?.preview?.length}`);

  // HTML no próprio /auth/authenticate: o status também chega ao chamador.
  ether = await import("../src/ether.js?html403auth=" + Date.now());
  ({ result } = await withMockFetch([html(403)], () => ether.getBoletoStatus("abc").catch((e) => e)));
  if (result instanceof ether.EtherError && result.status === 403) ok("HTML 403 no /auth/authenticate também vira EtherError(403)");
  else bad("HTML 403 no auth", `veio ${result?.name}: ${result?.message}`);

  // (c) resposta vazia segue funcionando (204 e 200 sem corpo) e JSON normal também.
  ether = await import("../src/ether.js?empty=" + Date.now());
  ({ result } = await withMockFetch([tokenOk, () => new Response(null, { status: 204 })], () => ether.getBoletoStatus("abc")));
  if (result === undefined) ok("resposta 204 vazia retorna undefined (sem erro)");
  else bad("resposta vazia 204", JSON.stringify(result));
  ({ result } = await withMockFetch([() => new Response("", { status: 200 })], () => ether.getBoletoStatus("abc")));
  if (result === undefined) ok("resposta 200 com corpo vazio retorna undefined");
  else bad("resposta vazia 200", JSON.stringify(result));
  ({ result } = await withMockFetch([() => jsonResponse(200, { a: 1 })], () => ether.getBoletoStatus("abc")));
  if (result?.a === 1) ok("resposta JSON normal continua funcionando");
  else bad("JSON normal", JSON.stringify(result));

  // HTML com status 200 (gateway devolvendo página): também erro explícito, não SyntaxError.
  ({ result } = await withMockFetch(
    [() => new Response("<html>ok?</html>", { status: 200, headers: { "Content-Type": "text/html" } })],
    () => ether.getBoletoStatus("abc").catch((e) => e),
  ));
  if (result instanceof ether.EtherError && result.body?.error === "RespostaNaoJSON") ok("HTML com status 200 vira EtherError(RespostaNaoJSON)");
  else bad("HTML 200", `veio ${result?.name}`);
}

async function main() {
  // Cada teste importa o módulo com uma query string diferente para pegar
  // uma instância nova (cachedToken é estado a nível de módulo).
  await testRetryOnTokenExpired();
  await testNoInfiniteRetryOnPersistent401();
  await testTimeoutBecomesEtherError();
  await testKycStepsMatchOfficialGuide();
  await testUserAgentOnEveryRequest();
  await testNonJsonResponses();

  console.log(`\n${PASS} ok, ${FAIL} falha(s)`);
  process.exit(FAIL > 0 ? 1 : 0);
}

main();
