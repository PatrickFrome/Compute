-- A verified native device may bootstrap a Fleet-owned transport before a
-- supervisor conversation exists. It uses the SAME client actuation lease,
-- never fabricates a mesh member, and grants no task/scheduler authority.
create table public.compute_fabric_a2_native_bootstrap_binding_h205f22 (
  lease_id uuid primary key references public.compute_fabric_a2_supervisor_actuation_lease_h205f22(lease_id),
  workspace_id uuid not null,
  client_id text not null,
  device_id uuid not null references public.compute_fabric_a2_browser_device_h205f22(device_id),
  admin_grant_epoch bigint not null check (admin_grant_epoch > 0),
  agent_id text not null,
  tab_id text not null,
  target_id text not null,
  agent_generation_epoch bigint not null,
  created_at timestamptz not null default clock_timestamp(),
  authority_effect boolean not null default false check (authority_effect = false)
);
alter table public.compute_fabric_a2_native_bootstrap_binding_h205f22 enable row level security;
revoke all on public.compute_fabric_a2_native_bootstrap_binding_h205f22 from public, anon, authenticated;
grant select on public.compute_fabric_a2_native_bootstrap_binding_h205f22 to service_role;
create index a2_native_bootstrap_device_v1_idx on public.compute_fabric_a2_native_bootstrap_binding_h205f22(device_id);

create function public.devos_fleet_transport_promotion_lease_v2(
  p_workspace uuid, p_client text, p_device uuid, p_agent text,
  p_tab text, p_target text, p_epoch bigint, p_seconds integer default 45
) returns jsonb language plpgsql security definer set search_path = pg_catalog
as $function$
declare
  v_client text := trim(coalesce(p_client,''));
  v_agent text := lower(trim(coalesce(p_agent,'')));
  v_target text := lower(trim(coalesce(p_target,'')));
  v_control destruktion_meta.devos_fleet_runtime_control_h205f22%rowtype;
  v_device public.compute_fabric_a2_browser_device_h205f22%rowtype;
  v_state public.compute_fabric_a2_browser_supervisor_state_h205f22%rowtype;
  v_j jsonb;
  v_fleet jsonb;
  v_row jsonb;
  v_mesh jsonb;
  v_holder text;
  v_key text;
  v_existing public.compute_fabric_a2_supervisor_actuation_lease_h205f22%rowtype;
  v_binding public.compute_fabric_a2_native_bootstrap_binding_h205f22%rowtype;
  v_lease public.compute_fabric_a2_supervisor_actuation_lease_h205f22%rowtype;
  v_duplicate boolean := false;
  v_now timestamptz := clock_timestamp();
