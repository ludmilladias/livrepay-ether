import { Router } from "express";
import { z } from "zod";
import { withService, withUser } from "../db.js";
import { ApiError, asyncRoute, requireAuth, requireRole, validate } from "../middleware.js";
import { runProviderEvent } from "./webhook.js";
import { authenticateClient, EtherError, getBankAccountDetails } from "../ether.js";
import { revokeCredential, storeCredential } from "../etherCredentials.js";

export const adminRouter = Router();

// Toda rota daqui exige estar logado E ter ao menos uma das roles de staff.
// A leitura ampla (ver dado de outros usuários) é garantida pelas policies
// "staff le todos" / "apenas admin lê" no banco — isto aqui é só roteamento.
adminRouter.use(requireAuth, requireRole("admin", "compliance"));

// --- Visão geral -------------------------------------------------------------

adminRouter.get(
  "/overview",
  asyncRoute(async (req, res) => {
    const counts = await withUser(req.userId, async (client) => {
      const [pendingReceivables, failedEvents, users] = await Promise.all([
        client.query(
          `select count(*)::int as n from public.receivables
            where status in ('scheduled','overdue') and verified_at is null`,
        ),
        client.query(
          `select count(*)::int as n from public.provider_events where error is not null`,
        ),
        // profiles só tem policy "usuário lê o próprio" — sem admin_list_users()
        // (SECURITY DEFINER) isto contaria só a própria conta do admin.
        client.query(`select count(*)::int as n from public.admin_list_users()`),
      ]);
      return {
        pending_receivables: pendingReceivables.rows[0].n,
        provider_events_with_error: failedEvents.rows[0].n,
        total_users: users.rows[0].n,
      };
    });
    res.json(counts);
  }),
);

// --- Volume (gráfico do dashboard admin) -------------------------------------
//
// Agrega public.transactions de TODOS os usuários por dia, últimos 30 dias.
// Até 2026-10-06 isto era uma query direta que dependia de uma policy RLS de
// staff em `transactions` — essa policy vazava o MESMO acesso amplo para as
// rotas pessoais /reports/statement e /reports/financials (RLS vale por
// sessão/role, não por rota). Corrigido (20260906010000): a policy foi
// removida e a agregação agora só existe via admin_transactions_volume(),
// SECURITY DEFINER que checa role internamente — não reintroduza a query
// direta nem a policy sem reler aquela migration.
adminRouter.get(
  "/reports/volume",
  asyncRoute(async (req, res) => {
    const rows = await withUser(req.userId, async (client) => {
      const result = await client.query(`select * from public.admin_transactions_volume()`);
      return result.rows;
    });
    res.json(rows);
  }),
);

// --- Verificação de recebíveis -----------------------------------------------
//
// Lista recebíveis pendentes de TODOS os usuários. Até 2026-10-06 isto era
// uma query direta que dependia de uma policy RLS de staff em `receivables`
// — essa policy vazava o MESMO acesso amplo para as rotas pessoais
// GET /receivables e GET /receivables/summary (RLS vale por sessão/role, não
// por rota). Corrigido (20261006000000): a policy foi removida e a listagem
// agora só existe via admin_receivables_list(), SECURITY DEFINER que checa
// role internamente — não reintroduza a query direta nem a policy sem reler
// aquela migration (mesmo padrão de /admin/reports/volume acima).
adminRouter.get(
  "/receivables",
  asyncRoute(async (req, res) => {
    const rows = await withUser(req.userId, async (client) => {
      const result = await client.query(`select * from public.admin_receivables_list()`);
      return result.rows;
    });
    res.json(rows);
  }),
);

adminRouter.post(
  "/receivables/:id/verify",
  asyncRoute(async (req, res) => {
    const result = await withUser(req.userId, async (client) => {
      // "select * from fn(...)" — nunca "select (fn(...)).*", que chama a
      // função uma vez por coluna (ver comentário em routes/receivables.js).
      const { rows } = await client.query(`select * from public.verify_receivable($1)`, [
        req.params.id,
      ]);
      return rows[0];
    });
    res.json(result);
  }),
);

const rejectBody = z.object({
  reason: z.string().trim().min(3, "Informe o motivo da recusa").max(500),
});

