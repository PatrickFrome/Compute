-- METAENGINE DevOS live CONTROL supervisor authority repair v1.
-- Branch-local only. Do not apply to production from this audit task.
--
-- The supervisor state row intentionally has authority_effect=true while CONTROL/armed.
-- Therefore row-level authority_effect is not a trust predicate. Trusted DevOS control state is
-- instead the authenticated native client row with CONTROL + armed, exact state/fleet schemas,
-- readiness contract, bounded freshness, and exact agent transport proof.

create or replace function public.devos_control_supervisor_snapshot_v1(
  p_workspace uuid,
  p_client text default null,
  p_fresh_seconds integer default 45
) returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public, destruktion_meta, pg_temp
as $$
declare
  v_client text := nullif(trim(coalesce(p_client,'')),'');
  v_state jsonb;
  v_seen timestamptz;
  v_row_client text;
  v_horizon integer := greatest(5, least(120, coalesce(p_fresh_seconds,45)));
begin
  if p_workspace is null then raise exception 'devos_control_workspace_required' using errcode='22023'; end if;
  if v_client is not null and (length(v_client)>160 or v_client ~ '[\x00-\x1f\x7f]') then
    raise exception 'devos_control_client_invalid' using errcode='22023';
  end if;

  select s.client_id,s.state,s.last_seen_at
    into v_row_client,v_state,v_seen
    from public.compute_fabric_a2_browser_supervisor_state_h205f22 s
   where s.workspace_id=p_workspace
     and (v_client is null or s.client_id=v_client)
     and s.supervisor_mode='CONTROL'
     and s.armed=true
     and s.state->>'schema'='metaengine.native-browser-supervisor.state.v1'
     and s.state->'fleet'->>'schema'='metaengine.browser.fleet-snapshot.v1'
     and s.state->'fleet'->>'readiness_contract'='TRANSPORT_PROOF_REQUIRED'
   order by s.last_seen_at desc
   limit 1;

  if not found then
    return jsonb_build_object('schema','metaengine.devos.control-supervisor-snapshot.v1','state','MISSING','workspace_id',p_workspace,'client_id',v_client,'fresh',false,'authority_effect',false);
  end if;
  if v_seen < clock_timestamp() - make_interval(secs=>v_horizon) then
    return jsonb_build_object('schema','metaengine.devos.control-supervisor-snapshot.v1','state','STALE','workspace_id',p_workspace,'client_id',v_row_client,'last_seen_at',v_seen,'fresh',false,'authority_effect',false);
  end if;
  return jsonb_build_object('schema','metaengine.devos.control-supervisor-snapshot.v1','state','FRESH_CONTROL','workspace_id',p_workspace,'client_id',v_row_client,'last_seen_at',v_seen,'fresh',true,'supervisor_state',v_state,'authority_effect',false);
end;
$$;

revoke all on function public.devos_control_supervisor_snapshot_v1(uuid,text,integer) from public, anon, authenticated;
grant execute on function public.devos_control_supervisor_snapshot_v1(uuid,text,integer) to service_role;

create or replace function destruktion_meta.devos_fleet_claim_transport_admission_h205f22()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, destruktion_meta, pg_temp
as $$
declare
  v_control jsonb;
  v_client_id text;
  v_supervisor_state jsonb;
  v_fleet jsonb;
  v_agent jsonb;
  v_proof jsonb;
  v_last_seen timestamptz;
  v_proven_at timestamptz;
  v_now timestamptz;
