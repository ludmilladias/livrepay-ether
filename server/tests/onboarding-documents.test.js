// Teste da rota de upload de documento de KYC (POST /auth/onboarding/documents/:type).
// Sem Postgres e sem Ether real: banco injetado, `fetch` mockado só para o host
// da Ether (chamadas a 127.0.0.1 passam para o fetch real).
// Uso: node server/tests/onboarding-documents.test.js
process.env.ETHER_CLIENT_ID = "test-client";
process.env.ETHER_CLIENT_SECRET = "test-secret";
process.env.ETHER_BASE_URL = "https://ether.invalid";
process.env.JWT_SECRET = "test-jwt-secret-not-real-0123456789";
process.env.PGUSER = "test";
process.env.PGPASSWORD = "test";

import express from "express";

const { createDocumentUploadRouter, sniffMime } = await import("../src/routes/onboarding-documents.js");
const { errorHandler } = await import("../src/middleware.js");
const { signAccessToken } = await import("../src/tokens.js");
const ether = await import("../src/ether.js");

let FAIL = 0;

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("conteudo-secreto-do-documento")]);
const PDF = Buffer.from("%PDF-1.4 conteudo-secreto");
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("conteudo-secreto")]);

// Perfis por usuário (substitui o banco).
const USER_OK = "11111111-1111-1111-1111-111111111111";
const USER_NO_ETHER = "22222222-2222-2222-2222-222222222222";
const USER_REJECTED = "33333333-3333-3333-3333-333333333333";
const profiles = {
  [USER_OK]: { ether_user_id: "ether-own", ether_account_status: "pending", ether_pix_key: null, ether_pix_key_type: null },
  [USER_NO_ETHER]: { ether_user_id: null, ether_account_status: "pending" },
  [USER_REJECTED]: { ether_user_id: "ether-rej", ether_account_status: "rejected" },
};
const synced = [];

