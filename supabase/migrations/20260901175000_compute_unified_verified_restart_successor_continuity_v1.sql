-- Branch-local C0 continuity hardening: compose a durable VERIFIED_RESTART receipt
-- with the existing successor-acceptance fence. This function grants no authority
-- and does not actuate Browser restart, wake replay, lease mutation, or promotion.

create or replace function public.h205f22_compute_unified_verified_restart_successor_continuity_v1(
  p_workspace_id uuid,
  p_attempt_id text,
  p_effect_key text,
  p_receipt_fingerprint_sha256 text,
  p_checkpoint_id bigint,
  p_successor_process_incarnation_id text,
  p_successor_epoch bigint,
  p_expected_source_git_commit text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_receipt jsonb;
  v_acceptance jsonb;
  v_continuity_accepted boolean := false;
  v_reason text := 'UNSET';
begin
  v_receipt := public.h205f22_read_compute_unified_restart_effect_receipt_v1(
    p_workspace_id,
    p_attempt_id,
    p_effect_key,
    p_receipt_fingerprint_sha256
  );

  if v_receipt->>'disposition' is distinct from 'VERIFIED_RESTART'
     or v_receipt->>'outcome' is distinct from 'VERIFIED_SUCCESS'
     or v_receipt->>'consumption_state' is distinct from 'VERIFIED_READBACK_ONLY' then
    v_reason := 'RESTART_NOT_DURABLY_VERIFIED';
  elsif coalesce((v_receipt->>'hold_ambiguous')::boolean,true)
     or coalesce((v_receipt->>'automatic_retry_allowed')::boolean,true)
     or coalesce((v_receipt->>'restart_authorized')::boolean,true)
     or coalesce((v_receipt->>'wake_replay_authorized')::boolean,true)
     or coalesce((v_receipt->>'lease_mutation_authorized')::boolean,true)
     or coalesce((v_receipt->>'authority_effect')::boolean,true) then
    v_reason := 'RECEIPT_AUTHORITY_OR_RETRY_REJECTED';
  elsif v_receipt->>'successor_process_incarnation_id' is distinct from p_successor_process_incarnation_id then
    v_reason := 'SUCCESSOR_PROCESS_MISMATCH';
  elsif (v_receipt->>'successor_supervisor_epoch')::bigint is distinct from p_successor_epoch then
    v_reason := 'SUCCESSOR_EPOCH_MISMATCH';
  elsif v_receipt->>'expected_source_git_commit' is distinct from p_expected_source_git_commit then
    v_reason := 'SOURCE_COMMIT_MISMATCH';
  else
    v_acceptance := public.h205f22_compute_unified_successor_acceptance_v1(
      p_workspace_id,
      p_checkpoint_id,
      p_successor_process_incarnation_id,
      p_successor_epoch,
      p_expected_source_git_commit
    );

    if not coalesce((v_acceptance->>'accepted')::boolean,false) then
      v_reason := 'SUCCESSOR_ACCEPTANCE_REJECTED:' || coalesce(v_acceptance->>'reason','UNKNOWN');
    elsif coalesce((v_acceptance->>'restart_authorized')::boolean,true)
       or coalesce((v_acceptance->>'wake_replay_authorized')::boolean,true)
       or coalesce((v_acceptance->>'lease_mutation_authorized')::boolean,true)
       or coalesce((v_acceptance->>'authority_effect')::boolean,true) then
      v_reason := 'SUCCESSOR_ACCEPTANCE_AUTHORITY_REJECTED';
    elsif v_acceptance->>'workspace_id' is distinct from p_workspace_id::text
       or (v_acceptance->>'checkpoint_id')::bigint is distinct from p_checkpoint_id
       or v_acceptance->>'successor_process_incarnation_id' is distinct from p_successor_process_incarnation_id
       or (v_acceptance->>'successor_supervisor_epoch')::bigint is distinct from p_successor_epoch
       or v_acceptance->>'source_git_commit' is distinct from p_expected_source_git_commit then
      v_reason := 'SUCCESSOR_ACCEPTANCE_PROVENANCE_DRIFT';
    else
      v_continuity_accepted := true;
      v_reason := 'VERIFIED_RESTART_SUCCESSOR_CONTINUITY_ACCEPTED';
    end if;
  end if;

  return jsonb_build_object(
    'schema','metaengine.compute-unified.verified-restart-successor-continuity.v1',
    'workspace_id',p_workspace_id,
    'attempt_id',p_attempt_id,
    'effect_key',p_effect_key,
    'receipt_fingerprint_sha256',p_receipt_fingerprint_sha256,
    'checkpoint_id',p_checkpoint_id,
    'successor_process_incarnation_id',p_successor_process_incarnation_id,
    'successor_supervisor_epoch',p_successor_epoch,
    'expected_source_git_commit',p_expected_source_git_commit,
    'continuity_accepted',v_continuity_accepted,
    'reason',v_reason,
    'requires_fresh_successor_heartbeat',true,
    'requires_exact_enrollment_readback',true,
    'requires_keepalive_continuity_readback',true,
    'requires_integration_head_readback',true,
    'automatic_retry_allowed',false,
    'restart_authorized',false,
    'wake_replay_authorized',false,
    'lease_mutation_authorized',false,
    'authority_effect',false
  );
end;
$$;

revoke all on function public.h205f22_compute_unified_verified_restart_successor_continuity_v1(uuid,text,text,text,bigint,text,bigint,text) from public, anon, authenticated;
grant execute on function public.h205f22_compute_unified_verified_restart_successor_continuity_v1(uuid,text,text,text,bigint,text,bigint,text) to service_role;
