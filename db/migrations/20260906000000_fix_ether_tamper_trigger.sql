-- ============================================================================
-- Migration: corrige o trigger que protege profiles.ether_*
-- ============================================================================
-- Problema (20260901000000_ether_subaccounts.sql): o trigger decidia quem é
-- "serviço" lendo a GUC `request.jwt.claim.role`. Nenhum código da API seta essa
-- GUC (withService() só faz SET LOCAL ROLE service_role), então o ramo nunca
-- entrava e o UPDATE de ether_user_id no onboarding sempre estourava, deixando
-- conta órfã na Ether.
--
-- Correção: usar a identidade REAL do Postgres (current_user), não uma GUC.
-- Uma GUC é um valor arbitrário gravável por qualquer código da transação
-- (set_config); apoiar autorização nela transformaria qualquer set_config
-- futuro em bypass. current_user só muda por SET ROLE, que exige membership.
--
-- Decisões:
--  * SECURITY INVOKER (antes era DEFINER): em função DEFINER, current_user
--    seria o dono da função, nunca o papel ativo do chamador. A função só
--    compara OLD/NEW, não precisa de privilégio elevado.
--  * `current_user = 'service_role'` (igualdade) em vez de
--    pg_has_role(..., 'member'): membership também é verdadeiro para a role de
--    login da API (livrepay_app, membro de authenticated e service_role) e
--    para qualquer role futura que receba service_role, além de superusuários.
--    A igualdade exige que o código tenha declarado SET ROLE service_role.
--  * Forward-only: não altera a migration anterior.
-- ============================================================================

create or replace function public.prevent_ether_field_tampering()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- service_role (assumida por withService()) grava após onboarding/webhook.
  if current_user = 'service_role' then
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
