import pg from "pg";
import { config } from "./config.js";

// bigint (int8) chega como string no driver para não perder precisão acima de
// 2^53. Nossos valores são centavos e cabem com folga em Number, então
// convertemos — mas de forma explícita, checando o limite seguro.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) {
    throw new Error(`Valor bigint fora do intervalo seguro de JS: ${value}`);
  }
  return n;
});

export const pool = new pg.Pool(config.db);

pool.on("error", (err) => {
  console.error("Erro inesperado no pool do Postgres", err);
});

/**
 * Executa `fn` numa transação com a identidade do usuário aplicada.
 *
 * É aqui que a RLS ganha vida sem Supabase: `set_config(..., true)` grava o id
 * do usuário como variável LOCAL À TRANSAÇÃO, e `SET LOCAL ROLE authenticated`
 * rebaixa os privilégios. Ambos são desfeitos no COMMIT/ROLLBACK — obrigatório
 * com pool de conexões, senão a identidade de um usuário vazaria para a
 * próxima requisição que pegasse a mesma conexão.
 *
 * Como a API conecta com uma role que NÃO é dona das tabelas, as policies
 * valem de verdade: um bug numa query não expõe dado de outro cliente.
 */
export async function withUser(userId, fn) {
  if (!userId) throw new Error("withUser exige um userId");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId]);
    await client.query("SET LOCAL ROLE authenticated");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Transação com privilégio de serviço (BYPASSRLS). Use SOMENTE para o que o
 * usuário não pode fazer: liquidação vinda do provedor, webhooks, rotinas
 * internas. Nunca para servir dados de uma requisição autenticada.
 */
export async function withService(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE service_role");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Consulta no schema `auth` (cadastro, login, refresh tokens).
 *
 * Roda sob service_role porque nenhuma requisição tem identidade ainda — é
 * justamente o login que vai estabelecê-la. Como a role de conexão é
 * NOINHERIT, o privilégio só existe dentro deste SET LOCAL, o que mantém o
 * acesso a hashes de senha restrito a este caminho de código.
 *
 * NÃO use para tabelas de negócio em `public`: lá vale withUser().
 */
export async function authQuery(text, params) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE service_role");
    const result = await client.query(text, params);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
