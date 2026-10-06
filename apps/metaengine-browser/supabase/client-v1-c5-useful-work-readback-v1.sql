-- PREPARE_ONLY Client V1 C5 useful-work readback contract.
-- This is intentionally NOT a migration. Generate the eventual migration with
-- `supabase migration new`, review advisors, and deploy only under explicit
-- live mutation authorization.
--
-- Trust model:
-- - Client goal/result truth remains owned by client_v1_goal_execution_proof_v1.
-- - Useful-work acceptance is NOT read from Agent/model-authored result_summary.
-- - A separate TASK_USEFUL_WORK_VERIFIED event must be written by a future
--   trusted server verifier path bound to the exact task/lease/result.
-- - This function is read-only and service_role-only.

create or replace function public.client_v1_goal_useful_work_proof_v1(
  p_workspace_id uuid,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, destruktion_meta, extensions, pg_temp
as $$
declare
  v_execution jsonb;
  v_event destruktion_meta.devos_fleet_event_h205f22%rowtype;
  v_payload jsonb;
  v_request_id uuid;
  v_task_id uuid;
  v_plan_generation bigint;
  v_alignment_epoch bigint;
  v_lease_generation bigint;
  v_changed_file_count integer;
  v_materialized_edit_operations integer;
  v_pre_repair_exit integer;
  v_post_repair_exit integer;
  v_artifact_bytes bigint;
begin
  if p_workspace_id is null then
    raise exception 'client_v1_goal_useful_work_proof_workspace_required' using errcode='22023';
  end if;
  if p_request_id is null then
    raise exception 'client_v1_goal_useful_work_proof_request_id_required' using errcode='22023';
  end if;

  v_execution := public.client_v1_goal_execution_proof_v1(p_workspace_id, p_request_id);

  if coalesce((v_execution->>'found')::boolean,false) is not true
     or coalesce(v_execution->>'task_state','') <> 'COMPLETED'
     or coalesce((v_execution->>'terminal')::boolean,false) is not true
     or coalesce((v_execution->>'user_goal_to_agent_readback')::boolean,false) is not true
     or coalesce((v_execution->>'user_goal_to_result_readback')::boolean,false) is not true
     or coalesce((v_execution#>>'{result_proof,accepted}')::boolean,false) is not true
     or coalesce((v_execution#>>'{result_proof,claim_valid}')::boolean,false) is not true
     or coalesce((v_execution#>>'{result_proof,origin_bound}')::boolean,false) is not true
  then
    return jsonb_build_object(
      'schema','metaengine.client-v1.useful-work-proof.v1',
      'found',false,
      'request_id',p_request_id,
      'workspace_id',p_workspace_id,
      'user_goal_to_verified_artifact_readback',false,
      'client_c5_useful_work_verified',false,
      'canonical_c2_promotion_authorized',false,
      'automatic_retry_allowed',false,
      'scheduler_authority',false,
      'browser_authority',false,
      'release_authority',false,
      'authority_effect',false
    );
  end if;

  v_request_id := (v_execution->>'request_id')::uuid;
  v_task_id := (v_execution->>'task_id')::uuid;
  v_plan_generation := (v_execution->>'plan_generation')::bigint;
  v_alignment_epoch := (v_execution->>'alignment_epoch')::bigint;
  v_lease_generation := (v_execution->>'lease_generation')::bigint;

  select * into v_event
    from destruktion_meta.devos_fleet_event_h205f22 e
   where e.workspace_id = p_workspace_id
     and e.task_id = v_task_id
     and e.point_id = v_execution->>'point_id'
     and e.base_sha = v_execution->>'baseline_sha'
     and e.lease_generation = v_lease_generation
     and e.event_type = 'TASK_USEFUL_WORK_VERIFIED'
     and e.authority_effect = false
     and coalesce(e.payload->>'proof_contract','') = 'METAENGINE_USEFUL_WORK_VERIFIED_V1'
     and coalesce(e.payload->>'verifier_origin','') = 'TRUSTED_SERVER_VERIFIER'
     and lower(coalesce(e.payload->>'result_sha256','')) = lower(coalesce(v_execution#>>'{result_proof,result_sha256}',''))
     and lower(coalesce(e.payload->>'claim_sha256','')) = lower(coalesce(v_execution#>>'{result_proof,claim_sha256}',''))
     and lower(coalesce(e.payload->>'conversation_url_sha256','')) = lower(coalesce(v_execution#>>'{agent_origin_proof,conversation_url_sha256}',''))
   order by e.event_id desc
   limit 1;

  if not found then
    return jsonb_build_object(
      'schema','metaengine.client-v1.useful-work-proof.v1',
      'found',false,
      'request_id',p_request_id,
      'workspace_id',p_workspace_id,
      'user_goal_to_verified_artifact_readback',false,
      'client_c5_useful_work_verified',false,
      'canonical_c2_promotion_authorized',false,
      'automatic_retry_allowed',false,
      'scheduler_authority',false,
      'browser_authority',false,
      'release_authority',false,
      'authority_effect',false
    );
  end if;

  v_payload := v_event.payload;
  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'client_v1_goal_useful_work_proof_event_invalid';
  end if;

  if coalesce(v_payload->>'repository_identity_sha256','') !~ '^[0-9a-f]{64}$'
     or lower(coalesce(v_payload->>'checkout_sha','')) <> lower(coalesce(v_execution->>'baseline_sha',''))
     or coalesce(v_payload->>'source_snapshot_sha256','') !~ '^[0-9a-f]{64}$'
     or coalesce(v_payload->>'patch_sha256','') !~ '^[0-9a-f]{64}$'
     or coalesce(v_payload->>'changed_file_manifest_sha256','') !~ '^[0-9a-f]{64}$'
     or coalesce(v_payload->>'command_contract_sha256','') !~ '^[0-9a-f]{64}$'
     or coalesce(v_payload->>'pre_repair_receipt_sha256','') !~ '^[0-9a-f]{64}$'
     or coalesce(v_payload->>'post_repair_receipt_sha256','') !~ '^[0-9a-f]{64}$'
     or coalesce(v_payload->>'artifact_sha256','') !~ '^[0-9a-f]{64}$'
     or coalesce(v_payload->>'artifact_subject_sha256','') !~ '^[0-9a-f]{64}$'
     or coalesce(v_payload->>'provenance_sha256','') !~ '^[0-9a-f]{64}$'
     or coalesce(v_payload->>'verification_receipt_sha256','') !~ '^[0-9a-f]{64}$'
     or coalesce(v_payload->>'review_receipt_sha256','') !~ '^[0-9a-f]{64}$'
     or coalesce(v_payload->>'accepted_artifact_sha256','') !~ '^[0-9a-f]{64}$'
     or coalesce(v_payload->>'verifier_identity_sha256','') !~ '^[0-9a-f]{64}$'
  then
    raise exception 'client_v1_goal_useful_work_proof_digest_invalid';
  end if;

  if coalesce(v_payload->>'changed_file_count','') !~ '^[1-9][0-9]{0,5}$'
     or coalesce(v_payload->>'materialized_edit_operations','') !~ '^[1-9][0-9]{0,8}$'
     or coalesce(v_payload->>'pre_repair_exit_code','') !~ '^[1-9][0-9]{0,5}$'
     or coalesce(v_payload->>'post_repair_exit_code','') <> '0'
     or coalesce(v_payload->>'artifact_bytes','') !~ '^[1-9][0-9]{0,18}$'
  then
    raise exception 'client_v1_goal_useful_work_proof_measurement_invalid';
  end if;

  v_changed_file_count := (v_payload->>'changed_file_count')::integer;
  v_materialized_edit_operations := (v_payload->>'materialized_edit_operations')::integer;
  v_pre_repair_exit := (v_payload->>'pre_repair_exit_code')::integer;
  v_post_repair_exit := (v_payload->>'post_repair_exit_code')::integer;
  v_artifact_bytes := (v_payload->>'artifact_bytes')::bigint;

  if lower(v_payload->>'artifact_subject_sha256') <> lower(v_payload->>'artifact_sha256')
     or lower(v_payload->>'accepted_artifact_sha256') <> lower(v_payload->>'artifact_sha256')
     or coalesce((v_payload->>'isolated_workspace')::boolean,false) is not true
     or coalesce((v_payload->>'source_snapshot_read_only')::boolean,false) is not true
     or coalesce((v_payload->>'host_repository_mounted')::boolean,true) is not false
     or coalesce((v_payload->>'host_git_directory_mounted')::boolean,true) is not false
     or coalesce((v_payload->>'linked_git_worktree_exposed')::boolean,true) is not false
     or coalesce((v_payload->>'edit_materialized')::boolean,false) is not true
     or coalesce((v_payload->>'protected_root_modified')::boolean,true) is not false
     or coalesce((v_payload->>'host_repository_modified')::boolean,true) is not false
     or coalesce((v_payload->>'pre_repair_test_observed')::boolean,false) is not true
     or coalesce((v_payload->>'post_repair_test_observed')::boolean,false) is not true
     or coalesce((v_payload->>'real_build_or_test')::boolean,false) is not true
     or coalesce((v_payload->>'repair_verified')::boolean,false) is not true
     or coalesce((v_payload->>'provenance_verified')::boolean,false) is not true
     or coalesce((v_payload->>'subject_digest_verified')::boolean,false) is not true
     or coalesce((v_payload->>'artifact_verified')::boolean,false) is not true
     or coalesce((v_payload->>'independent_verifier')::boolean,false) is not true
     or coalesce((v_payload->>'accepted')::boolean,false) is not true
     or coalesce((v_payload->>'candidate_authored')::boolean,true) is not false
     or coalesce((v_payload->>'model_authored')::boolean,true) is not false
     or coalesce((v_payload->>'browser_authored')::boolean,true) is not false
     or coalesce((v_payload->>'raw_patch_included')::boolean,true) is not false
     or coalesce((v_payload->>'raw_logs_included')::boolean,true) is not false
     or coalesce((v_payload->>'model_output_included')::boolean,true) is not false
     or coalesce((v_payload->>'page_content_included')::boolean,true) is not false
  then
    raise exception 'client_v1_goal_useful_work_proof_verification_invalid';
  end if;

  return jsonb_build_object(
    'schema','metaengine.client-v1.useful-work-proof.v1',
    'found',true,
    'request_id',v_request_id,
    'workspace_id',p_workspace_id,
    'roadmap_id',v_execution->>'roadmap_id',
    'plan_generation',v_plan_generation,
    'alignment_epoch',v_alignment_epoch,
    'baseline_sha',lower(v_execution->>'baseline_sha'),
    'plan_sha256',lower(v_execution->>'plan_sha256'),
    'point_id',v_execution->>'point_id',
    'task_id',v_task_id,
    'task_spec_sha256',lower(v_execution->>'task_spec_sha256'),
    'lease_generation',v_lease_generation,
    'result_sha256',lower(v_execution#>>'{result_proof,result_sha256}'),
    'claim_sha256',lower(v_execution#>>'{result_proof,claim_sha256}'),
    'conversation_url_sha256',lower(v_execution#>>'{agent_origin_proof,conversation_url_sha256}'),
    'evidence_class','LIVE',
    'evidence_origin','SIGNED_SUPERVISOR_READBACK',
    'repository',jsonb_build_object(
      'repository_identity_sha256',lower(v_payload->>'repository_identity_sha256'),
      'checkout_sha',lower(v_payload->>'checkout_sha'),
      'source_snapshot_sha256',lower(v_payload->>'source_snapshot_sha256'),
      'isolated_workspace',true,
      'host_repository_mounted',false,
      'host_git_directory_mounted',false,
      'linked_git_worktree_exposed',false,
      'source_snapshot_read_only',true,
      'authority_effect',false
    ),
    'edit',jsonb_build_object(
      'patch_sha256',lower(v_payload->>'patch_sha256'),
      'changed_file_manifest_sha256',lower(v_payload->>'changed_file_manifest_sha256'),
      'changed_file_count',v_changed_file_count,
      'materialized_edit_operations',v_materialized_edit_operations,
      'edit_materialized',true,
      'protected_root_modified',false,
      'host_repository_modified',false,
      'authority_effect',false
    ),
    'verification',jsonb_build_object(
      'command_contract_sha256',lower(v_payload->>'command_contract_sha256'),
      'pre_repair_receipt_sha256',lower(v_payload->>'pre_repair_receipt_sha256'),
      'pre_repair_test_observed',true,
      'pre_repair_exit_code',v_pre_repair_exit,
      'post_repair_receipt_sha256',lower(v_payload->>'post_repair_receipt_sha256'),
      'post_repair_test_observed',true,
      'post_repair_exit_code',v_post_repair_exit,
      'real_build_or_test',true,
      'repair_verified',true,
      'authority_effect',false
    ),
    'artifact',jsonb_build_object(
      'artifact_sha256',lower(v_payload->>'artifact_sha256'),
      'artifact_bytes',v_artifact_bytes,
      'artifact_subject_sha256',lower(v_payload->>'artifact_subject_sha256'),
      'provenance_sha256',lower(v_payload->>'provenance_sha256'),
      'verification_receipt_sha256',lower(v_payload->>'verification_receipt_sha256'),
      'provenance_verified',true,
      'subject_digest_verified',true,
      'artifact_verified',true,
      'authority_effect',false
    ),
    'review',jsonb_build_object(
      'review_receipt_sha256',lower(v_payload->>'review_receipt_sha256'),
      'independent_verifier',true,
      'accepted',true,
      'accepted_artifact_sha256',lower(v_payload->>'accepted_artifact_sha256'),
      'authority_effect',false
    ),
    'serial_loop_end_to_end',true,
    'user_goal_to_verified_artifact_readback',true,
    'client_c5_useful_work_verified',true,
    'canonical_c2_promotion_authorized',false,
    'automatic_retry_allowed',false,
    'scheduler_authority',false,
    'browser_authority',false,
    'release_authority',false,
    'authority_effect',false
  );
end;
$$;

revoke all on function public.client_v1_goal_useful_work_proof_v1(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.client_v1_goal_useful_work_proof_v1(uuid,uuid)
  to service_role;

comment on function public.client_v1_goal_useful_work_proof_v1(uuid,uuid) is
  'PREPARE_ONLY read-only Client C5 digest proof from exact completed Client execution plus separate trusted TASK_USEFUL_WORK_VERIFIED event; service-role-only; no raw patch/log/model/page content and no scheduler/browser/release/canonical-promotion authority.';
