-- Client V1 ADMIN connectivity hardening.
--
-- Goals:
-- 1. Make the already device-signed Native Browser authority explicit as a
--    revocable ADMIN device grant. No master/service-role secret is stored in
--    the distributed client.
-- 2. Add one server-side state-merge RPC so the Edge can move its normal
--    heartbeat/control-plane traffic to PostgREST without holding direct
--    Postgres query sessions.
--
-- This does not add a second scheduler/control plane. The existing approved
-- device enrollment remains the trust root.

alter table public.compute_fabric_a2_browser_device_h205f22
  add column if not exists access_tier text not null default 'ADMIN',
  add column if not exists admin_scopes jsonb not null default
    '["CONTROL_PLANE","DEVOS","FLEET","SUPERVISOR","DIAGNOSTICS","RECOVERY","UPDATE","ROADMAP"]'::jsonb,
  add column if not exists admin_grant_epoch bigint not null default 1,
  add column if not exists admin_granted_at timestamptz not null default clock_timestamp(),
  add column if not exists admin_revoked_at timestamptz null;

alter table public.compute_fabric_a2_browser_device_h205f22
  drop constraint if exists compute_fabric_a2_browser_device_access_tier_ck;
alter table public.compute_fabric_a2_browser_device_h205f22
  add constraint compute_fabric_a2_browser_device_access_tier_ck
  check (access_tier in ('ADMIN','REVOKED'));

alter table public.compute_fabric_a2_browser_device_h205f22
  drop constraint if exists compute_fabric_a2_browser_device_admin_scopes_ck;
alter table public.compute_fabric_a2_browser_device_h205f22
  add constraint compute_fabric_a2_browser_device_admin_scopes_ck
  check (
    jsonb_typeof(admin_scopes)='array'
    and jsonb_array_length(admin_scopes) between 1 and 32
  );

alter table public.compute_fabric_a2_browser_device_h205f22
  drop constraint if exists compute_fabric_a2_browser_device_admin_epoch_ck;
alter table public.compute_fabric_a2_browser_device_h205f22
  add constraint compute_fabric_a2_browser_device_admin_epoch_ck
  check (admin_grant_epoch >= 1);

-- Existing approved Native Browser devices already had access to the same
-- device-signed privileged routes. This records that existing authority
-- explicitly rather than increasing it.
update public.compute_fabric_a2_browser_device_h205f22
   set access_tier='ADMIN',
       admin_scopes='["CONTROL_PLANE","DEVOS","FLEET","SUPERVISOR","DIAGNOSTICS","RECOVERY","UPDATE","ROADMAP"]'::jsonb,
       admin_grant_epoch=greatest(admin_grant_epoch,1),
       admin_granted_at=coalesce(admin_granted_at,enrolled_at),
       admin_revoked_at=null
 where active=true
   and revoked_at is null;


