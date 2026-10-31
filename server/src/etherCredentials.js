import crypto from "node:crypto";
import { config } from "./config.js";
import { withService } from "./db.js";
import { authenticateClient, getHouseEtherUserId, getTenantToken } from "./ether.js";
import { ApiError } from "./middleware.js";

/**
 * Cofre das credenciais da Ether por cliente final (vault.ether_credentials).
 *
 * Cada cliente opera a própria conta com clientId + clientSecret próprios,
 * gerados pela Ether a partir do userId dele. O clientSecret é cifrado aqui com
 * AES-256-GCM e a chave mestra (ETHER_CREDENTIALS_KEY) nunca vai para o banco.
 *
 * Regras:
 *  - A credencial usada é SEMPRE escolhida pelo userId do JWT de quem chama
 *    (quem chama esta camada passa req.userId), nunca por dado vindo do cliente.
 *  - Conta da casa: o perfil ligado (profiles.ether_user_id) à MESMA conta que a
 *    credencial do tenant opera (ETHER_HOUSE_USER_ID), E com papel admin no
 *    momento da chamada, usa o
 *    token do tenant, que já fica no servidor. O vínculo é gravado pela rota admin
 *    /users/:id/link-house-account; o onboarding comum recusa o ID da casa.
 *    Tirar o papel admin corta o acesso na hora.
 *  - Qualquer outro usuário sem credencial ativa não opera: lança
 *    CredentialUnavailableError (nunca cai na conta do tenant).
 *  - Nunca logar clientSecret, token nem o texto cifrado.
 */

const KEY_VERSION = 1;
const IV_BYTES = 12;

export class CredentialUnavailableError extends Error {
  constructor(message = "Conta ainda não habilitada para operar no banco parceiro") {
    super(message);
    this.name = "CredentialUnavailableError";
  }
}

function masterKey(version) {
  if (version !== KEY_VERSION) {
    throw new Error(`Versão de chave de credencial desconhecida: ${version}`);
  }
  const raw = config.ether.credentialsKey;
  if (!raw) throw new Error("ETHER_CREDENTIALS_KEY não configurada");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("ETHER_CREDENTIALS_KEY deve ter 32 bytes em base64");
  return key;
}

/**
 * Dados associados (AAD): amarram o texto cifrado ao dono. Copiar o segredo de
 * uma linha para a de outro usuário faz a decifragem falhar.
 */
function aad({ userId, etherUserId, clientId }) {
  return Buffer.from(`${userId}|${etherUserId}|${clientId}`, "utf8");
}

export function encryptSecret(secret, owner) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey(KEY_VERSION), iv);
  cipher.setAAD(aad(owner));
  const ciphertext = Buffer.concat([cipher.update(String(secret), "utf8"), cipher.final()]);
  return { ciphertext, iv, tag: cipher.getAuthTag(), keyVersion: KEY_VERSION };
}

export function decryptSecret({ ciphertext, iv, tag, keyVersion }, owner) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey(keyVersion), iv);
  decipher.setAAD(aad(owner));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

// Token da Ether por usuário, só em memória (por instância). Nunca em Redis ou banco.
const tokenCache = new Map(); // userId -> { token, expiresAt, credentialId }
const MAX_TOKEN_AGE_MS = 55 * 60 * 1000;
const TOKEN_SAFETY_MARGIN_MS = 60 * 1000;

function forgetToken(userId) {
  tokenCache.delete(userId);
}

/**
 * Grava a credencial de um cliente (cifrada). Se já houver uma não revogada para
 * o mesmo usuário, ela é revogada na MESMA transação. Devolve só metadados.
 */
export async function storeCredential({ userId, etherUserId, clientId, clientSecret, actorId }) {
  if (!userId || !etherUserId || !clientId || !clientSecret) {
    throw new Error("userId, etherUserId, clientId e clientSecret são obrigatórios");
  }
  const enc = encryptSecret(clientSecret, { userId, etherUserId, clientId });

  const row = await withService(async (client) => {
    await client.query(
      `update vault.ether_credentials
          set status = 'revoked', revoked_at = now()
        where user_id = $1 and status <> 'revoked'`,
      [userId],
    );
    const { rows } = await client.query(
      `insert into vault.ether_credentials
         (user_id, ether_user_id, client_id, secret_ciphertext, secret_iv, secret_tag, key_version, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning id, user_id, ether_user_id, client_id, status, created_at`,
      [userId, etherUserId, clientId, enc.ciphertext, enc.iv, enc.tag, enc.keyVersion, actorId ?? null],
    );
    return rows[0];
  });

  forgetToken(userId);
  return row;
}

