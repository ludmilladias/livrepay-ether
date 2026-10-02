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

const isoDate = (msg) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, msg);
const text = (max = 60) => z.string().trim().min(1).max(max);

/**
 * Enum tolerante a grafia. Normaliza a entrada (sem acento, maiúsculas, "_" e
 * espaço equivalentes) e devolve SEMPRE a forma canônica do dicionário oficial
 * "Tipos de contas e dados usados na criação de contas" (obtido 2026-10-02).
 * `aliases` mapeia sinônimos (ex.: equivalentes em inglês) para a forma canônica.
 */
const keyOf = (v) =>
  String(v).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[_\s]+/g, " ").trim();
const canonicalEnum = (canonical, aliases = {}) => {
  const lookup = new Map(canonical.map((c) => [keyOf(c), c]));
  for (const [alias, target] of Object.entries(aliases)) lookup.set(keyOf(alias), target);
  return z.string().transform((v, ctx) => {
    const found = lookup.get(keyOf(v));
    if (!found) {
      ctx.addIssue({ code: "custom", message: `Valor inválido. Aceitos: ${canonical.join(", ")}` });
      return z.NEVER;
    }
    return found;
  });
};

/*
 * Fontes oficiais da Ether (ambas coladas pela usuária em 2026-10-02):
 *  (a) guia "Abertura de Conta PF" (exemplo de payload);
 *  (b) "Tipos de contas e dados usados na criação de contas" (matriz de
 *      obrigatoriedade PF x PJ e dicionário de enums) — mais específico, vence
 *      em caso de divergência.
 *
 * Campos de perfil/endereço/documento são dados do cliente final: vêm na
 * requisição, o servidor não inventa valores.
 *
 * accountType: fixo em "NOMINAL" no payload (conta de pagamento BRL com
 * agência/conta/Pix). A outra opção da doc, "CRIPTO" (custódia on-chain, Pix
 * restrito a mesma titularidade), não faz parte do produto: escolha deliberada.
 *
 * Obrigatoriedade (matriz (b)):
 *  - PF obrigatórios: personType, taxId, phone, dateBirth, nationality,
 *    maritalStatus, monthlyIncome, hometown.
 *  - PF opcionais: gender, education, socialName, website, socialNetwork,
 *    managerName.
 *  - PF: NÃO enviar cnaeId, assessment, legalNature, companyInfo (companyInfo
 *    recebido num cadastro PF é descartado do payload).
 *  - PJ obrigatórios: companyInfo, website e socialNetwork (vazio gera
 *    USR_VAL_005). hometown opcional. maritalStatus/gender/education NÃO são
 *    enviados (descartados do payload mesmo se vierem na requisição).
 *  - PJ opcionais, dentro de `profile` (guia PJ, não em companyInfo): cnaeId
 *    (ex.: "6204000"), assessment (SIMPLES_NACIONAL|LUCRO_REAL|LUCRO_PRESUMIDO)
 *    e legalNature (ex.: "206-2"). Descartados em PF.
 *  - NÃO suportado: personType PESSOA_ESTRANGEIRA.
 *
 * NOMENCLATURA PJ (fácil de trocar): `profile.socialName` é a RAZÃO SOCIAL;
 * `companyInfo.tradeName` é o NOME FANTASIA. São coisas diferentes.
 *
 * DIVERGÊNCIA DE GRAFIA (não resolvida pela Ether): o guia (a) usa
 * "ENSINO_SUPERIOR_COMPLETO" (underscores); o dicionário (b) lista
 * "ENSINO SUPERIOR COMPLETO" (espaços; idem "UNIÃO ESTÁVEL"). Aceitamos as duas
 * grafias (e sem acento) na entrada e ENVIAMOS a forma do dicionário (b), por
 * ser o documento mais específico. Se a Ether rejeitar, inverter aqui — o ponto
 * único é a lista `canonical` de cada enum. PERGUNTA ABERTA à Ether.
 *
 * DIVERGÊNCIA taxId: o guia PF mostra "123.456.789-00" e o guia PJ mostra
 * "50.299.488/0001-78" (ambos com máscara); enviamos só dígitos. Testes reais
 * (PENDING.md) mostraram que sem máscara o campo é aceito (CPF) — o erro evoluiu
 * além dele. Para CNPJ não há teste real ainda. Não alterar sem novo erro
 * apontando taxId.
 *
 * ATENÇÃO address.city: o guia mostra um slug ("br-rs-porto-alegre"), não o
 * nome. Repassamos o valor recebido sem transformar (regra do slug não
 * confirmada).
 *
 * DOIS VOCABULÁRIOS DE DOCUMENTO — NÃO UNIFICAR (não é duplicação):
 *  1) `document.type` (passo 1, profile-data): documento PESSOAL de identidade.
 *     Lista aceita: CARTEIRA_IDENTIDADE | CARTEIRA_TRABALHO | CARTEIRA_HABILITACAO
 *     | PASSAPORTE. Em PJ, `document` é o documento do REPRESENTANTE LEGAL (o
 *     guia PJ envia CARTEIRA_IDENTIDADE), não da empresa. Default
 *     CARTEIRA_IDENTIDADE para PF e PJ. "CARTAO_CNPJ" NÃO é válido aqui.
 *  2) Tipos de upload / `documentChecklist` (passo 4, /users/document/upload):
 *     PF: CARTEIRA_IDENTIDADE, COMPROVANTE_RESIDENCIA, SELFIE_COM_DOC.
 *     PJ: CARTAO_CNPJ, CONTRATO_SOCIAL, COMPROVANTE_RESIDENCIA. Aqui
 *     "CARTAO_CNPJ" É válido (ver UPLOAD_DOCUMENT_TYPES em ether.js).
 *
 * document.issuingAgency/issueDate/issueState: aparecem nos exemplos dos DOIS
 * guias (PF e PJ), embora a matriz de obrigatoriedade não os liste. Evidência:
 * 2 exemplos oficiais (não só 1) -> mantidos obrigatórios para PF. Em PJ são
 * aceitos e enviados se vierem; hoje não exigidos (ainda sem teste real).
 */
