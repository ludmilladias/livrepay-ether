// Teste offline do cofre de credenciais da Ether por cliente (sem Postgres, sem Ether).
// Banco falso em pool.connect; fetch interceptado só para /auth/authenticate.
// Uso: node server/tests/ether-credentials.test.js
import crypto from "node:crypto";

process.env.ETHER_CLIENT_ID = "tenant-client-id";
process.env.ETHER_CLIENT_SECRET = "tenant-secret-nao-usar";
process.env.ETHER_BASE_URL = "https://ether.invalid";
process.env.JWT_SECRET = "test-jwt-secret-not-real-0123456789";
process.env.PGUSER = "test";
process.env.PGPASSWORD = "test";
process.env.ETHER_CREDENTIALS_KEY = crypto.randomBytes(32).toString("base64");
process.env.ETHER_HOUSE_USER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const { pool } = await import("../src/db.js");
const { config } = await import("../src/config.js");
const vault = await import("../src/etherCredentials.js");

let FAIL = 0;
const check = (label, cond, detail) => {
  process.stdout.write(`  ${cond ? "OK  " : "FALHA"} ${label}${!cond && detail ? " — " + detail : ""}\n`);
  if (!cond) FAIL++;
};
const throws = (fn) => { try { fn(); return false; } catch { return true; } };
const rejects = async (p, Cls) => { try { await p; return false; } catch (e) { return Cls ? e instanceof Cls : true; } };

const logs = [];
for (const m of ["log", "error", "warn"]) console[m] = (...a) => logs.push(JSON.stringify(a));

// --- banco falso: vault.ether_credentials em memória -------------------------
let rows = [];
let nextId = 1;
// profiles.ether_user_id por usuário (vínculo com a conta na Ether).
const ETHER_CASA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const linked = {};
const admins = new Set(); // usuários com papel admin em user_roles
pool.connect = async () => ({
  query: async (sql, params = []) => {
    const q = String(sql).replace(/\s+/g, " ");
    if (/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL)/i.test(q.trim())) return { rows: [] };
    if (q.includes("set status = 'revoked'")) {
      for (const r of rows) if (r.user_id === params[0] && r.status !== "revoked") { r.status = "revoked"; r.revoked_at = new Date(); }
      return { rows: [] };
    }
    if (q.includes("set status = 'suspect'")) {
      for (const r of rows) if (r.user_id === params[0] && r.status === "active") r.status = "suspect";
      return { rows: [] };
    }
    if (q.includes("insert into vault.ether_credentials")) {
      const [user_id, ether_user_id, client_id, secret_ciphertext, secret_iv, secret_tag, key_version, created_by] = params;
      const r = { id: `cred-${nextId++}`, user_id, ether_user_id, client_id, secret_ciphertext, secret_iv, secret_tag, key_version, created_by, status: "active", created_at: new Date() };
      rows.push(r);
      const { secret_ciphertext: _c, secret_iv: _i, secret_tag: _t, ...meta } = r;
      return { rows: [meta] };
    }
    if (q.includes("from vault.ether_credentials") && q.includes("status = 'active'")) {
      return { rows: rows.filter((r) => r.user_id === params[0] && r.status === "active") };
    }
    if (q.includes("as is_admin") && q.includes("from public.profiles p")) {
      const u = params[0];
      return { rows: u in linked ? [{ ether_user_id: linked[u], is_admin: admins.has(u) }] : [] };
    }
    throw new Error(`query inesperada: ${q.slice(0, 80)}`);
  },
  release: () => {},
});

// --- fetch falso para /auth/authenticate ---------------------------------------
const authCalls = [];
let authMode = "ok";
let detailsDown = false;
globalThis.fetch = async (url, options) => {
  if (String(url).endsWith("/auth/authenticate")) {
    const body = JSON.parse(options.body);
    authCalls.push(body.clientId);
    if (authMode === "reject") return new Response(JSON.stringify({ message: "AUTH_KEY_001" }), { status: 401 });
    return new Response(JSON.stringify({ access_token: `tok-${body.clientId}-${authCalls.length}`, expires_in: 3600, token_type: "Bearer" }), { status: 200 });
  }
  // Com o token do tenant, a Ether responde a conta da casa.
  if (String(url).endsWith("/users/bank-account/details")) {
    if (detailsDown) return new Response("{}", { status: 500 });
    return new Response(JSON.stringify({ user: { id: ETHER_CASA, userProfiles: [{ taxId: "12345678000190" }] } }), { status: 200 });
  }
  throw new Error(`fetch inesperado: ${url}`);
};

