-- METAENGINE DevOS scheduler pressure projection v2.
-- Branch-local migration only. Do not apply to production from this audit task.
--
-- Extends the existing read-only capacity RPC with bounded scheduler-owned backlog counts
-- and a soft new-frontier admission budget. It never allocates a lease or uses Browser/model
-- text as authority. Physical available_slots remain the hard scheduler capacity; the softer
-- new_frontier_slots prevents Meta from amplifying READY/recovery debt.

create or replace function public.devos_fleet_capacity_snapshot_v1(p_workspace uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, destruktion_meta, pg_temp
as $$
declare
  v_supervisor_state jsonb;
  v_agents jsonb;
  v_agent jsonb;
  v_proof jsonb;
  v_last_seen timestamptz;
  v_proven_at timestamptz;
  v_agent_id text;
  v_role text;
  v_seen text[] := array[]::text[];
  v_available integer := 0;
  v_live_total integer := 0;
  v_by_role jsonb := '{}'::jsonb;
  v_ready integer := 0;
  v_leased integer := 0;
  v_running integer := 0;
  v_result_ready integer := 0;
  v_ambiguous integer := 0;
  v_blocked integer := 0;
  v_active_claims integer := 0;
  v_ready_limit integer := 4;
  v_ambiguity_limit integer := 8;
  v_new_frontier_slots integer := 0;
  v_pressure_state text := 'CAPACITY_UNAVAILABLE';
begin
  if p_workspace is null then
    raise exception 'devos_capacity_workspace_required' using errcode = '22023';
  end if;

  select
    count(*) filter (where t.state = 'READY'),
    count(*) filter (where t.state = 'LEASED'),
    count(*) filter (where t.state = 'RUNNING'),
    count(*) filter (where t.state = 'RESULT_READY'),
    count(*) filter (where t.state = 'AMBIGUOUS'),
    count(*) filter (where t.state = 'BLOCKED')
  into v_ready, v_leased, v_running, v_result_ready, v_ambiguous, v_blocked
  from destruktion_meta.devos_fleet_task_h205f22 t
  where t.workspace_id = p_workspace;

  select count(*) into v_active_claims
  from destruktion_meta.devos_fleet_claim_h205f22 c
  where c.workspace_id = p_workspace
    and c.state = 'ACTIVE'
    and c.expires_at > clock_timestamp();

  select s.state, s.last_seen_at
    into v_supervisor_state, v_last_seen
    from public.compute_fabric_a2_browser_supervisor_state_h205f22 s
   where s.workspace_id = p_workspace
     and s.authority_effect = false
     and s.state->>'schema' = 'metaengine.native-browser-supervisor.state.v1'
     and s.state->'fleet'->>'schema' = 'metaengine.browser.fleet-snapshot.v1'
     and s.state->'fleet'->>'readiness_contract' = 'TRANSPORT_PROOF_REQUIRED'
   order by s.last_seen_at desc
   limit 1;

  if not found then
    return jsonb_build_object(
      'schema','metaengine.devos.scheduler-capacity.v1','workspace_id',p_workspace,
      'state','NO_SNAPSHOT','source','DEVOS_SCHEDULER_SNAPSHOT','available_slots',0,'new_frontier_slots',0,
      'live_transport_slots',0,'by_role','{}'::jsonb,
      'ready_backlog',v_ready,'leased_backlog',v_leased,'running_backlog',v_running,
      'result_ready_backlog',v_result_ready,'ambiguous_backlog',v_ambiguous,'blocked_backlog',v_blocked,
      'active_claims',v_active_claims,'ready_backlog_limit',4,'ambiguity_pressure_limit',8,
      'pressure_state','CAPACITY_UNAVAILABLE','freshness_horizon_seconds',45,
      'transport_admission','ACTIVE_EXACT_PROOF_V1','scheduler_source','NATIVE_SUPERVISOR_HEARTBEAT',
      'scheduler_policy','IDLE_ROLE_FAIR_SHARE_V1','pressure_policy','RECOVERY_AWARE_FRONTIER_V1',
      'automatic_retry_allowed',false,'authority_effect',false
    );
  end if;

  if v_last_seen < clock_timestamp() - interval '45 seconds' then
    return jsonb_build_object(
      'schema','metaengine.devos.scheduler-capacity.v1','workspace_id',p_workspace,
      'state','STALE_FAIL_CLOSED','source','DEVOS_SCHEDULER_SNAPSHOT','available_slots',0,'new_frontier_slots',0,
      'live_transport_slots',0,'by_role','{}'::jsonb,'observed_at',v_last_seen,
      'ready_backlog',v_ready,'leased_backlog',v_leased,'running_backlog',v_running,
      'result_ready_backlog',v_result_ready,'ambiguous_backlog',v_ambiguous,'blocked_backlog',v_blocked,
      'active_claims',v_active_claims,'ready_backlog_limit',4,'ambiguity_pressure_limit',8,
      'pressure_state','CAPACITY_UNAVAILABLE','freshness_horizon_seconds',45,
      'transport_admission','ACTIVE_EXACT_PROOF_V1','scheduler_source','NATIVE_SUPERVISOR_HEARTBEAT',
      'scheduler_policy','IDLE_ROLE_FAIR_SHARE_V1','pressure_policy','RECOVERY_AWARE_FRONTIER_V1',
      'automatic_retry_allowed',false,'authority_effect',false
    );
  end if;

  v_agents := v_supervisor_state->'fleet'->'agents';
  if jsonb_typeof(v_agents) <> 'array' or jsonb_array_length(v_agents) > 64 then
    return jsonb_build_object(
      'schema','metaengine.devos.scheduler-capacity.v1','workspace_id',p_workspace,
      'state','INVALID_FLEET_FAIL_CLOSED','source','DEVOS_SCHEDULER_SNAPSHOT','available_slots',0,'new_frontier_slots',0,
      'live_transport_slots',0,'by_role','{}'::jsonb,'observed_at',v_last_seen,
      'ready_backlog',v_ready,'leased_backlog',v_leased,'running_backlog',v_running,
      'result_ready_backlog',v_result_ready,'ambiguous_backlog',v_ambiguous,'blocked_backlog',v_blocked,
      'active_claims',v_active_claims,'ready_backlog_limit',4,'ambiguity_pressure_limit',8,
      'pressure_state','CAPACITY_UNAVAILABLE','freshness_horizon_seconds',45,
      'transport_admission','ACTIVE_EXACT_PROOF_V1','scheduler_source','NATIVE_SUPERVISOR_HEARTBEAT',
      'scheduler_policy','IDLE_ROLE_FAIR_SHARE_V1','pressure_policy','RECOVERY_AWARE_FRONTIER_V1',
      'automatic_retry_allowed',false,'authority_effect',false
    );
  end if;

  for v_agent in select value from jsonb_array_elements(v_agents)
  loop
    v_agent_id := lower(coalesce(v_agent->>'agent_id',''));
    v_role := upper(coalesce(v_agent->>'role',''));
    if v_agent_id !~ '^agent_[a-z0-9-]{8,64}$'
       or v_role !~ '^[A-Z][A-Z0-9_]{1,63}$'
       or v_agent_id = any(v_seen)
       or v_agent->>'ownership' <> 'FLEET_OWNED'
       or v_agent->>'lifecycle_state' <> 'ACTIVE'
       or v_agent->>'authority_effect' <> 'false'
       or v_agent->>'automatic_retry_allowed' <> 'false'
       or coalesce(v_agent->>'tab_id','') = ''
       or lower(coalesce(v_agent->>'target_id','')) !~ '^webcontents:[1-9][0-9]*$'
       or coalesce(v_agent->>'generation_epoch','') !~ '^[1-9][0-9]*$' then
      continue;
    end if;

    v_proof := v_agent->'transport_proof';
    if jsonb_typeof(v_proof) <> 'object'
       or v_proof->>'schema' <> 'metaengine.browser.fleet-transport-proof.v1'
       or v_proof->>'authority_effect' <> 'false'
       or v_proof->>'tab_id' <> v_agent->>'tab_id'
       or lower(coalesce(v_proof->>'target_id','')) <> lower(v_agent->>'target_id')
       or coalesce(v_proof->>'generation_epoch','') <> v_agent->>'generation_epoch'
       or lower(coalesce(v_proof->>'conversation_url_sha256','')) !~ '^[0-9a-f]{64}$'
       or coalesce(v_proof->>'proven_at','') = '' then
      continue;
    end if;

    begin v_proven_at := (v_proof->>'proven_at')::timestamptz;
    exception when others then continue; end;
    if v_proven_at > v_last_seen + interval '5 seconds' then continue; end if;

    v_seen := array_append(v_seen, v_agent_id);
    v_live_total := v_live_total + 1;

    if exists (
      select 1 from destruktion_meta.devos_fleet_claim_h205f22 c
       where c.workspace_id = p_workspace
         and c.agent_id = v_agent_id
         and c.state = 'ACTIVE'
         and c.expires_at > clock_timestamp()
    ) then continue; end if;

    v_available := v_available + 1;
    v_by_role := jsonb_set(v_by_role,array[v_role],to_jsonb(coalesce((v_by_role->>v_role)::integer,0)+1),true);
  end loop;

  v_ready_limit := greatest(4, least(32, greatest(1,v_live_total) * 2));
  v_ambiguity_limit := greatest(8, least(64, greatest(1,v_live_total) * 2));

  if v_ready >= v_ready_limit then
    v_pressure_state := 'READY_SATURATED';
    v_new_frontier_slots := 0;
  elsif v_ambiguous >= v_ambiguity_limit then
    v_pressure_state := 'RECOVERY_DEBT_HIGH';
    v_new_frontier_slots := least(v_available,1);
  else
    v_pressure_state := 'NORMAL';
    v_new_frontier_slots := v_available;
  end if;

  return jsonb_build_object(
    'schema','metaengine.devos.scheduler-capacity.v1','workspace_id',p_workspace,
    'state','FRESH','source','DEVOS_SCHEDULER_SNAPSHOT','available_slots',v_available,
    'new_frontier_slots',v_new_frontier_slots,'live_transport_slots',v_live_total,'by_role',v_by_role,
    'observed_at',v_last_seen,'ready_backlog',v_ready,'leased_backlog',v_leased,'running_backlog',v_running,
    'result_ready_backlog',v_result_ready,'ambiguous_backlog',v_ambiguous,'blocked_backlog',v_blocked,
    'active_claims',v_active_claims,'ready_backlog_limit',v_ready_limit,'ambiguity_pressure_limit',v_ambiguity_limit,
    'pressure_state',v_pressure_state,'freshness_horizon_seconds',45,
    'transport_admission','ACTIVE_EXACT_PROOF_V1','scheduler_source','NATIVE_SUPERVISOR_HEARTBEAT',
    'scheduler_policy','IDLE_ROLE_FAIR_SHARE_V1','pressure_policy','RECOVERY_AWARE_FRONTIER_V1',
    'automatic_retry_allowed',false,'authority_effect',false
  );
end;
$$;

revoke all on function public.devos_fleet_capacity_snapshot_v1(uuid) from public, anon, authenticated;
grant execute on function public.devos_fleet_capacity_snapshot_v1(uuid) to service_role;