export const onboardingSchema = z
  .object({
    taxId: z.string().regex(/^\d{11}$|^\d{14}$/, "CPF ou CNPJ inválido"),
    personType: z.enum(["FISICA", "JURIDICA"]),
    // Doc: exatamente 11 dígitos (DDD + celular).
    phone: z.string().regex(/^\d{11}$/, "Telefone com DDD, 11 dígitos (apenas números)"),
    dateBirth: isoDate("Data de nascimento (YYYY-MM-DD)"),

    documentType: canonicalEnum([
      "CARTEIRA_IDENTIDADE", "CARTEIRA_TRABALHO", "CARTEIRA_HABILITACAO", "PASSAPORTE",
    ]).optional(),
    // Sem este campo a Ether recusa o cadastro com 400 USR_VAL_006 (achado em
    // 2026-09-29, teste real contra produção).
    documentNumber: z.string().min(1).max(30, "Número do documento"),
    // Bloco `document` (ver nota "DOIS VOCABULÁRIOS" e issuingAgency acima).
    // Obrigatórios para PF; a matriz não os classifica, mas os 2 guias os enviam.
    documentIssuingAgency: text(30).optional(), // ex.: "SSP/RS"
    documentIssueDate: isoDate("Data de emissão (YYYY-MM-DD)").optional(),
    documentIssueState: z.string().length(2).optional(), // UF de emissão

    // Perfil
    nationality: canonicalEnum(["Brasileiro", "Brasileira"]).optional(),
    maritalStatus: canonicalEnum(
      ["SOLTEIRO(A)", "CASADO(A)", "DIVORCIADO(A)", "VIUVO(A)", "UNIÃO ESTÁVEL"],
      {
        single: "SOLTEIRO(A)", married: "CASADO(A)", divorced: "DIVORCIADO(A)",
        widower: "VIUVO(A)", "stable-union": "UNIÃO ESTÁVEL",
      },
    ).optional(),
    // Decimal como string, ex.: "5000.00" (formato do exemplo da doc).
    monthlyIncome: z.string().regex(/^\d+(\.\d{1,2})?$/, "Renda mensal, ex.: 5000.00").optional(),
    hometown: text(100).optional(), // naturalidade
    gender: canonicalEnum([
      "PREFIRO_NAO_INFORMAR", "HOMEM_CISGENERO", "MULHER_CISGENERO",
      "HOMEM_TRANSGENERO", "MULHER_TRANSGENERO", "PESSOA_NAO_BINARIA",
    ]).optional(),
    education: canonicalEnum([
      "ENSINO FUNDAMENTAL INCOMPLETO", "ENSINO FUNDAMENTAL COMPLETO",
      "ENSINO MÉDIO INCOMPLETO", "ENSINO MÉDIO COMPLETO",
      "ENSINO SUPERIOR INCOMPLETO", "ENSINO SUPERIOR COMPLETO", "PÓS-GRADUAÇÃO",
    ]).optional(),
    socialName: text(140).optional(),
    website: text(200).optional(), // PJ: obrigatório
    socialNetwork: text(200).optional(), // PJ: obrigatório
    managerName: text(140).optional(),
    // Só PJ, opcionais, dentro de `profile`; descartados em PF.
    cnaeId: text(20).optional(), // ex.: "6204000"
    assessment: canonicalEnum(["SIMPLES_NACIONAL", "LUCRO_REAL", "LUCRO_PRESUMIDO"]).optional(),
    legalNature: text(20).optional(), // ex.: "206-2"

    address: z.object({
      isPreferred: z.boolean().default(true),
      addressType: canonicalEnum(["RESIDENCIAL", "COMERCIAL"]),
      zipcode: z.string().regex(/^\d{8}$/, "CEP (apenas números)"),
      street: z.string().min(1).max(200),
      number: z.string().min(1).max(20),
      complement: z.string().max(100).optional(),
      district: z.string().min(1).max(100),
      city: z.string().min(1).max(100), // ver aviso sobre slug acima
      state: z.string().length(2),
      country: canonicalEnum(["BR", "Brasil"]).default("BR"), // obrigatório na Ether; default BR
      caixaPostal: z.number().int().min(0).default(0),
      anoResidencia: z.number().int().min(0).max(150).default(5),
    }),
    // PJ: dados corporativos (descartado em cadastro PF)
    companyInfo: z.object({
      tradeName: z.string().min(1).max(140),
      openingDate: isoDate("Data de abertura (YYYY-MM-DD)"),
      revenue: z.string().regex(/^\d+\.?\d*$/, "Faturamento mensal"),
      responsible: z.object({
        fullName: z.string().min(1).max(140),
        email: z.string().email(),
        phone: z.string().regex(/^\d{10,11}$/),
      }),
    }).optional(),
  })
  .superRefine((b, ctx) => {
    const need = (fields, why) => {
      for (const field of fields) {
        if (b[field] === undefined) ctx.addIssue({ code: "custom", path: [field], message: `Obrigatório para ${why}` });
      }
    };
    if (b.personType === "FISICA") {
      need(["nationality", "maritalStatus", "monthlyIncome", "hometown"], "pessoa física");
      need(["documentIssuingAgency", "documentIssueDate", "documentIssueState"], "pessoa física");
    } else {
      need(["companyInfo", "website", "socialNetwork"], "pessoa jurídica");
    }
  });