const ANA = { userId: "u-ana", etherUserId: "ether-ana", clientId: "client-ana" };
const BIA = { userId: "u-bia", etherUserId: "ether-bia", clientId: "client-bia" };
const SECRET_ANA = "segredo-da-ana-123";
const SECRET_BIA = "segredo-da-bia-456";

// --- cifragem -----------------------------------------------------------------
const enc = vault.encryptSecret(SECRET_ANA, ANA);
check("decifra de volta o segredo", vault.decryptSecret(enc, ANA) === SECRET_ANA);
check("texto cifrado não contém o segredo", !enc.ciphertext.toString("latin1").includes(SECRET_ANA));
const enc2 = vault.encryptSecret(SECRET_ANA, ANA);
check("IV aleatório (mesmo segredo, cifrados diferentes)", !enc.iv.equals(enc2.iv) && !enc.ciphertext.equals(enc2.ciphertext));
const tampered = { ...enc, ciphertext: Buffer.from(enc.ciphertext) };
tampered.ciphertext[0] ^= 1;
check("texto cifrado adulterado é recusado", throws(() => vault.decryptSecret(tampered, ANA)));
check("tag adulterada é recusada", throws(() => vault.decryptSecret({ ...enc, tag: crypto.randomBytes(16) }, ANA)));
check("segredo da Ana não decifra como se fosse da Bia (AAD)", throws(() => vault.decryptSecret(enc, BIA)));
check("versão de chave desconhecida é recusada", throws(() => vault.decryptSecret({ ...enc, keyVersion: 9 }, ANA)));

const keyBackup = config.ether.credentialsKey;
config.ether.credentialsKey = "";
check("sem ETHER_CREDENTIALS_KEY: falha clara", throws(() => vault.encryptSecret("x", ANA)));
config.ether.credentialsKey = Buffer.alloc(16).toString("base64");
check("chave com tamanho errado: falha clara", throws(() => vault.encryptSecret("x", ANA)));
config.ether.credentialsKey = keyBackup;

// --- gravação -------------------------------------------------------------------
const saved = await vault.storeCredential({ ...ANA, clientSecret: SECRET_ANA, actorId: "admin-1" });
check("gravação devolve só metadados (sem segredo nem cifrado)",
  saved.client_id === ANA.clientId && !("secret_ciphertext" in saved) && !JSON.stringify(saved).includes(SECRET_ANA));
check("no banco fica só o texto cifrado", rows.length === 1 && Buffer.isBuffer(rows[0].secret_ciphertext) && !rows[0].secret_ciphertext.toString("latin1").includes(SECRET_ANA));
await vault.storeCredential({ ...BIA, clientSecret: SECRET_BIA, actorId: "admin-1" });

const loaded = await vault.loadActiveCredential(ANA.userId);
check("carrega e decifra a credencial ativa da Ana", loaded.clientSecret === SECRET_ANA && loaded.clientId === ANA.clientId);
check("usuário sem credencial -> CredentialUnavailableError", await rejects(vault.loadActiveCredential("u-sem"), vault.CredentialUnavailableError));

// --- token por cliente ----------------------------------------------------------
vault.clearTokenCacheForTest();
const t1 = await vault.getUserEtherToken(ANA.userId);
const t2 = await vault.getUserEtherToken(ANA.userId);
check("autentica com o clientId da própria Ana, não o do tenant", authCalls[0] === ANA.clientId && !authCalls.includes(config.ether.clientId));
check("token fica em cache (2 chamadas, 1 autenticação)", t1 === t2 && authCalls.length === 1);
const tb = await vault.getUserEtherToken(BIA.userId);
check("Bia recebe token próprio, diferente do da Ana", tb !== t1 && authCalls.at(-1) === BIA.clientId);

