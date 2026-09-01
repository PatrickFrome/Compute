-- Branch-local C0 hardening: persist only complete zero-authority recovery-resume evidence.
create extension if not exists pgcrypto;

create table if not exists public.compute_unified_recovery_resume_proof_h205f22 (
  recovery_resume_proof_id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  attempt_id text not null,
  successor_client_id text not null,
  successor_process_incarnation_id text not null,
  successor_supervisor_epoch bigint not null check (successor_supervisor_epoch > 0),
  expected_source_git_commit text not null check (expected_source_git_commit ~ '^[0-9a-f]{40}$'),
  durable_proof_fingerprint_sha256 text not null check (durable_proof_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  fresh_heartbeat_observed_at timestamptz not null,
  recovery_resume_fingerprint_sha256 text not null check (recovery_resume_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  verified_evidence jsonb not null,
  recorded_at timestamptz not null default clock_timestamp(),
  automatic_retry_allowed boolean not null default false check (automatic_retry_allowed=false),
  restart_authorized boolean not null default false check (restart_authorized=false),
  wake_replay_authorized boolean not null default false check (wake_replay_authorized=false),
  lease_mutation_authorized boolean not null default false check (lease_mutation_authorized=false),
  promotion_authorized boolean not null default false check (promotion_authorized=false),
  authority_effect boolean not null default false check (authority_effect=false),
  unique(workspace_id,attempt_id),
  unique(workspace_id,successor_process_incarnation_id,successor_supervisor_epoch)
);

alter table public.compute_unified_recovery_resume_proof_h205f22 enable row level security;
revoke all on table public.compute_unified_recovery_resume_proof_h205f22 from public,anon,authenticated,service_role;

create or replace function public.h205f22_persist_compute_unified_recovery_resume_proof_v1(
  p_verified_evidence jsonb
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  v_workspace uuid; v_attempt text; v_client text; v_process text; v_epoch bigint; v_commit text;
  v_durable_fp text; v_heartbeat timestamptz; v_fp text; v_inserted uuid;
  v_existing public.compute_unified_recovery_resume_proof_h205f22%rowtype;
begin
  if p_verified_evidence is null
     or p_verified_evidence->>'schema' is distinct from 'metaengine.compute-unified.recovery-resume-gate.v1'
     or not coalesce((p_verified_evidence->>'verified')::boolean,false)
     or not coalesce((p_verified_evidence->>'recovery_resume_eligible')::boolean,false)
     or p_verified_evidence->>'reason' is distinct from 'RECOVERY_RESUME_EVIDENCE_VERIFIED'
     or coalesce((p_verified_evidence->>'automatic_retry_allowed')::boolean,true)
     or coalesce((p_verified_evidence->>'restart_authorized')::boolean,true)
     or coalesce((p_verified_evidence->>'wake_replay_authorized')::boolean,true)
     or coalesce((p_verified_evidence->>'lease_mutation_authorized')::boolean,true)
     or coalesce((p_verified_evidence->>'promotion_authorized')::boolean,true)
     or coalesce((p_verified_evidence->>'authority_effect')::boolean,true) then
    raise exception 'recovery-resume evidence is not complete zero-authority verified evidence';
  end if;

  v_workspace := (p_verified_evidence->>'workspace_id')::uuid;
  v_attempt := nullif(p_verified_evidence->>'attempt_id','');
  v_client := nullif(p_verified_evidence->>'successor_client_id','');
  v_process := nullif(p_verified_evidence->>'successor_process_incarnation_id','');
  v_epoch := (p_verified_evidence->>'successor_supervisor_epoch')::bigint;
  v_commit := p_verified_evidence->>'expected_source_git_commit';
  v_durable_fp := p_verified_evidence->>'durable_proof_fingerprint_sha256';
  v_heartbeat := (p_verified_evidence->>'fresh_heartbeat_observed_at')::timestamptz;
  if v_workspace is null or v_attempt is null or v_client is null or v_process is null or v_epoch is null or v_epoch < 1
     or v_commit !~ '^[0-9a-f]{40}$' or v_durable_fp !~ '^[0-9a-f]{64}$' or v_heartbeat is null then
    raise exception 'recovery-resume identity/provenance incomplete';
  end if;

  v_fp := encode(public.digest(convert_to(p_verified_evidence::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_workspace::text,0));
  insert into public.compute_unified_recovery_resume_proof_h205f22(
    workspace_id,attempt_id,successor_client_id,successor_process_incarnation_id,successor_supervisor_epoch,
    expected_source_git_commit,durable_proof_fingerprint_sha256,fresh_heartbeat_observed_at,
    recovery_resume_fingerprint_sha256,verified_evidence
  ) values(v_workspace,v_attempt,v_client,v_process,v_epoch,v_commit,v_durable_fp,v_heartbeat,v_fp,p_verified_evidence)
  on conflict(workspace_id,attempt_id) do nothing returning recovery_resume_proof_id into v_inserted;

  select * into v_existing from public.compute_unified_recovery_resume_proof_h205f22
   where workspace_id=v_workspace and attempt_id=v_attempt;
  if v_existing.recovery_resume_proof_id is null then raise exception 'recovery-resume durable readback missing'; end if;
  if v_existing.recovery_resume_fingerprint_sha256 is distinct from v_fp
     or v_existing.successor_client_id is distinct from v_client
     or v_existing.successor_process_incarnation_id is distinct from v_process
     or v_existing.successor_supervisor_epoch is distinct from v_epoch
     or v_existing.expected_source_git_commit is distinct from v_commit
     or v_existing.durable_proof_fingerprint_sha256 is distinct from v_durable_fp
     or v_existing.fresh_heartbeat_observed_at is distinct from v_heartbeat
     or v_existing.verified_evidence is distinct from p_verified_evidence then
    raise exception 'recovery-resume replay/provenance collision';
  end if;

  return jsonb_build_object(
    'schema','metaengine.compute-unified.recovery-resume-persistence.v1',
    'recovery_resume_proof_id',v_existing.recovery_resume_proof_id,
    'workspace_id',v_workspace,'attempt_id',v_attempt,
    'recovery_resume_fingerprint_sha256',v_fp,'persistence_effect',v_inserted is not null,
    'recovery_resume_eligible',true,
    'automatic_retry_allowed',false,'restart_authorized',false,'wake_replay_authorized',false,
    'lease_mutation_authorized',false,'promotion_authorized',false,'authority_effect',false);
end $$;
revoke all on function public.h205f22_persist_compute_unified_recovery_resume_proof_v1(jsonb) from public,anon,authenticated;
grant execute on function public.h205f22_persist_compute_unified_recovery_resume_proof_v1(jsonb) to service_role;