begin
  if new.state <> 'ACTIVE' then raise exception 'devos_transport_claim_state_invalid' using errcode='23514'; end if;

  v_control := public.devos_control_supervisor_snapshot_v1(new.workspace_id,null,45);
  if v_control->>'state' <> 'FRESH_CONTROL' then raise exception 'devos_transport_supervisor_snapshot_missing' using errcode='55000'; end if;
  v_client_id := v_control->>'client_id';
  if nullif(trim(coalesce(v_client_id,'')),'') is null then raise exception 'devos_transport_client_binding_missing' using errcode='55000'; end if;

  perform pg_advisory_xact_lock(hashtextextended('devos-transport-promotion:'||new.workspace_id::text||':'||v_client_id,0));
  v_now := clock_timestamp();

  -- Authority is re-read after the shared promotion lock to eliminate pre-lock TOCTOU.
  v_control := public.devos_control_supervisor_snapshot_v1(new.workspace_id,v_client_id,45);
  if v_control->>'state' <> 'FRESH_CONTROL' then raise exception 'devos_transport_supervisor_snapshot_missing_after_lock' using errcode='55000'; end if;
  v_supervisor_state := v_control->'supervisor_state';
  v_last_seen := (v_control->>'last_seen_at')::timestamptz;

  update public.compute_fabric_a2_supervisor_actuation_lease_h205f22
     set status='EXPIRED',released_at=v_now,release_reason='TTL_EXPIRED'
   where workspace_id=new.workspace_id and target_client_id=v_client_id
     and effect_scope='BROWSER_CLIENT_ACTUATION' and status='ACTIVE' and expires_at<=v_now;

  if exists(select 1 from public.compute_fabric_a2_supervisor_actuation_lease_h205f22 l
             where l.workspace_id=new.workspace_id and l.target_client_id=v_client_id
               and l.effect_scope='BROWSER_CLIENT_ACTUATION' and l.status='ACTIVE' and l.expires_at>v_now) then
    raise exception 'devos_transport_client_actuation_lease_active' using errcode='55000';
  end if;

  v_fleet := v_supervisor_state->'fleet';
  if jsonb_typeof(v_fleet->'agents')<>'array' or jsonb_array_length(v_fleet->'agents')>64 then
    raise exception 'devos_transport_fleet_agents_invalid' using errcode='22023';
  end if;
  select a.value into v_agent from jsonb_array_elements(v_fleet->'agents') a(value)
   where lower(coalesce(a.value->>'agent_id',''))=lower(new.agent_id) limit 1;
  if not found then raise exception 'devos_transport_agent_missing' using errcode='55000'; end if;
  if v_agent->>'ownership'<>'FLEET_OWNED' or v_agent->>'lifecycle_state'<>'ACTIVE'
     or coalesce((v_agent->>'authority_effect')::boolean,true)<>false
     or coalesce((v_agent->>'automatic_retry_allowed')::boolean,true)<>false then
    raise exception 'devos_transport_agent_not_active' using errcode='55000';
  end if;
  if v_agent->>'role'<>new.role or v_agent->>'tab_id'<>new.tab_id
     or lower(v_agent->>'target_id')<>lower(new.target_id)
     or coalesce((v_agent->>'generation_epoch')::bigint,0)<>new.agent_generation_epoch then
    raise exception 'devos_transport_agent_binding_mismatch' using errcode='55000';
  end if;

  v_proof:=v_agent->'transport_proof';
  if jsonb_typeof(v_proof)<>'object' or v_proof->>'schema'<>'metaengine.browser.fleet-transport-proof.v1'
     or coalesce((v_proof->>'authority_effect')::boolean,true)<>false
     or v_proof->>'tab_id'<>new.tab_id or lower(v_proof->>'target_id')<>lower(new.target_id)
     or coalesce((v_proof->>'generation_epoch')::bigint,0)<>new.agent_generation_epoch
     or coalesce(v_proof->>'conversation_url_sha256','') !~ '^[0-9a-f]{64}$'
     or coalesce(v_proof->>'proven_at','')='' then
    raise exception 'devos_transport_proof_mismatch' using errcode='55000';
  end if;
  begin v_proven_at:=(v_proof->>'proven_at')::timestamptz;
  exception when others then raise exception 'devos_transport_proof_time_invalid' using errcode='22007'; end;
  if v_proven_at>v_last_seen+interval '5 seconds' then raise exception 'devos_transport_proof_time_in_future' using errcode='55000'; end if;
  return new;
end;
$$;

revoke all on function destruktion_meta.devos_fleet_claim_transport_admission_h205f22() from public, anon, authenticated;
grant execute on function destruktion_meta.devos_fleet_claim_transport_admission_h205f22() to service_role;

