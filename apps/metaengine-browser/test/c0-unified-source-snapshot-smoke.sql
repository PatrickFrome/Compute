create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema destruktion_meta;

create or replace function public.devos_roadmap_contract_v1()
returns jsonb language sql stable as $$ select '{"schema":"metaengine.devos.roadmap-contract.v1","roadmap_id":"metaengine-development-os-v1","authority_effect":false}'::jsonb $$;

create table public.compute_fabric_a2_browser_supervisor_state_h205f22 (
  client_id text primary key,
  workspace_id uuid not null,
  last_seen_at timestamptz not null,
  extension_version text,
  supervisor_mode text,
  armed boolean,
  state jsonb,
  authority_effect boolean not null default false
);

create table public.compute_fabric_a2_supervisor_mesh_instance_h205f22 (
  workspace_id uuid not null,
  supervisor_instance_id text not null,
  tab_id text,
  status text not null,
  priority integer not null,
  last_seen_at timestamptz not null,
  retired_at timestamptz,
  acquired_at timestamptz,
  authority_effect boolean not null default false
);

create table public.compute_fabric_a2_supervisor_actuation_lease_h205f22 (
  lease_id uuid primary key,
  workspace_id uuid not null,
  target_client_id text not null,
  holder_supervisor_instance_id text not null,
  effect_scope text not null,
  effect_key text not null,
  status text not null,
  command_id uuid,
  acquired_at timestamptz not null,
  expires_at timestamptz,
  released_at timestamptz,
  release_reason text,
  authority_effect boolean not null default true
);

\i supabase/migrations/20260831184800_compute_unified_source_snapshot_v1.sql

insert into public.compute_fabric_a2_browser_supervisor_state_h205f22 values
('client_exact','11111111-1111-4111-8111-111111111111',clock_timestamp(),'0.6.3-test','CONTROL',true,'{"supervisor_lifecycle":{"quiescent":false}}',false);

insert into public.compute_fabric_a2_supervisor_mesh_instance_h205f22
(workspace_id,supervisor_instance_id,tab_id,status,priority,last_seen_at,authority_effect)
values
('11111111-1111-4111-8111-111111111111','METAENGINE_SUPERVISOR','tab_exact','ACTIVE',100,clock_timestamp(),false),
('11111111-1111-4111-8111-111111111111','sup_lost',null,'LOST',10,clock_timestamp()-interval '1 minute',false);

insert into public.compute_fabric_a2_supervisor_actuation_lease_h205f22
(lease_id,workspace_id,target_client_id,holder_supervisor_instance_id,effect_scope,effect_key,status,acquired_at,expires_at,authority_effect)
values
('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','client_exact','METAENGINE_SUPERVISOR','BROWSER_CLIENT_ACTUATION','fleet.transport-promotion:agent_exact','ACTIVE',clock_timestamp(),clock_timestamp()+interval '5 minutes',true),
('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','client_exact','METAENGINE_SUPERVISOR','BROWSER_CLIENT_ACTUATION','old','ACTIVE',clock_timestamp()-interval '10 minutes',clock_timestamp()-interval '5 minutes',true);

DO $$
declare j jsonb;
begin
  j := public.h205f22_compute_unified_source_snapshot_v1('11111111-1111-4111-8111-111111111111');
  if j->>'schema' <> 'metaengine.compute-unified.source-snapshot.v1' then raise exception 'bad schema: %', j; end if;
  if j->>'authority_effect' <> 'false' then raise exception 'snapshot granted authority'; end if;
  if j#>>'{roadmap_contract,roadmap_id}' <> 'metaengine-development-os-v1' then raise exception 'roadmap missing: %', j; end if;
  if (j#>>'{browser_supervisor,stale}')::boolean is distinct from false then raise exception 'fresh browser marked stale: %', j; end if;
  if (j#>>'{supervisor_mesh,active_count}')::int <> 1 then raise exception 'mesh count wrong: %', j; end if;
  if (j#>>'{actuation_leases,active_unreleased_count}')::int <> 1 then raise exception 'lease count wrong: %', j; end if;
  if has_function_privilege('anon','public.h205f22_compute_unified_source_snapshot_v1(uuid)','EXECUTE') then raise exception 'anon execute unexpectedly granted'; end if;
  if has_function_privilege('authenticated','public.h205f22_compute_unified_source_snapshot_v1(uuid)','EXECUTE') then raise exception 'authenticated execute unexpectedly granted'; end if;
  if not has_function_privilege('service_role','public.h205f22_compute_unified_source_snapshot_v1(uuid)','EXECUTE') then raise exception 'service_role execute missing'; end if;
end $$;
