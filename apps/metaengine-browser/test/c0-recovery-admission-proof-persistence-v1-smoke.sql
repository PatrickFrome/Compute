\set ON_ERROR_STOP on
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

\i supabase/migrations/20260902024500_compute_unified_recovery_admission_proof_persistence_v1.sql

DO $$
declare
  e jsonb; r1 jsonb; r2 jsonb; fp text;
  ws uuid := '11111111-1111-1111-1111-111111111111';
  src text := repeat('a',40);
  resume_fp text := repeat('b',64);
begin
  e := jsonb_build_object(
    'schema','metaengine.compute-unified.recovery-admission-gate.v1',
    'verified',true,'recovery_admission_eligible',true,'reason','RECOVERY_ADMISSION_EVIDENCE_VERIFIED',
    'workspace_id',ws,'attempt_id','attempt-1','successor_client_id','client-new',
    'successor_process_incarnation_id','proc-new','successor_supervisor_epoch',9,
    'expected_source_git_commit',src,'recovery_resume_fingerprint_sha256',resume_fp,
    'fresh_heartbeat_observed_at',statement_timestamp(),
    'enrollment_active',true,'active_actuation_lease_count',0,'unresolved_supervisor_command_count',0,
    'automatic_retry_allowed',false,'restart_authorized',false,'wake_replay_authorized',false,
    'lease_mutation_authorized',false,'promotion_authorized',false,'authority_effect',false);

  r1 := public.h205f22_persist_compute_unified_recovery_admission_proof_v1(e);
  fp := r1->>'recovery_admission_fingerprint_sha256';
  if fp !~ '^[0-9a-f]{64}$' or not coalesce((r1->>'persistence_effect')::boolean,false)
     or coalesce((r1->>'automatic_retry_allowed')::boolean,true)
     or coalesce((r1->>'restart_authorized')::boolean,true)
     or coalesce((r1->>'wake_replay_authorized')::boolean,true)
     or coalesce((r1->>'lease_mutation_authorized')::boolean,true)
     or coalesce((r1->>'promotion_authorized')::boolean,true)
     or coalesce((r1->>'authority_effect')::boolean,true) then
    raise exception 'valid admission persistence rejected or leaked authority: %',r1;
  end if;

  r2 := public.h205f22_persist_compute_unified_recovery_admission_proof_v1(e);
  if coalesce((r2->>'persistence_effect')::boolean,true) or r2->>'recovery_admission_fingerprint_sha256' is distinct from fp then
    raise exception 'exact replay was not physical no-op: %',r2;
  end if;

  begin
    perform public.h205f22_persist_compute_unified_recovery_admission_proof_v1(jsonb_set(e,'{successor_process_incarnation_id}','"proc-drift"'));
    raise exception 'provenance collision accepted';
  exception when others then
    if sqlerrm='provenance collision accepted' then raise; end if;
  end;

  begin
    perform public.h205f22_persist_compute_unified_recovery_admission_proof_v1(jsonb_set(e,'{active_actuation_lease_count}','1'));
    raise exception 'active lease evidence accepted';
  exception when others then
    if sqlerrm='active lease evidence accepted' then raise; end if;
  end;

  begin
    perform public.h205f22_persist_compute_unified_recovery_admission_proof_v1(jsonb_set(e,'{unresolved_supervisor_command_count}','1'));
    raise exception 'unresolved command evidence accepted';
  exception when others then
    if sqlerrm='unresolved command evidence accepted' then raise; end if;
  end;

  begin
    perform public.h205f22_persist_compute_unified_recovery_admission_proof_v1(jsonb_set(e,'{restart_authorized}','true'));
    raise exception 'authority-bearing evidence accepted';
  exception when others then
    if sqlerrm='authority-bearing evidence accepted' then raise; end if;
  end;

  if (select count(*) from public.compute_unified_recovery_admission_proof_h205f22 where workspace_id=ws and attempt_id='attempt-1') <> 1 then
    raise exception 'unexpected durable row count';
  end if;
end $$;

DO $$ begin
  if has_table_privilege('service_role','public.compute_unified_recovery_admission_proof_h205f22','INSERT') then raise exception 'service_role direct insert leaked'; end if;
  if has_table_privilege('anon','public.compute_unified_recovery_admission_proof_h205f22','SELECT') then raise exception 'anon table read leaked'; end if;
  if has_function_privilege('anon','public.h205f22_persist_compute_unified_recovery_admission_proof_v1(jsonb)','EXECUTE') then raise exception 'anon execute leaked'; end if;
  if has_function_privilege('authenticated','public.h205f22_persist_compute_unified_recovery_admission_proof_v1(jsonb)','EXECUTE') then raise exception 'authenticated execute leaked'; end if;
  if not has_function_privilege('service_role','public.h205f22_persist_compute_unified_recovery_admission_proof_v1(jsonb)','EXECUTE') then raise exception 'service_role execute missing'; end if;
end $$;
