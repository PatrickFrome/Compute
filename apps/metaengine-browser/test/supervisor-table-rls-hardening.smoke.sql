\set ON_ERROR_STOP on

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create table public.compute_fabric_a2_supervisor_mesh_instance_h205f22 (id bigint primary key, value text);
create table public.compute_fabric_a2_supervisor_actuation_lease_h205f22 (id bigint primary key, value text);
create table public.compute_fabric_development_gate_policy_h205f22 (id bigint primary key, value text);

\ir ../../../supabase/migrations/20260831005000_h205f22_supervisor_table_rls_hardening_v1.sql

insert into public.compute_fabric_a2_supervisor_mesh_instance_h205f22 values (1, 'mesh');
insert into public.compute_fabric_a2_supervisor_actuation_lease_h205f22 values (1, 'lease');
insert into public.compute_fabric_development_gate_policy_h205f22 values (1, 'gate');

-- All three authority-bearing tables must have RLS enabled and no permissive policy.
do $$
declare
  enabled_count integer;
  policy_count integer;
begin
  select count(*) into enabled_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in (
      'compute_fabric_a2_supervisor_mesh_instance_h205f22',
      'compute_fabric_a2_supervisor_actuation_lease_h205f22',
      'compute_fabric_development_gate_policy_h205f22'
    )
    and c.relrowsecurity;
  if enabled_count <> 3 then
    raise exception 'expected RLS enabled on all supervisor tables, got %', enabled_count;
  end if;

  select count(*) into policy_count
  from pg_policies
  where schemaname = 'public'
    and tablename in (
      'compute_fabric_a2_supervisor_mesh_instance_h205f22',
      'compute_fabric_a2_supervisor_actuation_lease_h205f22',
      'compute_fabric_development_gate_policy_h205f22'
    );
  if policy_count <> 0 then
    raise exception 'expected no direct RLS policies, got %', policy_count;
  end if;
end $$;

-- Browser-facing roles must have no direct table privilege at all.
do $$
declare
  role_name text;
  table_name text;
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    foreach table_name in array array[
      'compute_fabric_a2_supervisor_mesh_instance_h205f22',
      'compute_fabric_a2_supervisor_actuation_lease_h205f22',
      'compute_fabric_development_gate_policy_h205f22'
    ] loop
      if has_table_privilege(role_name, format('public.%I', table_name), 'SELECT')
         or has_table_privilege(role_name, format('public.%I', table_name), 'INSERT')
         or has_table_privilege(role_name, format('public.%I', table_name), 'UPDATE')
         or has_table_privilege(role_name, format('public.%I', table_name), 'DELETE') then
        raise exception '% unexpectedly has direct privilege on %', role_name, table_name;
      end if;
    end loop;
  end loop;
end $$;

-- Trusted server role retains the intended maintenance/readback path.
set role service_role;
select * from public.compute_fabric_a2_supervisor_mesh_instance_h205f22 where id = 1;
update public.compute_fabric_a2_supervisor_actuation_lease_h205f22 set value = 'lease-ok' where id = 1;
insert into public.compute_fabric_development_gate_policy_h205f22 values (2, 'gate-ok');
delete from public.compute_fabric_development_gate_policy_h205f22 where id = 2;
reset role;

-- Exercise actual denial, not only catalog introspection.
\set ON_ERROR_STOP off
set role anon;
select * from public.compute_fabric_a2_supervisor_mesh_instance_h205f22;
\if :ERROR = 'false'
  \echo 'anon unexpectedly read supervisor table'
  \quit 1
\endif
rollback;
reset role;

set role authenticated;
update public.compute_fabric_a2_supervisor_actuation_lease_h205f22 set value = 'bad' where id = 1;
\if :ERROR = 'false'
  \echo 'authenticated unexpectedly mutated supervisor table'
  \quit 1
\endif
rollback;
reset role;
\set ON_ERROR_STOP on

select 'supervisor table RLS smoke passed' as result;
