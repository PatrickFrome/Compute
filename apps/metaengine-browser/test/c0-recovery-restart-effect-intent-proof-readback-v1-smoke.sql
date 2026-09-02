\set ON_ERROR_STOP on
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

\i supabase/migrations/20260902084400_compute_unified_recovery_restart_effect_intent_proof_persistence_v1.sql
\i supabase/migrations/20260902094500_compute_unified_recovery_restart_effect_intent_proof_readback_v1.sql

DO $$
declare
  e jsonb; p jsonb; r jsonb; fp text;
  ws uuid := '44444444-4444-4444-4444-444444444444';
  src text := repeat('a',40);
  precondition_fp text := repeat('b',64);
begin
  e := jsonb_build_object(
    'schema','metaengine.compute-unified.recovery-restart-effect-intent.v1',
    'intent_bound',true,
    'reason','DURABLE_RECOVERY_RESTART_EFFECT_INTENT_BOUND',
    'workspace_id',ws,
    'recovery_attempt_id','recovery-effect-rb-1',
    'restart_intent_id','restart-effect-rb-1',
    'lease_id','lease-effect-rb-1',
    'actuator_type','NATIVE_BROWSER_TYPED_ACTUATOR',
    'effect_scope','BROWSER_RESTART',
    'target_client_id','client-effect-rb',
    'target_process_incarnation_id','proc-effect-rb',
    'supervisor_epoch',13,
    'expected_source_git_commit',src,
    'recovery_restart_precondition_fingerprint_sha256',precondition_fp,
    'automatic_retry_allowed',false,
    'effect_must_be_single_shot',true,
    'post_effect_readback_required',true,
    'restart_authorized',false,
    'wake_replay_authorized',false,
    'lease_mutation_authorized',false,
    'promotion_authorized',false,
    'authority_effect',false);

  p := public.h205f22_persist_compute_unified_recovery_restart_effect_intent_proof_v1(e);
  fp := p->>'recovery_restart_effect_intent_fingerprint_sha256';
  r := public.h205f22_verify_compute_unified_recovery_restart_effect_intent_proof_v1(ws,'recovery-effect-rb-1','restart-effect-rb-1',fp);

  if not coalesce((r->>'verified')::boolean,false)
     or r->>'reason' is distinct from 'RECOVERY_RESTART_EFFECT_INTENT_DURABLE_PROOF_VERIFIED'
     or r->>'target_process_incarnation_id' is distinct from 'proc-effect-rb'
     or r->>'lease_id' is distinct from 'lease-effect-rb-1'
     or r->>'recovery_restart_precondition_fingerprint_sha256' is distinct from precondition_fp
     or r->>'recovery_restart_effect_intent_fingerprint_sha256' is distinct from fp
     or coalesce((r->>'automatic_retry_allowed')::boolean,true)
     or not coalesce((r->>'effect_must_be_single_shot')::boolean,false)
     or not coalesce((r->>'post_effect_readback_required')::boolean,false)
     or coalesce((r->>'restart_authorized')::boolean,true)
     or coalesce((r->>'wake_replay_authorized')::boolean,true)
     or coalesce((r->>'lease_mutation_authorized')::boolean,true)
     or coalesce((r->>'promotion_authorized')::boolean,true)
     or coalesce((r->>'authority_effect')::boolean,true) then
    raise exception 'valid durable restart effect intent readback rejected or leaked authority: %',r;
  end if;

  begin
    perform public.h205f22_verify_compute_unified_recovery_restart_effect_intent_proof_v1(ws,'recovery-effect-rb-1','restart-effect-rb-1',repeat('0',64));
    raise exception 'wrong fingerprint accepted';
  exception when others then
    if sqlerrm='wrong fingerprint accepted' then raise; end if;
  end;

  begin
    perform public.h205f22_verify_compute_unified_recovery_restart_effect_intent_proof_v1(ws,'recovery-effect-rb-1','restart-wrong',fp);
    raise exception 'wrong restart intent accepted';
  exception when others then
    if sqlerrm='wrong restart intent accepted' then raise; end if;
  end;

  update public.compute_unified_recovery_restart_effect_intent_proof_h205f22
     set verified_evidence=jsonb_set(verified_evidence,'{target_process_incarnation_id}','"proc-tampered"')
   where workspace_id=ws and recovery_attempt_id='recovery-effect-rb-1' and restart_intent_id='restart-effect-rb-1';
  begin
    perform public.h205f22_verify_compute_unified_recovery_restart_effect_intent_proof_v1(ws,'recovery-effect-rb-1','restart-effect-rb-1',fp);
    raise exception 'tampered evidence accepted';
  exception when others then
    if sqlerrm='tampered evidence accepted' then raise; end if;
  end;
end $$;

DO $$ begin
  if has_table_privilege('service_role','public.compute_unified_recovery_restart_effect_intent_proof_h205f22','SELECT') then raise exception 'service_role raw table read leaked'; end if;
  if has_function_privilege('anon','public.h205f22_verify_compute_unified_recovery_restart_effect_intent_proof_v1(uuid,text,text,text)','EXECUTE') then raise exception 'anon verifier execute leaked'; end if;
  if has_function_privilege('authenticated','public.h205f22_verify_compute_unified_recovery_restart_effect_intent_proof_v1(uuid,text,text,text)','EXECUTE') then raise exception 'authenticated verifier execute leaked'; end if;
  if not has_function_privilege('service_role','public.h205f22_verify_compute_unified_recovery_restart_effect_intent_proof_v1(uuid,text,text,text)','EXECUTE') then raise exception 'service_role verifier execute missing'; end if;
end $$;
