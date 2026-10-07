// Prova que PII (CPF, nome, nascimento, linha de `profiles`) não vai para LOG nem
// para a RESPOSTA nos pontos de erro do onboarding e no handler genérico.
// Sem Postgres e sem Ether real: `pool.connect` é substituído por um cliente
// falso e o `fetch` é mockado só para o host da Ether.
// Uso: node server/tests/log-privacy.test.js
process.env.ETHER_CLIENT_ID = "test-client";
process.env.ETHER_CLIENT_SECRET = "test-secret";
process.env.ETHER_BASE_URL = "https://ether.invalid";
process.env.JWT_SECRET = "test-jwt-secret-not-real-0123456789";
process.env.PGUSER = "test";
process.env.PGPASSWORD = "test";

import express from "express";

const { pool } = await import("../src/db.js");
const { authRouter } = await import("../src/routes/auth.js");
const { errorHandler, asyncRoute } = await import("../src/middleware.js");
const { signAccessToken } = await import("../src/tokens.js");

const USER = "11111111-1111-1111-1111-111111111111";

// Dados falsos que NUNCA podem aparecer em log/resposta.
const FAKE_CPF = "529.982.247-25";
const FAKE_CPF_DIGITS = "52998224725";
const FAKE_NAME = "Fulana de Tal Silva";
const FAKE_BIRTH = "1987-03-21";
const FAKE_PHONE = "11987654321";
const SECRETS = [FAKE_CPF, FAKE_CPF_DIGITS, FAKE_NAME, FAKE_BIRTH, FAKE_PHONE, "Failing row"];

// --- banco falso -------------------------------------------------------------
pool.connect = async () => ({
  query: async (sql) => {
    const q = String(sql);
    if (/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL)/i.test(q) || q.includes("set_config")) return { rows: [] };
    if (q.includes("select ether_user_id, ether_account_status from public.profiles")) {
      return { rows: [{ ether_user_id: null, ether_account_status: "pending" }] };
    }
    if (q.includes("from auth.users u")) return { rows: [{ email: "t@example.com", full_name: FAKE_NAME }] };
    if (q.includes("update public.profiles")) return { rows: [] };
    throw new Error(`query inesperada no teste: ${q.slice(0, 60)}`);
  },
  release: () => {},
});

// --- Ether falsa: o corpo de erro ecoa os valores rejeitados ------------------
const realFetch = globalThis.fetch;
const etherCalls = [];
let profileDataResponse;
const jsonRes = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const echoBody = (code) => ({
  code,
  message: `taxId ${FAKE_CPF} inválido para ${FAKE_NAME} (nascimento ${FAKE_BIRTH}, telefone ${FAKE_PHONE})`,
});
globalThis.fetch = async (url, options) => {
  const u = String(url);
  if (!u.startsWith("https://ether.invalid")) return realFetch(url, options);
  etherCalls.push({ url: u, options });
  if (u.endsWith("/auth/authenticate")) return jsonRes(201, { access_token: "tok", expires_in: 3600 });
  if (u.endsWith("/users/profile-data")) return profileDataResponse();
  if (u.endsWith("/accept-terms") || u.endsWith("/pep-declaration")) return jsonRes(400, echoBody("USR_VAL_099"));
  return jsonRes(404, {});
};

// --- captura de console -------------------------------------------------------
const logs = [];
for (const m of ["log", "error", "warn"]) {
  console[m] = (...a) => {
    logs.push(JSON.stringify(a, (_k, v) => (v instanceof Error ? { n: v.name, m: v.message, d: v.detail } : v)));
  };
}
const out = (s) => process.stdout.write(s + "\n");

