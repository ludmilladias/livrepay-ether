-- ============================================================================
-- LIVREPAY — Privilégios das roles de aplicação
--
-- Roda por último: concede acesso às tabelas criadas pelas migrations
-- anteriores. GRANT abre a porta; quem filtra linha a linha é a RLS.
--
-- IMPORTANTE: a API nunca deve conectar como dono das tabelas. Dono de tabela
-- ignora RLS por padrão — conectando como `livrepay_app` (não-dono) e fazendo
-- SET LOCAL ROLE, as policies valem de verdade.
-- ============================================================================

grant select, insert, update, delete on all tables in schema public
  to authenticated, service_role;
grant usage, select on all sequences in schema public
  to authenticated, service_role;

-- Tabelas criadas no futuro herdam os mesmos privilégios.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema public
  grant usage, select on sequences to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Role de login da API
-- ----------------------------------------------------------------------------
-- Criada fora das migrations (docker/initdb/zzz-app-role.sh no compose, ou
-- manualmente em produção) porque depende de uma senha que não se versiona.
-- Ela precisa apenas de:
--   create role <nome> login noinherit password '<senha forte>';
--   grant authenticated, service_role to <nome>;
--   grant usage on schema public to <nome>;
--
-- NOINHERIT é intencional: a role não usa nenhum privilégio sem um SET ROLE
-- explícito, o que obriga a API a declarar em qual contexto está operando.