begin
  if p_workspace is null or p_device is null or length(v_client) not between 1 and 160
    or v_agent !~ '^agent_[a-z0-9-]{8,64}$'
    or coalesce(p_tab,'') !~ '^tab_[0-9a-f-]{36}$'
    or v_target !~ '^webcontents:[1-9][0-9]*$'
    or p_epoch is null or p_epoch not between 1 and 9007199254740991 then
    raise exception 'native_bootstrap_identity_invalid' using errcode='22023';
  end if;
  select * into v_device from public.compute_fabric_a2_browser_device_h205f22
    where device_id=p_device and client_id=v_client for share;
  if not found or v_device.active is distinct from true or v_device.revoked_at is not null
    or v_device.access_tier is distinct from 'ADMIN' or v_device.admin_revoked_at is not null
    or coalesce(v_device.admin_grant_epoch,0)<1
    or jsonb_typeof(v_device.admin_scopes) is distinct from 'array'
    or coalesce(v_device.key_fingerprint_sha256,'') !~ '^[a-f0-9]{64}$'
    or not coalesce(v_device.admin_scopes ? 'FLEET',false)
    or not coalesce(v_device.admin_scopes ? 'DEVOS',false) then
    raise exception 'native_bootstrap_device_authority_invalid' using errcode='22023';
  end if;
  select * into v_control from destruktion_meta.devos_fleet_runtime_control_h205f22
    where workspace_id=p_workspace for share;
  if not found or v_control.refill_enabled is distinct from true or v_control.supervisor_admission_enabled is distinct from true
    or p_epoch<v_control.generation_floor then
    raise exception 'native_bootstrap_admission_fenced' using errcode='22023';
  end if;
  select * into v_state from public.compute_fabric_a2_browser_supervisor_state_h205f22
    where client_id=v_client and workspace_id=p_workspace;
  if not found or v_state.last_seen_at is null or v_state.last_seen_at<v_now-interval '45 seconds'
    or v_state.armed is distinct from true or v_state.supervisor_mode is distinct from 'CONTROL' then
    raise exception 'native_bootstrap_runtime_fenced' using errcode='22023';
  end if;
  v_j := case when jsonb_typeof(v_state.state)='string' then (v_state.state #>> '{}')::jsonb else v_state.state end;
  if v_j->>'client_kind' is distinct from 'METAENGINE_BROWSER_ELECTRON_NATIVE'
    or v_j #>> '{transport_identity,device_id}' is distinct from p_device::text
    or v_j #>> '{transport_identity,key_fingerprint_sha256}' is distinct from v_device.key_fingerprint_sha256
    or v_j #>> '{transport_identity,admin_grant_epoch}' is distinct from v_device.admin_grant_epoch::text then
    raise exception 'native_bootstrap_runtime_identity_drift' using errcode='22023';
  end if;
  v_fleet := v_j->'fleet';
  if v_fleet->>'schema' is distinct from 'metaengine.browser.fleet-snapshot.v1'
    or v_fleet->>'readiness_contract' is distinct from 'TRANSPORT_PROOF_REQUIRED'
    or jsonb_typeof(v_fleet->'agents') is distinct from 'array' then
    raise exception 'native_bootstrap_fleet_invalid' using errcode='22023';
  end if;
  if (select count(*) from jsonb_array_elements(v_fleet->'agents') a
      where a->>'agent_id'=v_agent) <> 1 then
    raise exception 'native_bootstrap_agent_missing_or_ambiguous' using errcode='22023';
  end if;
  select a into v_row from jsonb_array_elements(v_fleet->'agents') a where a->>'agent_id'=v_agent;
  if v_row->>'ownership' is distinct from 'FLEET_OWNED'
    or v_row->>'lifecycle_state' is distinct from 'BOUND_UNVERIFIED'
    or v_row->'transport_proof' is distinct from 'null'::jsonb
    or v_row->'authority_effect' is distinct from 'false'::jsonb
    or v_row->'automatic_retry_allowed' is distinct from 'false'::jsonb
    or v_row->>'tab_id' is distinct from p_tab
    or v_row->>'target_id' is distinct from v_target
    or v_row->>'generation_epoch' is distinct from p_epoch::text then
    raise exception 'native_bootstrap_agent_binding_drift' using errcode='22023';
  end if;
  v_mesh := v_j #> '{supervisor_mesh,mesh}';
  if v_mesh->>'schema' is distinct from 'metaengine.supervisor-mesh.state.v1'
    or jsonb_typeof(v_mesh->'supervisors') is distinct from 'array' then
    raise exception 'native_bootstrap_mesh_invalid' using errcode='22023';
  end if;
  if jsonb_array_length(v_mesh->'supervisors')>0 then
    -- An existing/ambiguous conversation remains on the original verified path.
    return public.devos_fleet_transport_promotion_lease_v1(
      p_workspace,v_client,v_agent,p_tab,v_target,p_epoch,p_seconds);
  end if;

  v_holder := 'native_device:'||p_device::text||':'||v_device.admin_grant_epoch::text;
  v_key := 'fleet.transport-promotion:'||v_agent;
  perform pg_advisory_xact_lock(hashtextextended('devos-transport-promotion:'||p_workspace::text||':'||v_client,0));
  update public.compute_fabric_a2_supervisor_actuation_lease_h205f22
    set status='EXPIRED',released_at=v_now,release_reason='TTL_EXPIRED'
    where workspace_id=p_workspace and target_client_id=v_client and status='ACTIVE' and expires_at<=v_now;
  select * into v_existing from public.compute_fabric_a2_supervisor_actuation_lease_h205f22
    where workspace_id=p_workspace and target_client_id=v_client and status='ACTIVE'
    order by acquired_at desc limit 1 for update;
  if found then
    if v_existing.holder_supervisor_instance_id<>v_holder or v_existing.effect_key<>v_key then
      return jsonb_build_object('schema','metaengine.devos.transport-promotion-lease.v1',
        'leased',false,'reason','CLIENT_ACTUATION_LEASE_BUSY','automatic_retry_allowed',false,'authority_effect',false);
    end if;
    select * into v_binding from public.compute_fabric_a2_native_bootstrap_binding_h205f22 where lease_id=v_existing.lease_id;
    if not found or v_binding.workspace_id<>p_workspace or v_binding.client_id<>v_client
      or v_binding.device_id<>p_device or v_binding.admin_grant_epoch<>v_device.admin_grant_epoch
      or v_binding.agent_id<>v_agent or v_binding.tab_id<>p_tab or v_binding.target_id<>v_target
      or v_binding.agent_generation_epoch<>p_epoch then
      raise exception 'native_bootstrap_lease_binding_drift' using errcode='22023';
    end if;
    v_lease := v_existing;
    v_duplicate := true;
  else
    insert into public.compute_fabric_a2_supervisor_actuation_lease_h205f22(
      workspace_id,target_client_id,holder_supervisor_instance_id,effect_scope,effect_key,status,command_id,expires_at,authority_effect)
    values(p_workspace,v_client,v_holder,'BROWSER_CLIENT_ACTUATION',v_key,'ACTIVE',null,
      v_now+make_interval(secs=>greatest(20,least(90,coalesce(p_seconds,45)))),false) returning * into v_lease;
    insert into public.compute_fabric_a2_native_bootstrap_binding_h205f22(
      lease_id,workspace_id,client_id,device_id,admin_grant_epoch,agent_id,tab_id,target_id,agent_generation_epoch)
    values(v_lease.lease_id,p_workspace,v_client,p_device,v_device.admin_grant_epoch,v_agent,p_tab,v_target,p_epoch);
  end if;
  return jsonb_build_object('schema','metaengine.devos.transport-promotion-lease.v1',
    'leased',true,'duplicate',v_duplicate,'lease_id',v_lease.lease_id,
    'agent_id',v_agent,'tab_id',p_tab,'target_id',v_target,'agent_generation_epoch',p_epoch,
    'holder_supervisor_instance_id',v_holder,'holder_kind','NATIVE_DEVICE_BOOTSTRAP',
    'device_id',p_device,'admin_grant_epoch',v_device.admin_grant_epoch,
    'effect_scope',v_lease.effect_scope,'effect_key',v_key,'status',v_lease.status,
    'expires_at',v_lease.expires_at,'not_expired',true,'holder_verified',true,'target_verified',true,
    'task_leasing',false,'scheduler_authority',false,'automatic_retry_allowed',false,'authority_effect',false);
end;
$function$;
revoke all on function public.devos_fleet_transport_promotion_lease_v2(uuid,text,uuid,text,text,text,bigint,integer) from public,anon,authenticated;
grant execute on function public.devos_fleet_transport_promotion_lease_v2(uuid,text,uuid,text,text,text,bigint,integer) to service_role;
notify pgrst, 'reload schema';
