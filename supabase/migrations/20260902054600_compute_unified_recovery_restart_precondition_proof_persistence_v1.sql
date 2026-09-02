-- Branch-local C0 hardening: persist only complete zero-authority composed recovery/restart precondition evidence.
create extension if not exists pgcrypto;

create table if not exists public.compute_unified_recovery_restart_precondition_proof_h205f22 (
  recovery_restart_precondition_proof_id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  recovery_attempt_id text not null,
  recovery_admission_fingerprint_sha256 text not null check (recovery_admission_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  restart_intent_id text not null,
  lease_id text not null,
  actuator_type text not null check (actuator_type='NATIVE_BROWSER_TYPED_ACTUATOR'),
  effect_scope text not null check (effect_scope='BROWSER_RESTART'),
  target_client_id text not null,
  target_process_incarnation_id text not null,
  supervisor_epoch bigint not null check (supervisor_epoch > 0),
  expected_source_git_commit text not null check (expected_source_git_commit ~ '^[0-9a-f]{40}$'),
  recovery_restart_precondition_fingerprint_sha256 text not null check (recovery_restart_precondition_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  verified_evidence jsonb not null,
  recorded_at timestamptz not null default clock_timestamp(),
  automatic_retry_allowed boolean not null default false check (automatic_retry_allowed=false),
  effect_must_be_single_shot boolean not null default true check (effect_must_be_single_shot=true),
  post_effect_readback_required boolean not null default true check (post_effect_readback_required=true),
  restart_authorized boolean not null default false check (restart_authorized=false),
  wake_replay_authorized boolean not null default false check (wake_replay_authorized=false),
  lease_mutation_authorized boolean not null default false check (lease_mutation_authorized=false),
  promotion_authorized boolean not null default false check (promotion_authorized=false),
  authority_effect boolean not null default false check (authority_effect=false),
  unique(workspace_id,recovery_attempt_id,restart_intent_id),
  unique(workspace_id,lease_id,target_process_incarnation_id,supervisor_epoch)
);

alter table public.compute_unified_recovery_restart_precondition_proof_h205f22 enable row level security;
revoke all on table public.compute_unified_recovery_restart_precondition_proof_h205f22 from public,anon,authenticated,service_role;

create or replace function public.h205f22_persist_compute_unified_recovery_restart_precondition_proof_v1(
  p_verified_evidence jsonb
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  v_workspace uuid; v_attempt text; v_admission_fp text; v_restart_intent text; v_lease text;
  v_client text; v_process text; v_epoch bigint; v_commit text; v_fp text; v_inserted uuid;
  v_existing public.compute_unified_recovery_restart_precondition_proof_h205f22%rowtype;
begin
  if p_verified_evidence is null
     or p_verified_evidence->>'schema' is distinct from 'metaengine.compute-unified.recovery-restart-precondition.v1'
     or not coalesce((p_verified_evidence->>'preconditions_verified')::boolean,false)
     or p_verified_evidence->>'reason' is distinct from 'RECOVERY_AND_TYPED_RESTART_PRECONDITIONS_VERIFIED'
     or p_verified_evidence->>'actuator_type' is distinct from 'NATIVE_BROWSER_TYPED_ACTUATOR'
     or p_verified_evidence->>'effect_scope' is distinct from 'BROWSER_RESTART'
     or coalesce((p_verified_evidence->>'automatic_retry_allowed')::boolean,true)
     or not coalesce((p_verified_evidence->>'effect_must_be_single_shot')::boolean,false)
     or not coalesce((p_verified_evidence->>'post_effect_readback_required')::boolean,false)
     or coalesce((p_verified_evidence->>'restart_authorized')::boolean,true)
     or coalesce((p_verified_evidence->>'wake_replay_authorized')::boolean,true)
     or coalesce((p_verified_evidence->>'lease_mutation_authorized')::boolean,true)
     or coalesce((p_verified_evidence->>'promotion_authorized')::boolean,true)
     or coalesce((p_verified_evidence->>'authority_effect')::boolean,true) then
    raise exception 'recovery/restart precondition evidence is not complete zero-authority verified evidence';
  end if;

  v_workspace := (p_verified_evidence->>'workspace_id')::uuid;
  v_attempt := nullif(p_verified_evidence->>'recovery_attempt_id','');
  v_admission_fp := p_verified_evidence->>'recovery_admission_fingerprint_sha256';
  v_restart_intent := nullif(p_verified_evidence->>'restart_intent_id','');
  v_lease := nullif(p_verified_evidence->>'lease_id','');
  v_client := nullif(p_verified_evidence->>'target_client_id','');
  v_process := nullif(p_verified_evidence->>'target_process_incarnation_id','');
  v_epoch := (p_verified_evidence->>'supervisor_epoch')::bigint;
  v_commit := p_verified_evidence->>'expected_source_git_commit';

  if v_workspace is null or v_attempt is null or v_restart_intent is null or v_lease is null
     or v_client is null or v_process is null or v_epoch is null or v_epoch < 1
     or v_admission_fp !~ '^[0-9a-f]{64}$' or v_commit !~ '^[0-9a-f]{40}$' then
    raise exception 'recovery/restart identity or provenance incomplete';
  end if;

  v_fp := encode(public.digest(convert_to(p_verified_evidence::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_workspace::text,0));

  insert into public.compute_unified_recovery_restart_precondition_proof_h205f22(
    workspace_id,recovery_attempt_id,recovery_admission_fingerprint_sha256,restart_intent_id,lease_id,
    actuator_type,effect_scope,target_client_id,target_process_incarnation_id,supervisor_epoch,
    expected_source_git_commit,recovery_restart_precondition_fingerprint_sha256,verified_evidence
  ) values(
    v_workspace,v_attempt,v_admission_fp,v_restart_intent,v_lease,'NATIVE_BROWSER_TYPED_ACTUATOR','BROWSER_RESTART',
    v_client,v_process,v_epoch,v_commit,v_fp,p_verified_evidence
  ) on conflict(workspace_id,recovery_attempt_id,restart_intent_id) do nothing
  returning recovery_restart_precondition_proof_id into v_inserted;

  select * into v_existing
    from public.compute_unified_recovery_restart_precondition_proof_h205f22
   where workspace_id=v_workspace and recovery_attempt_id=v_attempt and restart_intent_id=v_restart_intent;

  if v_existing.recovery_restart_precondition_proof_id is null then
    raise exception 'recovery/restart durable readback missing';
  end if;

  if v_existing.recovery_restart_precondition_fingerprint_sha256 is distinct from v_fp
     or v_existing.recovery_admission_fingerprint_sha256 is distinct from v_admission_fp
     or v_existing.lease_id is distinct from v_lease
     or v_existing.target_client_id is distinct from v_client
     or v_existing.target_process_incarnation_id is distinct from v_process
     or v_existing.supervisor_epoch is distinct from v_epoch
     or v_existing.expected_source_git_commit is distinct from v_commit
     or v_existing.verified_evidence is distinct from p_verified_evidence then
    raise exception 'recovery/restart replay or provenance collision';
  end if;

  return jsonb_build_object(
    'schema','metaengine.compute-unified.recovery-restart-precondition-persistence.v1',
    'recovery_restart_precondition_proof_id',v_existing.recovery_restart_precondition_proof_id,
    'workspace_id',v_workspace,
    'recovery_attempt_id',v_attempt,
    'restart_intent_id',v_restart_intent,
    'lease_id',v_lease,
    'recovery_restart_precondition_fingerprint_sha256',v_fp,
    'persistence_effect',v_inserted is not null,
    'preconditions_verified',true,
    'automatic_retry_allowed',false,
    'effect_must_be_single_shot',true,
    'post_effect_readback_required',true,
    'restart_authorized',false,
    'wake_replay_authorized',false,
    'lease_mutation_authorized',false,
    'promotion_authorized',false,
    'authority_effect',false
  );
end $$;

revoke all on function public.h205f22_persist_compute_unified_recovery_restart_precondition_proof_v1(jsonb) from public,anon,authenticated;
grant execute on function public.h205f22_persist_compute_unified_recovery_restart_precondition_proof_v1(jsonb) to service_role;
