\set ON_ERROR_STOP on

create role anon;
create role authenticated;
create role service_role;

\i supabase/migrations/20260901144500_compute_unified_restart_effect_receipt_v1.sql
\i supabase/migrations/20260901154500_compute_unified_restart_effect_receipt_persistence_v1.sql
\i supabase/migrations/20260901165000_compute_unified_restart_effect_receipt_readback_v1.sql

DO $$
DECLARE
  p jsonb := jsonb_build_object(
    'preconditions_verified',true,'authority_effect',false,'restart_authorized',false,
    'automatic_retry_allowed',false,'effect_must_be_single_shot',true,
    'post_effect_readback_required',true,'effect_scope','BROWSER_RESTART',
    'actuator_type','NATIVE_BROWSER_TYPED_ACTUATOR','workspace_id','11111111-1111-1111-1111-111111111111',
    'lease_id','lease-1','target_client_id','browser-a','target_process_incarnation_id','proc-old',
    'supervisor_epoch',7,'expected_source_git_commit',repeat('a',40)
  );
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
    perform public.h205f22_read_compute_unified_restart_effect_receipt_v1(
      (persisted->>'workspace_id')::uuid,persisted->>'attempt_id',persisted->>'effect_key',repeat('0',64));
    raise exception 'wrong fingerprint unexpectedly accepted';
  exception when others then
    if sqlerrm='wrong fingerprint unexpectedly accepted' then raise; end if;
  end;

  update public.compute_unified_restart_effect_receipt_h205f22
  set automatic_retry_allowed=true
  where effect_receipt_id=(persisted->>'effect_receipt_id')::uuid;
  begin
    perform public.h205f22_read_compute_unified_restart_effect_receipt_v1(
      (persisted->>'workspace_id')::uuid,persisted->>'attempt_id',persisted->>'effect_key',persisted->>'receipt_fingerprint_sha256');
    raise exception 'retry-authorized durable row unexpectedly accepted';
  exception when others then
    if sqlerrm='retry-authorized durable row unexpectedly accepted' then raise; end if;
  end;
  update public.compute_unified_restart_effect_receipt_h205f22
  set automatic_retry_allowed=false
  where effect_receipt_id=(persisted->>'effect_receipt_id')::uuid;

  update public.compute_unified_restart_effect_receipt_h205f22
  set expected_source_git_commit=repeat('b',40)
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
