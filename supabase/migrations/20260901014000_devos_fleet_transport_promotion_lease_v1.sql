-- METAENGINE DevOS pre-lease fleet transport promotion authority v1.
-- Branch-local only. No production DDL from this convergence task.
--
-- Purpose: break the restart deadlock where Browser agents are deliberately restored as
-- BOUND_UNVERIFIED and therefore cannot consume DevOS task leases. This reuses the existing
-- supervisor actuation-lease table and the existing native-supervisor heartbeat. It does not
-- add a scheduler, task lease owner, Browser proof source, or retry loop.

create or replace function public.devos_fleet_transport_promotion_lease_v1(
  p_workspace uuid,
  p_client text,
  p_agent text,
  p_tab text,
  p_target text,
  p_epoch bigint,
  p_seconds integer default 45
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_client text := left(trim(coalesce(p_client,'')),160);
  v_agent_id text := lower(trim(coalesce(p_agent,'')));
  v_tab_id text := left(trim(coalesce(p_tab,'')),160);
  v_target_id text := lower(trim(coalesce(p_target,'')));
  v_epoch bigint := coalesce(p_epoch,0);
  v_secs integer := greatest(20,least(90,coalesce(p_seconds,45)));
  v_now timestamptz := clock_timestamp();
  v_state public.compute_fabric_a2_browser_supervisor_state_h205f22%rowtype;
  v_fleet jsonb;
  v_agent jsonb;
  v_mesh jsonb;
  v_holder jsonb;
  v_holder_id text;
  v_holder_hash text;
  v_effect_key text;
  v_existing public.compute_fabric_a2_supervisor_actuation_lease_h205f22%rowtype;
  v_lease public.compute_fabric_a2_supervisor_actuation_lease_h205f22%rowtype;
begin
  if p_workspace is null or length(v_client)<1 then raise exception 'devos_transport_promotion_identity_required' using errcode='22023'; end if;
  if v_agent_id !~ '^agent_[a-z0-9-]{8,64}$' or length(v_tab_id)<4 or v_target_id !~ '^webcontents:[1-9][0-9]*$' or v_epoch<1 then
    raise exception 'devos_transport_promotion_binding_invalid' using errcode='22023';
  end if;
  v_effect_key := 'fleet.transport-promotion:' || v_agent_id;

  perform pg_advisory_xact_lock(hashtextextended('devos-transport-promotion:'||p_workspace::text||':'||v_client,0));

  update public.compute_fabric_a2_supervisor_actuation_lease_h205f22
     set status='EXPIRED', released_at=v_now, release_reason='TTL_EXPIRED'
   where workspace_id=p_workspace and target_client_id=v_client and status='ACTIVE' and expires_at<=v_now;

  select * into v_existing
    from public.compute_fabric_a2_supervisor_actuation_lease_h205f22
   where workspace_id=p_workspace and target_client_id=v_client and status='ACTIVE'
   order by acquired_at desc limit 1 for update;
  if found then
    if v_existing.effect_key=v_effect_key and v_existing.expires_at>v_now then
      return jsonb_build_object(
        'schema','metaengine.devos.transport-promotion-lease.v1','leased',true,'duplicate',true,
        'lease_id',v_existing.lease_id,'agent_id',v_agent_id,'tab_id',v_tab_id,'target_id',v_target_id,
        'agent_generation_epoch',v_epoch,'holder_supervisor_instance_id',v_existing.holder_supervisor_instance_id,
        'effect_scope',v_existing.effect_scope,'effect_key',v_existing.effect_key,'status',v_existing.status,
        'expires_at',v_existing.expires_at,'not_expired',true,'holder_verified',true,'target_verified',true,
        'automatic_retry_allowed',false,'authority_effect',false);
    end if;
    return jsonb_build_object(
      'schema','metaengine.devos.transport-promotion-lease.v1','leased',false,'reason','CLIENT_ACTUATION_LEASE_BUSY',
      'automatic_retry_allowed',false,'authority_effect',false);
  end if;

  select * into v_state
    from public.compute_fabric_a2_browser_supervisor_state_h205f22
   where workspace_id=p_workspace and client_id=v_client
   order by last_seen_at desc limit 1;
  if not found then raise exception 'devos_transport_promotion_supervisor_state_missing'; end if;
  if v_state.last_seen_at < v_now-interval '45 seconds' then raise exception 'devos_transport_promotion_supervisor_state_stale'; end if;
  if upper(coalesce(v_state.supervisor_mode,'OFF'))<>'CONTROL' or v_state.armed is distinct from true then
    raise exception 'devos_transport_promotion_control_required';
  end if;

  v_fleet := v_state.state->'fleet';
  if jsonb_typeof(v_fleet)<>'object'
     or v_fleet->>'schema'<>'metaengine.browser.fleet-snapshot.v1'
     or v_fleet->>'readiness_contract'<>'TRANSPORT_PROOF_REQUIRED'
     or jsonb_typeof(v_fleet->'agents')<>'array' then
    raise exception 'devos_transport_promotion_fleet_contract_invalid';
  end if;
  select a.value into v_agent from jsonb_array_elements(v_fleet->'agents') a(value)
   where lower(coalesce(a.value->>'agent_id',''))=v_agent_id limit 1;
  if not found then raise exception 'devos_transport_promotion_agent_missing'; end if;
  if v_agent->>'ownership'<>'FLEET_OWNED'
     or v_agent->>'lifecycle_state'<>'BOUND_UNVERIFIED'
     or v_agent->'transport_proof' is not null
     or coalesce((v_agent->>'authority_effect')::boolean,true)<>false
     or coalesce((v_agent->>'automatic_retry_allowed')::boolean,true)<>false then
    raise exception 'devos_transport_promotion_agent_not_admissible';
  end if;
  if v_agent->>'tab_id'<>v_tab_id
     or lower(coalesce(v_agent->>'target_id',''))<>v_target_id
     or coalesce((v_agent->>'generation_epoch')::bigint,0)<>v_epoch then
    raise exception 'devos_transport_promotion_binding_drift';
  end if;

  v_mesh := v_state.state->'supervisor_mesh'->'mesh';
  if jsonb_typeof(v_mesh)<>'object' or v_mesh->>'schema'<>'metaengine.supervisor-mesh.state.v1'
     or jsonb_typeof(v_mesh->'supervisors')<>'array' then
    raise exception 'devos_transport_promotion_mesh_missing';
  end if;
  v_holder_id := nullif(lower(trim(coalesce(v_mesh->>'preferred_supervisor_id',''))),'');
  if v_holder_id is not null then
    select s.value into v_holder from jsonb_array_elements(v_mesh->'supervisors') s(value)
     where lower(coalesce(s.value->>'supervisor_id',''))=v_holder_id
       and s.value->>'status'='ACTIVE' and s.value->>'tab_id' is not null
       and coalesce((s.value->>'authority_effect')::boolean,true)=false limit 1;
  end if;
  if v_holder is null then
    select s.value into v_holder from jsonb_array_elements(v_mesh->'supervisors') s(value)
     where s.value->>'status'='ACTIVE' and s.value->>'tab_id' is not null
       and coalesce((s.value->>'authority_effect')::boolean,true)=false
     order by case when coalesce((s.value->>'selected')::boolean,false) then 0 else 1 end,
              lower(s.value->>'supervisor_id') limit 1;
    v_holder_id := lower(coalesce(v_holder->>'supervisor_id',''));
  end if;
  if v_holder is null or v_holder_id !~ '^sup_[a-f0-9]{24}$' then raise exception 'devos_transport_promotion_active_holder_missing'; end if;
  v_holder_hash := lower(coalesce(v_holder->>'conversation_url_sha256',''));
  if v_holder_hash !~ '^[a-f0-9]{64}$' or v_holder_id <> 'sup_'||substr(v_holder_hash,1,24) then
    raise exception 'devos_transport_promotion_holder_binding_invalid';
  end if;
  if not exists (
    select 1 from public.compute_fabric_a2_supervisor_mesh_instance_h205f22 m
     where m.workspace_id=p_workspace and m.supervisor_instance_id=v_holder_id
       and m.conversation_url_sha256=v_holder_hash and m.authority_effect=false
  ) then raise exception 'devos_transport_promotion_holder_registry_missing'; end if;

  insert into public.compute_fabric_a2_supervisor_actuation_lease_h205f22(
    workspace_id,target_client_id,holder_supervisor_instance_id,effect_scope,effect_key,status,command_id,expires_at,authority_effect
  ) values (
    p_workspace,v_client,v_holder_id,'BROWSER_CLIENT_ACTUATION',v_effect_key,'ACTIVE',null,
    v_now+make_interval(secs=>v_secs),false
  ) returning * into v_lease;

  return jsonb_build_object(
    'schema','metaengine.devos.transport-promotion-lease.v1','leased',true,'duplicate',false,
    'lease_id',v_lease.lease_id,'agent_id',v_agent_id,'tab_id',v_tab_id,'target_id',v_target_id,
    'agent_generation_epoch',v_epoch,'holder_supervisor_instance_id',v_holder_id,
    'effect_scope',v_lease.effect_scope,'effect_key',v_lease.effect_key,'status',v_lease.status,
    'expires_at',v_lease.expires_at,'not_expired',true,'holder_verified',true,'target_verified',true,
    'automatic_retry_allowed',false,'authority_effect',false);
end;
$$;

create or replace function public.devos_fleet_transport_promotion_release_v1(
  p_workspace uuid,
  p_client text,
  p_lease uuid,
  p_agent text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_client text := left(trim(coalesce(p_client,'')),160);
  v_agent_id text := lower(trim(coalesce(p_agent,'')));
  v_effect_key text := 'fleet.transport-promotion:'||v_agent_id;
  v_row public.compute_fabric_a2_supervisor_actuation_lease_h205f22%rowtype;
begin
  select * into v_row from public.compute_fabric_a2_supervisor_actuation_lease_h205f22
   where lease_id=p_lease and workspace_id=p_workspace and target_client_id=v_client and effect_key=v_effect_key
   for update;
  if not found then raise exception 'devos_transport_promotion_release_not_found'; end if;
  if v_row.status='ACTIVE' then
    update public.compute_fabric_a2_supervisor_actuation_lease_h205f22
       set status='RELEASED',released_at=clock_timestamp(),release_reason='TRANSPORT_PROMOTION_COMPLETED'
     where lease_id=v_row.lease_id;
  end if;
  return jsonb_build_object(
    'schema','metaengine.devos.transport-promotion-release.v1','released',true,'lease_id',v_row.lease_id,
    'agent_id',v_agent_id,'prior_status',v_row.status,'automatic_retry_allowed',false,'authority_effect',false);
end;
$$;

revoke all on function public.devos_fleet_transport_promotion_lease_v1(uuid,text,text,text,text,bigint,integer) from public,anon,authenticated;
revoke all on function public.devos_fleet_transport_promotion_release_v1(uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.devos_fleet_transport_promotion_lease_v1(uuid,text,text,text,text,bigint,integer) to service_role;
grant execute on function public.devos_fleet_transport_promotion_release_v1(uuid,text,uuid,text) to service_role;
