# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

LivrePay: a fintech (banking-as-a-service style) app — accounts, PIX charges, PIX/boleto
payments, payroll batches, receivables anticipation, cards, insurance — built on **Postgres as
the primary security boundary**, not the API or the frontend. Read [SECURITY.md](SECURITY.md)
in full before touching anything that moves money, auth, or the Ether integration. Read
[PENDING.md](PENDING.md) for the current real state (what's wired to real data vs. still
generated placeholder screens).

## Commands

Root (frontend):
```bash
npm run dev              # Vite dev server
npm run build             # production build
npm run lint               # eslint
npm run typecheck          # tsc --noEmit
npm run db:test            # bash db/tests/run-tests.sh — see below
```

Database tests (`db/tests/run-tests.sh`): spins up a disposable `postgres:16-alpine` container,
applies every file in `db/migrations/` in filename order, then runs `db/tests/security_test.sql`
(numbered assertions `T1`, `T2`, `T2b`, `T3`... — each raises an exception with an explicit
message on failure). To run a single assertion while iterating, comment out the ones you don't
need in that file, or copy the relevant `do $$ ... $$;` block into `psql` against a scratch
database — there's no per-test filter flag.

Server (`server/`, separate `package.json`):
```bash
cd server
npm install
npm start                  # node src/index.js
npm run dev                 # node --watch src/index.js
npm run test:ether          # server/tests/ether.test.js — mocked fetch, no real Ether calls
```

End-to-end API test against the real stack:
```bash
docker compose up -d --build
bash server/tests/e2e.sh [base_url]   # defaults to http://localhost:8081
```
**This script executes real payment flows** (`POST /payments/:id/execute` for both a PIX
transfer and a boleto) against whatever `ETHER_*` credentials are in `.env`. Never run it against
production credentials without knowing that.

Full stack locally:
```bash
cp .env.example .env    # fill in passwords + JWT_SECRET (32+ chars) + Ether creds
docker compose up -d --build
npm run dev              # frontend against the dockerized API
```

There is no single top-level "run all tests" command — `db:test`, `server/tests/e2e.sh`, and
`server/npm run test:ether` are three separate suites for three separate layers.

## Architecture

**Three layers, each assuming the one before it can fail** (this is the load-bearing idea of the
whole codebase — see SECURITY.md's "Arquitetura" section):
1. Frontend (React/Vite/TS, `src/`) — UX convenience only. Route guards and disabled buttons are
   not security.
2. API (Node/Express, `server/src/`) — validates input (zod), authenticates (JWT), and forwards
   identity into the DB transaction. Does not itself decide what's allowed.
3. Postgres (`db/migrations/*.sql`) — RLS policies, `CHECK` constraints, and `SECURITY DEFINER`
   functions are the actual authorization layer. Everything else can have a bug; the DB is the
   backstop.

**How identity reaches the database** (`server/src/db.js`): every business-data query runs
inside `withUser(userId, fn)`, which opens a transaction, does
`select set_config('request.jwt.claim.sub', userId, true)` + `SET LOCAL ROLE authenticated`, then
runs `fn`. Postgres RLS policies read that GUC via `auth.uid()`. `withService(fn)` does the same
but as `service_role`, for operations a user legitimately cannot do themselves (crediting a
balance from a confirmed provider event, completing/failing a payment). **Never call
`withService` to serve a normal authenticated request** — it bypasses the RLS that protects every
other user.

**Money movement is centralized in a handful of `SECURITY DEFINER` SQL functions**, never raw
`UPDATE`/`INSERT` from the API:
- `process_transaction()` — the only thing that ever changes `accounts.balance_cents`; locks the
  row (`FOR UPDATE`), validates status/sufficient balance, writes both the balance and an
  append-only `transactions` ledger row in the same transaction. Its `EXECUTE` grant is
  intentionally narrow (see below) — most code reaches it only through a wrapper.
- `execute_payment()` / `execute_payment_batch()` — user-callable; debit *before* calling the
  provider (see "Pagamentos" in SECURITY.md for why: debiting only on confirmation would allow
  double-spend from concurrent requests).
- `provider_settle()` / `provider_confirm_charge()` / `provider_complete_payment()` /
  `provider_fail_payment()` / `advance_receivable()` / `verify_receivable()` — the only paths
  that can ever *credit* a balance. All are `SECURITY DEFINER`; all but `advance_receivable`/
  `verify_receivable` (which gate on `has_role(auth.uid(),'admin')` / a `verified_at` check
  instead) have `EXECUTE` revoked from `authenticated` entirely. If you add a new way to credit a
  balance, it needs the same treatment, or you've reopened the self-credit hole closed in
  `db/migrations/20260820000000_close_settlement_gaps.sql` — see SECURITY.md's "Barreira crítica:
  quem pode creditar".

**Provider integration** (`server/src/ether.js`, routes in `server/src/routes/{charges,payments,
webhook}.js`): the Ether Global Assets API (spec in `Ether Global Assets.json`, OpenAPI format)
is the bank rail behind PIX and boleto payment. Credentials never reach the browser (no
`VITE_*` env var holds a secret). The webhook (`POST /webhooks/ether`) authenticates by a shared
secret compared in constant time and is idempotent via a `unique(provider, event_id)` constraint
on `provider_events` — the payload is persisted *before* being processed, so a crash mid-processing
doesn't lose the event. Boleto payment amount is verified against the real value
(`simulateBoleto()`, an `isSimulation: true` call to Ether) before debiting — the digitable line
alone doesn't reliably expose the amount on our side.

**Migrations** (`db/migrations/*.sql`) run in filename-timestamp order, applied by both
`docker-compose.yml` (Postgres `docker-entrypoint-initdb.d`, alphabetical) and
`db/tests/run-tests.sh` (explicit loop). There's no down-migration tooling — schema changes are
forward-only; check `SECURITY.md`'s "Regras para evoluir o código" before adding a table (RLS
must be enabled in the same commit, with an explicit policy per operation).

**Frontend data fetching**: `@tanstack/react-query` hooks in `src/hooks/use-*.ts` wrap a thin
client in `src/lib/api.ts` (`api.get/post/patch`). Look at `src/hooks/use-payments.ts` for the
pattern (query key, mutation with `invalidateQueries` on success) before adding a new resource
hook.

**Known placeholder screens**: `src/pages/cartoes/*` and `src/pages/seguros/*` render fixed,
non-persisted arrays with no backing route (they carry a `PreviewBanner` saying so) — Cards and
Insurance have no real backend feature yet. Don't assume a page rendering data means the feature
is real; check for a corresponding router in `server/src/routes/` and a table in
`db/migrations/`.

## `.claude/` agent framework

This repo also has a `.claude/agents/` set of specialized subagents (tech lead, security
reviewer, compliance reviewer, data engineer, etc.) with a shared constitution/guardrails in
`.claude/governance/` and domain rules in `.claude/product/Domain-Rules.md`. If you're operating
as one of those named agents, its own `.md` file and the sources it lists take precedence over
this file for that persona's process; this file is the baseline for anyone working in the repo
directly.
