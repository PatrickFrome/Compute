\set ON_ERROR_STOP on

create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create schema if not exists public;

create or replace function public.coordination_read_barrier_h205f22()
returns jsonb
language sql
security definer
set search_path = public
as $$ select jsonb_build_object('authority_effect', false) $$;

create or replace function public.h205f22_a2_browser_supervisor_continue_if_needed_v1(uuid, text, jsonb)
returns jsonb
language sql
security definer
set search_path = public
as $$ select jsonb_build_object('advanced', false) $$;

create or replace function public.h205f22_a2_browser_supervisor_continuity_trigger_v1()
returns jsonb
language sql
security definer
set search_path = public
as $$ select jsonb_build_object('triggered', false) $$;

\ir ../../../supabase/migrations/20260830175500_h205f22_supervisor_rpc_acl_hardening_v1.sql

-- Catalog contract: all SECURITY DEFINER boundaries use an empty search_path.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as fn, p.proconfig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'coordination_read_barrier_h205f22',
         'h205f22_a2_browser_supervisor_continue_if_needed_v1',
         'h205f22_a2_browser_supervisor_continuity_trigger_v1'
       )
  loop
    if not ('search_path=""' = any(coalesce(r.proconfig, array[]::text[]))) then
      raise exception 'missing empty search_path on %: %', r.fn, r.proconfig;
    end if;
  end loop;
end $$;

-- Zero-authority read plane: authenticated + trusted service identity only.
set role authenticated;
select public.coordination_read_barrier_h205f22();
reset role;
set role service_role;
select public.coordination_read_barrier_h205f22();
reset role;

-- anon must fail closed on the read barrier.
do $$
begin
  begin
    execute 'set local role anon';
    perform public.coordination_read_barrier_h205f22();
    raise exception 'anon unexpectedly executed coordination read barrier';
  exception when insufficient_privilege then
    null;
  end;
end $$;

-- Effect-capable continuity RPCs must fail closed for browser/user roles.
do $$
declare
  role_name text;
begin
  foreach role_name in array array['anon','authenticated'] loop
    begin
      execute format('set local role %I', role_name);
      perform public.h205f22_a2_browser_supervisor_continuity_trigger_v1();
      raise exception '% unexpectedly executed continuity trigger', role_name;
    exception when insufficient_privilege then
      null;
    end;
  end loop;
end $$;

-- Trusted service identity retains intended execution.
set role service_role;
select public.h205f22_a2_browser_supervisor_continue_if_needed_v1(gen_random_uuid(), 'SMOKE', '{}'::jsonb);
select public.h205f22_a2_browser_supervisor_continuity_trigger_v1();
reset role;
