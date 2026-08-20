-- ============================================================================
-- LIVREPAY — Fundação do painel administrativo (Fase 1)
--
-- Contexto: a correção de 2026-08-20 (fechar o auto-crédito via
-- /receivables/:id/advance) fez a antecipação de recebível DEPENDER de um
-- admin chamar verify_receivable() — mas não existia nenhum papel dedicado
-- pra isso nem interface. Esta migration cria o papel `compliance`, o fluxo
-- simétrico de recusa, e amplia a leitura (nunca a escrita de dinheiro) para
-- quem vai operar o painel.
--
-- Bootstrap do primeiro admin (manual — mesmo padrão de JWT_SECRET/Ether em
-- SECURITY.md, ninguém se autopromove por código):
--   insert into public.user_roles (user_id, role)
--   select id, 'admin' from auth.users where email = 'voce@livrepay.com'
--   on conflict do nothing;
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Papéis: renomeia 'operator' -> 'support' (mais claro) e adiciona
--    'compliance'. RENAME VALUE preserva quem já tinha a role.
-- ----------------------------------------------------------------------------
alter type public.app_role rename value 'operator' to 'support';
alter type public.app_role add value 'compliance';

-- ----------------------------------------------------------------------------
-- 2. Recebíveis: fluxo de recusa, simétrico ao de verificação.
-- ----------------------------------------------------------------------------
alter table public.receivables
  add column rejected_at timestamptz,
  add column rejected_by uuid references auth.users(id),
  add column rejection_reason text;

-- guard_receivable_verification (da migration anterior) protegia só
-- verified_at/verified_by; agora cobre também as colunas de rejeição.
create or replace function public.guard_receivable_verification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.verified_at is distinct from old.verified_at
      or new.verified_by is distinct from old.verified_by
      or new.rejected_at is distinct from old.rejected_at
      or new.rejected_by is distinct from old.rejected_by
      or new.rejection_reason is distinct from old.rejection_reason)
     and not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'compliance')) then
    raise exception 'Apenas admin/compliance pode alterar a verificação de um recebível';
  end if;
  return new;
end;
$$;

-- verify_receivable() também passa a aceitar compliance, não só admin.
create or replace function public.verify_receivable(_receivable_id uuid)
returns public.receivables
language plpgsql
security definer
set search_path = public
as $$
declare
  _receivable public.receivables%rowtype;
begin
  if not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'compliance')) then
    raise exception 'Apenas admin/compliance pode verificar recebíveis';
  end if;

  update public.receivables
  set verified_at = now(), verified_by = auth.uid()
  where id = _receivable_id
  returning * into _receivable;

  if not found then
    raise exception 'Recebível % não encontrado', _receivable_id;
  end if;

  return _receivable;
end;
$$;

create or replace function public.reject_receivable(_receivable_id uuid, _reason text)
returns public.receivables
language plpgsql
security definer
set search_path = public
as $$
declare
  _receivable public.receivables%rowtype;
begin
  if not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'compliance')) then
    raise exception 'Apenas admin/compliance pode recusar recebíveis';
  end if;

  if _reason is null or btrim(_reason) = '' then
    raise exception 'Informe o motivo da recusa';
  end if;

  update public.receivables
  set status = 'cancelled',
      rejected_at = now(), rejected_by = auth.uid(), rejection_reason = _reason
  where id = _receivable_id
    and status in ('scheduled', 'overdue')
  returning * into _receivable;

  if not found then
    raise exception 'Recebível % não encontrado ou não pode mais ser recusado', _receivable_id;
  end if;

  return _receivable;
end;
$$;

revoke all on function public.reject_receivable(uuid, text) from public, anon;
grant execute on function public.reject_receivable(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Leitura ampla pro staff — nunca escrita de dinheiro. RLS combina
--    policies permissivas com OR: a policy do dono continua valendo para o
--    cliente, esta é adicional.
-- ----------------------------------------------------------------------------
create policy "receivables: staff le todos"
  on public.receivables for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'compliance'));

alter policy "provider_events: apenas admin le" on public.provider_events
  using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'compliance'));

alter policy "audit_log: apenas admin lê" on public.audit_log
  using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'compliance'));

-- ----------------------------------------------------------------------------
-- 4. Listagem de usuários para o painel — precisa de auth.users (e-mail), e
--    esse schema é inacessível a `authenticated` por design (SECURITY.md:
--    "Senhas isoladas"). Em vez de abrir o schema auth, uma função
--    SECURITY DEFINER que já checa a role, igual ao resto do arquivo.
-- ----------------------------------------------------------------------------
create or replace function public.admin_list_users()
returns table (
  id uuid,
  full_name text,
  phone text,
  email text,
  roles text[]
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'compliance')) then
    raise exception 'Apenas admin/compliance pode listar usuários';
  end if;

  return query
    select p.id, p.full_name, p.phone, u.email,
           coalesce(array_agg(r.role::text) filter (where r.role is not null), '{}')
      from public.profiles p
      join auth.users u on u.id = p.id
      left join public.user_roles r on r.user_id = p.id
     group by p.id, u.email
     order by p.full_name;
end;
$$;

revoke all on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;
