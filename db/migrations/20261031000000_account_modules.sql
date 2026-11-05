-- ============================================================================
-- LIVREPAY — Módulos habilitáveis por conta
--
-- Nem todo cliente contrata tudo. Cada módulo (ex.: 'crypto') é liberado por um
-- admin para uma conta específica. Sem linha ativa = módulo desligado.
--
-- Autorização no banco: o usuário só LÊ os próprios módulos; quem concede e
-- revoga é admin, via funções SECURITY DEFINER (não há INSERT/UPDATE direto
-- para `authenticated`). A API e o frontend consultam, mas quem decide é aqui.
-- Novo módulo = incluir o nome no CHECK abaixo (migration nova).
-- ============================================================================

create table public.account_modules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  module text not null check (module in ('crypto')),
  enabled_by uuid not null references auth.users(id),
  enabled_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id),
  constraint account_modules_revoke_pair check ((revoked_at is null) = (revoked_by is null))
);

-- Um módulo ativo por conta (histórico de revogações fica).
create unique index account_modules_one_active
  on public.account_modules (user_id, module) where revoked_at is null;

alter table public.account_modules enable row level security;

create policy "account_modules: dono le os seus"
  on public.account_modules for select to authenticated
  using (user_id = auth.uid());

create policy "account_modules: admin le todos"
  on public.account_modules for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

revoke all on public.account_modules from public, anon, authenticated;
grant select on public.account_modules to authenticated;
grant select, insert, update on public.account_modules to service_role;

create trigger audit_account_modules
  after insert or update on public.account_modules
  for each row execute function public.write_audit();

-- Consulta usada pela API (e por policies futuras de tabelas do módulo).
create or replace function public.has_module(_user_id uuid, _module text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.account_modules
     where user_id = _user_id and module = _module and revoked_at is null
  );
$$;

revoke all on function public.has_module(uuid, text) from public;
grant execute on function public.has_module(uuid, text) to authenticated, service_role;

create or replace function public.admin_set_module(_user_id uuid, _module text, _enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Apenas admin pode alterar módulos';
  end if;
  if not exists (select 1 from auth.users where id = _user_id) then
    raise exception 'Usuário não encontrado';
  end if;

  if _enabled then
    insert into public.account_modules (user_id, module, enabled_by)
    values (_user_id, _module, auth.uid())
    on conflict (user_id, module) where revoked_at is null do nothing;
  else
    update public.account_modules
       set revoked_at = now(), revoked_by = auth.uid()
     where user_id = _user_id and module = _module and revoked_at is null;
  end if;
end;
$$;

revoke all on function public.admin_set_module(uuid, text, boolean) from public, anon;
grant execute on function public.admin_set_module(uuid, text, boolean) to authenticated;