const app = express();
app.use(express.json());
app.use("/auth", authRouter);
// Rota que simula violação de constraint do Postgres vinda de uma query real.
app.get("/boom", asyncRoute(async () => {
  const err = new Error('insert or update on table "profiles" violates foreign key constraint "profiles_x_fkey"');
  err.code = "23503";
  err.constraint = "profiles_x_fkey";
  err.table = "profiles";
  err.routine = "ri_ReportViolation";
  err.detail = `Failing row contains (${USER}, ${FAKE_NAME}, ${FAKE_CPF_DIGITS}, ${FAKE_PHONE}).`;
  throw err;
}));
app.use(errorHandler);
const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}`;

let FAIL = 0;
const report = [];
function c(label, cond, detail) {
  report.push(`  ${cond ? "OK  " : "FALHA"} ${label}${!cond && detail ? " — " + detail : ""}`);
  if (!cond) FAIL++;
}
const leaks = (text) => SECRETS.filter((s) => text.includes(s));

const pfBody = {
  taxId: FAKE_CPF_DIGITS, personType: "FISICA", phone: FAKE_PHONE, dateBirth: FAKE_BIRTH,
  documentNumber: "1234567", documentIssuingAgency: "SSP/SP", documentIssueDate: "2015-10-20", documentIssueState: "SP",
  nationality: "Brasileiro", maritalStatus: "SOLTEIRO(A)", monthlyIncome: "5000.00", hometown: "São Paulo",
  address: { addressType: "RESIDENCIAL", zipcode: "01001000", street: "Praça da Sé", number: "1", district: "Sé", city: "São Paulo", state: "SP" },
};
const postOnboarding = async (body = pfBody) => {
  const res = await realFetch(`${base}/auth/onboarding`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${signAccessToken(USER)}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text, json: text ? JSON.parse(text) : null };
};

// 1) Ether recusa o cadastro: corpo de erro ecoa CPF/nome/nascimento.
profileDataResponse = () => jsonRes(400, echoBody("USR_VAL_004"));
logs.length = 0;
let r = await postOnboarding();
let logText = logs.join("\n");
c("cadastro recusado: resposta 502 genérica", r.status === 502, JSON.stringify(r));
c("cadastro recusado: resposta não contém PII", leaks(r.text).length === 0, leaks(r.text).join(","));
c("cadastro recusado: log não contém PII", leaks(logText).length === 0, leaks(logText).join(","));
c("cadastro recusado: log mantém userId, status e código da Ether",
  logText.includes(USER) && logText.includes("USR_VAL_004") && logText.includes("400"), logText);
const sent = etherCalls.find((x) => x.url.endsWith("/users/profile-data"));
c("payload à Ether leva city normalizada (São Paulo + SP -> br-sp-sao-paulo)",
  JSON.parse(sent.options.body).address.city === "br-sp-sao-paulo");

// 2) Cadastro criado, mas accept-terms e pep-declaration recusados (corpo ecoa PII).
profileDataResponse = () => jsonRes(201, { userId: "ether-user-1", status: "pending_documents" });
logs.length = 0;
r = await postOnboarding();
logText = logs.join("\n");
c("accept-terms/pep recusados: cadastro segue 201", r.status === 201 && r.json.ether_user_id === "ether-user-1", JSON.stringify(r));
c("accept-terms/pep recusados: resposta sem PII", leaks(r.text).length === 0, leaks(r.text).join(","));
c("accept-terms/pep recusados: log sem PII", leaks(logText).length === 0, leaks(logText).join(","));
c("accept-terms/pep recusados: log registra as duas etapas com código",
  logText.includes("accept-terms") && logText.includes("pep-declaration") && logText.includes("USR_VAL_099"), logText);

// 3) Campo `code` com texto livre (contendo PII) não pode ser logado.
profileDataResponse = () => jsonRes(400, { code: `código livre com ${FAKE_CPF}`, error: FAKE_NAME });
logs.length = 0;
r = await postOnboarding();
logText = logs.join("\n");
c("código fora do formato não é logado (pode ser texto livre)", leaks(logText).length === 0 && leaks(r.text).length === 0, logText);

// 4) Handler genérico: violação de constraint do Postgres.
logs.length = 0;
const boom = await realFetch(`${base}/boom`);
const boomText = await boom.text();
logText = logs.join("\n");
c("handler genérico: 500 sem detalhe", boom.status === 500 && !boomText.includes("Failing") && leaks(boomText).length === 0, boomText);
c("handler genérico: log não contém linha da constraint nem PII", leaks(logText).length === 0, logText);
c("handler genérico: log mantém code/constraint/table/routine",
  ["23503", "profiles_x_fkey", "profiles", "ri_ReportViolation"].every((f) => logText.includes(f)), logText);

// 5) Cidade que não vira slug confiável é recusada antes de chamar a Ether.
for (const city of ["!!!", "br-rs-porto-alegre"]) { // 2o: slug de outra UF (state=SP)
  etherCalls.length = 0;
  const res = await postOnboarding({ ...pfBody, address: { ...pfBody.address, city } });
  c(`cidade "${city}" -> 400 e nenhuma chamada à Ether`, res.status === 400 && etherCalls.length === 0, String(res.status));
}

server.close();
out(report.join("\n"));
out(FAIL === 0 ? "\nTodos os testes passaram." : `\n${FAIL} falha(s).`);
process.exit(FAIL === 0 ? 0 : 1);
