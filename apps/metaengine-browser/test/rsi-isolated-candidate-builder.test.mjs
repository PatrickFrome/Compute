import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RSI_ISOLATED_CANDIDATE_MATERIALIZATION_SCHEMA,
  finalizeRsiIsolatedCandidateBuild,
  prepareRsiIsolatedCandidateBuild,
  verifyRsiIsolatedCandidateBuildPlan,
} from '../src/rsi-isolated-candidate-builder.mjs';
import { RsiShadowArchive } from '../src/rsi-shadow-core.mjs';
import { RSI_DEVOS_EXPERIMENT_PLAN_SCHEMA } from '../src/rsi-devos-experiment-plan.mjs';

const PARENT = 'a'.repeat(40);
const CANDIDATE = 'b'.repeat(40);
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const COORDINATION_WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const TASK_ID = '33333333-3333-4333-8333-333333333333';
const AGENT_ID = 'agent_00000000-0000-4000-8000-000000000001';
const TAB_ID = 'tab_00000000-0000-4000-8000-000000000001';
const SOURCE_SNAPSHOT = Object.freeze({
  schema: 'metaengine.devos.packaged-source-snapshot.v1',
  repository: 'PatrickFrome/Compute',
  head: PARENT,
  ref: 'refs/heads/release/self-update-ambiguity-live-v2',
  source_files: [
    'apps/metaengine-browser/src/main.mjs',
    'apps/metaengine-browser/ui/app.js',
  ],
  source_file_count: 2,
  bounded: true,
  arbitrary_path_copy: false,
  process_spawn_used: false,
  authority_effect: false,
});

function experimentPlan(overrides = {}) {
  return {
    schema: RSI_DEVOS_EXPERIMENT_PLAN_SCHEMA,
    experiment_id: 'rsi_exp_0123456789abcdef01234567',
    source_sha: PARENT,
    target_branch: 'work/rsi/reliability-aaaaaaaa-01234567',
    task_spec: {
      schema: RSI_DEVOS_EXPERIMENT_PLAN_SCHEMA,
      objective: 'Improve bounded Browser Brain routing without changing authority.',
      constraints: ['exact_base_sha=' + PARENT],
      deliverable: 'Exact candidate and evidence only.',
      source_branch: '',
      target_branch: 'work/rsi/reliability-aaaaaaaa-01234567',
      rsi: {
        experiment_id: 'rsi_exp_0123456789abcdef01234567',
        observation_digest: '0'.repeat(64),
        opportunity_id: 'opportunity:test',
        signal: 'RELIABILITY_PRESSURE',
        mutation_surface: 'AGENT_ORCHESTRATION',
        source_sha: PARENT,
        shadow_only: true,
      },
    },
    requires_existing_devos_scheduler: true,
    lease_created: false,
    agent_assigned: false,
    workspace_bound: false,
    command_created: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
    ...overrides,
  };
}

function goodBuildPlan(extra = {}) {
  return prepareRsiIsolatedCandidateBuild({
    experiment_plan: experimentPlan(),
    source_snapshot: SOURCE_SNAPSHOT,
    mutations: [{ path: 'apps/metaengine-browser/src/browser-brain-routing-v2.mjs', change: 'MODIFY' }],
    sequence: 1,
    requested_backend: 'VERCEL_SANDBOX',
    ...extra,
  });
}

function goodBindingSnapshot(plan, rowOverrides = {}, snapshotOverrides = {}) {
  return {
    schema: 'metaengine.devos.workspace-binding-snapshot.v1',
    state: 'AVAILABLE',
    coordination_workspace_id: COORDINATION_WORKSPACE_ID,
    observed_at: '2026-09-17T00:00:01.000Z',
    bindings: [{
      workspace_id: WORKSPACE_ID,
      workspace_generation: 3,
      coordination_workspace_id: COORDINATION_WORKSPACE_ID,
      task_id: TASK_ID,
      claim_id: 41,
      point_id: 'rsi.candidate.materialize.v1',
      repo_id: 'PatrickFrome/Compute',
      base_sha: PARENT,
      branch_name: plan.target_branch,
      agent_id: AGENT_ID,
      tab_id: TAB_ID,
      target_id: 'webcontents:7',
      agent_generation_epoch: 28,
      lease_generation: 2,
      lease_expires_at: '2026-09-17T00:15:00.000Z',
      lease_current: true,
      state: 'READY',
      last_verified_head_sha: PARENT,
      ambiguity_code: null,
      dirty_hold: false,
      updated_at: '2026-09-17T00:00:00.000Z',
      automatic_retry_allowed: false,
      scheduler_authority: false,
      browser_actuation_authority: false,
      page_data_authority: false,
      authority_effect: false,
      ...rowOverrides,
    }],
    bounded_rows: 64,
    filesystem_paths_exposed: false,
    scheduler_authority: false,
    browser_actuation_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
    ...snapshotOverrides,
  };
}

