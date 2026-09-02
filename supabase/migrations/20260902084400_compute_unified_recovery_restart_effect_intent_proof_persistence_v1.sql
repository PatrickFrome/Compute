-- Branch-local C0 hardening: durably persist only complete zero-authority restart-effect intent evidence.
create extension if not exists pgcrypto;

create table if not exists public.compute_unified_recovery_restart_effect_intent_proof_h205f22 (
  recovery_restart_effect_intent_proof_id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  recovery_attempt_id text not null,
  restart_intent_id text not null,
  lease_id text not null,
  actuator_type text not null check (actuator_type='NATIVE_BROWSER_TYPED_ACTUATOR'),
  effect_scope text not null check (effect_scope='BROWSER_RESTART'),
  target_client_id text not null,
  target_process_incarnation_id text not null,
  supervisor_epoch bigint not null check (supervisor_epoch > 0),
  expected_source_git_commit text not null check (expected_source_git_commit ~ '^[0-9a-f]{40}$'),
  recovery_restart_precondition_fingerprint_sha256 text not null check (recovery_restart_precondition_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  recovery_restart_effect_intent_fingerprint_sha256 text not null check (recovery_restart_effect_intent_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
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

alter table public.compute_unified_recovery_restart_effect_intent_proof_h205f22 enable row level security;
revoke all on table public.compute_unified_recovery_restart_effect_intent_proof_h205f22 from public,anon,authenticated,service_role;

create or replace function public.h205f22_persist_compute_unified_recovery_restart_effect_intent_proof_v1(
  p_bound_intent jsonb
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  v_workspace uuid; v_attempt text; v_restart_intent text; v_lease text; v_client text; v_process text;
  v_epoch bigint; v_commit text; v_precondition_fp text; v_fp text; v_inserted uuid;
  v_existing public.compute_unified_recovery_restart_effect_intent_proof_h205f22%rowtype;
begin
  if p_bound_intent is null
     or p_bound_intent->>'schema' is distinct from 'metaengine.compute-unified.recovery-restart-effect-intent.v1'
     or not coalesce((p_bound_intent->>'intent_bound')::boolean,false)
     or p_bound_intent->>'reason' is distinct from 'DURABLE_RECOVERY_RESTART_EFFECT_INTENT_BOUND'
     or p_bound_intent->>'actuator_type' is distinct from 'NATIVE_BROWSER_TYPED_ACTUATOR'
     or p_bound_intent->>'effect_scope' is distinct from 'BROWSER_RESTART'
     or coalesce((p_bound_intent->>'automatic_retry_allowed')::boolean,true)
     or not coalesce((p_bound_intent->>'effect_must_be_single_shot')::boolean,false)
     or not coalesce((p_bound_intent->>'post_effect_readback_required')::boolean,false)
     or coalesce((p_bound_intent->>'restart_authorized')::boolean,true)
     or coalesce((p_bound_intent->>'wake_replay_authorized')::boolean,true)
     or coalesce((p_bound_intent->>'lease_mutation_authorized')::boolean,true)
     or coalesce((p_bound_intent->>'promotion_authorized')::boolean,true)
     or coalesce((p_bound_intent->>'authority_effect')::boolean,true) then
    raise exception 'restart effect intent evidence is not complete zero-authority bound evidence';
  end if;

  v_workspace := (p_bound_intent->>'workspace_id')::uuid;
  v_attempt := nullif(p_bound_intent->>'recovery_attempt_id','');
  v_restart_intent := nullif(p_bound_intent->>'restart_intent_id','');
  v_lease := nullif(p_bound_intent->>'lease_id','');
  v_client := nullif(p_bound_intent->>'target_client_id','');
  v_process := nullif(p_bound_intent->>'target_process_incarnation_id','');
  v_epoch := (p_bound_intent->>'supervisor_epoch')::bigint;
  v_commit := p_bound_intent->>'expected_source_git_commit';
  v_precondition_fp := p_bound_intent->>'recovery_restart_precondition_fingerprint_sha256';

  if v_workspace is null or v_attempt is null or v_restart_intent is null or v_lease is null or v_client is null
     or v_process is null or v_epoch is null or v_epoch < 1 or v_commit !~ '^[0-9a-f]{40}$'
     or v_precondition_fp !~ '^[0-9a-f]{64}$' then
    raise exception 'restart effect intent identity or provenance incomplete';
  end if;

  v_fp := encode(public.digest(convert_to(p_bound_intent::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_workspace::text,0));

  insert into public.compute_unified_recovery_restart_effect_intent_proof_h205f22(
    workspace_id,recovery_attempt_id,restart_intent_id,lease_id,actuator_type,effect_scope,target_client_id,
    target_process_incarnation_id,supervisor_epoch,expected_source_git_commit,
    recovery_restart_precondition_fingerprint_sha256,recovery_restart_effect_intent_fingerprint_sha256,verified_evidence
  ) values(
    v_workspace,v_attempt,v_restart_intent,v_lease,'NATIVE_BROWSER_TYPED_ACTUATOR','BROWSER_RESTART',v_client,
    v_process,v_epoch,v_commit,v_precondition_fp,v_fp,p_bound_intent
  ) on conflict(workspace_id,recovery_attempt_id,restart_intent_id) do nothing
  returning recovery_restart_effect_intent_proof_id into v_inserted;

  select * into v_existing from public.compute_unified_recovery_restart_effect_intent_proof_h205f22
   where workspace_id=v_workspace and recovery_attempt_id=v_attempt and restart_intent_id=v_restart_intent;

  if v_existing.recovery_restart_effect_intent_proof_id is null then raise exception 'restart effect intent durable readback missing'; end if;
  if v_existing.recovery_restart_effect_intent_fingerprint_sha256 is distinct from v_fp
     or v_existing.recovery_restart_precondition_fingerprint_sha256 is distinct from v_precondition_fp
     or v_existing.lease_id is distinct from v_lease
     or v_existing.target_client_id is distinct from v_client
     or v_existing.target_process_incarnation_id is distinct from v_process
     or v_existing.supervisor_epoch is distinct from v_epoch
     or v_existing.expected_source_git_commit is distinct from v_commit
     or v_existing.verified_evidence is distinct from p_bound_intent then
    raise exception 'restart effect intent replay or provenance collision';
  end if;

  return jsonb_build_object(
    'schema','metaengine.compute-unified.recovery-restart-effect-intent-persistence.v1',
    'recovery_restart_effect_intent_proof_id',v_existing.recovery_restart_effect_intent_proof_id,
    'workspace_id',v_workspace,'recovery_attempt_id',v_attempt,'restart_intent_id',v_restart_intent,'lease_id',v_lease,
    'recovery_restart_effect_intent_fingerprint_sha256',v_fp,'persistence_effect',v_inserted is not null,'intent_bound',true,
    'automatic_retry_allowed',false,'effect_must_be_single_shot',true,'post_effect_readback_required',true,
    'restart_authorized',false,'wake_replay_authorized',false,'lease_mutation_authorized',false,
    'promotion_authorized',false,'authority_effect',false);
end $$;

revoke all on function public.h205f22_persist_compute_unified_recovery_restart_effect_intent_proof_v1(jsonb) from public,anon,authenticated;
grant execute on function public.h205f22_persist_compute_unified_recovery_restart_effect_intent_proof_v1(jsonb) to service_role;
