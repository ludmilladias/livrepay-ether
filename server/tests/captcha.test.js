// Teste do reCAPTCHA com mais de um secret (LivrePay + VARKI), contra um mock de
// `fetch` — nunca chama o Google real.
//
// Uso: node server/tests/captcha.test.js

process.env.RECAPTCHA_SECRET = "secret-livrepay";
process.env.RECAPTCHA_SECRET_VARKI = "secret-varki";
process.env.JWT_SECRET = "test-jwt-secret-not-real-0123456789";
process.env.PGUSER = "test";
process.env.PGPASSWORD = "test";

let PASS = 0;
let FAIL = 0;
const ok = (label) => (console.log(`  OK   ${label}`), PASS++);
const bad = (label, detail) => (console.log(`  FALHA ${label}${detail ? " — " + detail : ""}`), FAIL++);
const check = (cond, label, detail) => (cond ? ok(label) : bad(label, detail));

const realFetch = globalThis.fetch;
let calls = [];
function mockGoogle(validSecrets) {
  calls = [];
  globalThis.fetch = async (_url, init) => {
    const secret = new URLSearchParams(init.body).get("secret");
    calls.push(secret);
    return { ok: true, json: async () => ({ success: validSecrets.includes(secret) }) };
  };
}

const { verifyRecaptcha, requireCaptcha } = await import("../src/captcha.js");
const { config } = await import("../src/config.js");

check(config.recaptcha.secrets.length === 2, "config junta RECAPTCHA_SECRET e RECAPTCHA_SECRET_VARKI");

mockGoogle(["secret-livrepay"]);
check((await verifyRecaptcha("token-livrepay-0123", "1.1.1.1")) === true, "token da chave do LivrePay é aceito");
check(calls.length === 1, "aceito no primeiro secret sem consulta extra", `chamadas: ${calls.length}`);

mockGoogle(["secret-varki"]);
check((await verifyRecaptcha("token-varki-012345", "1.1.1.1")) === true, "token da chave da VARKI é aceito");
check(calls.join(",") === "secret-livrepay,secret-varki", "tenta o secret seguinte quando o primeiro recusa");

mockGoogle([]);
check((await verifyRecaptcha("token-invalido-123", "1.1.1.1")) === false, "token inválido continua recusado");

mockGoogle(["secret-livrepay"]);
const semToken = await new Promise((resolve) => requireCaptcha({ body: {}, ip: "1.1.1.1" }, {}, resolve));
check(semToken?.code === "CAPTCHA_REQUIRED", "sem captchaToken: CAPTCHA_REQUIRED (nada foi relaxado)");

globalThis.fetch = async () => {
  throw new Error("rede");
};
const indisponivel = await new Promise((resolve) =>
  requireCaptcha({ body: { captchaToken: "token-qualquer-123" }, ip: "1.1.1.1" }, {}, resolve),
);
check(indisponivel?.code === "CAPTCHA_UNAVAILABLE", "Google fora do ar: falha fechada (503)");

globalThis.fetch = realFetch;
console.log(`\n${PASS} ok, ${FAIL} falha(s)`);
process.exit(FAIL ? 1 : 0);