function goodMaterialization(plan, extra = {}) {
  return {
    schema: RSI_ISOLATED_CANDIDATE_MATERIALIZATION_SCHEMA,
    plan_id: plan.plan_id,
    plan_digest: plan.plan_digest,
    experiment_id: plan.experiment_id,
    parent_sha: PARENT,
    candidate_sha: CANDIDATE,
    target_branch: plan.target_branch,
    workspace: {
      workspace_id: WORKSPACE_ID,
      isolated: true,
      host_repository_mounted: false,
      linked_git_worktree_exposed: false,
      source_snapshot_read_only: true,
      writable_layer_private: true,
      binding_snapshot: goodBindingSnapshot(plan),
    },
    input_manifest_digest: plan.source.source_snapshot_digest,
    output_manifest_digest: `sha256:${'d'.repeat(64)}`,
    components: [{
      path: 'apps/metaengine-browser/src/browser-brain-routing-v2.mjs',
      change: 'MODIFY',
      digest: `sha256:${'c'.repeat(64)}`,
    }],
    materialized_file_count: 1,
    materialized_bytes: 4096,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
    ...extra,
  };
}

test('prepare phase is deterministic, exact-source, pre-lease and zero-authority', () => {
  const first = goodBuildPlan();
  const second = goodBuildPlan();
  assert.deepEqual(first, second);
  assert.equal(first.source.parent_sha, PARENT);
  assert.equal(first.workspace_contract.authority, 'EXISTING_DEVOS_ONLY');
  assert.equal(first.workspace_contract.binding_schema, 'metaengine.devos.workspace-binding-snapshot.v1');
  assert.equal(first.workspace_contract.exact_base_sha_readback_required, true);
  assert.equal(first.workspace_contract.exact_verified_head_readback_required, true);
  assert.equal(first.workspace_contract.current_lease_readback_required, true);
  assert.equal(first.workspace_contract.host_repository_mount_allowed, false);
  assert.equal(first.workspace_contract.linked_git_worktree_is_security_boundary, false);
  assert.equal(first.materialization_contract.arbitrary_command_field_allowed, false);
  assert.equal(first.lease_created, false);
  assert.equal(first.workspace_created, false);
  assert.equal(first.materialization_executed, false);
  assert.equal(first.execution_authority, false);
  assert.equal(first.promotion_authority, false);
  assert.equal(first.automatic_retry_allowed, false);
  assert.equal(verifyRsiIsolatedCandidateBuildPlan(first).ok, true);
});

test('prepare rejects source drift before any materialization authority can exist', () => {
  assert.throws(() => goodBuildPlan({
    source_snapshot: { ...SOURCE_SNAPSHOT, head: 'f'.repeat(40) },
  }), /source_snapshot_head_mismatch/);
});

test('prepare rejects traversal, evaluator roots and update authority paths', () => {
  for (const path of [
    '../outside.mjs',
    'apps/metaengine-browser/test/rsi-shadow-core.test.mjs',
    'apps/metaengine-browser/src/self-update-runtime.mjs',
    'apps/metaengine-browser/src/rsi-shadow-core.mjs',
    'apps/metaengine-browser/src/rsi-episode-orchestrator.mjs',
    'apps/metaengine-browser/src/rsi-browser-command-attribution-registry.mjs',
    'apps/metaengine-browser/src/rsi-trusted-credit-assignment.mjs',
    'apps/metaengine-browser/supabase/rsi-shadow-archive-v1.sql',
  ]) {
    assert.throws(() => goodBuildPlan({ mutations: [{ path, change: 'MODIFY' }] }), /mutation_|immutable_/);
  }
});

test('tampering with a prepared plan invalidates its digest', () => {
  const plan = goodBuildPlan();
  const tampered = structuredClone(plan);
  tampered.workspace_contract.host_repository_mount_allowed = true;
  assert.throws(() => verifyRsiIsolatedCandidateBuildPlan(tampered), /digest_mismatch/);
});

