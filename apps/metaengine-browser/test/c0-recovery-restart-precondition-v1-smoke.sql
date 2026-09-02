\set ON_ERROR_STOP on
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

\i supabase/migrations/20260901134500_compute_unified_restart_actuator_precondition_v1.sql
\i supabase/migrations/20260902044500_compute_unified_recovery_restart_precondition_v1.sql

DO $$
declare
  a jsonb; rr jsonb; ae jsonb; r jsonb;
  ws text := '22222222-2222-2222-2222-222222222222';
  src text := repeat('c',40);
begin
  a := jsonb_build_object(
    'schema','metaengine.compute-unified.recovery-admission-readback.v1',
    'verified',true,'reason','RECOVERY_ADMISSION_DURABLE_PROOF_VERIFIED',
    'workspace_id',ws,'attempt_id','attempt-final-1',
    'successor_client_id','client-final','successor_process_incarnation_id','proc-final',
    'successor_supervisor_epoch',12,'expected_source_git_commit',src,
    'recovery_admission_fingerprint_sha256',repeat('a',64),
    'recovery_admission_eligible',true,'enrollment_active',true,
    'active_actuation_lease_count',0,'unresolved_supervisor_command_count',0,
    'automatic_retry_allowed',false,'restart_authorized',false,'wake_replay_authorized',false,
    'lease_mutation_authorized',false,'promotion_authorized',false,'authority_effect',false);

  rr := jsonb_build_object(
    'verified',true,'latest',true,'state','ROLLOVER',
    'workspace_id',ws,'restart_intent_id',77,
    'successor_client_id','client-final','successor_process_incarnation_id','proc-final',
    'successor_supervisor_epoch',12,'expected_source_git_commit',src,
    'restart_authorized',false,'wake_replay_authorized',false,
    'lease_mutation_authorized',false,'authority_effect',false);

  ae := jsonb_build_object(
    'typed_actuator_verified',true,'lease_verified',true,
    'workspace_id',ws,'target_client_id','client-final',
    'target_process_incarnation_id','proc-final','supervisor_epoch',12,
    'expected_source_git_commit',src,'lease_id','lease-final-1',
    'effect_scope','BROWSER_RESTART','actuator_type','NATIVE_BROWSER_TYPED_ACTUATOR',
    'authority_effect',false);

  r := public.h205f22_compute_unified_recovery_restart_precondition_v1(a,rr,ae);
  if not coalesce((r->>'preconditions_verified')::boolean,false)
     or r->>'reason' is distinct from 'RECOVERY_AND_TYPED_RESTART_PRECONDITIONS_VERIFIED'
     or r->>'target_process_incarnation_id' is distinct from 'proc-final'
     or coalesce((r->>'automatic_retry_allowed')::boolean,true)
     or not coalesce((r->>'effect_must_be_single_shot')::boolean,false)
     or not coalesce((r->>'post_effect_readback_required')::boolean,false)
     or coalesce((r->>'restart_authorized')::boolean,true)
     or coalesce((r->>'authority_effect')::boolean,true) then
    raise exception 'valid composed precondition rejected or leaked authority: %',r;
  end if;

  begin
    perform public.h205f22_compute_unified_recovery_restart_precondition_v1(
      jsonb_set(a,'{successor_process_incarnation_id}','"proc-drift"'),rr,ae);
    raise exception 'process drift accepted';
  exception when others then
    if sqlerrm='process drift accepted' then raise; end if;
  end;

  begin
    perform public.h205f22_compute_unified_recovery_restart_precondition_v1(
      jsonb_set(a,'{restart_authorized}','true'),rr,ae);
    raise exception 'authority-bearing admission accepted';
  exception when others then
    if sqlerrm='authority-bearing admission accepted' then raise; end if;
  end;

  begin
    perform public.h205f22_compute_unified_recovery_restart_precondition_v1(
      a,rr,jsonb_set(ae,'{lease_id}','"lease-drift"'));
  exception when others then
    raise exception 'independent lease identity should remain valid when exact typed evidence is otherwise bound: %',sqlerrm;
  end;
end $$;

DO $$ begin
  if has_function_privilege('anon','public.h205f22_compute_unified_recovery_restart_precondition_v1(jsonb,jsonb,jsonb)','EXECUTE') then raise exception 'anon execute leaked'; end if;
  if has_function_privilege('authenticated','public.h205f22_compute_unified_recovery_restart_precondition_v1(jsonb,jsonb,jsonb)','EXECUTE') then raise exception 'authenticated execute leaked'; end if;
  if not has_function_privilege('service_role','public.h205f22_compute_unified_recovery_restart_precondition_v1(jsonb,jsonb,jsonb)','EXECUTE') then raise exception 'service_role execute missing'; end if;
end $$;
