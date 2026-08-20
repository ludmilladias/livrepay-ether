import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { config } from "./config.js";
import { authQuery } from "./db.js";

/**
 * Access token: curto, sem estado, carrega só o id do usuário.
 * O claim `sub` é exatamente o que vira `auth.uid()` no Postgres.
 */
export function signAccessToken(userId) {
  return jwt.sign({}, config.jwt.secret, {
    subject: userId,
    issuer: config.jwt.issuer,
    expiresIn: config.jwt.accessTtlSeconds,
    algorithm: "HS256",
  });
}

export function verifyAccessToken(token) {
  // algorithms explícito evita o ataque de trocar o alg para "none".
  return jwt.verify(token, config.jwt.secret, {
    issuer: config.jwt.issuer,
    algorithms: ["HS256"],
  });
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Refresh token opaco (não é JWT): 32 bytes aleatórios. Guardamos apenas o
 * SHA-256 — se a tabela vazar, os tokens não são reutilizáveis.
 */
export async function issueRefreshToken(userId, userAgent) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + config.jwt.refreshTtlDays * 86_400_000);

  await authQuery(
    `insert into auth.refresh_tokens (user_id, token_hash, expires_at, user_agent)
     values ($1, $2, $3, $4)`,
    [userId, hashToken(token), expiresAt, userAgent?.slice(0, 300) ?? null],
  );

  return { token, expiresAt };
}

/**
 * Troca um refresh token por outro (rotação). Se o token já foi usado ou
 * revogado, negamos — reuso é sinal de token roubado.
 */
export async function rotateRefreshToken(token, userAgent) {
  const { rows } = await authQuery(
    `update auth.refresh_tokens
        set revoked_at = now()
      where token_hash = $1
        and revoked_at is null
        and expires_at > now()
      returning user_id`,
    [hashToken(token)],
  );

  if (rows.length === 0) return null;

  const userId = rows[0].user_id;
  const next = await issueRefreshToken(userId, userAgent);
  return { userId, ...next };
}

export async function revokeRefreshToken(token) {
  await authQuery(
    `update auth.refresh_tokens set revoked_at = now()
      where token_hash = $1 and revoked_at is null`,
    [hashToken(token)],
  );
}

export async function revokeAllForUser(userId) {
  await authQuery(
    `update auth.refresh_tokens set revoked_at = now()
      where user_id = $1 and revoked_at is null`,
    [userId],
  );
}