// Troca de credencial: a antiga é revogada e o cache é descartado.
await vault.storeCredential({ ...ANA, clientId: "client-ana-2", clientSecret: "segredo-novo-ana", actorId: "admin-1" });
check("só uma credencial não revogada por usuário após a troca",
  rows.filter((r) => r.user_id === ANA.userId && r.status !== "revoked").length === 1);
await vault.getUserEtherToken(ANA.userId);
check("após a troca, autentica de novo com a credencial nova", authCalls.at(-1) === "client-ana-2");

// Ether recusa a credencial: vira suspeita e NÃO cai na conta do tenant.
vault.clearTokenCacheForTest();
authMode = "reject";
const before = authCalls.length;
check("credencial recusada -> CredentialUnavailableError", await rejects(vault.getUserEtherToken(BIA.userId), vault.CredentialUnavailableError));
check("credencial recusada fica 'suspect'", rows.find((r) => r.user_id === BIA.userId).status === "suspect");
authMode = "ok";
check("depois de suspeita, não opera (sem fallback para o tenant)",
  await rejects(vault.getUserEtherToken(BIA.userId), vault.CredentialUnavailableError) && authCalls.length === before + 1);

// --- conta da casa (credencial do tenant) -----------------------------------------
const CASA = "u-casa";
linked[CASA] = ETHER_CASA;
admins.add(CASA);
linked[ANA.userId] = ANA.etherUserId;
vault.clearTokenCacheForTest();
const tCasa = await vault.getUserEtherToken(CASA);
check("operador ligado à conta da casa recebe o token do tenant", tCasa.startsWith(`tok-${config.ether.clientId}-`), tCasa);
const tAna = await vault.getUserEtherToken(ANA.userId);
check("cliente ligado a outra conta continua no próprio token, nunca no do tenant", !tAna.startsWith(`tok-${config.ether.clientId}-`), tAna);
check("usuário sem vínculo nem credencial não opera (sem fallback para o tenant)",
  await rejects(vault.getUserEtherToken("u-sem-nada"), vault.CredentialUnavailableError));
linked["u-intruso"] = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
check("vínculo com outra conta da Ether não abre o token do tenant",
  await rejects(vault.getUserEtherToken("u-intruso"), vault.CredentialUnavailableError));
// Ligado à conta da casa, mas sem papel admin (onboarding comum que caísse no ID
// da casa, ou admin que saiu da empresa): não recebe o token do tenant.
linked["u-sem-papel"] = ETHER_CASA;
check("ligado à conta da casa SEM papel admin não recebe o token do tenant",
  await rejects(vault.getUserEtherToken("u-sem-papel"), vault.CredentialUnavailableError));
admins.delete(CASA);
check("ex-admin perde o token do tenant na hora (papel checado a cada chamada)",
  await rejects(vault.getUserEtherToken(CASA), vault.CredentialUnavailableError));
admins.add(CASA);

const houseBackup = config.ether.houseUserId;
config.ether.houseUserId = "";
check("sem ETHER_HOUSE_USER_ID ninguém recebe o token do tenant",
  await rejects(vault.getUserEtherToken(CASA), vault.CredentialUnavailableError));
config.ether.houseUserId = houseBackup;

// operationToken: conta não habilitada vira 403 com código, nunca token do tenant.
try {
  await vault.operationToken("u-sem-nada");
  check("operationToken sem conta habilitada lança", false);
} catch (error) {
  check("operationToken sem conta habilitada -> 403 ACCOUNT_NOT_ENABLED", error.status === 403 && error.code === "ACCOUNT_NOT_ENABLED");
}
check("operationToken do operador da casa devolve o token do tenant",
  (await vault.operationToken(CASA)).startsWith(`tok-${config.ether.clientId}-`));

// --- logs -----------------------------------------------------------------------
const logText = logs.join("\n");
check("log não contém segredo, token nem chave mestra",
  !logText.includes(SECRET_ANA) && !logText.includes(SECRET_BIA) && !logText.includes("segredo-novo-ana") &&
  !logText.includes("tok-") && !logText.includes(keyBackup));

process.stdout.write(FAIL ? `\n${FAIL} falha(s)\n` : "\nTodos os testes passaram.\n");
process.exit(FAIL ? 1 : 0);