create or replace function public.devos_fleet_capacity_snapshot_v1(p_workspace uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, destruktion_meta, pg_temp
as $$
declare
  v_control jsonb;
  v_state jsonb;
  v_agents jsonb;
  v_agent jsonb;
  v_proof jsonb;
  v_seen timestamptz;
  v_proven_at timestamptz;
  v_agent_id text;
  v_role text;
  v_seen_agents text[]:=array[]::text[];
  v_available integer:=0; v_live integer:=0; v_by_role jsonb:='{}'::jsonb;
  v_ready integer:=0; v_leased integer:=0; v_running integer:=0; v_result_ready integer:=0; v_ambiguous integer:=0; v_blocked integer:=0; v_active_claims integer:=0;
  v_ready_limit integer:=4; v_ambiguity_limit integer:=8; v_new integer:=0; v_pressure text:='CAPACITY_UNAVAILABLE';
begin
  if p_workspace is null then raise exception 'devos_capacity_workspace_required' using errcode='22023'; end if;
  select count(*) filter(where state='READY'),count(*) filter(where state='LEASED'),count(*) filter(where state='RUNNING'),count(*) filter(where state='RESULT_READY'),count(*) filter(where state='AMBIGUOUS'),count(*) filter(where state='BLOCKED')
    into v_ready,v_leased,v_running,v_result_ready,v_ambiguous,v_blocked
    from destruktion_meta.devos_fleet_task_h205f22 where workspace_id=p_workspace;
  select count(*) into v_active_claims from destruktion_meta.devos_fleet_claim_h205f22 where workspace_id=p_workspace and state='ACTIVE' and expires_at>clock_timestamp();

  v_control:=public.devos_control_supervisor_snapshot_v1(p_workspace,null,45);
  if v_control->>'state'<>'FRESH_CONTROL' then
    return jsonb_build_object('schema','metaengine.devos.scheduler-capacity.v1','workspace_id',p_workspace,'state',case when v_control->>'state'='STALE' then 'STALE_FAIL_CLOSED' else 'NO_SNAPSHOT' end,'source','DEVOS_SCHEDULER_SNAPSHOT','available_slots',0,'new_frontier_slots',0,'live_transport_slots',0,'by_role','{}'::jsonb,'ready_backlog',v_ready,'leased_backlog',v_leased,'running_backlog',v_running,'result_ready_backlog',v_result_ready,'ambiguous_backlog',v_ambiguous,'blocked_backlog',v_blocked,'active_claims',v_active_claims,'ready_backlog_limit',4,'ambiguity_pressure_limit',8,'pressure_state','CAPACITY_UNAVAILABLE','freshness_horizon_seconds',45,'transport_admission','ACTIVE_EXACT_PROOF_V1','scheduler_source','NATIVE_SUPERVISOR_HEARTBEAT','scheduler_policy','IDLE_ROLE_FAIR_SHARE_V1','pressure_policy','RECOVERY_AWARE_FRONTIER_V1','automatic_retry_allowed',false,'authority_effect',false);
  end if;
  v_state:=v_control->'supervisor_state'; v_seen:=(v_control->>'last_seen_at')::timestamptz; v_agents:=v_state->'fleet'->'agents';
  if jsonb_typeof(v_agents)<>'array' or jsonb_array_length(v_agents)>64 then
    return jsonb_build_object('schema','metaengine.devos.scheduler-capacity.v1','workspace_id',p_workspace,'state','INVALID_FLEET_FAIL_CLOSED','source','DEVOS_SCHEDULER_SNAPSHOT','available_slots',0,'new_frontier_slots',0,'live_transport_slots',0,'by_role','{}'::jsonb,'ready_backlog',v_ready,'leased_backlog',v_leased,'running_backlog',v_running,'result_ready_backlog',v_result_ready,'ambiguous_backlog',v_ambiguous,'blocked_backlog',v_blocked,'active_claims',v_active_claims,'pressure_state','CAPACITY_UNAVAILABLE','automatic_retry_allowed',false,'authority_effect',false);
  end if;

  for v_agent in select value from jsonb_array_elements(v_agents) loop
    v_agent_id:=lower(coalesce(v_agent->>'agent_id','')); v_role:=upper(coalesce(v_agent->>'role',''));
    if v_agent_id !~ '^agent_[a-z0-9-]{8,64}$' or v_role !~ '^[A-Z][A-Z0-9_]{1,63}$' or v_agent_id=any(v_seen_agents)
       or v_agent->>'ownership'<>'FLEET_OWNED' or v_agent->>'lifecycle_state'<>'ACTIVE' or v_agent->>'authority_effect'<>'false'
       or v_agent->>'automatic_retry_allowed'<>'false' or coalesce(v_agent->>'tab_id','')='' or lower(coalesce(v_agent->>'target_id','')) !~ '^webcontents:[1-9][0-9]*$'
       or coalesce(v_agent->>'generation_epoch','') !~ '^[1-9][0-9]*$' then continue; end if;
    v_proof:=v_agent->'transport_proof';
    if jsonb_typeof(v_proof)<>'object' or v_proof->>'schema'<>'metaengine.browser.fleet-transport-proof.v1' or v_proof->>'authority_effect'<>'false'
       or v_proof->>'tab_id'<>v_agent->>'tab_id' or lower(coalesce(v_proof->>'target_id',''))<>lower(v_agent->>'target_id')
       or coalesce(v_proof->>'generation_epoch','')<>v_agent->>'generation_epoch' or lower(coalesce(v_proof->>'conversation_url_sha256','')) !~ '^[0-9a-f]{64}$' or coalesce(v_proof->>'proven_at','')='' then continue; end if;
    begin v_proven_at:=(v_proof->>'proven_at')::timestamptz; exception when others then continue; end;
    if v_proven_at>v_seen+interval '5 seconds' then continue; end if;
    v_seen_agents:=array_append(v_seen_agents,v_agent_id); v_live:=v_live+1;
    if exists(select 1 from destruktion_meta.devos_fleet_claim_h205f22 c where c.workspace_id=p_workspace and c.agent_id=v_agent_id and c.state='ACTIVE' and c.expires_at>clock_timestamp()) then continue; end if;
    v_available:=v_available+1; v_by_role:=jsonb_set(v_by_role,array[v_role],to_jsonb(coalesce((v_by_role->>v_role)::integer,0)+1),true);
  end loop;

  v_ready_limit:=greatest(4,least(32,greatest(1,v_live)*2)); v_ambiguity_limit:=greatest(8,least(64,greatest(1,v_live)*2));
  if v_ready>=v_ready_limit then v_pressure:='READY_SATURATED'; v_new:=0;
  elsif v_ambiguous>=v_ambiguity_limit then v_pressure:='RECOVERY_DEBT_HIGH'; v_new:=least(v_available,1);
  else v_pressure:='NORMAL'; v_new:=v_available; end if;

  return jsonb_build_object('schema','metaengine.devos.scheduler-capacity.v1','workspace_id',p_workspace,'state','FRESH','source','DEVOS_SCHEDULER_SNAPSHOT','available_slots',v_available,'new_frontier_slots',v_new,'live_transport_slots',v_live,'by_role',v_by_role,'observed_at',v_seen,'ready_backlog',v_ready,'leased_backlog',v_leased,'running_backlog',v_running,'result_ready_backlog',v_result_ready,'ambiguous_backlog',v_ambiguous,'blocked_backlog',v_blocked,'active_claims',v_active_claims,'ready_backlog_limit',v_ready_limit,'ambiguity_pressure_limit',v_ambiguity_limit,'pressure_state',v_pressure,'freshness_horizon_seconds',45,'transport_admission','ACTIVE_EXACT_PROOF_V1','scheduler_source','NATIVE_SUPERVISOR_HEARTBEAT','scheduler_policy','IDLE_ROLE_FAIR_SHARE_V1','pressure_policy','RECOVERY_AWARE_FRONTIER_V1','automatic_retry_allowed',false,'authority_effect',false);
end;
$$;

revoke all on function public.devos_fleet_capacity_snapshot_v1(uuid) from public, anon, authenticated;
grant execute on function public.devos_fleet_capacity_snapshot_v1(uuid) to service_role;
