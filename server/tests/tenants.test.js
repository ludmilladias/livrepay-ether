// Teste da resolução de tenant por origem (server/src/tenants.js) e dos links de
// e-mail por tenant. Sem rede nem banco.
//
// Uso: node server/tests/tenants.test.js

process.env.TENANT_VARKI_ORIGINS = "https://app.varki.test/, https://varki-app.example.app";
process.env.APP_URL = "https://livrepay.test";
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

const { tenantFromOrigin, appUrlForTenant, DEFAULT_TENANT } = await import("../src/tenants.js");
const { config } = await import("../src/config.js");

check(tenantFromOrigin("https://app.varki.test") === "varki", "origem cadastrada da VARKI resolve varki");
check(tenantFromOrigin("https://app.varki.test/") === "varki", "barra final é ignorada");
check(tenantFromOrigin("HTTPS://APP.VARKI.TEST") === "varki", "comparação sem diferenciar maiúsculas");
check(tenantFromOrigin("https://varki-app.example.app") === "varki", "segunda origem da lista (com espaço) resolve varki");
check(tenantFromOrigin("https://livrepay.test") === DEFAULT_TENANT, "app do LivrePay cai no tenant padrão");
check(tenantFromOrigin("https://evil.example") === DEFAULT_TENANT, "origem desconhecida cai no tenant padrão");
check(tenantFromOrigin("https://app.varki.test.evil.example") === DEFAULT_TENANT, "sufixo malicioso nao herda o tenant");
check(tenantFromOrigin("https://x.app.varki.test") === DEFAULT_TENANT, "subdominio nao cadastrado nao herda o tenant");
check(tenantFromOrigin(undefined) === DEFAULT_TENANT, "sem Origin cai no tenant padrão");
check(tenantFromOrigin("") === DEFAULT_TENANT, "Origin vazia cai no tenant padrão");
check(tenantFromOrigin(["https://app.varki.test"]) === DEFAULT_TENANT, "valor nao-string (header repetido) cai no padrão");

check(appUrlForTenant("varki") === "https://app.varki.test", "link de e-mail da VARKI usa o app da VARKI");
check(appUrlForTenant("livrepay") === "https://livrepay.test", "link de e-mail do LivrePay segue APP_URL");
check(appUrlForTenant(undefined) === "https://livrepay.test", "tenant ausente usa APP_URL");

check(
  config.allowedOrigins.includes("https://app.varki.test") && config.allowedOrigins.includes("https://varki-app.example.app"),
  "origens do tenant entram no CORS",
);

console.log(`\n${PASS} ok, ${FAIL} falha(s)`);
process.exit(FAIL ? 1 : 0);
