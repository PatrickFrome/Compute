\set ON_ERROR_STOP on
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

\i supabase/migrations/20260902024500_compute_unified_recovery_admission_proof_persistence_v1.sql
\i supabase/migrations/20260902035000_compute_unified_recovery_admission_proof_readback_v1.sql

DO $$
declare
  e jsonb; p jsonb; r jsonb; fp text;
  ws uuid := '22222222-2222-2222-2222-222222222222';
  src text := repeat('c',40);
  resume_fp text := repeat('d',64);
begin
  e := jsonb_build_object(
    'schema','metaengine.compute-unified.recovery-admission-gate.v1',
    'verified',true,'recovery_admission_eligible',true,'reason','RECOVERY_ADMISSION_EVIDENCE_VERIFIED',
    'workspace_id',ws,'attempt_id','attempt-readback-1','successor_client_id','client-rb',
    'successor_process_incarnation_id','proc-rb','successor_supervisor_epoch',11,
    'expected_source_git_commit',src,'recovery_resume_fingerprint_sha256',resume_fp,
    'fresh_heartbeat_observed_at',statement_timestamp(),
    'enrollment_active',true,'active_actuation_lease_count',0,'unresolved_supervisor_command_count',0,
    'automatic_retry_allowed',false,'restart_authorized',false,'wake_replay_authorized',false,
    'lease_mutation_authorized',false,'promotion_authorized',false,'authority_effect',false);

  p := public.h205f22_persist_compute_unified_recovery_admission_proof_v1(e);
  fp := p->>'recovery_admission_fingerprint_sha256';
  r := public.h205f22_verify_compute_unified_recovery_admission_proof_v1(ws,'attempt-readback-1',fp);
  if not coalesce((r->>'verified')::boolean,false)
     or r->>'reason' is distinct from 'RECOVERY_ADMISSION_DURABLE_PROOF_VERIFIED'
     or r->>'successor_process_incarnation_id' is distinct from 'proc-rb'
     or r->>'recovery_admission_fingerprint_sha256' is distinct from fp
     or coalesce((r->>'automatic_retry_allowed')::boolean,true)
     or coalesce((r->>'restart_authorized')::boolean,true)
     or coalesce((r->>'wake_replay_authorized')::boolean,true)
     or coalesce((r->>'lease_mutation_authorized')::boolean,true)
     or coalesce((r->>'promotion_authorized')::boolean,true)
     or coalesce((r->>'authority_effect')::boolean,true) then
    raise exception 'valid durable readback rejected or leaked authority: %',r;
  end if;

  begin
    perform public.h205f22_verify_compute_unified_recovery_admission_proof_v1(ws,'attempt-readback-1',repeat('0',64));
    raise exception 'wrong fingerprint accepted';
  exception when others then
    if sqlerrm='wrong fingerprint accepted' then raise; end if;
  end;

  update public.compute_unified_recovery_admission_proof_h205f22
     set verified_evidence=jsonb_set(verified_evidence,'{successor_process_incarnation_id}','"proc-tampered"')
   where workspace_id=ws and attempt_id='attempt-readback-1';
  begin
    perform public.h205f22_verify_compute_unified_recovery_admission_proof_v1(ws,'attempt-readback-1',fp);
    raise exception 'tampered evidence accepted';
  exception when others then
    if sqlerrm='tampered evidence accepted' then raise; end if;
  end;
end $$;

DO $$ begin
  if has_table_privilege('service_role','public.compute_unified_recovery_admission_proof_h205f22','SELECT') then raise exception 'service_role raw table read leaked'; end if;
  if has_function_privilege('anon','public.h205f22_verify_compute_unified_recovery_admission_proof_v1(uuid,text,text)','EXECUTE') then raise exception 'anon verifier execute leaked'; end if;
  if has_function_privilege('authenticated','public.h205f22_verify_compute_unified_recovery_admission_proof_v1(uuid,text,text)','EXECUTE') then raise exception 'authenticated verifier execute leaked'; end if;
  if not has_function_privilege('service_role','public.h205f22_verify_compute_unified_recovery_admission_proof_v1(uuid,text,text)','EXECUTE') then raise exception 'service_role verifier execute missing'; end if;
end $$;
