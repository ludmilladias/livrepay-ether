import { withService } from "./db.js";
import { decryptSecret, encryptSecret } from "./etherCredentials.js";

/**
 * Token de cadastro da Ether (`recoveryToken` do POST /users/profile-data),
 * guardado cifrado em vault.ether_registration_tokens.
 *
 * Por que existe: a Ether só aceita o aceite de termos e o upload de documentos
 * de um cliente com este token (teste real 2026-11-03); a credencial do tenant é
 * recusada. Ele vale 48 h e é renovado quando o cliente reenvia o cadastro.
 *
 * Regras (as mesmas do cofre de credenciais):
 *  - Sempre escolhido pelo userId do JWT de quem chama, nunca por dado do cliente.
 *  - O AAD amarra o texto cifrado ao par (userId, etherUserId): copiar a linha
 *    para outro usuário faz a decifragem falhar.
 *  - Nunca logar o token nem o texto cifrado.
 */

const PURPOSE = "registration_recovery";
const MAX_TTL_MS = 48 * 60 * 60 * 1000;
// Não usar um token a poucos minutos de vencer: o upload pode levar até 15 s.
const SAFETY_MARGIN_MS = 5 * 60 * 1000;

const owner = (userId, etherUserId) => ({ userId, etherUserId, clientId: PURPOSE });

/** Vencimento pelo `exp` do JWT, limitado a 48 h; sem `exp` legível, 48 h. */
export function registrationTokenExpiry(token, now = Date.now()) {
  let expMs = null;
  try {
    const claims = JSON.parse(Buffer.from(String(token).split(".")[1], "base64url").toString("utf8"));
    if (Number.isFinite(claims?.exp)) expMs = claims.exp * 1000;
  } catch {
    // não é JWT legível: cai no padrão
  }
  const cap = now + MAX_TTL_MS;
  return new Date(expMs && expMs < cap ? expMs : cap);
}

export async function storeRegistrationToken({ userId, etherUserId, token }) {
  const enc = encryptSecret(token, owner(userId, etherUserId));
  await withService((client) =>
    client.query(
      `insert into vault.ether_registration_tokens
         (user_id, ether_user_id, token_ciphertext, token_iv, token_tag, key_version, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (user_id) do update
         set ether_user_id = excluded.ether_user_id,
             token_ciphertext = excluded.token_ciphertext,
             token_iv = excluded.token_iv,
             token_tag = excluded.token_tag,
             key_version = excluded.key_version,
             expires_at = excluded.expires_at,
             updated_at = now()`,
      [userId, etherUserId, enc.ciphertext, enc.iv, enc.tag, enc.keyVersion, registrationTokenExpiry(token)],
    ),
  );
}

async function loadRow(userId) {
  const { rows } = await withService((client) =>
    client.query(
      `select ether_user_id, token_ciphertext, token_iv, token_tag, key_version, expires_at
         from vault.ether_registration_tokens where user_id = $1`,
      [userId],
    ),
  );
  return rows[0] ?? null;
}

const usable = (row, etherUserId) =>
  !!row && row.ether_user_id === etherUserId && new Date(row.expires_at).getTime() > Date.now() + SAFETY_MARGIN_MS;

/** Token válido do usuário para aquele cliente da Ether, ou null. */
export async function loadRegistrationToken(userId, etherUserId) {
  const row = await loadRow(userId);
  if (!usable(row, etherUserId)) return null;
  try {
    return decryptSecret(
      { ciphertext: row.token_ciphertext, iv: row.token_iv, tag: row.token_tag, keyVersion: row.key_version },
      owner(userId, etherUserId),
    );
  } catch (error) {
    console.error("Token de cadastro da Ether ilegível", { userId, name: error?.name });
    return null;
  }
}

/** Só diz se há token utilizável (sem decifrar). */
export async function hasRegistrationToken(userId, etherUserId) {
  return usable(await loadRow(userId), etherUserId);
}

/** Apaga o token (a Ether o recusou): o cliente terá de reenviar o cadastro. */
export async function deleteRegistrationToken(userId) {
  await withService((client) =>
    client.query(`delete from vault.ether_registration_tokens where user_id = $1`, [userId]),
  );
}
