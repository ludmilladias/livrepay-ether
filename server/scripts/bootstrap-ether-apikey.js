#!/usr/bin/env node
/**
 * Gera as credenciais de INTEGRAÇÃO da Ether (uso único).
 *
 * Contexto: as credenciais que temos hoje (`ETHER_CLIENT_ID`/`SECRET`) são de
 * um App Client do Cognito destinado a login de PESSOAS. Para integração
 * sistema-a-sistema a Ether exige um par próprio, gerado a partir do JWT de um
 * usuário ADMIN do participant. Sem isso, todo endpoint protegido responde
 * `401 AUTH_KEY_001` e as rotas `/participant/*` respondem 404 (o gateway
 * roteia por escopo do token, e o nosso é `.../user`).
 *
 * Fluxo (confirmado pelo suporte em 2026-09-10):
 *   0. Login SRP do admin no Cognito (USER_SRP_AUTH)      -> JWT do admin
 *   1. POST /participant/api-key      (Bearer = JWT do admin)  -> clientId + secretToken
 *   2. POST /auth/api-key/secret      (secretToken, vale 5min) -> clientId + clientSecret
 *   3. POST /auth/api-key             (clientId + clientSecret) -> access_token
 *
 * O clientSecret é exibido UMA ÚNICA VEZ. Este script grava o resultado em
 * `nao-subir-ether-apikey.txt` (fora do git) em vez de imprimir no terminal,
 * para não deixar segredo no histórico do shell.
 *
 * Credenciais do admin (e-mail/senha) são lidas SOMENTE de
 * `nao-subir-ether-admin.env` (raiz do repo, fora do git, modo 600) — nunca
 * aceitas por argumento de CLI, nunca logadas. Formato:
 *   ETHER_ADMIN_EMAIL=...
 *   ETHER_ADMIN_PASSWORD=...
 *
 * Uso (fluxo normal, com SRP — o admin tem TOTP configurado):
 *   node server/scripts/bootstrap-ether-apikey.js
 *   (pede o código TOTP de 6 dígitos no prompt, no momento em que for gerado)
 *
 * Uso com o TOTP já em mãos (evita o prompt, útil para rodar de uma vez):
 *   node server/scripts/bootstrap-ether-apikey.js --totp 123456
 *   (o código expira em ~30s — gere-o e rode o comando na sequência; se o
 *   Cognito rejeitar por código errado/expirado, o script pergunta de novo no
 *   prompt para a única retentativa permitida — não reusa o valor da CLI)
 *
 * Uso alternativo (se já se tem um JWT de admin pronto, ex. copiado do portal):
 *   node server/scripts/bootstrap-ether-apikey.js --jwt-env ETHER_ADMIN_JWT
 *   (a variável precisa estar no ambiente; o script não aceita o JWT como
 *   argumento posicional para não deixá-lo no histórico do shell)
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import "dotenv/config";
import { loginWithSrp, decodeJwtPayload } from "./lib/cognito-srp.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");

const BASE = process.env.ETHER_BASE_URL ?? "https://api.etherglobalassets.com.br";
const OUT = resolve(process.cwd(), "nao-subir-ether-apikey.txt");
const ADMIN_ENV_PATH = resolve(REPO_ROOT, "nao-subir-ether-admin.env");

// O WAF da Ether bloqueia o User-Agent padrão de alguns clientes HTTP.
const UA = "Mozilla/5.0 (LivrePay-Bootstrap/1.0)";

// Cognito do App Client de login de pessoas (mesmo usado por authenticateSubAccount).
const USER_POOL_ID = process.env.ETHER_COGNITO_USER_POOL_ID || "us-east-2_BcbqtNJM3";
const APP_CLIENT_ID = process.env.ETHER_COGNITO_APP_CLIENT_ID || "rscjgeg0vbsjgbgu6fpq8ntc9";

/** Lê um .env simples (KEY=VALUE por linha) sem jogar nada em process.env nem em log. */
function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

function redact() {
  return "«redigido»";
}

/**
 * Devolve uma função getTotpCode para passar a loginWithSrp: usa `--totp
 * 123456` da CLI na primeira chamada (se fornecido), senão pergunta no
 * prompt. Numa eventual segunda tentativa (código rejeitado), o valor da CLI
 * já foi consumido/expirado — sempre pergunta de novo no prompt nesse caso,
 * já que um TOTP tem ~30s de validade e não dá para reusar.
 */
