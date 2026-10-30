-- ============================================================================
-- LIVREPAY — Cofre de credenciais da Ether por cliente
--
-- Cada cliente final opera a própria conta na Ether com uma credencial de API
-- própria (clientId + clientSecret, escopo de usuário), gerada pela Ether a
-- partir do userId do cliente (suporte da Ether, 2026-10-30). A credencial do
-- tenant opera só a conta da LivrePay, nunca a de cliente.
--
-- O clientSecret é cifrado NO SERVIDOR (AES-256-GCM, chave em
-- ETHER_CREDENTIALS_KEY, fora do banco). Aqui só fica o texto cifrado: quem tiver
-- apenas uma cópia do banco não lê nenhum segredo.
--
-- Acesso: schema `vault` fora do alcance de anon/authenticated. Só service_role
-- (via withService, no servidor) lê e grava. RLS ligada sem policy de usuário:
-- negado por padrão para qualquer role comum; service_role tem BYPASSRLS.
-- ============================================================================

create schema if not exists vault;

revoke all on schema vault from public, anon, authenticated;
grant usage on schema vault to service_role;

create table if not exists vault.ether_credentials (
  id uuid primary key default gen_random_uuid(),
  -- Dono da credencial no LivrePay. Restrict: apagar o usuário exige revogar e
  -- tratar a credencial antes (conta encerrada com credencial viva é risco).
  user_id uuid not null references auth.users(id) on delete restrict,
  ether_user_id text not null,
  client_id text not null,
  secret_ciphertext bytea not null,
  secret_iv bytea not null,
  secret_tag bytea not null,
  key_version int not null default 1 check (key_version > 0),
  -- active: em uso. suspect: a Ether recusou (ex.: AUTH_KEY_001), não usar até
  -- revisar. revoked: substituída ou cancelada (histórico, nunca reativada).
  status text not null default 'active' check (status in ('active', 'suspect', 'revoked')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint ether_credentials_revoked_at check ((status = 'revoked') = (revoked_at is not null))
);

-- Uma credencial não revogada por cliente (a Ether também só mantém uma ativa).
create unique index if not exists ether_credentials_one_live_per_user
  on vault.ether_credentials (user_id) where status <> 'revoked';
-- Um cliente da Ether nunca ligado a dois usuários LivrePay ao mesmo tempo.
create unique index if not exists ether_credentials_one_live_per_ether_user
  on vault.ether_credentials (ether_user_id) where status <> 'revoked';

alter table vault.ether_credentials enable row level security;

revoke all on vault.ether_credentials from public, anon, authenticated;
-- Sem DELETE: o histórico de credenciais fica (auditoria).
grant select, insert, update on vault.ether_credentials to service_role;

-- O segredo e a identidade da credencial são imutáveis: trocar credencial é
-- revogar a antiga e inserir outra. UPDATE só muda status/revoked_at.
create or replace function vault.forbid_credential_identity_change()
returns trigger
language plpgsql
as $$
begin
  if new.user_id is distinct from old.user_id
     or new.ether_user_id is distinct from old.ether_user_id
     or new.client_id is distinct from old.client_id
     or new.secret_ciphertext is distinct from old.secret_ciphertext
     or new.secret_iv is distinct from old.secret_iv
     or new.secret_tag is distinct from old.secret_tag
     or new.key_version is distinct from old.key_version
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'credencial imutável: revogue e cadastre outra';
  end if;
  if old.status = 'revoked' and new.status <> 'revoked' then
    raise exception 'credencial revogada não pode ser reativada';
  end if;
  return new;
end;
$$;

create trigger ether_credentials_immutable
  before update on vault.ether_credentials
  for each row execute function vault.forbid_credential_identity_change();

-- Auditoria SEM o segredo (a write_audit genérica gravaria a linha inteira,
-- inclusive o texto cifrado). Quem fez: auth.uid() se houver, senão created_by.
create or replace function vault.write_credential_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log (user_id, action, table_name, record_id, old_data, new_data)
  values (
    coalesce(auth.uid(), new.created_by),
    tg_op,
    'vault.ether_credentials',
    new.id,
    case when tg_op = 'UPDATE' then jsonb_build_object('status', old.status) end,
    jsonb_build_object(
      'user_id', new.user_id,
      'ether_user_id', new.ether_user_id,
      'client_id', new.client_id,
      'status', new.status,
      'key_version', new.key_version,
      'revoked_at', new.revoked_at
    )
  );
  return new;
end;
$$;

create trigger audit_ether_credentials
  after insert or update on vault.ether_credentials
  for each row execute function vault.write_credential_audit();
