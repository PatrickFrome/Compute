\set ON_ERROR_STOP on

create role anon;
create role authenticated;
create role service_role;

\i supabase/migrations/20260901235500_compute_unified_restart_actuator_precondition_v2.sql
\i supabase/migrations/20260901144500_compute_unified_restart_effect_receipt_v1.sql
\i supabase/migrations/20260901154500_compute_unified_restart_effect_receipt_persistence_v1.sql
\i supabase/migrations/20260901165000_compute_unified_restart_effect_receipt_readback_v1.sql

DO $$
DECLARE
  continuity jsonb := jsonb_build_object(
    'schema','metaengine.restart.continuity-evidence.v2',
    'workspace_id','11111111-1111-1111-1111-111111111111',
    'client_id','browser-a',
    'process_incarnation_id','proc-old',
    'supervisor_epoch',7,
    'source_git_sha',repeat('a',40),
    'state_read_ok',true,
    'durable_handoff_ready',true,
    'active_actuation_lease',false,
    'verified_download_mutation_active',false,
    'supervisor_generation','GENERATING',
    'queued_wakes',3,
    'active_model_request',true,
    'authority_effect',false
  );
  actuator jsonb := jsonb_build_object(
    'schema','metaengine.restart.actuator-evidence.v1',
    'typed_actuator_verified',true,
    'lease_verified',true,
    'lease_id','lease-1',
    'effect_scope','BROWSER_RESTART',
    'actuator_type','NATIVE_BROWSER_TYPED_ACTUATOR',
    'workspace_id','11111111-1111-1111-1111-111111111111',
    'client_id','browser-a',
    'process_incarnation_id','proc-old',
    'supervisor_epoch','7',
    'source_git_sha',repeat('a',40),
    'authority_effect',false
  );
  p jsonb;
  raw_ambiguous jsonb := jsonb_build_object(
    'authority_effect',false,'automatic_retry_allowed',false,'effect_scope','BROWSER_RESTART',
    'actuator_type','NATIVE_BROWSER_TYPED_ACTUATOR','attempt_id','attempt-1','effect_key','restart:attempt-1',
    'workspace_id','11111111-1111-1111-1111-111111111111','lease_id','lease-1',
    'target_client_id','browser-a','target_process_incarnation_id','proc-old','supervisor_epoch',7,
    'expected_source_git_commit',repeat('a',40),'outcome','AMBIGUOUS','effect_attempted',true,
    'post_effect_readback_verified',false
  );
  verified jsonb;
  persisted jsonb;
  readback jsonb;
