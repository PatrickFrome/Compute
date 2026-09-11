-- METAENGINE DevOS dispatch admission signed-native correction v3.
--
-- Corrects a stale provenance assumption in v2: the current signed native Browser
-- heartbeat is stored with the outer supervisor-state row authority_effect=true.
-- Filtering the row on authority_effect=false caused admission to skip the fresh
-- signed native client and select an obsolete legacy v7 supervisor row instead.
--
-- Admission now selects the newest workspace row, then proves native identity by
-- exact schema/client kind, freshness, and the active enrolled device/profile/key
-- fingerprint already bound into the signed heartbeat. These observations remain
-- deny-only and cannot grant Browser/page/model authority or automatic retry.

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
  v_transport_identity jsonb;
  v_keepalive_state text;
  v_last_seen timestamptz;
  v_proven_at timestamptz;
  v_client_id text;
  v_device_bound boolean := false;
begin
  if new.state <> 'ACTIVE' then
    raise exception 'devos_transport_claim_state_invalid' using errcode = '23514';
  end if;

  select destruktion_meta.devos_normalize_native_supervisor_state_h205f22(s.state),
         s.last_seen_at,
         s.client_id
    into v_supervisor_state, v_last_seen, v_client_id
    from public.compute_fabric_a2_browser_supervisor_state_h205f22 s
   where s.workspace_id = new.workspace_id
   order by s.last_seen_at desc
   limit 1;

  if not found or v_supervisor_state is null then
    raise exception 'devos_transport_supervisor_snapshot_missing' using errcode = '55000';
  end if;
  if v_supervisor_state->>'schema' <> 'metaengine.native-browser-supervisor.state.v1' then
    raise exception 'devos_transport_supervisor_schema_invalid' using errcode = '55000';
  end if;
  if v_supervisor_state->>'client_kind' <> 'METAENGINE_BROWSER_ELECTRON_NATIVE' then
    raise exception 'devos_transport_supervisor_client_kind_invalid' using errcode = '55000';
  end if;
  if v_last_seen < clock_timestamp() - interval '45 seconds' then
    raise exception 'devos_transport_supervisor_snapshot_stale' using errcode = '55000';
  end if;

  -- The outer row authority_effect flag is ingestion provenance, not page/model
  -- authority. Trust is instead bound to the enrolled device represented inside
  -- the signed native heartbeat and revalidated against the server-side registry.
  v_transport_identity := v_supervisor_state->'transport_identity';
  if jsonb_typeof(v_transport_identity) <> 'object'
     or v_transport_identity->>'profile' <> 'A2_DEVICE_HTTP_SIGNATURE_V1'
     or coalesce(v_transport_identity->>'device_id','') = ''
     or lower(coalesce(v_transport_identity->>'key_fingerprint_sha256','')) !~ '^[0-9a-f]{64}$' then
    raise exception 'devos_transport_identity_invalid' using errcode = '55000';
  end if;

  select exists (
    select 1
      from public.compute_fabric_a2_browser_device_h205f22 d
     where d.client_id = v_client_id
       and d.active = true
       and d.revoked_at is null
       and d.profile = v_transport_identity->>'profile'
       and lower(d.device_id::text) = lower(v_transport_identity->>'device_id')
       and lower(d.key_fingerprint_sha256) = lower(v_transport_identity->>'key_fingerprint_sha256')
  ) into v_device_bound;

  if not v_device_bound then
    raise exception 'devos_transport_device_binding_invalid' using errcode = '55000';
  end if;

  -- Continuity telemetry can only remove claim authority. It never grants an
  -- effect, retries work, or bypasses exact transport/lease fencing.
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