/** Credencial ativa e decifrada do usuário, ou CredentialUnavailableError. */
export async function loadActiveCredential(userId) {
  const row = await withService(async (client) => {
    const { rows } = await client.query(
      `select id, user_id, ether_user_id, client_id, secret_ciphertext, secret_iv, secret_tag, key_version
         from vault.ether_credentials
        where user_id = $1 and status = 'active'`,
      [userId],
    );
    return rows[0];
  });
  if (!row) throw new CredentialUnavailableError();

  const owner = { userId: row.user_id, etherUserId: row.ether_user_id, clientId: row.client_id };
  const clientSecret = decryptSecret(
    { ciphertext: row.secret_ciphertext, iv: row.secret_iv, tag: row.secret_tag, keyVersion: row.key_version },
    owner,
  );
  return { credentialId: row.id, etherUserId: row.ether_user_id, clientId: row.client_id, clientSecret };
}

/** Marca a credencial ativa como suspeita (a Ether recusou). Para de ser usada. */
export async function markCredentialSuspect(userId) {
  forgetToken(userId);
  await withService(async (client) => {
    await client.query(
      `update vault.ether_credentials set status = 'suspect'
        where user_id = $1 and status = 'active'`,
      [userId],
    );
  });
}

/** Revoga a credencial não revogada do usuário (troca ou cancelamento). */
export async function revokeCredential(userId) {
  forgetToken(userId);
  await withService(async (client) => {
    await client.query(
      `update vault.ether_credentials set status = 'revoked', revoked_at = now()
        where user_id = $1 and status <> 'revoked'`,
      [userId],
    );
  });
}

/**
 * O usuário opera a conta da casa? Exige as duas coisas: estar ligado à conta que
 * a credencial do tenant opera (ETHER_HOUSE_USER_ID) E ter papel admin agora.
 * Sem a variável configurada, ninguém opera a conta da casa.
 */
async function isHouseOperator(userId) {
  const house = getHouseEtherUserId();
  if (!house) return false;
  const row = await withService(async (client) => {
    const { rows } = await client.query(
      `select p.ether_user_id,
              exists (select 1 from public.user_roles r where r.user_id = p.id and r.role = 'admin') as is_admin
         from public.profiles p where p.id = $1`,
      [userId],
    );
    return rows[0] ?? null;
  });
  const linked = row?.is_admin ? row.ether_user_id : null;
  return Boolean(linked) && String(linked).toLowerCase() === house;
}

/**
 * Token da Ether que opera SOMENTE a conta do cliente `userId`. Autentica com a
 * credencial dele e guarda o token em memória por até 55 min.
 * Credencial recusada pela Ether (401/400 no authenticate) vira 'suspect'.
 */
export async function getUserEtherToken(userId) {
  if (await isHouseOperator(userId)) return getTenantToken();

  const cached = tokenCache.get(userId);
  if (cached && cached.expiresAt > Date.now() + TOKEN_SAFETY_MARGIN_MS) return cached.token;

  const cred = await loadActiveCredential(userId);
  let auth;
  try {
    auth = await authenticateClient(cred.clientId, cred.clientSecret);
  } catch (error) {
    if (error?.status === 400 || error?.status === 401) {
      console.error("Ether recusou a credencial do cliente", { userId, status: error.status });
      await markCredentialSuspect(userId);
      throw new CredentialUnavailableError("Credencial do cliente recusada pelo banco parceiro");
    }
    throw error;
  }

  tokenCache.set(userId, {
    token: auth.token,
    expiresAt: Math.min(auth.expiresAt, Date.now() + MAX_TOKEN_AGE_MS),
    credentialId: cred.credentialId,
  });
  return auth.token;
}

/**
 * Token para uma operação de dinheiro pedida pelo usuário `userId` (do JWT ou do
 * worker, nunca do corpo). Conta não habilitada vira 403 com mensagem; nenhuma
 * chamada de dinheiro acontece sem este token.
 */
export async function operationToken(userId) {
  try {
    return await getUserEtherToken(userId);
  } catch (error) {
    if (error instanceof CredentialUnavailableError) {
      throw new ApiError(
        403,
        "Sua conta ainda não está habilitada para movimentar dinheiro no banco parceiro.",
        "ACCOUNT_NOT_ENABLED",
      );
    }
    console.error("Falha ao obter o token da conta na Ether", { userId, status: error?.status });
    throw new ApiError(424, "Não foi possível falar com o banco parceiro agora. Tente de novo em instantes.", "PROVIDER_UNAVAILABLE");
  }
}

/** Só para teste. */
export function clearTokenCacheForTest() {
  tokenCache.clear();
}
