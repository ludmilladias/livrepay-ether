import { Router } from "express";
import { z } from "zod";
import { withUser } from "../db.js";
import { ApiError, asyncRoute, requireAuth, requireRole, validate } from "../middleware.js";
import { runProviderEvent } from "./webhook.js";

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
// Só existe dado aqui porque a migration 20260821010000 deu ao staff uma
// policy adicional de leitura ampla em transactions (nunca escrita — isso
// continua só pela RPC process_transaction()).
adminRouter.get(
  "/reports/volume",
  asyncRoute(async (req, res) => {
    const rows = await withUser(req.userId, async (client) => {
      const result = await client.query(
        `select day::date as day,
                coalesce(sum(amount_cents) filter (where type = 'credit'), 0)::bigint as in_cents,
                coalesce(sum(amount_cents) filter (where type = 'debit'), 0)::bigint as out_cents
           from generate_series(
                  date_trunc('day', now()) - interval '29 days',
                  date_trunc('day', now()),
                  interval '1 day'
                ) as day
           left join public.transactions t
             on date_trunc('day', t.created_at) = day
          group by day
          order by day`,
      );
      return result.rows;
    });
    res.json(rows);
  }),
);

// --- Verificação de recebíveis -----------------------------------------------

adminRouter.get(
  "/receivables",
  asyncRoute(async (req, res) => {
    const rows = await withUser(req.userId, async (client) => {
      const result = await client.query(
        `select r.*, c.name as contract_name, c.acquirer as contract_acquirer,
                p.full_name as owner_name
           from public.receivables r
           left join public.receivable_contracts c on c.id = r.contract_id
           left join public.profiles p on p.id = r.user_id
          where r.status in ('scheduled', 'overdue')
          order by r.verified_at is not null, r.due_date asc
          limit 200`,
      );
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
