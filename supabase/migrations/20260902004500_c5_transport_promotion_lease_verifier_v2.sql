-- C5 server-side transport promotion lease verifier v2.
-- Branch-local only. No production DDL is applied by this task.
--
-- Pure verification boundary over the existing C5 promotion lease and current
-- trusted CONTROL snapshot. It creates no lease, scheduler, wake, task claim,
-- Browser effect, or retry authority.

create or replace function public.h205f22_verify_browser_transport_promotion_lease_v2(
  p_workspace_id uuid,
  p_lease_id uuid,
  p_agent_id text,
  p_holder_supervisor_instance_id text,
  p_tab_id text,
  p_target_id text,
  p_agent_generation bigint,
  p_conversation_url_sha256 text
)
returns jsonb
language plpgsql
security definer
volatile
set search_path = pg_catalog, public, destruktion_meta, pg_temp
as $$
declare
  v_agent_id text := lower(nullif(btrim(coalesce(p_agent_id,'')),''));
  v_holder text := nullif(btrim(coalesce(p_holder_supervisor_instance_id,'')),'');
  v_tab text := nullif(btrim(coalesce(p_tab_id,'')),'');
  v_target text := lower(nullif(btrim(coalesce(p_target_id,'')),''));
  v_conversation text := lower(nullif(btrim(coalesce(p_conversation_url_sha256,'')),''));
  v_control jsonb;
  v_client_id text;
  v_state jsonb;
  v_fleet jsonb;
  v_agent jsonb;
  v_proof jsonb;
  v_seen timestamptz;
  v_proven_at timestamptz;
  v_lease public.compute_fabric_a2_supervisor_actuation_lease_h205f22%rowtype;
  v_now timestamptz;
  v_expected_key text;
  v_reason text := null;
