import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { config } from "../config.js";
import { authQuery, withUser } from "../db.js";
import { sharedRateLimitStore } from "../rateLimitStore.js";
import { ApiError, asyncRoute, requireAuth, validate } from "../middleware.js";
import {
  signAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllForUser,
} from "../tokens.js";

export const authRouter = Router();

// Limite por IP: mitiga força bruta e credential stuffing.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas tentativas. Tente novamente em alguns minutos." },
  store: sharedRateLimitStore("rl:login:"),
});

const credentials = z.object({
  email: z.string().email("E-mail inválido").max(320).transform((v) => v.toLowerCase().trim()),
  password: z.string().min(10, "A senha deve ter ao menos 10 caracteres").max(200),
});

const registration = credentials.extend({
  fullName: z.string().trim().min(2, "Informe o nome").max(120),
});

function sessionPayload(user, access, refresh) {
  return {
    access_token: access,
    refresh_token: refresh.token,
    expires_in: config.jwt.accessTtlSeconds,
    user: { id: user.id, email: user.email, full_name: user.raw_user_meta_data?.full_name ?? null },
  };
}

authRouter.post(
  "/register",
  loginLimiter,
  validate(registration),
  asyncRoute(async (req, res) => {
    const { email, password, fullName } = req.body;
    const passwordHash = await bcrypt.hash(password, config.auth.bcryptRounds);

    let user;
    try {
      const { rows } = await authQuery(
        `insert into auth.users (email, password_hash, raw_user_meta_data)
         values ($1, $2, jsonb_build_object('full_name', $3::text))
         returning id, email, raw_user_meta_data`,
        [email, passwordHash, fullName],
      );
      user = rows[0];
    } catch (error) {
      if (error.code === "23505") {
        // Não confirmamos se o e-mail existe (evita enumeração de contas).
        throw new ApiError(409, "Não foi possível criar a conta com estes dados");
      }
      throw error;
    }

    // O trigger on_auth_user_created já criou profile, role viewer e conta.
    const refresh = await issueRefreshToken(user.id, req.headers["user-agent"]);
    res.status(201).json(sessionPayload(user, signAccessToken(user.id), refresh));
  }),
);

authRouter.post(
  "/login",
  loginLimiter,
  validate(credentials),
  asyncRoute(async (req, res) => {
    const { email, password } = req.body;

    const { rows } = await authQuery(
      `select id, email, password_hash, raw_user_meta_data,
              failed_login_attempts, locked_until
         from auth.users where email = $1`,
      [email],
    );
    const user = rows[0];

    // Mensagem idêntica para usuário inexistente e senha errada: não revelamos
    // quais e-mails têm conta.
    const invalid = new ApiError(401, "E-mail ou senha incorretos");

    if (!user) {
      // Gasta tempo comparável ao bcrypt real para não vazar por timing.
      await bcrypt.compare(password, "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv");
      throw invalid;
    }

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      throw new ApiError(423, "Conta temporariamente bloqueada por tentativas malsucedidas");
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      const attempts = user.failed_login_attempts + 1;
      const shouldLock = attempts >= config.auth.maxFailedLogins;
      await authQuery(
        `update auth.users
            set failed_login_attempts = $2,
                locked_until = case when $3 then now() + ($4 || ' minutes')::interval else locked_until end
          where id = $1`,
        [user.id, shouldLock ? 0 : attempts, shouldLock, String(config.auth.lockMinutes)],
      );
      throw invalid;
    }

    await authQuery(
      `update auth.users
          set failed_login_attempts = 0, locked_until = null, last_sign_in_at = now()
        where id = $1`,
      [user.id],
    );

    const refresh = await issueRefreshToken(user.id, req.headers["user-agent"]);
    res.json(sessionPayload(user, signAccessToken(user.id), refresh));
  }),
);

authRouter.post(
  "/refresh",
  validate(z.object({ refresh_token: z.string().min(10) })),
  asyncRoute(async (req, res) => {
    // Rotação: o token antigo é revogado e um novo emitido. Reapresentar um
    // token já usado falha — sinal de roubo.
    const rotated = await rotateRefreshToken(req.body.refresh_token, req.headers["user-agent"]);
    if (!rotated) throw new ApiError(401, "Sessão expirada. Faça login novamente.");

    const { rows } = await authQuery(
      `select id, email, raw_user_meta_data from auth.users where id = $1`,
      [rotated.userId],
    );
    if (!rows[0]) throw new ApiError(401, "Sessão inválida");

    res.json(sessionPayload(rows[0], signAccessToken(rotated.userId), rotated));
  }),
);

authRouter.post(
  "/logout",
  validate(z.object({ refresh_token: z.string().min(10).optional() })),
  asyncRoute(async (req, res) => {
    if (req.body.refresh_token) await revokeRefreshToken(req.body.refresh_token);
    res.status(204).end();
  }),
);

authRouter.post(
  "/logout-all",
  requireAuth,
  asyncRoute(async (req, res) => {
    await revokeAllForUser(req.userId);
    res.status(204).end();
  }),
);

authRouter.get(
  "/me",
  requireAuth,
  asyncRoute(async (req, res) => {
    // Lido sob RLS: o profile só é visível para o próprio dono.
    const profile = await withUser(req.userId, async (client) => {
      const { rows } = await client.query(
        // role::text é necessário: o driver não sabe desserializar array de
        // enum customizado e devolveria a string literal "{viewer}".
        `select p.id, p.full_name, p.tax_id, p.phone,
                coalesce(array_agg(r.role::text) filter (where r.role is not null), '{}') as roles
           from public.profiles p
           left join public.user_roles r on r.user_id = p.id
          where p.id = $1
          group by p.id`,
        [req.userId],
      );
      return rows[0] ?? null;
    });

    if (!profile) throw new ApiError(404, "Perfil não encontrado");
    res.json(profile);
  }),
);