/**
 * O CHECK de profiles.ether_account_status só aceita pending|basic|full|rejected
 * (sem mudar schema). A Ether devolve pending_documents|pending_analysis|active|
 * inactive. Gravar o valor cru violaria o CHECK e quebraria o onboarding DEPOIS
 * de a conta já existir na Ether. "inactive" -> "rejected": confirmado pela doc
 * oficial "Tipos de contas e dados usados na criação de contas" (inactive =
 * "cadastro rejeitado pelo Compliance"). Desconhecido -> "pending". O status
 * cru da Ether continua sendo devolvido ao frontend.
 */
const ETHER_STATUS_TO_LOCAL = {
  pending_documents: "pending",
  pending_analysis: "pending",
  active: "full",
  inactive: "rejected",
};
const toLocalStatus = (etherStatus) => ETHER_STATUS_TO_LOCAL[etherStatus] ?? "pending";

/** Remove chaves undefined (não enviar campo ausente). */
const definedOnly = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

/**
 * Monta o corpo de POST /users/profile-data. Pura (sem I/O) para ser testável
 * sem chamar a Ether. `b` = corpo já validado/normalizado pelo onboardingSchema.
 */
export function buildOnboardingPayload(b, titular) {
  const isPF = b.personType === "FISICA";
  return {
    name: titular.full_name,
    email: titular.email,
    tenantUrl: config.ether.tenantUrl,
    accountType: "NOMINAL", // deliberado: conta de pagamento BRL (ver nota no schema)
    profile: {
      taxId: b.taxId,
      personType: b.personType,
      phone: b.phone,
      dateBirth: b.dateBirth,
      ...definedOnly({
        nationality: b.nationality,
        monthlyIncome: b.monthlyIncome,
        hometown: b.hometown,
        // Em PJ, socialName = RAZÃO SOCIAL (não confundir com companyInfo.tradeName,
        // que é o NOME FANTASIA).
        socialName: b.socialName,
        website: b.website,
        socialNetwork: b.socialNetwork,
        managerName: b.managerName,
        // Estado civil, gênero e escolaridade só existem para PF (doc: não enviar em PJ).
        ...(isPF ? { maritalStatus: b.maritalStatus, gender: b.gender, education: b.education } : {}),
        // cnaeId, assessment e legalNature só existem para PJ (doc: não enviar em PF).
        ...(!isPF ? { cnaeId: b.cnaeId, assessment: b.assessment, legalNature: b.legalNature } : {}),
      }),
    },
    address: b.address,
    document: {
      // PF e PJ: CARTEIRA_IDENTIDADE por padrão. Em PJ este objeto é o documento
      // pessoal do REPRESENTANTE LEGAL (guia PJ). "CARTAO_CNPJ" NÃO vale aqui —
      // só no checklist/upload (outro vocabulário; ver nota no schema).
      type: b.documentType ?? "CARTEIRA_IDENTIDADE",
      number: b.documentNumber,
      ...definedOnly({
        issuingAgency: b.documentIssuingAgency,
        issueDate: b.documentIssueDate,
        issueState: b.documentIssueState,
      }),
    },
    // companyInfo só em PJ (doc: não enviar em PF).
    ...(!isPF && b.companyInfo ? { companyInfo: b.companyInfo } : {}),
  };
}