function criarGetTotpCode() {
  const totpFlagIdx = process.argv.indexOf("--totp");
  let cliTotp = totpFlagIdx !== -1 ? process.argv[totpFlagIdx + 1] : undefined;

  return async () => {
    if (cliTotp) {
      const valor = cliTotp;
      cliTotp = undefined; // consumido — não reutilizar numa retentativa
      return valor;
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const resposta = await rl.question("Código TOTP (6 dígitos): ");
      return resposta.trim();
    } finally {
      rl.close();
    }
  };
}

async function obterJwtAdmin() {
  const jwtEnvFlagIdx = process.argv.indexOf("--jwt-env");
  if (jwtEnvFlagIdx !== -1) {
    const varName = process.argv[jwtEnvFlagIdx + 1];
    const jwt = varName && process.env[varName];
    if (!jwt) {
      console.error(`--jwt-env ${varName ?? ""}: variável vazia ou ausente no ambiente.`);
      process.exit(1);
    }
    console.log(`JWT do admin obtido via variável de ambiente ${varName} (fallback, sem SRP).`);
    return jwt;
  }

  if (!existsSync(ADMIN_ENV_PATH)) {
    console.error(`
Não encontrei ${ADMIN_ENV_PATH}.

Crie esse arquivo (fora do git, coberto por nao-subir*) com:
  ETHER_ADMIN_EMAIL=...
  ETHER_ADMIN_PASSWORD=...

ou rode com --jwt-env NOME_DA_VARIAVEL se já tiver um JWT pronto no ambiente.
`);
    process.exit(1);
  }

  const adminEnv = readEnvFile(ADMIN_ENV_PATH);
  const username = adminEnv.ETHER_ADMIN_EMAIL;
  const password = adminEnv.ETHER_ADMIN_PASSWORD;
  if (!username || !password) {
    console.error(`${ADMIN_ENV_PATH} precisa ter ETHER_ADMIN_EMAIL e ETHER_ADMIN_PASSWORD.`);
    process.exit(1);
  }

  const clientSecret = process.env.ETHER_CLIENT_SECRET;
  if (!clientSecret) {
    console.error("ETHER_CLIENT_SECRET ausente no .env — necessário para calcular o SECRET_HASH do SRP.");
    process.exit(1);
  }

  console.log(`Login SRP: pool=${USER_POOL_ID} client=${APP_CLIENT_ID} usuário=${redact()} senha=${redact()} ...`);
  let session;
  try {
    session = await loginWithSrp({
      userPoolId: USER_POOL_ID,
      clientId: APP_CLIENT_ID,
      clientSecret,
      username,
      password,
      getTotpCode: criarGetTotpCode(),
    });
  } catch (error) {
    console.error(`\n✗ Login SRP falhou: ${error.message ?? error}`);
    console.error(
      "Se a mensagem mencionar SECRET_HASH inválido, ETHER_CLIENT_SECRET não é o secret " +
        "correto deste App Client — não adivinhe outro valor, reporte antes de tentar de novo.",
    );
    process.exit(1);
  }
  console.log("     ok — sessão SRP obtida (access token + id token, não exibidos)");
  return session.accessToken;
}

async function call(path, { body, token } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": UA,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });

  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }

  return { ok: response.ok, status: response.status, body: parsed };
}

function fail(passo, resultado) {
  console.error(`\n✗ Falhou no passo ${passo} — HTTP ${resultado.status}`);
  console.error(JSON.stringify(resultado.body, null, 2));

  if (resultado.status === 404) {
    console.error(`
Diagnóstico: 404 aqui costuma significar que o JWT usado não tem escopo de
participant (o gateway da Ether roteia por escopo). Confirme que o token é de
um usuário ADMIN do participant, não de client_credentials nem de um usuário
comum. Pare aqui — não fique tentando variações de rota, é a mesma parede já
documentada no handoff.`);
  }
  if (resultado.status === 401) {
    console.error(`
Diagnóstico: 401 = token do admin inválido/expirado, ou o usuário não tem
papel de participant na Ether. Não repita o login em loop (rate limit).`);
  }
  process.exit(1);
}

