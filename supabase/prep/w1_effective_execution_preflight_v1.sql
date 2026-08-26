-- W1 effective-execution preflight v1
-- PREPARED / NOT APPLIED LIVE while W1 claim/directive are physically expired.
--
-- Purpose:
--   provide one DB-local, fail-closed read-only oracle that refuses to treat
--   ACTIVE labels as effective authority after physical expiry or alignment
--   drift. This function never mutates provider state, never admits a worker,
--   and never marks W1 verified. A PASS is evidence only.
--
-- Runtime rule:
--   callers MUST use this oracle before any W1 provider action, then separately
--   validate their execution authority. The oracle itself cannot mint authority.

create or replace function public.h205f22_w1_effective_execution_preflight_v1(
  p_claim_id bigint,
  p_directive_id bigint
) returns jsonb
language plpgsql
volatile
security invoker
set search_path = pg_catalog, destruktion_meta, extensions
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_roadmap jsonb := destruktion_meta.compute_fabric_roadmap_status_h205f22();
  v_alignment jsonb := destruktion_meta.compute_fabric_roadmap_alignment_status_h205f22();
  v_claim destruktion_meta.compute_fabric_roadmap_work_claim_h205f22%rowtype;
  v_directive destruktion_meta.compute_fabric_supervisor_directive_h205f22%rowtype;
  v_head_checkpoint text;
  v_head_root text;
  v_w1_state text;
  v_checks jsonb;
  v_pass boolean;
