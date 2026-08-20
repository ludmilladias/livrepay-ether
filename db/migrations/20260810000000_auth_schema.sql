-- ============================================================================
-- LIVREPAY — Schema de autenticação próprio (Postgres puro, sem Supabase)
--
-- Substitui o schema `auth` que o Supabase provia. Mantemos os MESMOS nomes
-- (auth.users, auth.uid()) de propósito: todas as policies de RLS e funções
-- das migrations seguintes continuam válidas sem alteração.
--
-- Como a identidade chega ao banco:
--   A API valida o JWT e, dentro de cada transação, executa
--     SELECT set_config('request.jwt.claim.sub', '<user-id>', true);
--     SET LOCAL ROLE authenticated;
--   O `true` em set_config torna o valor local à transação — obrigatório com
--   pool de conexões, senão a identidade vazaria de uma request para a outra.
-- ============================================================================

create schema if not exists auth;

-- ----------------------------------------------------------------------------
-- 1. Roles
-- ----------------------------------------------------------------------------
-- NOINHERIT: a role de login não ganha privilégio automático — precisa de
-- SET ROLE explícito. Evita que um bug na API rode com poder demais.
do $$ begin
  create role anon nologin noinherit;
exception when duplicate_object then null; end $$;

do $$ begin
  create role authenticated nologin noinherit;
exception when duplicate_object then null; end $$;

-- service_role tem BYPASSRLS: usada só pelo webhook/rotinas internas.
do $$ begin
  create role service_role nologin noinherit bypassrls;
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 2. Usuários
-- ----------------------------------------------------------------------------
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  -- bcrypt (nunca a senha em claro). Hash gerado pela API.
  password_hash text not null,
  email_confirmed_at timestamptz,
  last_sign_in_at timestamptz,
  -- Bloqueio temporário após tentativas de login malsucedidas.
  failed_login_attempts int not null default 0,
  locked_until timestamptz,
  raw_user_meta_data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_lowercase check (email = lower(email))
);

-- Sessões de refresh token: permitem revogar acesso sem esperar o JWT expirar.
create table if not exists auth.refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Guardamos apenas o SHA-256 do token: vazamento da tabela não dá acesso.
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists refresh_tokens_user_idx
  on auth.refresh_tokens (user_id) where revoked_at is null;

-- ----------------------------------------------------------------------------
-- 3. auth.uid() — identidade do requisitante
-- ----------------------------------------------------------------------------
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

-- ----------------------------------------------------------------------------
-- 4. Acesso ao schema auth
-- ----------------------------------------------------------------------------
-- `authenticated` NUNCA toca o schema auth: hashes de senha e refresh tokens
-- ficam fora do alcance de qualquer requisição de usuário final. Login e
-- cadastro rodam sob service_role, que a API assume explicitamente.
revoke all on schema auth from anon, authenticated;

grant usage on schema auth to service_role;
grant select, insert, update on auth.users to service_role;
grant select, insert, update, delete on auth.refresh_tokens to service_role;

grant usage on schema public to anon, authenticated, service_role;
