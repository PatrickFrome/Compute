-- Branch-local C0 hardening: read persisted post-successor continuity proof back from durable storage.
create extension if not exists pgcrypto;

create or replace function public.h205f22_read_compute_unified_post_successor_continuity_v2(
  p_workspace_id uuid,
  p_attempt_id text,
  p_proof_fingerprint_sha256 text
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_row public.compute_unified_post_successor_continuity_h205f22%rowtype;
  v_recomputed_fp text;
begin
  if p_workspace_id is null or nullif(p_attempt_id,'') is null
     or p_proof_fingerprint_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'durable continuity readback identity incomplete';
  end if;

  select * into v_row
    from public.compute_unified_post_successor_continuity_h205f22
   where workspace_id=p_workspace_id and attempt_id=p_attempt_id;

  if v_row.continuity_proof_id is null then
    raise exception 'durable continuity proof not found';
  end if;

  v_recomputed_fp:=encode(public.digest(convert_to(v_row.verified_proof::text,'UTF8'),'sha256'),'hex');
  if v_row.proof_fingerprint_sha256 is distinct from p_proof_fingerprint_sha256
     or v_recomputed_fp is distinct from v_row.proof_fingerprint_sha256
     or v_row.verified_proof->>'schema' is distinct from 'metaengine.compute-unified.post-successor-continuity-readback.v1'
     or not coalesce((v_row.verified_proof->>'verified')::boolean,false)
     or v_row.verified_proof->>'reason' is distinct from 'POST_SUCCESSOR_CONTINUITY_VERIFIED'
     or not coalesce((v_row.verified_proof->>'enrollment_active')::boolean,false)
     or coalesce((v_row.verified_proof->>'automatic_retry_allowed')::boolean,true)
     or coalesce((v_row.verified_proof->>'restart_authorized')::boolean,true)
     or coalesce((v_row.verified_proof->>'wake_replay_authorized')::boolean,true)
     or coalesce((v_row.verified_proof->>'lease_mutation_authorized')::boolean,true)
     or coalesce((v_row.verified_proof->>'authority_effect')::boolean,true)
     or (v_row.verified_proof->>'workspace_id')::uuid is distinct from v_row.workspace_id
     or v_row.verified_proof->>'successor_client_id' is distinct from v_row.successor_client_id
     or v_row.verified_proof->>'successor_process_incarnation_id' is distinct from v_row.successor_process_incarnation_id
     or (v_row.verified_proof->>'successor_supervisor_epoch')::bigint is distinct from v_row.successor_supervisor_epoch
     or v_row.verified_proof->>'expected_source_git_commit' is distinct from v_row.expected_source_git_commit
     or (v_row.verified_proof->>'heartbeat_observed_at')::timestamptz is distinct from v_row.heartbeat_observed_at
     or v_row.automatic_retry_allowed
     or v_row.authority_effect then
    raise exception 'durable continuity proof integrity/provenance mismatch';
  end if;

  return jsonb_build_object(
    'schema','metaengine.compute-unified.post-successor-continuity-durable-readback.v2',
    'verified',true,
    'reason','DURABLE_POST_SUCCESSOR_CONTINUITY_VERIFIED',
    'continuity_proof_id',v_row.continuity_proof_id,
    'workspace_id',v_row.workspace_id,
    'attempt_id',v_row.attempt_id,
    'successor_client_id',v_row.successor_client_id,
    'successor_process_incarnation_id',v_row.successor_process_incarnation_id,
    'successor_supervisor_epoch',v_row.successor_supervisor_epoch,
    'expected_source_git_commit',v_row.expected_source_git_commit,
    'heartbeat_observed_at',v_row.heartbeat_observed_at,
    'proof_fingerprint_sha256',v_row.proof_fingerprint_sha256,
    'recorded_at',v_row.recorded_at,
    'automatic_retry_allowed',false,
    'restart_authorized',false,
    'wake_replay_authorized',false,
    'lease_mutation_authorized',false,
    'authority_effect',false
  );
end $$;

revoke all on function public.h205f22_read_compute_unified_post_successor_continuity_v2(uuid,text,text) from public,anon,authenticated;
grant execute on function public.h205f22_read_compute_unified_post_successor_continuity_v2(uuid,text,text) to service_role;
