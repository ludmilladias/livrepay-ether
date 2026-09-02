-- ============================================================================
-- Migration: vincular usuários do LivrePay a sub-contas na Ether
-- ============================================================================
-- A Ether exige que cada cliente final tenha sua própria conta individual
-- (não suporta conta pool). Estes campos rastreiam o vínculo entre o
-- usuário do LivrePay e a sub-conta correspondente na Ether.
--
-- Nenhum destes campos é editável pelo usuário: são gerenciados pela API
-- durante o onboarding (registro → onboarding Ether → KYC → FULL).
-- ============================================================================

alter table public.profiles
  add column if not exists ether_user_id uuid,
  add column if not exists ether_account_status text not null default 'pending'
    check (ether_account_status in ('pending', 'basic', 'full', 'rejected')),
  add column if not exists ether_pix_key text,
  add column if not exists ether_pix_key_type text
    check (ether_pix_key_type is null or ether_pix_key_type in ('CPF','CNPJ','EMAIL','PHONE','RANDOM'));

-- Índice para buscar usuário pelo ether_user_id quando o webhook chega.
create unique index if not exists profiles_ether_user_id_idx
  on public.profiles (ether_user_id) where ether_user_id is not null;

-- O usuário NÃO pode alterar ether_* por conta própria — a policy existente
-- "usuário atualiza o próprio" já bloqueia, mas reforçamos com um trigger que
-- impede UPDATE nos campos ether_* para roles não-service.
create or replace function public.prevent_ether_field_tampering()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- service_role pode tudo (é quem grava após onboarding/webhook).
  if current_setting('request.jwt.claim.role', true) = 'service_role' then
    return new;
  end if;

  if new.ether_user_id is distinct from old.ether_user_id
     or new.ether_account_status is distinct from old.ether_account_status
     or new.ether_pix_key is distinct from old.ether_pix_key
     or new.ether_pix_key_type is distinct from old.ether_pix_key_type then
    raise exception 'Campos ether_* não podem ser alterados pelo usuário';
  end if;

  return new;
end;
$$;

create trigger profiles_prevent_ether_tampering
  before update on public.profiles
  for each row execute function public.prevent_ether_field_tampering();

comment on column public.profiles.ether_user_id is
  'ID do usuário na Ether (sub-conta). NULL = ainda não fez onboarding.';
comment on column public.profiles.ether_account_status is
  'Status da conta na Ether: pending (sem onboarding), basic (KYC pendente), full (operacional), rejected.';
comment on column public.profiles.ether_pix_key is
  'Chave PIX registrada na Ether para esta sub-conta.';
comment on column public.profiles.ether_pix_key_type is
  'Tipo da chave PIX: CPF, CNPJ, EMAIL, PHONE ou RANDOM.';
