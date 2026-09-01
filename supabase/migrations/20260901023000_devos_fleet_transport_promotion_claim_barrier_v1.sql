-- METAENGINE DevOS transport-promotion/task-claim mutual exclusion v1.
-- Branch-local migration only. Do not apply to production from this convergence task.
--
-- Extends the existing claim transport-admission membrane. The Browser pre-lease transport
-- promotion path and the normal DevOS task-claim path serialize on the same workspace/client
-- advisory transaction lock. A non-expired Browser client actuation lease blocks claim creation.
-- This adds no scheduler, poller, task owner, retry loop, or caller-controlled authority.

create or replace function destruktion_meta.devos_fleet_claim_transport_admission_h205f22()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, destruktion_meta, pg_temp
as $$
declare
  v_client_id text;
  v_supervisor_state jsonb;
  v_fleet jsonb;
  v_agent jsonb;
  v_proof jsonb;
  v_last_seen timestamptz;
  v_proven_at timestamptz;
  v_now timestamptz;
begin
  if new.state <> 'ACTIVE' then
    raise exception 'devos_transport_claim_state_invalid' using errcode = '23514';
  end if;

  -- Client identity is only a lock-routing hint here. No fleet state read before the shared
  -- promotion lock is allowed to authorize the claim, because it could become stale while
  -- waiting for a concurrent restart-promotion transaction to finish.
  select s.client_id
    into v_client_id
    from public.compute_fabric_a2_browser_supervisor_state_h205f22 s
   where s.workspace_id = new.workspace_id
     and s.authority_effect = false
     and s.state->>'schema' = 'metaengine.native-browser-supervisor.state.v1'
     and s.state->'fleet'->>'schema' = 'metaengine.browser.fleet-snapshot.v1'
     and s.state->'fleet'->>'readiness_contract' = 'TRANSPORT_PROOF_REQUIRED'
   order by s.last_seen_at desc
   limit 1;

  if not found or nullif(trim(coalesce(v_client_id,'')),'') is null then
    raise exception 'devos_transport_supervisor_snapshot_missing' using errcode = '55000';
  end if;

  -- Promotion acquire uses this exact lock namespace. Holding it until the enclosing task
  -- claim transaction commits makes Browser promotion and normal task lease admission mutually
  -- exclusive without a second scheduler or an HTTP preflight race.
  perform pg_advisory_xact_lock(
    hashtextextended('devos-transport-promotion:'||new.workspace_id::text||':'||v_client_id,0)
  );
  v_now := clock_timestamp();

  -- Re-read the authoritative supervisor state only after mutual exclusion is established.
  -- A pre-lock ACTIVE snapshot has zero authority after a concurrent restart/promotion change.
  select s.state, s.last_seen_at
    into v_supervisor_state, v_last_seen
    from public.compute_fabric_a2_browser_supervisor_state_h205f22 s
   where s.workspace_id = new.workspace_id
     and s.client_id = v_client_id
     and s.authority_effect = false
     and s.state->>'schema' = 'metaengine.native-browser-supervisor.state.v1'
     and s.state->'fleet'->>'schema' = 'metaengine.browser.fleet-snapshot.v1'
     and s.state->'fleet'->>'readiness_contract' = 'TRANSPORT_PROOF_REQUIRED'
   order by s.last_seen_at desc
   limit 1;

  if not found then
    raise exception 'devos_transport_supervisor_snapshot_missing_after_lock' using errcode = '55000';
  end if;

  -- TTL expiry is deterministic reconciliation, not a retry. A lost promotion-release response
  -- therefore stalls claims only until the already-bounded lease expires; it never authorizes a
  -- second physical Browser promotion while the original effect may still have authority.
  update public.compute_fabric_a2_supervisor_actuation_lease_h205f22
     set status = 'EXPIRED', released_at = v_now, release_reason = 'TTL_EXPIRED'
   where workspace_id = new.workspace_id
     and target_client_id = v_client_id
     and effect_scope = 'BROWSER_CLIENT_ACTUATION'
     and status = 'ACTIVE'
     and expires_at <= v_now;

  if exists (
    select 1
      from public.compute_fabric_a2_supervisor_actuation_lease_h205f22 l
     where l.workspace_id = new.workspace_id
       and l.target_client_id = v_client_id
       and l.effect_scope = 'BROWSER_CLIENT_ACTUATION'
       and l.status = 'ACTIVE'
       and l.expires_at > v_now
  ) then
    raise exception 'devos_transport_client_actuation_lease_active' using errcode = '55000';
  end if;

  -- The supervisor mesh watchdog already treats 45 seconds as a lost-supervisor horizon.
  -- Reuse that boundary instead of inventing a second liveness clock.
  if v_last_seen < v_now - interval '45 seconds' then
    raise exception 'devos_transport_supervisor_snapshot_stale' using errcode = '55000';
  end if;

  v_fleet := v_supervisor_state->'fleet';
  if jsonb_typeof(v_fleet->'agents') <> 'array' then
    raise exception 'devos_transport_fleet_agents_invalid' using errcode = '22023';
  end if;

  select a.value
    into v_agent
    from jsonb_array_elements(v_fleet->'agents') as a(value)
   where lower(a.value->>'agent_id') = lower(new.agent_id)
   limit 1;

  if not found then
    raise exception 'devos_transport_agent_missing' using errcode = '55000';
  end if;

  if v_agent->>'ownership' <> 'FLEET_OWNED'
     or v_agent->>'lifecycle_state' <> 'ACTIVE'
     or coalesce((v_agent->>'authority_effect')::boolean, true) <> false
     or coalesce((v_agent->>'automatic_retry_allowed')::boolean, true) <> false then
    raise exception 'devos_transport_agent_not_active' using errcode = '55000';
  end if;

  if v_agent->>'role' <> new.role
     or v_agent->>'tab_id' <> new.tab_id
     or lower(v_agent->>'target_id') <> lower(new.target_id)
     or coalesce((v_agent->>'generation_epoch')::bigint, 0) <> new.agent_generation_epoch then
    raise exception 'devos_transport_agent_binding_mismatch' using errcode = '55000';
  end if;

  v_proof := v_agent->'transport_proof';
  if jsonb_typeof(v_proof) <> 'object'
     or v_proof->>'schema' <> 'metaengine.browser.fleet-transport-proof.v1'
     or coalesce((v_proof->>'authority_effect')::boolean, true) <> false
     or v_proof->>'tab_id' <> new.tab_id
     or lower(v_proof->>'target_id') <> lower(new.target_id)
     or coalesce((v_proof->>'generation_epoch')::bigint, 0) <> new.agent_generation_epoch
     or coalesce(v_proof->>'conversation_url_sha256','') !~ '^[0-9a-f]{64}$'
     or coalesce(v_proof->>'proven_at','') = '' then
    raise exception 'devos_transport_proof_mismatch' using errcode = '55000';
  end if;

  begin
    v_proven_at := (v_proof->>'proven_at')::timestamptz;
  exception when others then
    raise exception 'devos_transport_proof_time_invalid' using errcode = '22007';
  end;
  if v_proven_at > v_last_seen + interval '5 seconds' then
    raise exception 'devos_transport_proof_time_in_future' using errcode = '55000';
  end if;

  return new;
end;
$$;

revoke all on function destruktion_meta.devos_fleet_claim_transport_admission_h205f22() from public, anon, authenticated;
grant execute on function destruktion_meta.devos_fleet_claim_transport_admission_h205f22() to service_role;
