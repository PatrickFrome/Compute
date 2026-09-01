\set ON_ERROR_STOP on

create role anon;
create role authenticated;
create role service_role;

\i supabase/migrations/20260901144500_compute_unified_restart_effect_receipt_v1.sql

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
  r jsonb := jsonb_build_object(
    'authority_effect',false,'automatic_retry_allowed',false,'effect_scope','BROWSER_RESTART',
    'actuator_type','NATIVE_BROWSER_TYPED_ACTUATOR','attempt_id','attempt-1','effect_key','restart:attempt-1',
    'workspace_id','11111111-1111-1111-1111-111111111111','lease_id','lease-1',
    'target_client_id','browser-a','target_process_incarnation_id','proc-old','supervisor_epoch',7,
    'expected_source_git_commit',repeat('a',40),'outcome','AMBIGUOUS','effect_attempted',true,
    'post_effect_readback_verified',false
  );
  out jsonb;
BEGIN
  out := public.h205f22_compute_unified_restart_effect_receipt_v1(p,r);
  if out->>'disposition' is distinct from 'HOLD_AMBIGUOUS'
     or coalesce((out->>'automatic_retry_allowed')::boolean,true)
     or coalesce((out->>'authority_effect')::boolean,true) then
    raise exception 'ambiguous receipt did not hold fail-closed: %',out;
  end if;

  out := public.h205f22_compute_unified_restart_effect_receipt_v1(
    p,
    r || jsonb_build_object(
      'outcome','VERIFIED_SUCCESS','post_effect_readback_verified',true,
      'observed_successor_process_incarnation_id','proc-new','observed_successor_supervisor_epoch',8
    )
  );
  if out->>'disposition' is distinct from 'VERIFIED_RESTART'
     or out->>'successor_process_incarnation_id' is distinct from 'proc-new'
     or (out->>'successor_supervisor_epoch')::bigint <> 8
     or coalesce((out->>'restart_authorized')::boolean,true) then
    raise exception 'verified successor receipt rejected or leaked authority: %',out;
  end if;

  begin
    perform public.h205f22_compute_unified_restart_effect_receipt_v1(
      p,
      r || jsonb_build_object(
        'outcome','VERIFIED_SUCCESS','post_effect_readback_verified',true,
        'observed_successor_process_incarnation_id','proc-old','observed_successor_supervisor_epoch',8
      )
    );
    raise exception 'process reuse unexpectedly accepted';
  exception when others then
    if sqlerrm='process reuse unexpectedly accepted' then raise; end if;
  end;

  begin
    perform public.h205f22_compute_unified_restart_effect_receipt_v1(
      p,
      r || jsonb_build_object(
        'outcome','VERIFIED_SUCCESS','post_effect_readback_verified',true,
        'observed_successor_process_incarnation_id','proc-new','observed_successor_supervisor_epoch',9
      )
    );
    raise exception 'epoch skip unexpectedly accepted';
  exception when others then
    if sqlerrm='epoch skip unexpectedly accepted' then raise; end if;
  end;

  begin
    perform public.h205f22_compute_unified_restart_effect_receipt_v1(
      p, jsonb_set(r,'{lease_id}',to_jsonb('lease-drift'::text)));
    raise exception 'lease drift unexpectedly accepted';
  exception when others then
    if sqlerrm='lease drift unexpectedly accepted' then raise; end if;
  end;

  begin
    perform public.h205f22_compute_unified_restart_effect_receipt_v1(
      p, jsonb_set(r,'{automatic_retry_allowed}','true'::jsonb));
    raise exception 'retry-authorized receipt unexpectedly accepted';
  exception when others then
    if sqlerrm='retry-authorized receipt unexpectedly accepted' then raise; end if;
  end;
END $$;

DO $$
BEGIN
  if has_function_privilege('anon','public.h205f22_compute_unified_restart_effect_receipt_v1(jsonb,jsonb)','EXECUTE') then
    raise exception 'anon unexpectedly has EXECUTE';
  end if;
  if has_function_privilege('authenticated','public.h205f22_compute_unified_restart_effect_receipt_v1(jsonb,jsonb)','EXECUTE') then
    raise exception 'authenticated unexpectedly has EXECUTE';
  end if;
  if not has_function_privilege('service_role','public.h205f22_compute_unified_restart_effect_receipt_v1(jsonb,jsonb)','EXECUTE') then
    raise exception 'service_role missing EXECUTE';
  end if;
END $$;