test('finalize binds exact workspace base readback, Candidate Capsule and PREPARE_ONLY sandbox', () => {
  const plan = goodBuildPlan();
  const handoff = finalizeRsiIsolatedCandidateBuild({
    build_plan: plan,
    materialization_receipt: goodMaterialization(plan),
  });

  assert.equal(handoff.parent_sha, PARENT);
  assert.equal(handoff.candidate_sha, CANDIDATE);
  assert.match(handoff.workspace_binding_readback_digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(handoff.candidate_capsule.source.head, CANDIDATE);
  assert.match(handoff.candidate_capsule.candidate_id, /^candidate_sha256_[0-9a-f]{64}$/);
  assert.equal(handoff.candidate_verification.ok, true);
  assert.equal(handoff.candidate_verification.executable, false);
  assert.equal(handoff.candidate_verification.promotion_authorized, false);
  assert.equal(handoff.sandbox_plan.mode, 'PREPARE_ONLY');
  assert.equal(handoff.sandbox_plan.filesystem.host_repository_mounted, false);
  assert.equal(handoff.sandbox_plan.network.deny_by_default, true);
  assert.deepEqual(handoff.sandbox_plan.network.allowed_hosts, []);
  assert.equal(handoff.sandbox_plan_verification.execution_authorized, false);
  assert.equal(handoff.eligible_for_evaluation, true);
  assert.equal(handoff.eligible_for_promotion, false);
  assert.equal(handoff.materialization_replay_authorized, false);
  assert.equal(handoff.execution_authority, false);
  assert.equal(handoff.self_update_authority, false);
  assert.equal(handoff.automatic_retry_allowed, false);
});

test('finalize rejects stale workspace base, stale verified head and non-current lease', () => {
  const plan = goodBuildPlan();

  for (const rowOverrides of [
    { base_sha: 'f'.repeat(40) },
    { last_verified_head_sha: 'f'.repeat(40) },
    { lease_current: false },
    { dirty_hold: true },
    { ambiguity_code: 'HEAD_AMBIGUOUS' },
  ]) {
    const materialization = goodMaterialization(plan);
    materialization.workspace.binding_snapshot = goodBindingSnapshot(plan, rowOverrides);
    assert.throws(
      () => finalizeRsiIsolatedCandidateBuild({ build_plan: plan, materialization_receipt: materialization }),
      /workspace_binding_source_fence_invalid/,
    );
  }
});

test('finalize rejects workspace binding authority or filesystem-path exposure', () => {
  const plan = goodBuildPlan();
  const authority = goodMaterialization(plan);
  authority.workspace.binding_snapshot = goodBindingSnapshot(plan, { browser_actuation_authority: true });
  assert.throws(() => finalizeRsiIsolatedCandidateBuild({ build_plan: plan, materialization_receipt: authority }), /workspace_binding_authority_invalid/);

  const pathLeak = goodMaterialization(plan);
  pathLeak.workspace.binding_snapshot = goodBindingSnapshot(plan, { worktree_path: 'C:/repo/worktree' });
  assert.throws(() => finalizeRsiIsolatedCandidateBuild({ build_plan: plan, materialization_receipt: pathLeak }), /workspace_binding_paths_exposed/);
});

test('finalize rejects no-op candidate, host repo exposure and mutation-set substitution', () => {
  const plan = goodBuildPlan();
  assert.throws(() => finalizeRsiIsolatedCandidateBuild({
    build_plan: plan,
    materialization_receipt: goodMaterialization(plan, { candidate_sha: PARENT }),
  }), /materialization_noop/);

  const exposed = goodMaterialization(plan);
  exposed.workspace.host_repository_mounted = true;
  assert.throws(() => finalizeRsiIsolatedCandidateBuild({ build_plan: plan, materialization_receipt: exposed }), /workspace_isolation_invalid/);

  assert.throws(() => finalizeRsiIsolatedCandidateBuild({
    build_plan: plan,
    materialization_receipt: goodMaterialization(plan, {
      components: [{ path: 'apps/metaengine-browser/src/main.mjs', change: 'MODIFY', digest: `sha256:${'e'.repeat(64)}` }],
    }),
  }), /components_mismatch/);
});

test('handoff feeds the existing shadow archive without acquiring promotion authority', () => {
  const plan = goodBuildPlan();
  const handoff = finalizeRsiIsolatedCandidateBuild({ build_plan: plan, materialization_receipt: goodMaterialization(plan) });
  const archive = new RsiShadowArchive({ clock: () => Date.parse('2026-09-17T00:00:00.000Z') });
  const proposed = archive.propose(handoff.shadow_archive_proposal);
  assert.equal(proposed.parent_sha, PARENT);
  assert.equal(proposed.candidate_sha, CANDIDATE);
  assert.equal(proposed.state, 'PROPOSED');
  assert.equal(proposed.execution_authority, false);
  assert.equal(proposed.promotion_authority, false);
  assert.equal(proposed.self_update_authority, false);
});
