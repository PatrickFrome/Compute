\set ON_ERROR_STOP on
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

\i supabase/migrations/20260902054600_compute_unified_recovery_restart_precondition_proof_persistence_v1.sql

DO $$
declare
  e jsonb; r1 jsonb; r2 jsonb; fp text;
  ws uuid := '11111111-1111-1111-1111-111111111111';
begin
  e := jsonb_build_object(
    'schema','metaengine.compute-unified.recovery-restart-precondition.v1',
    'preconditions_verified',true,'reason','RECOVERY_AND_TYPED_RESTART_PRECONDITIONS_VERIFIED',
    'workspace_id',ws,'recovery_attempt_id','attempt-1','recovery_admission_fingerprint_sha256',repeat('a',64),
    'restart_intent_id','restart-1','lease_id','lease-1','actuator_type','NATIVE_BROWSER_TYPED_ACTUATOR',
    'effect_scope','BROWSER_RESTART','target_client_id','client-new','target_process_incarnation_id','proc-new',
    'supervisor_epoch',9,'expected_source_git_commit',repeat('b',40),
    'automatic_retry_allowed',false,'effect_must_be_single_shot',true,'post_effect_readback_required',true,
    'restart_authorized',false,'wake_replay_authorized',false,'lease_mutation_authorized',false,
    'promotion_authorized',false,'authority_effect',false);

  r1 := public.h205f22_persist_compute_unified_recovery_restart_precondition_proof_v1(e);
  fp := r1->>'recovery_restart_precondition_fingerprint_sha256';
  if fp !~ '^[0-9a-f]{64}$' or not coalesce((r1->>'persistence_effect')::boolean,false)
     or coalesce((r1->>'automatic_retry_allowed')::boolean,true)
     or not coalesce((r1->>'effect_must_be_single_shot')::boolean,false)
     or not coalesce((r1->>'post_effect_readback_required')::boolean,false)
     or coalesce((r1->>'restart_authorized')::boolean,true)
     or coalesce((r1->>'wake_replay_authorized')::boolean,true)
     or coalesce((r1->>'lease_mutation_authorized')::boolean,true)
     or coalesce((r1->>'promotion_authorized')::boolean,true)
     or coalesce((r1->>'authority_effect')::boolean,true) then
    raise exception 'valid persistence rejected or leaked authority: %',r1;
  end if;

  r2 := public.h205f22_persist_compute_unified_recovery_restart_precondition_proof_v1(e);
  if coalesce((r2->>'persistence_effect')::boolean,true) or r2->>'recovery_restart_precondition_fingerprint_sha256' is distinct from fp then
    raise exception 'exact replay was not physical no-op: %',r2;
  end if;

  begin
    perform public.h205f22_persist_compute_unified_recovery_restart_precondition_proof_v1(jsonb_set(e,'{target_process_incarnation_id}','"proc-drift"'));
    raise exception 'process provenance collision accepted';
  exception when others then if sqlerrm='process provenance collision accepted' then raise; end if; end;

  begin
    perform public.h205f22_persist_compute_unified_recovery_restart_precondition_proof_v1(jsonb_set(e,'{lease_id}','"lease-drift"'));
    raise exception 'lease provenance collision accepted';
  exception when others then if sqlerrm='lease provenance collision accepted' then raise; end if; end;

  begin
    perform public.h205f22_persist_compute_unified_recovery_restart_precondition_proof_v1(jsonb_set(e,'{automatic_retry_allowed}','true'));
    raise exception 'retry-bearing evidence accepted';
  exception when others then if sqlerrm='retry-bearing evidence accepted' then raise; end if; end;

  begin
    perform public.h205f22_persist_compute_unified_recovery_restart_precondition_proof_v1(jsonb_set(e,'{restart_authorized}','true'));
    raise exception 'authority-bearing evidence accepted';
  exception when others then if sqlerrm='authority-bearing evidence accepted' then raise; end if; end;

  if (select count(*) from public.compute_unified_recovery_restart_precondition_proof_h205f22 where workspace_id=ws and recovery_attempt_id='attempt-1') <> 1 then
    raise exception 'unexpected durable row count';
  end if;
end $$;

DO $$ begin
  if has_table_privilege('service_role','public.compute_unified_recovery_restart_precondition_proof_h205f22','INSERT') then raise exception 'service_role direct insert leaked'; end if;
  if has_table_privilege('anon','public.compute_unified_recovery_restart_precondition_proof_h205f22','SELECT') then raise exception 'anon table read leaked'; end if;
  if has_function_privilege('anon','public.h205f22_persist_compute_unified_recovery_restart_precondition_proof_v1(jsonb)','EXECUTE') then raise exception 'anon execute leaked'; end if;
  if has_function_privilege('authenticated','public.h205f22_persist_compute_unified_recovery_restart_precondition_proof_v1(jsonb)','EXECUTE') then raise exception 'authenticated execute leaked'; end if;
  if not has_function_privilege('service_role','public.h205f22_persist_compute_unified_recovery_restart_precondition_proof_v1(jsonb)','EXECUTE') then raise exception 'service_role execute missing'; end if;
end $$;
