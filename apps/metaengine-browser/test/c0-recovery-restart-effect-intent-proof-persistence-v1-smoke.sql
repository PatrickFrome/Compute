\set ON_ERROR_STOP on
\i supabase/migrations/20260902084400_compute_unified_recovery_restart_effect_intent_proof_persistence_v1.sql
DO $$
declare e jsonb; a jsonb; b jsonb; src text := repeat('a',40);
begin
e := jsonb_build_object('schema','metaengine.compute-unified.recovery-restart-effect-intent.v1','intent_bound',true,'reason','DURABLE_RECOVERY_RESTART_EFFECT_INTENT_BOUND','workspace_id','44444444-4444-4444-4444-444444444444','recovery_attempt_id','recovery-effect-1','restart_intent_id','restart-effect-1','lease_id','lease-effect-1','actuator_type','NATIVE_BROWSER_TYPED_ACTUATOR','effect_scope','BROWSER_RESTART','target_client_id','client-effect','target_process_incarnation_id','proc-effect','supervisor_epoch',17,'expected_source_git_commit',src,'recovery_restart_precondition_fingerprint_sha256',repeat('b',64),'automatic_retry_allowed',false,'effect_must_be_single_shot',true,'post_effect_readback_required',true,'restart_authorized',false,'wake_replay_authorized',false,'lease_mutation_authorized',false,'promotion_authorized',false,'authority_effect',false);
a := public.h205f22_persist_compute_unified_recovery_restart_effect_intent_proof_v1(e);
if not coalesce((a->>'persistence_effect')::boolean,false) or coalesce((a->>'restart_authorized')::boolean,true) or coalesce((a->>'authority_effect')::boolean,true) then raise exception 'valid persistence rejected or authority leaked'; end if;
b := public.h205f22_persist_compute_unified_recovery_restart_effect_intent_proof_v1(e);
if coalesce((b->>'persistence_effect')::boolean,true) or a->>'recovery_restart_effect_intent_fingerprint_sha256' is distinct from b->>'recovery_restart_effect_intent_fingerprint_sha256' then raise exception 'exact replay not idempotent'; end if;
begin perform public.h205f22_persist_compute_unified_recovery_restart_effect_intent_proof_v1(jsonb_set(e,'{target_process_incarnation_id}','"proc-drift"')); raise exception 'process drift accepted'; exception when others then if sqlerrm='process drift accepted' then raise; end if; end;
begin perform public.h205f22_persist_compute_unified_recovery_restart_effect_intent_proof_v1(jsonb_set(e,'{automatic_retry_allowed}','true')); raise exception 'retry intent accepted'; exception when others then if sqlerrm='retry intent accepted' then raise; end if; end;
if has_table_privilege('service_role','public.compute_unified_recovery_restart_effect_intent_proof_h205f22','SELECT') or has_table_privilege('service_role','public.compute_unified_recovery_restart_effect_intent_proof_h205f22','INSERT') then raise exception 'service_role raw-table privilege leaked'; end if;
end $$;
