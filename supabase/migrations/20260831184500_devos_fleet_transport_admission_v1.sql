-- METAENGINE DevOS fleet transport admission v1.
-- Branch-local migration only. Do not apply to production from this convergence task.
--
-- Purpose:
--   Prevent DevOS task leases from being consumed by Browser incarnations that have not
--   crossed the existing C5 transport-promotion boundary. This does NOT add a scheduler.
--   It adds an atomic admission fence at durable claim creation in the single existing
--   devos_fleet scheduler transaction.
--
-- Authority model:
--   * caller-supplied agent/tab/target/generation is never sufficient;
--   * the latest fresh native-browser supervisor snapshot is authoritative for fleet binding;
--   * lifecycle must be ACTIVE and carry an exact fleet-transport-proof for the same
--     agent/tab/target/generation incarnation;
--   * BOUND_UNVERIFIED, stale snapshots and any identity drift fail closed before a claim exists;
--   * raising from this BEFORE INSERT trigger rolls back the enclosing lease transaction,
--     so a rejected incarnation cannot leave a task stranded in LEASED without a claim;
--   * page/model/worker text has zero authority; this function executes no supplied text.

create or replace function destruktion_meta.devos_fleet_claim_transport_admission_h205f22()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, destruktion_meta
as $$
declare
  v_supervisor_state jsonb;
  v_fleet jsonb;
  v_agent jsonb;
  v_proof jsonb;
  v_last_seen timestamptz;
  v_proven_at timestamptz;
begin
  if new.state <> 'ACTIVE' then
    raise exception 'devos_transport_claim_state_invalid' using errcode = '23514';
  end if;

  select s.state, s.last_seen_at
    into v_supervisor_state, v_last_seen
    from public.compute_fabric_a2_browser_supervisor_state_h205f22 s
   where s.workspace_id = new.workspace_id
     and s.authority_effect = false
     and s.state->>'schema' = 'metaengine.native-browser-supervisor.state.v1'
     and s.state->'fleet'->>'schema' = 'metaengine.browser.fleet-snapshot.v1'
     and s.state->'fleet'->>'readiness_contract' = 'TRANSPORT_PROOF_REQUIRED'
   order by s.last_seen_at desc
   limit 1;

  if not found then
    raise exception 'devos_transport_supervisor_snapshot_missing' using errcode = '55000';
  end if;

  -- The supervisor mesh watchdog already treats 45 seconds as a lost-supervisor horizon.
  -- Reuse that boundary instead of inventing a second liveness clock.
  if v_last_seen < clock_timestamp() - interval '45 seconds' then
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

drop trigger if exists devos_fleet_claim_transport_admission_trg on destruktion_meta.devos_fleet_claim_h205f22;
create trigger devos_fleet_claim_transport_admission_trg
before insert on destruktion_meta.devos_fleet_claim_h205f22
for each row
execute function destruktion_meta.devos_fleet_claim_transport_admission_h205f22();