begin
  if p_workspace_id is null or p_lease_id is null or v_agent_id is null or v_holder is null
     or v_tab is null or v_target is null or p_agent_generation is null or p_agent_generation < 1
     or v_conversation !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object(
      'schema','metaengine.c5.transport-promotion-lease-verification.v2',
      'valid',false,'reason','IDENTITY_REQUIRED','automatic_retry_allowed',false,'authority_effect',false
    );
  end if;

  if v_agent_id !~ '^agent_[a-z0-9-]{8,64}$' or v_target !~ '^webcontents:[1-9][0-9]*$' then
    return jsonb_build_object(
      'schema','metaengine.c5.transport-promotion-lease-verification.v2',
      'valid',false,'reason','IDENTITY_INVALID','automatic_retry_allowed',false,'authority_effect',false
    );
  end if;

  v_control := public.devos_control_supervisor_snapshot_v1(p_workspace_id,null,45);
  if v_control->>'state' <> 'FRESH_CONTROL' then
    return jsonb_build_object(
      'schema','metaengine.c5.transport-promotion-lease-verification.v2',
      'valid',false,'reason','CONTROL_SNAPSHOT_MISSING','automatic_retry_allowed',false,'authority_effect',false
    );
  end if;
  v_client_id := nullif(btrim(coalesce(v_control->>'client_id','')),'');
  if v_client_id is null then
    return jsonb_build_object(
      'schema','metaengine.c5.transport-promotion-lease-verification.v2',
      'valid',false,'reason','CONTROL_CLIENT_MISSING','automatic_retry_allowed',false,'authority_effect',false
    );
  end if;

  -- Same serialization domain as claim admission / transport promotion. Re-read
  -- CONTROL state after the lock so the verifier cannot bless a pre-lock snapshot.
  perform pg_advisory_xact_lock(hashtextextended('devos-transport-promotion:'||p_workspace_id::text||':'||v_client_id,0));
  v_control := public.devos_control_supervisor_snapshot_v1(p_workspace_id,v_client_id,45);
  if v_control->>'state' <> 'FRESH_CONTROL' then
    return jsonb_build_object(
      'schema','metaengine.c5.transport-promotion-lease-verification.v2',
      'valid',false,'reason','CONTROL_SNAPSHOT_MISSING_AFTER_LOCK','client_id',v_client_id,
      'automatic_retry_allowed',false,'authority_effect',false
    );
  end if;

  v_now := clock_timestamp();
  v_state := v_control->'supervisor_state';
  begin v_seen := (v_control->>'last_seen_at')::timestamptz;
  exception when others then
    return jsonb_build_object(
      'schema','metaengine.c5.transport-promotion-lease-verification.v2',
      'valid',false,'reason','CONTROL_SNAPSHOT_TIME_INVALID','client_id',v_client_id,
      'automatic_retry_allowed',false,'authority_effect',false
    );
  end;

  select * into v_lease
    from public.compute_fabric_a2_supervisor_actuation_lease_h205f22
   where lease_id=p_lease_id and workspace_id=p_workspace_id;

  v_expected_key := 'fleet.transport-promotion:'||v_agent_id;
  if not found then v_reason := 'LEASE_NOT_FOUND';
  elsif v_lease.status <> 'ACTIVE' then v_reason := 'LEASE_NOT_ACTIVE';
  elsif v_lease.released_at is not null then v_reason := 'LEASE_RELEASED';
  elsif v_lease.expires_at is null or v_lease.expires_at <= v_now then v_reason := 'LEASE_EXPIRED';
  elsif v_lease.effect_scope <> 'BROWSER_CLIENT_ACTUATION' then v_reason := 'SCOPE_MISMATCH';
  elsif v_lease.effect_key <> v_expected_key then v_reason := 'EFFECT_KEY_MISMATCH';
  elsif v_lease.holder_supervisor_instance_id <> v_holder then v_reason := 'HOLDER_MISMATCH';
  elsif v_lease.target_client_id <> v_client_id then v_reason := 'TARGET_CLIENT_MISMATCH';
  end if;

  if v_reason is null then
    v_fleet := v_state->'fleet';
    if jsonb_typeof(v_fleet->'agents') <> 'array' or jsonb_array_length(v_fleet->'agents') > 64 then
      v_reason := 'FLEET_INVALID';
    else
      select a.value into v_agent
        from jsonb_array_elements(v_fleet->'agents') a(value)
       where lower(coalesce(a.value->>'agent_id',''))=v_agent_id
       limit 1;
      if not found then v_reason := 'AGENT_MISSING';
      elsif v_agent->>'ownership' <> 'FLEET_OWNED' or v_agent->>'lifecycle_state' <> 'ACTIVE'
         or coalesce((v_agent->>'authority_effect')::boolean,true) <> false
         or coalesce((v_agent->>'automatic_retry_allowed')::boolean,true) <> false then
        v_reason := 'AGENT_NOT_ACTIVE';
      elsif v_agent->>'tab_id' <> v_tab or lower(coalesce(v_agent->>'target_id','')) <> v_target
         or coalesce((v_agent->>'generation_epoch')::bigint,0) <> p_agent_generation then
        v_reason := 'AGENT_BINDING_MISMATCH';
      else
        v_proof := v_agent->'transport_proof';
        if jsonb_typeof(v_proof) <> 'object'
           or v_proof->>'schema' <> 'metaengine.browser.fleet-transport-proof.v1'
           or coalesce((v_proof->>'authority_effect')::boolean,true) <> false
           or v_proof->>'tab_id' <> v_tab
           or lower(coalesce(v_proof->>'target_id','')) <> v_target
           or coalesce((v_proof->>'generation_epoch')::bigint,0) <> p_agent_generation
           or lower(coalesce(v_proof->>'conversation_url_sha256','')) <> v_conversation
           or coalesce(v_proof->>'proven_at','')='' then
          v_reason := 'TRANSPORT_PROOF_MISMATCH';
        else
          begin v_proven_at := (v_proof->>'proven_at')::timestamptz;
          exception when others then v_reason := 'TRANSPORT_PROOF_TIME_INVALID'; end;
          if v_reason is null and (v_proven_at > v_seen + interval '5 seconds' or v_proven_at < v_seen - interval '45 seconds') then
            v_reason := 'TRANSPORT_PROOF_STALE';
          end if;
        end if;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'schema','metaengine.c5.transport-promotion-lease-verification.v2',
    'valid',v_reason is null,
    'reason',v_reason,
    'workspace_id',p_workspace_id,
    'lease_id',p_lease_id,
    'agent_id',v_agent_id,
    'client_id',v_client_id,
    'holder_supervisor_instance_id',v_holder,
    'tab_id',v_tab,
    'target_id',v_target,
    'agent_generation',p_agent_generation,
    'conversation_url_sha256',v_conversation,
    'lease_status',case when v_lease.lease_id is null then null else v_lease.status end,
    'lease_expires_at',case when v_lease.lease_id is null then null else v_lease.expires_at end,
    'control_last_seen_at',v_seen,
    'transport_proven_at',v_proven_at,
    'same_promotion_lock',true,
    'post_lock_control_reread',true,
    'creates_lease',false,
    'invokes_scheduler',false,
    'browser_effect',false,
    'automatic_retry_allowed',false,
    'verified_at',v_now,
    'authority_effect',false
  );
end;
$$;

revoke all on function public.h205f22_verify_browser_transport_promotion_lease_v2(uuid,uuid,text,text,text,text,bigint,text) from public, anon, authenticated;
grant execute on function public.h205f22_verify_browser_transport_promotion_lease_v2(uuid,uuid,text,text,text,text,bigint,text) to service_role;