create or replace function public.client_v1_native_supervisor_state_merge_v1(
  p_client_id text,
  p_workspace_id uuid,
  p_extension_version text,
  p_operator_runtime text,
  p_supervisor_mode text,
  p_armed boolean,
  p_operator_mode text,
  p_ordering_policy text,
  p_last_command_id uuid,
  p_last_command_status text,
  p_state jsonb,
  p_authority_effect boolean
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_row public.compute_fabric_a2_browser_supervisor_state_h205f22%rowtype;
begin
  if p_client_id is null or char_length(p_client_id) < 1 or char_length(p_client_id) > 160
     or p_workspace_id is null
     or jsonb_typeof(p_state) <> 'object'
  then
    raise exception 'client_v1_supervisor_state_merge_invalid' using errcode='22023';
  end if;

  insert into public.compute_fabric_a2_browser_supervisor_state_h205f22 as target(
    client_id,workspace_id,last_seen_at,extension_version,operator_runtime,
    supervisor_mode,armed,operator_mode,ordering_policy,last_command_id,
    last_command_status,state,authority_effect
  ) values (
    p_client_id,p_workspace_id,v_now,
    nullif(left(coalesce(p_extension_version,''),64),''),
    nullif(left(coalesce(p_operator_runtime,''),96),''),
    nullif(left(coalesce(p_supervisor_mode,''),32),''),
    coalesce(p_armed,false),
    nullif(left(coalesce(p_operator_mode,''),32),''),
    nullif(left(coalesce(p_ordering_policy,''),96),''),
    p_last_command_id,
    nullif(left(coalesce(p_last_command_status,''),64),''),
    p_state,
    coalesce(p_authority_effect,false)
  )
  on conflict(client_id) do update set
    workspace_id=excluded.workspace_id,
    last_seen_at=excluded.last_seen_at,
    extension_version=excluded.extension_version,
    operator_runtime=excluded.operator_runtime,
    supervisor_mode=excluded.supervisor_mode,
    armed=excluded.armed,
    operator_mode=excluded.operator_mode,
    ordering_policy=excluded.ordering_policy,
    last_command_id=excluded.last_command_id,
    last_command_status=excluded.last_command_status,
    state=coalesce(target.state,'{}'::jsonb)||excluded.state,
    authority_effect=excluded.authority_effect
  returning * into v_row;

  return jsonb_build_object(
    'schema','metaengine.native-browser-supervisor.state-merge.v1',
    'accepted',true,
    'client_id',v_row.client_id,
    'workspace_id',v_row.workspace_id,
    'last_seen_at',v_row.last_seen_at,
    'authority_effect',false
  );
end;
$$;

revoke all on function public.client_v1_native_supervisor_state_merge_v1(
  text,uuid,text,text,text,boolean,text,text,uuid,text,jsonb,boolean
) from public, anon, authenticated;
grant execute on function public.client_v1_native_supervisor_state_merge_v1(
  text,uuid,text,text,text,boolean,text,text,uuid,text,jsonb,boolean
) to service_role;


create or replace function public.client_v1_device_admin_readback_v1(
  p_device_id uuid,
  p_client_id text,
  p_key_fingerprint_sha256 text
) returns jsonb
language sql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'schema','metaengine.client-v1.admin-device-readback.v1',
        'found',true,
        'device_id',d.device_id,
        'client_id',d.client_id,
        'profile',d.profile,
        'key_fingerprint_sha256',d.key_fingerprint_sha256,
        'access_tier',d.access_tier,
        'admin_scopes',d.admin_scopes,
        'admin_grant_epoch',d.admin_grant_epoch,
        'admin_granted_at',d.admin_granted_at,
        'admin_ready',(
          d.active=true
          and d.revoked_at is null
          and d.admin_revoked_at is null
          and d.access_tier='ADMIN'
        ),
        'master_secret_exposed',false,
        'service_role_exposed',false,
        'cloudflare_token_exposed',false,
        'automatic_retry_allowed',false,
        'authority_effect',false
      )
      from public.compute_fabric_a2_browser_device_h205f22 d
      where d.device_id=p_device_id
        and d.client_id=p_client_id
        and d.key_fingerprint_sha256=p_key_fingerprint_sha256
      limit 1
    ),
    jsonb_build_object(
      'schema','metaengine.client-v1.admin-device-readback.v1',
      'found',false,
      'device_id',p_device_id,
      'client_id',p_client_id,
      'admin_ready',false,
      'master_secret_exposed',false,
      'service_role_exposed',false,
      'cloudflare_token_exposed',false,
      'automatic_retry_allowed',false,
      'authority_effect',false
    )
  );
$$;

revoke all on function public.client_v1_device_admin_readback_v1(uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.client_v1_device_admin_readback_v1(uuid,text,text)
  to service_role;

comment on function public.client_v1_device_admin_readback_v1(uuid,text,text) is
  'Exact device-bound ADMIN grant readback for the Native Browser. Master infrastructure secrets never leave the server.';
