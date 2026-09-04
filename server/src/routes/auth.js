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
                p.ether_user_id, p.ether_account_status, p.ether_pix_key,
                p.ether_pix_key_type,
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

// ---------------------------------------------------------------------------
// Onboarding Ether — cria sub-conta do cliente final na Ether
// ---------------------------------------------------------------------------

const onboardingSchema = z.object({
  taxId: z.string().regex(/^\d{11}$|^\d{14}$/, "CPF ou CNPJ inválido"),
  personType: z.enum(["FISICA", "JURIDICA"]),
  phone: z.string().regex(/^\d{10,11}$/, "Telefone com DDD (apenas números)"),
  dateBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data de nascimento (YYYY-MM-DD)"),
  address: z.object({
    zipcode: z.string().regex(/^\d{8}$/, "CEP (apenas números)"),
    street: z.string().min(1).max(200),
    number: z.string().min(1).max(20),
    complement: z.string().max(100).optional(),
    district: z.string().min(1).max(100),
    city: z.string().min(1).max(100),
    state: z.string().length(2),
  }),
  // PJ: dados corporativos adicionais
  companyInfo: z.object({
    tradeName: z.string().min(1).max(140),
    openingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    revenue: z.string().regex(/^\d+\.?\d*$/, "Faturamento mensal"),
    responsible: z.object({
      fullName: z.string().min(1).max(140),
      email: z.string().email(),
      phone: z.string().regex(/^\d{10,11}$/),
    }),
  }).optional(),
});

/**
 * POST /auth/onboarding — inicia a abertura de conta na Ether.
 *
 * Fluxo real (confirmado pelo suporte Ether em 2026-09-04):
 * 1. Usuário preenche dados no frontend
 * 2. POST /users/onboarding na Ether com identityDocument (CPF/CNPJ) —
 *    primeira requisição autenticada; cria a conta em status BASIC
 * 3. Documentos de KYC vão via /kyc/submissions
 * 4. Ether aprova → conta vira FULL e libera Pix/saldo
 */
authRouter.post(
  "/onboarding",
  requireAuth,
  validate(onboardingSchema),
  asyncRoute(async (req, res) => {
    const { submitOnboarding } = await import("../ether.js");
    const b = req.body;

    // Verifica se já fez onboarding.
    const existing = await withUser(req.userId, async (client) => {
      const { rows } = await client.query(
        `select ether_user_id, ether_account_status from public.profiles where id = $1`,
        [req.userId],
      );
      return rows[0];
    });

    if (existing?.ether_user_id) {
      throw new ApiError(409, "Onboarding já realizado. Status: " + existing.ether_account_status);
    }

    let etherResult;
    try {
      etherResult = await submitOnboarding(b.taxId);
    } catch (error) {
      console.error("Ether recusou o onboarding", {
        userId: req.userId,
        detail: error?.body ?? String(error),
      });
      throw new ApiError(502, "Não foi possível iniciar o cadastro. Verifique os dados e tente novamente.");
    }

    const etherUserId = etherResult.userId ?? etherResult.id;
    if (!etherUserId) {
      throw new ApiError(502, "Ether não retornou ID do usuário");
    }

    // Grava o vínculo no banco (service_role pode escrever ether_*).
    const { withService } = await import("../db.js");
    await withService(async (client) => {
      await client.query(
        `update public.profiles
            set ether_user_id = $2, ether_account_status = $3, tax_id = $4, phone = $5
          where id = $1`,
        [req.userId, etherUserId, etherResult.status ?? "basic", b.taxId, b.phone],
      );
    });

    res.status(201).json({
      ether_user_id: etherUserId,
      status: etherResult.status ?? "basic",
      message: "Cadastro iniciado. Envie os documentos de KYC para liberar a conta (status FULL).",
    });
  }),
);

/** GET /auth/onboarding/status — consulta o status da conta na Ether. */
authRouter.get(
  "/onboarding/status",
  requireAuth,
  asyncRoute(async (req, res) => {
    const profile = await withUser(req.userId, async (client) => {
      const { rows } = await client.query(
        `select ether_user_id, ether_account_status, ether_pix_key, ether_pix_key_type
           from public.profiles where id = $1`,
        [req.userId],
      );
      return rows[0];
    });

    if (!profile?.ether_user_id) {
      return res.json({ status: "not_started" });
    }

    // Consulta o status atual na Ether.
    const { getAccountStatus } = await import("../ether.js");
    try {
      const etherStatus = await getAccountStatus(profile.ether_user_id);

      // Atualiza o status local se mudou.
      if (etherStatus?.status && etherStatus.status !== profile.ether_account_status) {
        const { withService } = await import("../db.js");
        await withService(async (client) => {
          await client.query(
            `update public.profiles set ether_account_status = $2 where id = $1`,
            [req.userId, etherStatus.status],
          );
        });
      }

      return res.json({
        ether_user_id: profile.ether_user_id,
        status: etherStatus?.status ?? profile.ether_account_status,
        pix_key: profile.ether_pix_key,
        pix_key_type: profile.ether_pix_key_type,
        checklist: etherStatus?.documentChecklist ?? null,
      });
    } catch {
      // Se a Ether estiver fora, retorna o último status conhecido.
      return res.json({
        ether_user_id: profile.ether_user_id,
        status: profile.ether_account_status,
        pix_key: profile.ether_pix_key,
        pix_key_type: profile.ether_pix_key_type,
        checklist: null,
      });
    }
  }),
);
