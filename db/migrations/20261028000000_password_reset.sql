-- ============================================================================
-- LIVREPAY — Redefinição de senha ("esqueci a senha")
--
-- Token de uso único, enviado por e-mail. Guardamos só o SHA-256: vazamento da
-- tabela não dá acesso a nenhuma conta. Fica no schema `auth`, fora do alcance
-- de `authenticated`/`anon` (mesmo padrão de auth.refresh_tokens); a API só toca
-- nela sob service_role, dentro de authQuery().
-- ============================================================================

create table if not exists auth.password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists password_reset_tokens_user_idx
  on auth.password_reset_tokens (user_id) where used_at is null;

-- RLS ligada sem nenhuma policy: negado por padrão para qualquer role comum.
-- service_role tem BYPASSRLS (é a única com GRANT abaixo).
alter table auth.password_reset_tokens enable row level security;

revoke all on auth.password_reset_tokens from anon, authenticated;
grant select, insert, update on auth.password_reset_tokens to service_role;