adminRouter.post(
  "/receivables/:id/reject",
  validate(rejectBody),
  asyncRoute(async (req, res) => {
    const result = await withUser(req.userId, async (client) => {
      const { rows } = await client.query(`select * from public.reject_receivable($1, $2)`, [
        req.params.id,
        req.body.reason,
      ]);
      return rows[0];
    });
    res.json(result);
  }),
);

// --- Eventos do provedor -----------------------------------------------------

adminRouter.get(
  "/provider-events",
  asyncRoute(async (req, res) => {
    const onlyErrors = req.query.onlyErrors === "true";
    const rows = await withUser(req.userId, async (client) => {
      const result = await client.query(
        `select id, provider, event_id, event_type, payload, processed_at, error, received_at
           from public.provider_events
          where ($1::boolean is false or error is not null)
          order by received_at desc
          limit 200`,
        [onlyErrors],
      );
      return result.rows;
    });
    res.json(rows);
  }),
);

adminRouter.post(
  "/provider-events/:id/reprocess",
  asyncRoute(async (req, res) => {
    const event = await withUser(req.userId, async (client) => {
      const { rows } = await client.query(
        `select id, event_type, payload from public.provider_events where id = $1`,
        [req.params.id],
      );
      return rows[0];
    });

    if (!event) throw new ApiError(404, "Evento não encontrado");

    // Mesma extração que o webhook faz do envelope bruto — ver webhook.js.
    const payload = event.payload?.data?.data ?? {};
    const result = await runProviderEvent(event.id, {
      eventType: event.event_type,
      payload,
      eventId: event.payload?.id ?? event.id,
    });
    res.json(result);
  }),
);

// --- Auditoria ----------------------------------------------------------------

adminRouter.get(
  "/audit-log",
  asyncRoute(async (req, res) => {
    const table = typeof req.query.table === "string" ? req.query.table : null;
    const limit = Math.min(Number(req.query.limit) || 100, 500);

    const rows = await withUser(req.userId, async (client) => {
      const result = await client.query(
        `select id, user_id, action, table_name, record_id, old_data, new_data, created_at
           from public.audit_log
          where ($1::text is null or table_name = $1)
          order by created_at desc
          limit $2`,
        [table, limit],
      );
      return result.rows;
    });
    res.json(rows);
  }),
);

// --- Usuários e papéis --------------------------------------------------------

adminRouter.get(
  "/users",
  asyncRoute(async (req, res) => {
    // auth.users (e-mail) é inacessível a `authenticated` por design — a
    // checagem de role e o join com o schema auth vivem dentro da função.
    const rows = await withUser(req.userId, async (client) => {
      const result = await client.query(`select * from public.admin_list_users()`);
      return result.rows;
    });
    res.json(rows);
  }),
);

const roleParam = z.object({ role: z.enum(["admin", "compliance", "support", "viewer"]) });

// Só admin gerencia papel de outros usuários — compliance não promove ninguém.
adminRouter.post(
  "/users/:id/roles",
  requireRole("admin"),
  validate(roleParam),
  asyncRoute(async (req, res) => {
    await withUser(req.userId, async (client) => {
      await client.query(
        `insert into public.user_roles (user_id, role) values ($1, $2)
         on conflict (user_id, role) do nothing`,
        [req.params.id, req.body.role],
      );
    });
    res.status(204).end();
  }),
);

adminRouter.delete(
  "/users/:id/roles/:role",
  requireRole("admin"),
  asyncRoute(async (req, res) => {
    const parsed = roleParam.shape.role.safeParse(req.params.role);
    if (!parsed.success) throw new ApiError(400, "Role inválida");

    await withUser(req.userId, async (client) => {
      await client.query(`delete from public.user_roles where user_id = $1 and role = $2`, [
        req.params.id,
        parsed.data,
      ]);
    });
    res.status(204).end();
  }),
);

// --- Credenciais da Ether por cliente ----------------------------------------
//
// A Ether gera um clientId/clientSecret por cliente final (a partir do userId
// dele) e entrega por canal seguro. Um ADMIN cola o par aqui; o servidor confere
// com a PRÓPRIA credencial de quem ela é, e só então cifra e guarda no cofre.
// O segredo nunca volta em resposta, nem em log.
//
// withService aqui é deliberado: é ação de admin (requireRole("admin"), checado
// no banco) que precisa ler o perfil de OUTRO usuário e escrever no cofre, que só
// service_role alcança. Nunca é usado para servir dado ao próprio requisitante.

