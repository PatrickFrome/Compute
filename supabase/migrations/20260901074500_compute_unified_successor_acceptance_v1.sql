-- Branch-local C0 continuity hardening: derive successor-generation acceptance
-- from the latest durable zero-authority rollover checkpoint and exact source
-- provenance. This function never authorizes restart, wake replay, lease
-- mutation, Browser actuation, or promotion.

create or replace function public.h205f22_compute_unified_successor_acceptance_v1(
  p_workspace uuid,
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
  v_cp public.h205f22_compute_unified_rollover_checkpoints_v1%rowtype;
  v_latest_id bigint;
  v_accepted boolean := false;
  v_reason text := 'UNSET';
begin
  select checkpoint_id into v_latest_id
  from public.h205f22_compute_unified_rollover_checkpoints_v1
  where workspace_id = p_workspace
  order by supervisor_epoch desc nulls last, checkpoint_id desc
  limit 1;

  select * into v_cp
  from public.h205f22_compute_unified_rollover_checkpoints_v1
  where workspace_id = p_workspace
    and checkpoint_id = p_checkpoint_id;

  if not found then
    v_reason := 'CHECKPOINT_NOT_FOUND';
  elsif v_latest_id is distinct from p_checkpoint_id then
    v_reason := 'CHECKPOINT_NOT_LATEST';
  elsif v_cp.supervisor_id is distinct from 'METAENGINE_SUPERVISOR' then
    v_reason := 'SUPERVISOR_IDENTITY_MISMATCH';
  elsif v_cp.supervisor_epoch is null then
    v_reason := 'CHECKPOINT_EPOCH_MISSING';
  elsif p_successor_epoch is null or p_successor_epoch <> v_cp.supervisor_epoch + 1 then
    v_reason := 'SUCCESSOR_EPOCH_NOT_EXACT_NEXT';
  elsif nullif(p_successor_process_incarnation_id, '') is null then
    v_reason := 'SUCCESSOR_PROCESS_INCARNATION_MISSING';
  elsif p_successor_process_incarnation_id = v_cp.process_incarnation_id then
    v_reason := 'SUCCESSOR_PROCESS_INCARNATION_NOT_NEW';
  elsif nullif(p_expected_source_git_commit, '') is null
        or p_expected_source_git_commit !~ '^[0-9a-f]{40}$' then
    v_reason := 'EXPECTED_SOURCE_COMMIT_INVALID';
  elsif v_cp.source_git_branch is distinct from 'integration/compute-unified-v1' then
    v_reason := 'SOURCE_BRANCH_MISMATCH';
  elsif v_cp.source_git_commit is distinct from p_expected_source_git_commit then
    v_reason := 'SOURCE_COMMIT_MISMATCH';
  elsif coalesce((v_cp.envelope->>'authority_effect')::boolean, true)
     or coalesce((v_cp.envelope->>'restart_authorized')::boolean, true)
     or coalesce((v_cp.envelope->>'wake_replay_authorized')::boolean, true)
     or coalesce((v_cp.envelope->>'lease_mutation_authorized')::boolean, true) then
    v_reason := 'AUTHORITY_BEARING_CHECKPOINT_REJECTED';
  else
    v_accepted := true;
    v_reason := 'SUCCESSOR_IDENTITY_ACCEPTABLE';
  end if;

  return jsonb_build_object(
    'schema','metaengine.compute-unified.successor-acceptance.v1',
    'workspace_id',p_workspace,
    'checkpoint_id',p_checkpoint_id,
    'checkpoint_supervisor_epoch',v_cp.supervisor_epoch,
    'checkpoint_process_incarnation_id',v_cp.process_incarnation_id,
    'successor_supervisor_epoch',p_successor_epoch,
    'successor_process_incarnation_id',p_successor_process_incarnation_id,
    'source_git_branch',v_cp.source_git_branch,
    'source_git_commit',v_cp.source_git_commit,
    'accepted',v_accepted,
    'reason',v_reason,
    'requires_fresh_successor_heartbeat',true,
    'requires_exact_enrollment_readback',true,
    'requires_quiescent_restart_gate',true,
    'restart_authorized',false,
    'wake_replay_authorized',false,
    'lease_mutation_authorized',false,
    'authority_effect',false
  );
end;
$$;

revoke all on function public.h205f22_compute_unified_successor_acceptance_v1(uuid,bigint,text,bigint,text) from public, anon, authenticated;
grant execute on function public.h205f22_compute_unified_successor_acceptance_v1(uuid,bigint,text,bigint,text) to service_role;