begin
  if p_claim_id is null or p_directive_id is null then
    return jsonb_build_object(
      'schema','metaengine.compute.w1-effective-execution-preflight-db.h205f22.v1',
      'outcome','BLOCK_EFFECTIVE_EXECUTION_NONAUTHORITY',
      'effective_execution_preflight_passed',false,
      'provider_mutation_authorized',false,
      'persistent_worker_proof',false,
      'worker_admitted',false,
      'w1_verified',false,
      'canonical',false,
      'authority_effect',false,
      'evidence',jsonb_build_object('db_now',v_now,'reason','CLAIM_AND_DIRECTIVE_IDS_REQUIRED')
    );
  end if;

  select * into v_claim
  from destruktion_meta.compute_fabric_roadmap_work_claim_h205f22
  where claim_id=p_claim_id;

  select * into v_directive
  from destruktion_meta.compute_fabric_supervisor_directive_h205f22
  where directive_id=p_directive_id;

  if v_claim.claim_id is null or v_directive.directive_id is null then
    return jsonb_build_object(
      'schema','metaengine.compute.w1-effective-execution-preflight-db.h205f22.v1',
      'outcome','BLOCK_EFFECTIVE_EXECUTION_NONAUTHORITY',
      'effective_execution_preflight_passed',false,
      'provider_mutation_authorized',false,
      'persistent_worker_proof',false,
      'worker_admitted',false,
      'w1_verified',false,
      'canonical',false,
      'authority_effect',false,
      'evidence',jsonb_build_object(
        'db_now',v_now,
        'claim_found',(v_claim.claim_id is not null),
        'directive_found',(v_directive.directive_id is not null),
        'reason','CLAIM_OR_DIRECTIVE_NOT_FOUND'
      )
    );
  end if;

  v_head_checkpoint := v_roadmap#>>'{semantic_head,checkpoint_id}';
  v_head_root := v_roadmap#>>'{semantic_head,payload_root_sha256}';

  select m->>'effective_status' into v_w1_state
  from jsonb_array_elements(coalesce(v_roadmap->'milestones','[]'::jsonb)) m
  where m->>'milestone_key'='W1_PERSISTENT_LINUX_WORKER_SAFETY'
  limit 1;

  v_checks := jsonb_build_object(
    'definition_integrity',coalesce((v_roadmap->>'definition_integrity')::boolean,false),
    'canonical_integrity',coalesce((v_alignment->>'canonical_integrity')::boolean,false),
    'canonical_drift_absent',not coalesce((v_alignment->>'drift_detected')::boolean,true),
    'level2_definition_integrity',coalesce((v_alignment->>'level2_definition_integrity')::boolean,false),
    'roadmap_state_allows_w1_execution',v_w1_state in ('READY','IN_PROGRESS'),
    'semantic_payload_root_well_formed',coalesce(v_head_root ~ '^[0-9a-f]{64}$',false),
    'claim_roadmap_exact',v_claim.roadmap_id='compute-fabric-roadmap-v1',
    'claim_milestone_exact',v_claim.milestone_key='W1_PERSISTENT_LINUX_WORKER_SAFETY',
    'claim_holder_exact',v_claim.holder_id='aop1:W1_IMPLEMENTER',
    'claim_state_active',v_claim.state='ACTIVE',
    'claim_not_expired',v_claim.expires_at>v_now,
    'claim_not_from_future',v_claim.claimed_at<=v_now,
    'claim_checkpoint_matches_head',v_claim.base_checkpoint_id=v_head_checkpoint,
    'claim_payload_root_matches_head',v_claim.base_payload_root_sha256=v_head_root,
    'directive_roadmap_exact',v_directive.roadmap_id='compute-fabric-roadmap-v1',
    'directive_milestone_exact',v_directive.milestone_key='W1_PERSISTENT_LINUX_WORKER_SAFETY',
    'directive_target_holder_exact',v_directive.target_holder_id='aop1:W1_IMPLEMENTER',
    'directive_status_active',v_directive.status='ACTIVE',
    'directive_not_expired',v_directive.expires_at>v_now,
    'directive_not_from_future',v_directive.created_at<=v_now,
    'directive_not_superseded',v_directive.superseded_at is null,
    'directive_checkpoint_matches_head',v_directive.base_checkpoint_id=v_head_checkpoint,
    'holder_pair_aligned',v_claim.holder_id=v_directive.target_holder_id
  );

  select coalesce(bool_and(value::boolean),false) into v_pass
  from jsonb_each(v_checks);

  return jsonb_build_object(
    'schema','metaengine.compute.w1-effective-execution-preflight-db.h205f22.v1',
    'outcome',case when v_pass then 'PASS_EFFECTIVE_EXECUTION_PREFLIGHT_NONAUTHORITY' else 'BLOCK_EFFECTIVE_EXECUTION_NONAUTHORITY' end,
    'effective_execution_preflight_passed',v_pass,
    'provider_mutation_authorized',false,
    'persistent_worker_proof',false,
    'worker_admitted',false,
    'w1_verified',false,
    'canonical',false,
    'authority_effect',false,
    'evidence',jsonb_build_object(
      'db_now',v_now,
      'semantic_head',jsonb_build_object('checkpoint_id',v_head_checkpoint,'payload_root_sha256',v_head_root),
      'roadmap',jsonb_build_object(
        'roadmap_id',v_roadmap->>'roadmap_id',
        'definition_integrity',v_roadmap->'definition_integrity',
        'canonical_integrity',v_alignment->'canonical_integrity',
        'drift_detected',v_alignment->'drift_detected',
        'w1_effective_status',v_w1_state
      ),
      'claim',jsonb_build_object(
        'claim_id',v_claim.claim_id,
        'holder_id',v_claim.holder_id,
        'state',v_claim.state,
        'expires_at',v_claim.expires_at,
        'base_checkpoint_id',v_claim.base_checkpoint_id,
        'base_payload_root_sha256',v_claim.base_payload_root_sha256
      ),
      'directive',jsonb_build_object(
        'directive_id',v_directive.directive_id,
        'target_holder_id',v_directive.target_holder_id,
        'status',v_directive.status,
        'expires_at',v_directive.expires_at,
        'superseded_at',v_directive.superseded_at,
        'base_checkpoint_id',v_directive.base_checkpoint_id
      ),
      'checks',v_checks
    )
  );
end
$$;

comment on function public.h205f22_w1_effective_execution_preflight_v1(bigint,bigint) is
'Fail-closed read-only W1 freshness/alignment oracle. PASS is NON-AUTHORITY and never authorizes provider mutation, worker admission, or W1 verification.';

revoke all on function public.h205f22_w1_effective_execution_preflight_v1(bigint,bigint) from public, anon, authenticated;
grant execute on function public.h205f22_w1_effective_execution_preflight_v1(bigint,bigint) to service_role;