const app = express();
app.use("/docs", createDocumentUploadRouter({
  loadProfile: async (id) => profiles[id] ?? null,
  syncLocalStatus: async (...a) => { synced.push(a); },
  ether,
}));
app.use(errorHandler);
const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}/docs`;

// Mock da Ether; captura logs para provar que nada sensível vaza.
const realFetch = globalThis.fetch;
let etherCalls;
let etherUploadResponse;
function jsonRes(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
globalThis.fetch = async (url, options) => {
  const u = String(url);
  if (!u.startsWith("https://ether.invalid")) return realFetch(url, options);
  etherCalls.push({ url: u, options });
  if (u.endsWith("/auth/authenticate")) return jsonRes(201, { access_token: "tok", expires_in: 3600 });
  if (u.endsWith("/users/document/upload")) return etherUploadResponse();
  if (u.endsWith("/check-account")) {
    return jsonRes(200, { status: "pending_analysis", documentChecklist: { pending: ["SELFIE_COM_DOC"], sent: ["CARTEIRA_IDENTIDADE"] } });
  }
  return jsonRes(404, {});
};
const logs = [];
for (const m of ["log", "error", "warn"]) {
  const orig = console[m];
  console[m] = (...a) => {
    logs.push(JSON.stringify(a, (_k, v) => (v instanceof Error ? String(v) : v)));
    if (process.env.VERBOSE) orig(...a);
  };
}
// Restaura o console para imprimir o resultado do teste.
const out = (s) => process.stdout.write(s + "\n");

function reset() {
  etherCalls = [];
  etherUploadResponse = () => jsonRes(201, { ok: true });
  synced.length = 0;
}
const uploadCalls = () => etherCalls.filter((c) => c.url.endsWith("/users/document/upload"));
const tok = (id) => `Bearer ${signAccessToken(id)}`;
async function post(path, { user = USER_OK, body = PNG, type = "image/png", headers = {}, auth = true } = {}) {
  const res = await realFetch(`${base}${path}`, {
    method: "POST",
    headers: { ...(auth ? { Authorization: tok(user) } : {}), ...(type ? { "Content-Type": type } : {}), ...headers },
    body,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}
// console.log está capturado: o relatório vai direto ao stdout no fim.
const report = [];
function c(label, cond, detail) {
  report.push(`  ${cond ? "OK  " : "FALHA"} ${label}${!cond && detail ? " — " + detail : ""}`);
  if (!cond) FAIL++;
}

// --- sniff -----------------------------------------------------------------
c("sniffMime reconhece PNG/JPEG/PDF e rejeita texto",
  sniffMime(PNG) === "image/png" && sniffMime(JPG) === "image/jpeg" && sniffMime(PDF) === "application/pdf" && sniffMime(Buffer.from("MZ exe")) === null);

// --- autenticação / autorização -------------------------------------------
reset();
let r = await post("/SELFIE_COM_DOC", { auth: false });
c("sem JWT -> 401 e nenhuma chamada à Ether", r.status === 401 && etherCalls.length === 0, JSON.stringify(r));

reset();
r = await post("/SELFIE_COM_DOC", { user: USER_NO_ETHER });
c("perfil sem ether_user_id -> 409 ONBOARDING_REQUIRED (não 500), sem chamar a Ether",
  r.status === 409 && r.json.code === "ONBOARDING_REQUIRED" && /cadastro/i.test(r.json.error) && etherCalls.length === 0, JSON.stringify(r));

reset();
r = await post("/SELFIE_COM_DOC", { user: "99999999-9999-9999-9999-999999999999" });
c("usuário sem perfil -> 409 (não 500)", r.status === 409 && r.json.code === "ONBOARDING_REQUIRED", JSON.stringify(r));

reset();
r = await post("/SELFIE_COM_DOC", { user: USER_REJECTED });
c("conta rejeitada -> 409 ACCOUNT_NOT_PENDING, sem chamar a Ether", r.status === 409 && r.json.code === "ACCOUNT_NOT_PENDING" && etherCalls.length === 0, JSON.stringify(r));

// Tentativa de enviar em nome de outro: id em header e query não influenciam.
reset();
r = await post("/SELFIE_COM_DOC?userId=ether-victim&etherUserId=ether-victim", {
  headers: { "X-User-Id": "ether-victim", "X-Ether-User-Id": "ether-victim" },
});
const up = uploadCalls()[0];
const sentUserId = up?.options?.body instanceof FormData ? up.options.body.get("userId") : undefined;
c("id de outro em query/header é ignorado: Ether recebe o ether_user_id do JWT", r.status === 201 && sentUserId === "ether-own", `${r.status} ${sentUserId}`);
c("userId do outro nunca aparece em nenhuma chamada à Ether",
  !etherCalls.some((x) => x.url.includes("ether-victim") || (x.options?.body instanceof FormData && [...x.options.body.values()].includes("ether-victim"))));

// Path com id no lugar do tipo não passa no vocabulário.
reset();
r = await post("/ether-victim");
c("segmento de path que não é tipo de documento -> 400", r.status === 400 && etherCalls.length === 0, JSON.stringify(r));

// --- validação antes de gastar chamada ------------------------------------
reset();
r = await post("/FOTO_DO_GATO");
c("tipo fora do vocabulário -> 400, sem chamar a Ether", r.status === 400 && etherCalls.length === 0, JSON.stringify(r));
r = await post("/CARTEIRA_TRABALHO");
c("vocabulário de document.type (CARTEIRA_TRABALHO) NÃO vale no upload -> 400", r.status === 400 && etherCalls.length === 0);

reset();
r = await post("/SELFIE_COM_DOC", { body: Buffer.from("texto"), type: "text/plain" });
c("MIME fora de PDF/JPEG/PNG -> 415, sem chamar a Ether", r.status === 415 && etherCalls.length === 0, JSON.stringify(r));
r = await post("/SELFIE_COM_DOC", { body: JSON.stringify({ a: 1 }), type: "application/json" });
c("JSON no corpo -> 415", r.status === 415 && etherCalls.length === 0, JSON.stringify(r));
r = await post("/SELFIE_COM_DOC", { body: "x", type: null });
c("sem Content-Type útil -> 415", r.status === 415 && etherCalls.length === 0, JSON.stringify(r));
r = await post("/SELFIE_COM_DOC", { body: Buffer.from("MZ executavel disfarcado"), type: "image/png" });
c("MIME declarado png mas conteúdo não é imagem (magic bytes) -> 415", r.status === 415 && etherCalls.length === 0, JSON.stringify(r));
r = await post("/SELFIE_COM_DOC", { body: PDF, type: "image/png" });
c("MIME declarado diverge do conteúdo real -> 415", r.status === 415 && etherCalls.length === 0, JSON.stringify(r));
r = await post("/SELFIE_COM_DOC", { body: Buffer.alloc(0), type: "image/png" });
c("arquivo vazio -> rejeitado, sem chamar a Ether", [400, 415].includes(r.status) && etherCalls.length === 0, JSON.stringify(r));

reset();
const exactly5mb = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024 - PNG.length)]);
r = await post("/SELFIE_COM_DOC", { body: exactly5mb });
c("exatamente 5MB é aceito", r.status === 201, JSON.stringify(r));
reset();
r = await post("/SELFIE_COM_DOC", { body: Buffer.concat([exactly5mb, Buffer.from([0])]) });
c("5MB + 1 byte -> 413 FILE_TOO_LARGE (não 500), sem chamar a Ether", r.status === 413 && r.json.code === "FILE_TOO_LARGE" && etherCalls.length === 0, JSON.stringify(r));

// --- caminho feliz ---------------------------------------------------------
for (const [type, body, mime, ext] of [
  ["CARTEIRA_IDENTIDADE", JPG, "image/jpeg", "jpg"],
  ["COMPROVANTE_RESIDENCIA", PDF, "application/pdf", "pdf"],
  ["SELFIE_COM_DOC", PNG, "image/png", "png"],
  ["CARTAO_CNPJ", PDF, "application/pdf", "pdf"],
  ["CONTRATO_SOCIAL", PDF, "application/pdf", "pdf"],
]) {
  reset();
  r = await post(`/${type}`, { body, type: `${mime}; charset=binary` });
  const form = uploadCalls()[0]?.options?.body;
  const file = form instanceof FormData ? form.get("file") : null;
  c(`${type}: 201, multipart à Ether com userId do perfil, type e arquivo íntegro`,
    r.status === 201 && form instanceof FormData && form.get("userId") === "ether-own" && form.get("type") === type &&
    file && file.type === mime && Buffer.from(await file.arrayBuffer()).equals(body), JSON.stringify(r));
  c(`${type}: nome do arquivo é gerado (${type.toLowerCase()}.${ext}), não vem do cliente`, file?.name === `${type.toLowerCase()}.${ext}`, file?.name);
}

reset();
r = await post("/SELFIE_COM_DOC");
c("resposta: formato do /onboarding/status + uploaded_type + checklist da Ether",
  r.status === 201 && r.json.uploaded_type === "SELFIE_COM_DOC" && r.json.ether_user_id === "ether-own" &&
  r.json.status === "pending_analysis" && r.json.checklist?.pending?.[0] === "SELFIE_COM_DOC" && "pix_key" in r.json, JSON.stringify(r));
c("status local sincronizado via syncLocalStatus (userId do JWT, status Ether, status local anterior)",
  synced.length === 1 && synced[0][0] === USER_OK && synced[0][1] === "pending_analysis" && synced[0][2] === "pending");

// --- falhas da Ether -------------------------------------------------------
reset();
const leak = "Fulano de Tal CPF 123.456.789-00 selfie.png";
etherUploadResponse = () => jsonRes(422, { code: "DOC_VAL_001", message: leak });
logs.length = 0;
r = await post("/SELFIE_COM_DOC");
c("Ether recusa o documento -> 422 DOCUMENT_REJECTED, mensagem genérica", r.status === 422 && r.json.code === "DOCUMENT_REJECTED" && !JSON.stringify(r.json).includes("Fulano"), JSON.stringify(r));
c("corpo de erro da Ether NÃO vai para log (só status/código)", !logs.join("\n").includes("Fulano") && !logs.join("\n").includes("123.456") && logs.join("\n").includes("DOC_VAL_001"));

reset();
etherUploadResponse = () => new Response("<html>WAF</html>", { status: 403, headers: { "Content-Type": "text/html" } });
logs.length = 0;
r = await post("/SELFIE_COM_DOC");
c("Ether fora/WAF -> 502 PROVIDER_UNAVAILABLE", r.status === 502 && r.json.code === "PROVIDER_UNAVAILABLE", JSON.stringify(r));
c("preview HTML da Ether não vai para log", !logs.join("\n").includes("WAF"));

// --- privacidade nos logs --------------------------------------------------
reset();
logs.length = 0;
await post("/SELFIE_COM_DOC", { headers: { "Content-Disposition": 'attachment; filename="rg-da-maria.png"' } });
const all = logs.join("\n");
c("conteúdo do arquivo e nome do cliente não aparecem em nenhum log, nem token",
  !all.includes("conteudo-secreto") && !all.includes("rg-da-maria") && !all.includes("Bearer"));

server.close();
for (const line of report) out(line);
out(FAIL === 0 ? "\nTodos os testes passaram." : `\n${FAIL} falha(s).`);
process.exit(FAIL === 0 ? 0 : 1);