const onlyDigits = (v) => String(v ?? "").replace(/\D/g, "");

const credentialBody = z.object({
  etherUserId: z.string().trim().uuid("userId da Ether inválido (copie o ID da URL do cliente no backoffice)"),
  clientId: z.string().trim().min(4).max(200),
  clientSecret: z.string().min(8).max(500),
});

adminRouter.get(
  "/ether-credentials",
  requireRole("admin"),
  asyncRoute(async (_req, res) => {
    const rows = await withService(async (client) => {
      const result = await client.query(
        `select c.user_id, c.ether_user_id, c.client_id, c.status, c.created_at, c.revoked_at
           from vault.ether_credentials c
          where c.status <> 'revoked'
          order by c.created_at desc`,
      );
      return result.rows;
    });
    res.json(rows);
  }),
);

adminRouter.post(
  "/users/:id/ether-credential",
  requireRole("admin"),
  validate(credentialBody),
  asyncRoute(async (req, res) => {
    const targetUserId = req.params.id;
    const { etherUserId, clientId, clientSecret } = req.body;

    const profile = await withService(async (client) => {
      const { rows } = await client.query(
        `select id, tax_id, ether_user_id from public.profiles where id = $1`,
        [targetUserId],
      );
      return rows[0];
    });
    if (!profile) throw new ApiError(404, "Usuário não encontrado");
    if (profile.ether_user_id && profile.ether_user_id !== etherUserId) {
      throw new ApiError(
        409,
        "Este usuário já está ligado a outro cliente da Ether. Confira o ID antes de continuar.",
        "ETHER_USER_MISMATCH",
      );
    }

    // Prova de posse: autentica com a credencial recebida e pergunta de quem é a conta.
    let details;
    try {
      const auth = await authenticateClient(clientId, clientSecret);
      details = await getBankAccountDetails(auth.token);
    } catch (error) {
      console.error("Credencial de cliente não validou na Ether", {
        targetUserId,
        status: error instanceof EtherError ? error.status : undefined,
      });
      throw new ApiError(
        422,
        "A Ether não aceitou esta credencial. Confira o clientId e o clientSecret recebidos.",
        "ETHER_CREDENTIAL_INVALID",
      );
    }

    const etherUser = details?.user ?? {};
    if (etherUser.id !== etherUserId) {
      throw new ApiError(
        422,
        "Esta credencial pertence a outro cliente da Ether, não ao ID informado.",
        "ETHER_CREDENTIAL_OWNER_MISMATCH",
      );
    }
    const etherTaxId = onlyDigits(etherUser.userProfiles?.[0]?.taxId);
    const localTaxId = onlyDigits(profile.tax_id);
    if (localTaxId && etherTaxId && localTaxId !== etherTaxId) {
      throw new ApiError(
        422,
        "O CPF/CNPJ do cliente na Ether não bate com o do usuário na LivrePay.",
        "ETHER_CREDENTIAL_TAXID_MISMATCH",
      );
    }

    const saved = await storeCredential({
      userId: targetUserId,
      etherUserId,
      clientId,
      clientSecret,
      actorId: req.userId,
    });

    // Vínculo do perfil (se ainda não existia). ether_* só service_role escreve.
    if (!profile.ether_user_id) {
      await withService(async (client) => {
        await client.query(
          `update public.profiles set ether_user_id = $2 where id = $1 and ether_user_id is null`,
          [targetUserId, etherUserId],
        );
      });
    }

    console.log("ether_credential_stored", { targetUserId, etherUserId, actorId: req.userId });
    res.status(201).json({
      user_id: saved.user_id,
      ether_user_id: saved.ether_user_id,
      client_id: saved.client_id,
      status: saved.status,
      created_at: saved.created_at,
    });
  }),
);

adminRouter.post(
  "/users/:id/ether-credential/revoke",
  requireRole("admin"),
  asyncRoute(async (req, res) => {
    await revokeCredential(req.params.id);
    console.log("ether_credential_revoked", { targetUserId: req.params.id, actorId: req.userId });
    res.status(204).end();
  }),
);
