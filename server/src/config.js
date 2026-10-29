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
  //
  // Em produção, o domínio oficial do frontend é sempre incluído, mesmo que
  // ALLOWED_ORIGINS esteja ausente ou mal configurada no painel do App
  // Platform — isso evita que um CORS quebrado derrube login/cadastro em
  // produção por uma env var esquecida. Não é "allow all": continua sendo
  // uma lista explícita, só com um piso conhecido para o único frontend
  // legítimo hoje.
  allowedOrigins: Array.from(
    new Set([
      ...optional("ALLOWED_ORIGINS", "http://localhost:8080")
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean),
      ...(isProduction ? ["https://livrepay.digital", "https://www.livrepay.digital"] : []),
    ]),
  ),

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
    // Token no path da URL de callback cadastrada no painel da Ether —
    // necessário porque o painel deles só aceita configurar a URL, sem
    // headers customizados. Validado em tempo constante, como camada
    // adicional à assinatura HMAC (quando presente).
    webhookUrlToken: optional("ETHER_WEBHOOK_URL_TOKEN", ""),
    // Cognito: a Ether usa AWS Cognito para autenticação de sub-contas.
    // O LivrePay (participant) precisa dessas credenciais para criar/autenticar
    // usuários finais na Ether.
    cognitoAppClientId: optional("ETHER_COGNITO_APP_CLIENT_ID", ""),
    cognitoUserPoolId: optional("ETHER_COGNITO_USER_POOL_ID", ""),
    // tenantUrl do LivrePay na Ether (usado no onboarding de sub-contas).
    // Confirmado pelo suporte da Ether (2026-09-29) e por teste real
    // (2026-10-27): tem de ser o subdomínio "api.livrepay.digital". O domínio
    // nu ("livrepay.digital", default antigo) faz /users/profile-data
    // responder 404 USR_NOT_001 — e a produção ficou com esse default por
    // não ter ETHER_TENANT_URL configurada.
    tenantUrl: optional("ETHER_TENANT_URL", "api.livrepay.digital"),
  },

  // Sem isso, rate limit vira MemoryStore por instância: com 2+ réplicas atrás
  // do load balancer, cada uma conta separado e o teto deixa de valer de verdade.
  redisUrl: optional("REDIS_URL", ""),

  // reCAPTCHA v2 (checkbox). Sem RECAPTCHA_SECRET a verificação é desligada (útil
  // em dev e para ligar a chave em produção sem derrubar o login); com ele, falta
  // ou falha do token barra a requisição.
  recaptcha: {
    secret: optional("RECAPTCHA_SECRET", ""),
  },

  // E-mail transacional (redefinição de senha). Provedor, em ordem de preferência:
  // Amazon SES (AWS_SES_*) e, se não configurado, Resend (RESEND_API_KEY).
  // As credenciais do SES têm nomes próprios (não AWS_ACCESS_KEY_ID) para a API
  // nunca herdar uma credencial AWS "solta" do ambiente.
  mail: {
    awsRegion: optional("AWS_SES_REGION", ""),
    awsAccessKeyId: optional("AWS_SES_ACCESS_KEY_ID", ""),
    awsSecretAccessKey: optional("AWS_SES_SECRET_ACCESS_KEY", ""),
    resendApiKey: optional("RESEND_API_KEY", ""),
    from: optional("MAIL_FROM", "LivrePay <nao-responder@livrepay.digital>"),
  },

  // URL pública do frontend: base do link de redefinição enviado por e-mail.
  appUrl: optional("APP_URL", "https://livrepay.digital").replace(/\/+$/, ""),
};

if (isProduction && !config.recaptcha.secret) {
  console.warn("RECAPTCHA_SECRET não definida em produção — login/cadastro/esqueci-a-senha sem reCAPTCHA.");
}
export const sesConfigured = Boolean(
  config.mail.awsRegion && config.mail.awsAccessKeyId && config.mail.awsSecretAccessKey,
);
if (isProduction && !sesConfigured && !config.mail.resendApiKey) {
  console.warn(
    "Nenhum provedor de e-mail configurado (AWS_SES_* ou RESEND_API_KEY) — e-mails de redefinição de senha NÃO serão enviados.",
  );
}

if (isProduction && !config.redisUrl) {
  console.warn(
    "REDIS_URL não definida em produção — rate limit está em memória por instância " +
      "(não é compartilhado entre réplicas). Configure o Redis gerenciado antes de escalar " +
      "para 2+ instâncias.",
  );
}
