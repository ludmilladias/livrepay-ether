import { verifyAccessToken } from "./tokens.js";

/** Erro de negócio com status HTTP — o handler global sabe traduzir. */
export class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Exige um access token válido; anexa req.userId. */
export function requireAuth(req, _res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return next(new ApiError(401, "Não autenticado"));
  }

  try {
    const payload = verifyAccessToken(header.slice(7));
    if (!payload.sub) throw new Error("token sem sub");
    req.userId = payload.sub;
    next();
  } catch {
    // Mensagem genérica de propósito: não revelamos se expirou ou é inválido.
    next(new ApiError(401, "Sessão inválida ou expirada"));
  }
}

/** Valida o corpo com um schema zod e substitui req.body pelo dado limpo. */
export function validate(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const detail = result.error.issues
        .map((i) => `${i.path.join(".") || "corpo"}: ${i.message}`)
        .join("; ");
      return next(new ApiError(400, detail, "VALIDATION_ERROR"));
    }
    req.body = result.data;
    next();
  };
}

/** Envolve handler async para que rejeições cheguem ao handler de erro. */
export function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

/**
 * Traduz exceções do Postgres em respostas úteis sem vazar detalhe interno.
 * As mensagens das funções SQL (ex.: "Saldo insuficiente") são de negócio e
 * podem ser mostradas; o resto vira 500 genérico.
 */
const BUSINESS_MESSAGES = [
  "Saldo insuficiente",
  "não está ativa",
  "não encontrada",
  "não encontrado",
  "sem permissão",
  "está cancelada",
  "não pode ser executado",
  "não pode ser liquidada",
  "não possui pagamentos pendentes",
  "Valor deve ser positivo",
  "em processamento",
  "não pode ser antecipado",
  "ainda não verificado",
  "diverge do valor cobrado",
];

/** Mensagens de negócio que significam "sem permissão", não "dado inválido". */
const FORBIDDEN_MESSAGES = ["Apenas admin pode"];

export function errorHandler(err, req, res, _next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }

  const message = String(err?.message ?? "");

  // Violação de unicidade → conflito, não erro interno.
  if (err?.code === "23505") {
    return res.status(409).json({ error: "Registro já existe", code: "DUPLICATE" });
  }
  // Violação de check constraint → dado inválido.
  if (err?.code === "23514") {
    return res.status(400).json({ error: "Dados inválidos para esta operação" });
  }
  // Privilégio insuficiente: quase sempre tentativa de burlar a RLS.
  if (err?.code === "42501") {
    console.warn("Privilégio negado pelo banco", { path: req.path, userId: req.userId });
    return res.status(403).json({ error: "Operação não permitida" });
  }

  if (FORBIDDEN_MESSAGES.some((m) => message.includes(m))) {
    console.warn("Ação restrita a admin negada", { path: req.path, userId: req.userId });
    return res.status(403).json({ error: message, code: "FORBIDDEN" });
  }

  if (BUSINESS_MESSAGES.some((m) => message.includes(m))) {
    return res.status(422).json({ error: message, code: "BUSINESS_RULE" });
  }

  console.error("Erro não tratado", { path: req.path, userId: req.userId, err });
  return res.status(500).json({ error: "Erro interno do servidor" });
}
