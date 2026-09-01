\set ON_ERROR_STOP on

create role anon;
create role authenticated;
create role service_role;

\i supabase/migrations/20260901144500_compute_unified_restart_effect_receipt_v1.sql
\i supabase/migrations/20260901154500_compute_unified_restart_effect_receipt_persistence_v1.sql

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
  out1 jsonb;
  out2 jsonb;
  row_count bigint;
BEGIN
  verified := public.h205f22_compute_unified_restart_effect_receipt_v1(p,raw_ambiguous);
  out1 := public.h205f22_persist_compute_unified_restart_effect_receipt_v1(verified);
  if out1->>'disposition' is distinct from 'HOLD_AMBIGUOUS'
     or not coalesce((out1->>'persistence_effect')::boolean,false)
     or coalesce((out1->>'automatic_retry_allowed')::boolean,true)
     or coalesce((out1->>'authority_effect')::boolean,true) then
    raise exception 'first ambiguous persistence did not fail closed: %',out1;
  end if;

  out2 := public.h205f22_persist_compute_unified_restart_effect_receipt_v1(verified);
  if coalesce((out2->>'persistence_effect')::boolean,true)
     or out2->>'receipt_fingerprint_sha256' is distinct from out1->>'receipt_fingerprint_sha256' then
    raise exception 'exact replay was not a physical no-op/readback: %',out2;
  end if;

  select count(*) into row_count
  from public.compute_unified_restart_effect_receipt_h205f22
  where workspace_id='11111111-1111-1111-1111-111111111111'::uuid and attempt_id='attempt-1';
  if row_count <> 1 then raise exception 'expected exactly one durable attempt row, got %',row_count; end if;

  begin
    perform public.h205f22_persist_compute_unified_restart_effect_receipt_v1(
      verified || jsonb_build_object('effect_key','restart:attempt-1-drift'));
    raise exception 'conflicting replay unexpectedly accepted';
  exception when others then
    if sqlerrm='conflicting replay unexpectedly accepted' then raise; end if;
  end;

  begin
    perform public.h205f22_persist_compute_unified_restart_effect_receipt_v1(
      jsonb_set(verified,'{automatic_retry_allowed}','true'::jsonb));
    raise exception 'retry-authorized evidence unexpectedly persisted';
  exception when others then
    if sqlerrm='retry-authorized evidence unexpectedly persisted' then raise; end if;
  end;

  begin
    perform public.h205f22_persist_compute_unified_restart_effect_receipt_v1(
      verified || jsonb_build_object(
        'disposition','VERIFIED_RESTART','outcome','VERIFIED_SUCCESS',
        'successor_process_incarnation_id','proc-new','successor_supervisor_epoch',9));
    raise exception 'epoch-skipping verified restart unexpectedly persisted';
  exception when others then
    if sqlerrm='epoch-skipping verified restart unexpectedly persisted' then raise; end if;
  end;
END $$;

DO $$
BEGIN
  if has_function_privilege('anon','public.h205f22_persist_compute_unified_restart_effect_receipt_v1(jsonb)','EXECUTE') then
    raise exception 'anon unexpectedly has writer EXECUTE';
  end if;
  if has_function_privilege('authenticated','public.h205f22_persist_compute_unified_restart_effect_receipt_v1(jsonb)','EXECUTE') then
    raise exception 'authenticated unexpectedly has writer EXECUTE';
  end if;
  if not has_function_privilege('service_role','public.h205f22_persist_compute_unified_restart_effect_receipt_v1(jsonb)','EXECUTE') then
    raise exception 'service_role missing writer EXECUTE';
  end if;
  if has_table_privilege('service_role','public.compute_unified_restart_effect_receipt_h205f22','INSERT')
     or has_table_privilege('service_role','public.compute_unified_restart_effect_receipt_h205f22','UPDATE')
     or has_table_privilege('service_role','public.compute_unified_restart_effect_receipt_h205f22','DELETE') then
    raise exception 'service_role unexpectedly has direct effect-receipt mutation authority';
  end if;
END $$;
