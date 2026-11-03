-- ============================================================================
-- LIVREPAY — Token de cadastro da Ether (recoveryToken) por cliente
--
-- POST /users/profile-data devolve um `recoveryToken` (JWT, scope
-- "registration_recovery", validade de 48 h). Teste real em 2026-11-03: com ele
-- a Ether ACEITA o aceite de termos e o upload de documentos do cliente; com a
-- credencial do tenant ela recusa (403 USR_PRM_004 / 404 USR_NOT_002). Até aqui o
-- token era descartado e nenhum cliente conseguia enviar documentos.
--
-- É uma credencial (dá acesso ao cadastro do cliente na Ether), então segue o
-- padrão do cofre (20261030000000_ether_credentials_vault.sql): cifrado NO
-- SERVIDOR com AES-256-GCM (chave ETHER_CREDENTIALS_KEY, fora do banco), schema
-- `vault` fora do alcance de anon/authenticated, só service_role lê e grava.
--
-- Diferente da credencial de cliente: é temporário e substituível. Uma linha por
-- usuário, sobrescrita a cada reenvio do cadastro; apagar é permitido (token
-- recusado pela Ether, conta apagada).
-- ============================================================================

create table if not exists vault.ether_registration_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  ether_user_id text not null,
  token_ciphertext bytea not null,
  token_iv bytea not null,
  token_tag bytea not null,
  key_version int not null default 1 check (key_version > 0),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table vault.ether_registration_tokens enable row level security;

revoke all on vault.ether_registration_tokens from public, anon, authenticated;
grant select, insert, update, delete on vault.ether_registration_tokens to service_role;