/**
 * POST /auth/onboarding — inicia a abertura de conta na Ether.
 *
 * Fluxo conforme a documentação oficial (verificado em 2026-09-09):
 * 1. `POST /users/profile-data` na Ether → cria o rascunho e devolve o userId
 * 2. `POST /users/{id}/accept-terms` e `/pep-declaration`
 * 3. Documentos via `POST /users/document/upload`
 * 4. Ether aprova → `check-account` passa a `active` e libera Pix/saldo
 *
 * Atenção: `/users/onboarding` e `/kyc/submissions` (sugeridos por suporte em
 * 2026-09-04) retornam 404 em produção — não voltar a usá-los.
 */
authRouter.post(
  "/onboarding",
  requireAuth,
  validate(onboardingSchema),
  asyncRoute(async (req, res) => {
    const { createUserProfile, acceptTerms, submitPepDeclaration } = await import("../ether.js");
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

    // Nome e e-mail do titular: o e-mail vive em auth.users, fora do alcance
    // da role `authenticated` — leitura via service_role, do próprio usuário.
    const { withService } = await import("../db.js");
    const titular = await withService(async (client) => {
      const { rows } = await client.query(
        `select u.email, coalesce(p.full_name, u.email) as full_name
           from auth.users u
           left join public.profiles p on p.id = u.id
          where u.id = $1`,
        [req.userId],
      );
      return rows[0];
    });
    if (!titular) throw new ApiError(404, "Usuário não encontrado");

    const payload = buildOnboardingPayload(b, titular);

    let etherResult;
    try {
      etherResult = await createUserProfile(payload);
    } catch (error) {
      console.error("Ether recusou o cadastro do cliente", {
        userId: req.userId,
        detail: error?.body ?? String(error),
      });
      throw new ApiError(502, "Não foi possível iniciar o cadastro. Verifique os dados e tente novamente.");
    }

    const etherUserId = etherResult.userId ?? etherResult.id;
    if (!etherUserId) {
      throw new ApiError(502, "Ether não retornou ID do usuário");
    }

    // Aceite de termos e declaração de PEP são exigidos antes da análise. Uma
    // falha aqui não invalida o cadastro já criado — registramos e seguimos,
    // para o cliente poder reenviar sem recriar o cadastro do zero.
    for (const [etapa, fn] of [
      ["accept-terms", () => acceptTerms(etherUserId, { userAgent: req.headers["user-agent"] })],
      ["pep-declaration", () => submitPepDeclaration(etherUserId)],
    ]) {
      try {
        await fn();
      } catch (error) {
        console.error(`Ether recusou ${etapa}`, {
          userId: req.userId,
          etherUserId,
          detail: error?.body ?? String(error),
        });
      }
    }

    // Grava o vínculo no banco (service_role pode escrever ether_*).
    await withService(async (client) => {
      await client.query(
        `update public.profiles
            set ether_user_id = $2, ether_account_status = $3, tax_id = $4, phone = $5
          where id = $1`,
        [req.userId, etherUserId, toLocalStatus(etherResult.status), b.taxId, b.phone],
      );
    });

    // `documentChecklist.pending` (ex.: CARTEIRA_IDENTIDADE, COMPROVANTE_RESIDENCIA,
    // SELFIE_COM_DOC) diz ao frontend quais documentos pedir. Antes era
    // descartado; null se a Ether não devolver.
    res.status(201).json({
      ether_user_id: etherUserId,
      status: etherResult.status ?? "pending_documents",
      document_checklist: etherResult.documentChecklist ?? null,
      message: "Cadastro iniciado. Envie os documentos de KYC para liberar a conta.",
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
      const localStatus = etherStatus?.status ? toLocalStatus(etherStatus.status) : null;
      if (localStatus && localStatus !== profile.ether_account_status) {
        const { withService } = await import("../db.js");
        await withService(async (client) => {
          await client.query(
            `update public.profiles set ether_account_status = $2 where id = $1`,
            [req.userId, localStatus],
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