BEGIN
  p := public.compute_unified_restart_actuator_precondition_v2(continuity, actuator);

  if not coalesce((p->>'preconditions_verified')::boolean,false)
     or p->>'supervisor_generation' is distinct from 'GENERATING'
     or (p->>'queued_wakes')::integer is distinct from 3
     or p->>'target_client_id' is distinct from 'browser-a'
     or p->>'target_process_incarnation_id' is distinct from 'proc-old'
     or p->>'expected_source_git_commit' is distinct from repeat('a',40)
     or coalesce((p->>'restart_authorized')::boolean,true)
     or coalesce((p->>'wake_replay_authorized')::boolean,true)
     or coalesce((p->>'lease_mutation_authorized')::boolean,true)
     or coalesce((p->>'automatic_retry_allowed')::boolean,true)
     or coalesce((p->>'authority_effect')::boolean,true) then
    raise exception 'continuity-compatible precondition invalid: %',p;
  end if;

  verified := public.h205f22_compute_unified_restart_effect_receipt_v1(p,raw_ambiguous);
  persisted := public.h205f22_persist_compute_unified_restart_effect_receipt_v1(verified);
  readback := public.h205f22_read_compute_unified_restart_effect_receipt_v1(
    (persisted->>'workspace_id')::uuid,
    persisted->>'attempt_id',
    persisted->>'effect_key',
    persisted->>'receipt_fingerprint_sha256'
  );

  if readback->>'disposition' is distinct from 'HOLD_AMBIGUOUS'
     or readback->>'consumption_state' is distinct from 'HOLD_NO_RETRY'
     or not coalesce((readback->>'hold_ambiguous')::boolean,false)
     or coalesce((readback->>'automatic_retry_allowed')::boolean,true)
     or coalesce((readback->>'restart_authorized')::boolean,true)
     or coalesce((readback->>'authority_effect')::boolean,true) then
    raise exception 'durable ambiguous readback did not fail closed: %',readback;
  end if;

  begin
    perform public.compute_unified_restart_actuator_precondition_v2(
      jsonb_set(continuity,'{verified_download_mutation_active}','true'::jsonb), actuator);
    raise exception 'active verified download mutation unexpectedly accepted';
  exception when others then
    if sqlerrm='active verified download mutation unexpectedly accepted' then raise; end if;
  end;

  begin
    perform public.compute_unified_restart_actuator_precondition_v2(
      continuity, jsonb_set(actuator,'{process_incarnation_id}','"proc-drift"'::jsonb));
    raise exception 'actuator binding drift unexpectedly accepted';
  exception when others then
    if sqlerrm='actuator binding drift unexpectedly accepted' then raise; end if;
  end;

  begin
    perform public.h205f22_read_compute_unified_restart_effect_receipt_v1(
      (persisted->>'workspace_id')::uuid,persisted->>'attempt_id',persisted->>'effect_key',repeat('0',64));
    raise exception 'wrong fingerprint unexpectedly accepted';
  exception when others then
    if sqlerrm='wrong fingerprint unexpectedly accepted' then raise; end if;
  end;

  begin
    update public.compute_unified_restart_effect_receipt_h205f22
    set automatic_retry_allowed=true
    where effect_receipt_id=(persisted->>'effect_receipt_id')::uuid;
    raise exception 'durable no-retry constraint unexpectedly bypassed';
  exception when check_violation then null;
  end;

  update public.compute_unified_restart_effect_receipt_h205f22
  set verified_receipt=jsonb_set(verified,'{authority_effect}','true'::jsonb)
  where effect_receipt_id=(persisted->>'effect_receipt_id')::uuid;
  begin
    perform public.h205f22_read_compute_unified_restart_effect_receipt_v1(
      (persisted->>'workspace_id')::uuid,persisted->>'attempt_id',persisted->>'effect_key',persisted->>'receipt_fingerprint_sha256');
    raise exception 'authority-bearing durable envelope unexpectedly accepted';
  exception when others then
    if sqlerrm='authority-bearing durable envelope unexpectedly accepted' then raise; end if;
  end;

  update public.compute_unified_restart_effect_receipt_h205f22
  set verified_receipt=verified,
      expected_source_git_commit=repeat('b',40)
  where effect_receipt_id=(persisted->>'effect_receipt_id')::uuid;
  begin
    perform public.h205f22_read_compute_unified_restart_effect_receipt_v1(
      (persisted->>'workspace_id')::uuid,persisted->>'attempt_id',persisted->>'effect_key',persisted->>'receipt_fingerprint_sha256');
    raise exception 'durable provenance drift unexpectedly accepted';
  exception when others then
    if sqlerrm='durable provenance drift unexpectedly accepted' then raise; end if;
  end;
END $$;

DO $$
BEGIN
  if has_function_privilege('anon','public.compute_unified_restart_actuator_precondition_v2(jsonb,jsonb)','EXECUTE')
     or has_function_privilege('authenticated','public.compute_unified_restart_actuator_precondition_v2(jsonb,jsonb)','EXECUTE') then
    raise exception 'untrusted role unexpectedly has precondition EXECUTE';
  end if;
  if not has_function_privilege('service_role','public.compute_unified_restart_actuator_precondition_v2(jsonb,jsonb)','EXECUTE') then
    raise exception 'service_role missing precondition EXECUTE';
  end if;
  if has_function_privilege('anon','public.h205f22_read_compute_unified_restart_effect_receipt_v1(uuid,text,text,text)','EXECUTE') then
    raise exception 'anon unexpectedly has readback EXECUTE';
  end if;
  if has_function_privilege('authenticated','public.h205f22_read_compute_unified_restart_effect_receipt_v1(uuid,text,text,text)','EXECUTE') then
    raise exception 'authenticated unexpectedly has readback EXECUTE';
  end if;
  if not has_function_privilege('service_role','public.h205f22_read_compute_unified_restart_effect_receipt_v1(uuid,text,text,text)','EXECUTE') then
    raise exception 'service_role missing readback EXECUTE';
  end if;
END $$;
