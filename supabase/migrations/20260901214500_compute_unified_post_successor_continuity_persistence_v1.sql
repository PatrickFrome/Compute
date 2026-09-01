-- Branch-local C0 hardening: persist only complete zero-authority post-successor continuity proofs.
create extension if not exists pgcrypto;

create table if not exists public.compute_unified_post_successor_continuity_h205f22 (
  continuity_proof_id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  attempt_id text not null,
  successor_client_id text not null,
  successor_process_incarnation_id text not null,
  successor_supervisor_epoch bigint not null,
  expected_source_git_commit text not null check (expected_source_git_commit ~ '^[0-9a-f]{40}$'),
  heartbeat_observed_at timestamptz not null,
  proof_fingerprint_sha256 text not null check (proof_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  verified_proof jsonb not null,
  recorded_at timestamptz not null default clock_timestamp(),
  automatic_retry_allowed boolean not null default false check (automatic_retry_allowed=false),
  authority_effect boolean not null default false check (authority_effect=false),
  unique(workspace_id,attempt_id),
  unique(workspace_id,successor_process_incarnation_id,successor_supervisor_epoch)
);

alter table public.compute_unified_post_successor_continuity_h205f22 enable row level security;
revoke all on table public.compute_unified_post_successor_continuity_h205f22 from public,anon,authenticated,service_role;

create or replace function public.h205f22_persist_compute_unified_post_successor_continuity_v1(
  p_attempt_id text,
  p_verified_proof jsonb
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  v_workspace uuid; v_client text; v_process text; v_epoch bigint; v_commit text;
  v_heartbeat timestamptz; v_fp text; v_inserted uuid;
  v_existing public.compute_unified_post_successor_continuity_h205f22%rowtype;
begin
  if nullif(p_attempt_id,'') is null
     or p_verified_proof is null
     or p_verified_proof->>'schema' is distinct from 'metaengine.compute-unified.post-successor-continuity-readback.v1'
     or not coalesce((p_verified_proof->>'verified')::boolean,false)
     or p_verified_proof->>'reason' is distinct from 'POST_SUCCESSOR_CONTINUITY_VERIFIED'
     or not coalesce((p_verified_proof->>'enrollment_active')::boolean,false)
     or coalesce((p_verified_proof->>'automatic_retry_allowed')::boolean,true)
     or coalesce((p_verified_proof->>'restart_authorized')::boolean,true)
     or coalesce((p_verified_proof->>'wake_replay_authorized')::boolean,true)
     or coalesce((p_verified_proof->>'lease_mutation_authorized')::boolean,true)
     or coalesce((p_verified_proof->>'authority_effect')::boolean,true) then
    raise exception 'post-successor continuity proof is not complete zero-authority verified evidence';
  end if;

  v_workspace:=(p_verified_proof->>'workspace_id')::uuid;
  v_client:=nullif(p_verified_proof->>'successor_client_id','');
  v_process:=nullif(p_verified_proof->>'successor_process_incarnation_id','');
  v_epoch:=(p_verified_proof->>'successor_supervisor_epoch')::bigint;
  v_commit:=p_verified_proof->>'expected_source_git_commit';
  v_heartbeat:=(p_verified_proof->>'heartbeat_observed_at')::timestamptz;
  if v_client is null or v_process is null or v_epoch is null or v_epoch<1 or v_heartbeat is null or v_commit !~ '^[0-9a-f]{40}$' then
    raise exception 'post-successor continuity identity/provenance incomplete';
  end if;

  v_fp:=encode(public.digest(convert_to(p_verified_proof::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_workspace::text,0));
  insert into public.compute_unified_post_successor_continuity_h205f22(
    workspace_id,attempt_id,successor_client_id,successor_process_incarnation_id,successor_supervisor_epoch,
    expected_source_git_commit,heartbeat_observed_at,proof_fingerprint_sha256,verified_proof,
    automatic_retry_allowed,authority_effect
  ) values(v_workspace,p_attempt_id,v_client,v_process,v_epoch,v_commit,v_heartbeat,v_fp,p_verified_proof,false,false)
  on conflict(workspace_id,attempt_id) do nothing returning continuity_proof_id into v_inserted;

  select * into v_existing from public.compute_unified_post_successor_continuity_h205f22
   where workspace_id=v_workspace and attempt_id=p_attempt_id;
  if v_existing.continuity_proof_id is null then raise exception 'post-successor continuity durable readback missing'; end if;
  if v_existing.proof_fingerprint_sha256 is distinct from v_fp
     or v_existing.successor_client_id is distinct from v_client
     or v_existing.successor_process_incarnation_id is distinct from v_process
     or v_existing.successor_supervisor_epoch is distinct from v_epoch
     or v_existing.expected_source_git_commit is distinct from v_commit
     or v_existing.heartbeat_observed_at is distinct from v_heartbeat
     or v_existing.verified_proof is distinct from p_verified_proof then
    raise exception 'post-successor continuity replay/provenance collision';
  end if;

  return jsonb_build_object('schema','metaengine.compute-unified.post-successor-continuity-persistence.v1',
    'continuity_proof_id',v_existing.continuity_proof_id,'workspace_id',v_workspace,'attempt_id',p_attempt_id,
    'proof_fingerprint_sha256',v_fp,'persistence_effect',v_inserted is not null,
    'automatic_retry_allowed',false,'restart_authorized',false,'wake_replay_authorized',false,
    'lease_mutation_authorized',false,'authority_effect',false);
end $$;
revoke all on function public.h205f22_persist_compute_unified_post_successor_continuity_v1(text,jsonb) from public,anon,authenticated;
grant execute on function public.h205f22_persist_compute_unified_post_successor_continuity_v1(text,jsonb) to service_role;
