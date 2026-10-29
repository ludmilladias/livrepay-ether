import { config } from "./config.js";
import { ApiError } from "./middleware.js";

const VERIFY_URL = "https://www.google.com/recaptcha/api/siteverify";
const TIMEOUT_MS = 5_000;

/**
 * Valida o token do reCAPTCHA v2 no Google. Devolve true/false; lança se o
 * Google não responder (quem chama decide: aqui falhamos FECHADO).
 */
export async function verifyRecaptcha(token, remoteIp) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const body = new URLSearchParams({ secret: config.recaptcha.secret, response: token });
    if (remoteIp) body.set("remoteip", remoteIp);
    const response = await fetch(VERIFY_URL, { method: "POST", body, signal: controller.signal });
    if (!response.ok) throw new Error(`siteverify HTTP ${response.status}`);
    const result = await response.json();
    return result?.success === true;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Middleware: exige `captchaToken` no corpo e o valida. Roda ANTES do `validate`
 * (que descarta chaves desconhecidas). Sem RECAPTCHA_SECRET, não faz nada.
 *
 * Mensagens estáticas: nada do retorno do Google vai ao cliente nem ao log.
 */
export function requireCaptcha(req, _res, next) {
  if (!config.recaptcha.secret) return next();

  const token = req.body?.captchaToken;
  if (typeof token !== "string" || token.length < 10 || token.length > 4096) {
    return next(new ApiError(400, "Confirme que você não é um robô.", "CAPTCHA_REQUIRED"));
  }

  verifyRecaptcha(token, req.ip)
    .then((ok) => {
      if (!ok) return next(new ApiError(400, "Não foi possível validar o reCAPTCHA. Tente de novo.", "CAPTCHA_FAILED"));
      return next();
    })
    .catch(() => {
      console.error("reCAPTCHA: falha ao consultar o Google");
      next(new ApiError(503, "Não foi possível validar o reCAPTCHA agora. Tente novamente em instantes.", "CAPTCHA_UNAVAILABLE"));
    });
}
