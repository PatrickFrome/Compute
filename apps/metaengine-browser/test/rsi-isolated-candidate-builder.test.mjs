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
      workspace_id: 'workspace_rsi_candidate_001',
      isolated: true,
      host_repository_mounted: false,
      linked_git_worktree_exposed: false,
      source_snapshot_read_only: true,
      writable_layer_private: true,
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

test('finalize binds exact materialization to Candidate Capsule and PREPARE_ONLY sandbox', () => {
  const plan = goodBuildPlan();
  const handoff = finalizeRsiIsolatedCandidateBuild({
    build_plan: plan,
    materialization_receipt: goodMaterialization(plan),
  });

  assert.equal(handoff.parent_sha, PARENT);
  assert.equal(handoff.candidate_sha, CANDIDATE);
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
