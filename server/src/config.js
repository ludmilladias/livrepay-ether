import "dotenv/config";

/**
 * Configuração validada na inicialização. Preferimos falhar ao subir do que
 * descobrir em produção que um segredo estava faltando.
 */
function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
}

function optional(name, fallback) {
  return process.env[name] ?? fallback;
}

const isProduction = process.env.NODE_ENV === "production";

// Segredo de JWT curto é força bruta fácil. 32 bytes é o mínimo aceitável.
const jwtSecret = required("JWT_SECRET");
if (jwtSecret.length < 32) {
  throw new Error("JWT_SECRET deve ter ao menos 32 caracteres");
}

export const config = {
  isProduction,
  port: Number(optional("PORT", "8080")),

  db: {
    host: optional("PGHOST", "localhost"),
    port: Number(optional("PGPORT", "5432")),
    database: optional("PGDATABASE", "livrepay"),
    // A API NUNCA conecta como dono das tabelas: dono ignora RLS.
    user: required("PGUSER"),
    password: required("PGPASSWORD"),
    max: Number(optional("PGPOOL_MAX", "10")),
  },

  jwt: {
    secret: jwtSecret,
    // Access token curto: se vazar, a janela de abuso é pequena.
    accessTtlSeconds: Number(optional("JWT_ACCESS_TTL", "900")), // 15 min
    refreshTtlDays: Number(optional("JWT_REFRESH_TTL_DAYS", "14")),
    issuer: optional("JWT_ISSUER", "livrepay"),
  },

  // Sem "*": em fintech, origem liberada é sessão do usuário exposta.
  allowedOrigins: optional("ALLOWED_ORIGINS", "http://localhost:8080")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),

  auth: {
    bcryptRounds: Number(optional("BCRYPT_ROUNDS", "12")),
    maxFailedLogins: Number(optional("MAX_FAILED_LOGINS", "5")),
    lockMinutes: Number(optional("LOGIN_LOCK_MINUTES", "15")),
  },

  ether: {
    baseUrl: optional("ETHER_BASE_URL", "https://api.etherglobalassets.com.br"),
    clientId: optional("ETHER_CLIENT_ID", ""),
    clientSecret: optional("ETHER_CLIENT_SECRET", ""),
    webhookSecret: optional("ETHER_WEBHOOK_SECRET", ""),
  },
};
