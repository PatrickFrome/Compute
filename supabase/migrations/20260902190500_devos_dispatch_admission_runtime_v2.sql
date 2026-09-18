-- METAENGINE DevOS dispatch admission runtime v2.
-- Development-plane migration. Production application remains separately gated.
--
-- Closes two observed continuity gaps:
-- 1. native Browser state may be persisted either as a jsonb object or as a JSON string
--    inside jsonb; admission must normalize both without trusting caller data;
-- 2. a transport-proven fleet incarnation must not consume a new durable task lease while
--    the same fresh native Browser runtime is in a degraded supervisor continuity state.
--
-- This is not a scheduler and does not retry, dispatch, or actuate. Rejection happens in a
-- BEFORE INSERT claim trigger, so the enclosing devos_fleet_lease_v1 transaction rolls back
-- to READY with no claim/effect rather than creating future LEASE_EXPIRED_EFFECT_UNKNOWN debt.

create or replace function destruktion_meta.devos_normalize_native_supervisor_state_h205f22(p_state jsonb)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_decoded jsonb;
begin
  if p_state is null then
    return null;
  end if;
  if jsonb_typeof(p_state) = 'object' then
    return p_state;
  end if;
  if jsonb_typeof(p_state) <> 'string' then
    return null;
  end if;
  begin
    v_decoded := (p_state #>> '{}')::jsonb;
  exception when others then
    return null;
  end;
  if jsonb_typeof(v_decoded) <> 'object' then
    return null;
  end if;
  return v_decoded;
end;
$$;

revoke all on function destruktion_meta.devos_normalize_native_supervisor_state_h205f22(jsonb) from public, anon, authenticated;
grant execute on function destruktion_meta.devos_normalize_native_supervisor_state_h205f22(jsonb) to service_role;

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
  v_lifecycle jsonb;
  v_keepalive_state text;
  v_last_seen timestamptz;
  v_proven_at timestamptz;
begin
  if new.state <> 'ACTIVE' then
    raise exception 'devos_transport_claim_state_invalid' using errcode = '23514';
  end if;

  select destruktion_meta.devos_normalize_native_supervisor_state_h205f22(s.state), s.last_seen_at
    into v_supervisor_state, v_last_seen
    from public.compute_fabric_a2_browser_supervisor_state_h205f22 s
   where s.workspace_id = new.workspace_id
     and s.authority_effect = false
   order by s.last_seen_at desc
   limit 1;

  if not found or v_supervisor_state is null then
    raise exception 'devos_transport_supervisor_snapshot_missing' using errcode = '55000';
  end if;
  if v_supervisor_state->>'schema' <> 'metaengine.native-browser-supervisor.state.v1' then
    raise exception 'devos_transport_supervisor_schema_invalid' using errcode = '55000';
  end if;
  if v_last_seen < clock_timestamp() - interval '45 seconds' then
    raise exception 'devos_transport_supervisor_snapshot_stale' using errcode = '55000';
  end if;

  -- Continuity state is trusted only as native Browser telemetry and can only deny a claim.
  -- It never authorizes a physical effect. A degraded supervisor/runtime therefore creates
  -- backpressure before leasing rather than ambiguity after lease expiry.
  v_lifecycle := v_supervisor_state->'supervisor_lifecycle';
  if jsonb_typeof(v_lifecycle) <> 'object'
     or coalesce((v_lifecycle->'continuous_service'->>'enabled')::boolean, false) <> true
     or coalesce((v_lifecycle->>'actuation_enabled')::boolean, false) <> true then
    raise exception 'devos_dispatch_runtime_not_ready' using errcode = '55000';
  end if;
  v_keepalive_state := upper(coalesce(v_lifecycle->'keepalive'->>'state', 'UNKNOWN'));
  if v_keepalive_state in (
    'WAKE_AMBIGUOUS',
    'ROLLOVER_DEFERRED',
    'ROLLOVER_REQUIRED',
    'ROLLOVER_AMBIGUOUS',
    'RECOVERING'
  ) then
    raise exception 'devos_dispatch_continuity_degraded:%', v_keepalive_state using errcode = '55000';
  end if;

  v_fleet := v_supervisor_state->'fleet';
  if v_fleet->>'schema' <> 'metaengine.browser.fleet-snapshot.v1'
     or v_fleet->>'readiness_contract' <> 'TRANSPORT_PROOF_REQUIRED'
     or jsonb_typeof(v_fleet->'agents') <> 'array' then
    raise exception 'devos_transport_fleet_contract_invalid' using errcode = '55000';
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
