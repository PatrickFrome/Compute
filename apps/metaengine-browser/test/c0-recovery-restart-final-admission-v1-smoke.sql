\set ON_ERROR_STOP on
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
\i supabase/migrations/20260902101500_compute_unified_recovery_restart_final_admission_v1.sql

DO $$
declare
  p jsonb;
  s jsonb;
  r jsonb;
begin
  p := jsonb_build_object(
    'schema','metaengine.compute-unified.recovery-restart-effect-intent-readback.v1',
    'verified',true,
    'reason','RECOVERY_RESTART_EFFECT_INTENT_DURABLE_PROOF_VERIFIED',
    'workspace_id','44444444-4444-4444-4444-444444444444',
    'restart_intent_id','restart-final-1',
    'lease_id','lease-final-1',
    'target_client_id','client-final',
    'target_process_incarnation_id','proc-final',
    'supervisor_epoch',13,
    'expected_source_git_commit',repeat('a',40),
    'automatic_retry_allowed',false,
    'effect_must_be_single_shot',true,
    'post_effect_readback_required',true,
    'restart_authorized',false,
    'wake_replay_authorized',false,
    'lease_mutation_authorized',false,
    'promotion_authorized',false,
    'authority_effect',false);

  s := jsonb_build_object(
    'schema','metaengine.browser.recovery-runtime-snapshot.v1',
    'heartbeat_fresh',true,
    'quiescent',true,
    'active_wake_count',0,
    'queued_wake_count',0,
    'ambiguous_wake_count',0,
    'active_worker_generation_count',0,
    'active_supervisor_generation_count',0,
    'active_actuation_lease_count',1,
    'workspace_id','44444444-4444-4444-4444-444444444444',
    'restart_intent_id','restart-final-1',
    'lease_id','lease-final-1',
    'target_client_id','client-final',
    'target_process_incarnation_id','proc-final',
    'supervisor_epoch',13,
    'integration_source_git_commit',repeat('a',40),
    'actuator_type','NATIVE_BROWSER_TYPED_ACTUATOR',
    'effect_scope','BROWSER_RESTART',
    'typed_lease_valid',true,
    'supervisor_keepalive_continuous',true,
    'enrollment_active',true,
    'trusted_update_channel_match',true,
    'update_metadata_verified',true,
    'update_publisher_verified',true,
    'restart_gate_safe',true,
    'downgrade_requested',false,
    'web_installer_used',false,
    'automatic_retry_allowed',false,
    'authority_effect',false);

  r := public.h205f22_verify_compute_unified_recovery_restart_final_admission_v1(p,s);
  if not coalesce((r->>'verified')::boolean,false)
     or r->>'reason' <> 'RECOVERY_RESTART_FINAL_PRECONDITIONS_VERIFIED_NOT_AUTHORIZED'
     or coalesce((r->>'restart_authorized')::boolean,true)
     or coalesce((r->>'automatic_retry_allowed')::boolean,true)
     or coalesce((r->>'authority_effect')::boolean,true)
     or not coalesce((r->>'effect_must_be_single_shot')::boolean,false)
     or not coalesce((r->>'post_effect_readback_required')::boolean,false) then
    raise exception 'valid preconditions rejected or authority leaked: %',r;
  end if;

  begin
    perform public.h205f22_verify_compute_unified_recovery_restart_final_admission_v1(p,jsonb_set(s,'{queued_wake_count}','1'));
    raise exception 'queued wake accepted';
  exception when others then if sqlerrm='queued wake accepted' then raise; end if; end;

  begin
    perform public.h205f22_verify_compute_unified_recovery_restart_final_admission_v1(p,jsonb_set(s,'{heartbeat_fresh}','false'));
    raise exception 'stale heartbeat accepted';
  exception when others then if sqlerrm='stale heartbeat accepted' then raise; end if; end;

  begin
    perform public.h205f22_verify_compute_unified_recovery_restart_final_admission_v1(p,jsonb_set(s,'{target_process_incarnation_id}','"proc-drift"'));
    raise exception 'process drift accepted';
  exception when others then if sqlerrm='process drift accepted' then raise; end if; end;

  begin
    perform public.h205f22_verify_compute_unified_recovery_restart_final_admission_v1(p,jsonb_set(s,'{update_metadata_verified}','false'));
    raise exception 'unverified update metadata accepted';
  exception when others then if sqlerrm='unverified update metadata accepted' then raise; end if; end;

  begin
    perform public.h205f22_verify_compute_unified_recovery_restart_final_admission_v1(p,jsonb_set(s,'{active_actuation_lease_count}','0'));
    raise exception 'missing typed lease accepted';
  exception when others then if sqlerrm='missing typed lease accepted' then raise; end if; end;
end $$;

DO $$ begin
  if has_function_privilege('anon','public.h205f22_verify_compute_unified_recovery_restart_final_admission_v1(jsonb,jsonb)','EXECUTE') then raise exception 'anon execute leaked'; end if;
  if has_function_privilege('authenticated','public.h205f22_verify_compute_unified_recovery_restart_final_admission_v1(jsonb,jsonb)','EXECUTE') then raise exception 'authenticated execute leaked'; end if;
  if not has_function_privilege('service_role','public.h205f22_verify_compute_unified_recovery_restart_final_admission_v1(jsonb,jsonb)','EXECUTE') then raise exception 'service_role execute missing'; end if;
end $$;