console.log(`Base: ${BASE}\n`);

const ADMIN_JWT = await obterJwtAdmin();

// --- Claims do JWT do admin (não sensíveis) --------------------------------
try {
  const claims = decodeJwtPayload(ADMIN_JWT);
  const { scope, client_id, aud, exp, token_use, ["cognito:groups"]: groups, sub } = claims;
  console.log("\nClaims do JWT do admin (não sensíveis):");
  console.log(
    JSON.stringify(
      { token_use, scope, client_id, aud, exp, exp_iso: exp ? new Date(exp * 1000).toISOString() : undefined, groups, sub_hash: sub ? "presente (não exibido)" : undefined },
      null,
      2,
    ),
  );
} catch (e) {
  console.error("Não consegui decodificar o JWT do admin para relatar claims:", e.message);
}

// --- Passo 1: gerar a API Key -----------------------------------------------
console.log("\n1/3  POST /participant/api-key ...");
const criacao = await call("/participant/api-key", {
  token: ADMIN_JWT,
  body: { description: "Integração LivrePay" },
});
if (!criacao.ok) fail(1, criacao);

const clientId = criacao.body?.clientId;
const secretToken = criacao.body?.secretToken;
if (!clientId || !secretToken) {
  console.error("Resposta sem clientId/secretToken:", JSON.stringify(criacao.body, null, 2));
  process.exit(1);
}
console.log(`     ok — clientId recebido, secretToken válido até ${criacao.body?.secretTokenExpiresAt ?? "(não informado)"}`);

// --- Passo 2: trocar o secretToken pelo clientSecret (janela de 5 min) ------
console.log("2/3  POST /auth/api-key/secret ...");
const recuperacao = await call("/auth/api-key/secret", { body: { token: secretToken } });
if (!recuperacao.ok) fail(2, recuperacao);

const clientSecretNovo = recuperacao.body?.clientSecret;
if (!clientSecretNovo) {
  console.error("Resposta sem clientSecret:", JSON.stringify(recuperacao.body, null, 2));
  process.exit(1);
}

// Grava ANTES de validar: o secret só aparece uma vez, perder aqui obriga a
// gerar tudo de novo.
writeFileSync(
  OUT,
  `# Credenciais de INTEGRAÇÃO da Ether — geradas em ${new Date().toISOString()}
# NÃO versionar. Copie para o .env e para o secrets manager de produção.

ETHER_CLIENT_ID=${recuperacao.body?.clientId ?? clientId}
ETHER_CLIENT_SECRET=${clientSecretNovo}
`,
  { mode: 0o600 },
);
console.log(`     ok — credenciais gravadas em ${OUT}`);

// --- Passo 3: validar que autenticam e liberam endpoint protegido -----------
console.log("3/3  POST /auth/api-key (validação) ...");
const login = await call("/auth/api-key", {
  body: { clientId: recuperacao.body?.clientId ?? clientId, clientSecret: clientSecretNovo },
});
if (!login.ok) fail(3, login);

const accessToken = login.body?.access_token ?? login.body?.accessToken;
if (!accessToken) {
  console.error("Resposta sem access_token:", JSON.stringify(login.body, null, 2));
  process.exit(1);
}
console.log("     ok — access_token emitido");

// Teste real: o que hoje devolve AUTH_KEY_001 deve passar a responder.
const saldo = await fetch(`${BASE}/account-balance`, {
  headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": UA },
});
console.log(`\nGET /account-balance -> HTTP ${saldo.status}`);

if (saldo.ok) {
  console.log(`
✓ INTEGRAÇÃO DESBLOQUEADA.

Próximos passos:
  1. Copie ETHER_CLIENT_ID e ETHER_CLIENT_SECRET de ${OUT} para o .env
  2. Ajuste server/src/ether.js para autenticar em /auth/api-key
     (hoje usa /auth/authenticate) — mudança revisada à parte, não nesta rodada
  3. Apague ${OUT} depois de guardar as credenciais no cofre
`);
} else {
  console.log(`
As credenciais foram geradas, mas /account-balance ainda não libera.
Isso aponta para KYC/provisionamento do participant, não para credencial.
Envie este status ao suporte da Ether.
`);
}
