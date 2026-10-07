-- Disposable fixture: append after cognitive + readonly issuer fixtures only.
create schema destruktion_meta;
grant usage on schema destruktion_meta to service_role;
alter table public.compute_fabric_a2_browser_device_h205f22
  add column access_tier text,add column admin_scopes jsonb,
  add column admin_grant_epoch bigint,add column admin_revoked_at timestamptz,
  add column key_fingerprint_sha256 text;
alter table public.compute_fabric_a2_browser_supervisor_state_h205f22
  add column armed boolean,add column supervisor_mode text;
create table destruktion_meta.devos_fleet_runtime_control_h205f22(
  workspace_id uuid primary key,generation_floor bigint,refill_enabled boolean,supervisor_admission_enabled boolean
);
create table public.compute_fabric_a2_supervisor_actuation_lease_h205f22(
  lease_id uuid primary key default gen_random_uuid(),workspace_id uuid,target_client_id text,
  holder_supervisor_instance_id text,effect_scope text,effect_key text,status text,command_id uuid,
  acquired_at timestamptz default clock_timestamp(),expires_at timestamptz,released_at timestamptz,
  release_reason text,authority_effect boolean default false check(authority_effect=false)
);
create unique index fixture_one_active_client_lease on public.compute_fabric_a2_supervisor_actuation_lease_h205f22(workspace_id,target_client_id) where status='ACTIVE';
-- Detect delegation to the original mesh path without importing historical DDL.
create function public.devos_fleet_transport_promotion_lease_v1(uuid,text,text,text,text,bigint,integer)
returns jsonb language sql as $$select '{"legacy_mesh_route":true}'::jsonb$$;
