import assert from 'node:assert/strict';
import test from 'node:test';
import { proveWorkspaceReincarnationCandidate } from '../src/workspace-reincarnation-proof.mjs';

const now = Date.parse('2026-09-02T09:30:00.000Z');
const ids = {
  workspace: '123e4567-e89b-42d3-a456-426614174000',
  binding: '123e4567-e89b-42d3-a456-426614174001',
  coordination: '123e4567-e89b-42d3-a456-426614174002',
  task: '123e4567-e89b-42d3-a456-426614174003',
};
const sha = 'a'.repeat(40);

function fixture() {
  return {
    predecessor: {
      schema: 'metaengine.devos.workspace-binding.v1',
      state: 'READY',
      binding_id: ids.binding,
      workspace_id: ids.workspace,
      workspace_generation: 4,
      coordination_workspace_id: ids.coordination,
      task_id: ids.task,
      claim_id: 41,
      point_id: 'typed-workspaces',
      claim_class: 'MUTATING',
      base_sha: sha,
      branch_name: 'work/browser-typed-workspaces-v1',
      worktree_path: 'C:\\metaengine\\worktrees\\typed-workspaces',
      agent_id: 'agent_12345678',
      tab_id: 'tab_123e4567-e89b-42d3-a456-426614174010',
      target_id: 'webcontents:11',
      agent_generation_epoch: 7,
      lease_generation: 9,
      initial_head_sha: sha,
      last_verified_head_sha: sha,
      ambiguity_code: null,
      dirty_hold: false,
      automatic_retry_allowed: false,
      page_data_authority: false,
      authority_effect: false,
    },
    successor_agent: {
      agent_id: 'agent_12345678',
      lifecycle_state: 'BOUND_UNVERIFIED',
      tab_id: 'tab_123e4567-e89b-42d3-a456-426614174011',
      target_id: 'webcontents:19',
      generation_epoch: 8,
      transport_proof: null,
      browser_authority: false,
      authority_effect: false,
    },
    local_target_observation: {
      schema: 'metaengine.browser.fleet-local-target-observation.v1',
      source: 'METAENGINE_BROWSER_LOCAL_WEBCONTENTS',
      tab_id: 'tab_123e4567-e89b-42d3-a456-426614174011',
      target_id: 'webcontents:19',
      tab_exists: true,
      authority_effect: false,
    },
    claim: {
      claim_id: 52,
      claim_class: 'MUTATING',
      coordination_workspace_id: ids.coordination,
      task_id: ids.task,
      base_sha: sha,
      branch_name: 'work/browser-typed-workspaces-v1',
      agent_id: 'agent_12345678',
      tab_id: 'tab_123e4567-e89b-42d3-a456-426614174011',
      target_id: 'webcontents:19',
      agent_generation_epoch: 8,
      lease_generation: 10,
      lease_expires_at: '2026-09-02T09:45:00.000Z',
      scheduler_authority: false,
      authority_effect: false,
    },
    worktree_readback: {
      schema: 'metaengine.devos.workspace-reincarnation-worktree-readback.v1',
      branch_name: 'work/browser-typed-workspaces-v1',
      worktree_path: 'C:\\metaengine\\worktrees\\typed-workspaces',
      head_sha: sha,
      dirty: false,
      ambiguous: false,
      authority_effect: false,
    },
    now_ms: now,
  };
}

test('exact fresh successor becomes only a zero-authority DB transition candidate', () => {
  const result = proveWorkspaceReincarnationCandidate(fixture());
  assert.equal(result.schema, 'metaengine.devos.workspace-reincarnation-candidate.v1');
  assert.equal(result.eligible_for_db_transition, true);
  assert.equal(result.predecessor.workspace_generation, 4);
  assert.equal(result.successor.workspace_generation, 5);
  assert.equal(result.successor.agent_generation_epoch, 8);
  assert.equal(result.successor.lease_generation, 10);
  assert.equal(result.transition_rpc_required, true);
  assert.equal(result.transition_already_performed, false);
  assert.equal(result.fleet_transport_promoted, false);
  assert.equal(result.url_authority, false);
  assert.equal(result.title_authority, false);
  assert.equal(result.continuity_receipt_authority, false);
  assert.equal(result.automatic_retry_allowed, false);
  assert.equal(result.scheduler_authority, false);
  assert.equal(result.browser_actuation_authority, false);
  assert.equal(result.authority_effect, false);
  assert.equal('url' in result.successor, false);
  assert.equal('title' in result.successor, false);
});

test('successor must be a new physical tab and target incarnation', () => {
  const sameTab = fixture();
  sameTab.successor_agent.tab_id = sameTab.predecessor.tab_id;
  sameTab.local_target_observation.tab_id = sameTab.predecessor.tab_id;
  sameTab.claim.tab_id = sameTab.predecessor.tab_id;
  assert.throws(() => proveWorkspaceReincarnationCandidate(sameTab), /tab_incarnation_not_replaced/);

  const sameTarget = fixture();
  sameTarget.successor_agent.target_id = sameTarget.predecessor.target_id;
  sameTarget.local_target_observation.target_id = sameTarget.predecessor.target_id;
  sameTarget.claim.target_id = sameTarget.predecessor.target_id;
  assert.throws(() => proveWorkspaceReincarnationCandidate(sameTarget), /target_incarnation_not_replaced/);
});

test('agent generation and lease generation must both advance', () => {
  const staleAgent = fixture();
  staleAgent.successor_agent.generation_epoch = 7;
  staleAgent.claim.agent_generation_epoch = 7;
  assert.throws(() => proveWorkspaceReincarnationCandidate(staleAgent), /agent_generation_not_advanced/);

  const staleLease = fixture();
  staleLease.claim.lease_generation = 9;
  assert.throws(() => proveWorkspaceReincarnationCandidate(staleLease), /lease_generation_not_advanced/);
});

test('expired or drifted fresh claim cannot form a candidate', () => {
  const expired = fixture();
  expired.claim.lease_expires_at = '2026-09-02T09:29:59.000Z';
  assert.throws(() => proveWorkspaceReincarnationCandidate(expired), /lease_not_fresh/);

  const targetDrift = fixture();
  targetDrift.claim.target_id = 'webcontents:20';
  assert.throws(() => proveWorkspaceReincarnationCandidate(targetDrift), /claim_target_mismatch/);

  const taskDrift = fixture();
  taskDrift.claim.task_id = '123e4567-e89b-42d3-a456-426614174099';
  assert.throws(() => proveWorkspaceReincarnationCandidate(taskDrift), /claim_task_mismatch/);
});

test('local target observation must be exact Browser-owned live evidence', () => {
  const forged = fixture();
  forged.local_target_observation.source = 'PAGE_MODEL_OBSERVER';
  assert.throws(() => proveWorkspaceReincarnationCandidate(forged), /local_target_not_proven/);

  const dead = fixture();
  dead.local_target_observation.tab_exists = false;
  assert.throws(() => proveWorkspaceReincarnationCandidate(dead), /local_target_not_proven/);

  const drift = fixture();
  drift.local_target_observation.target_id = 'webcontents:21';
  assert.throws(() => proveWorkspaceReincarnationCandidate(drift), /observation_target_mismatch/);
});

test('FROZEN, dirty or ambiguous predecessor cannot use restart as a recovery bypass', () => {
  const frozen = fixture();
  frozen.predecessor.state = 'FROZEN';
  frozen.predecessor.ambiguity_code = 'OLD_EFFECT_UNKNOWN';
  assert.throws(() => proveWorkspaceReincarnationCandidate(frozen), /predecessor_not_ready/);

  const dirty = fixture();
  dirty.predecessor.dirty_hold = true;
  assert.throws(() => proveWorkspaceReincarnationCandidate(dirty), /predecessor_hold/);
});

test('worktree branch, path, head and cleanliness remain exact across Browser reincarnation', () => {
  const branch = fixture();
  branch.worktree_readback.branch_name = 'work/other';
  assert.throws(() => proveWorkspaceReincarnationCandidate(branch), /worktree_branch_mismatch/);

  const head = fixture();
  head.worktree_readback.head_sha = 'b'.repeat(40);
  assert.throws(() => proveWorkspaceReincarnationCandidate(head), /worktree_head_mismatch/);

  const dirty = fixture();
  dirty.worktree_readback.dirty = true;
  assert.throws(() => proveWorkspaceReincarnationCandidate(dirty), /worktree_not_clean/);
});

test('transport promotion cannot be laundered through the reincarnation proof', () => {
  const input = fixture();
  input.successor_agent.transport_proof = {
    schema: 'metaengine.browser.fleet-transport-proof.v1',
    tab_id: input.successor_agent.tab_id,
    target_id: input.successor_agent.target_id,
    generation_epoch: 8,
  };
  assert.throws(() => proveWorkspaceReincarnationCandidate(input), /transport_promotion_not_allowed/);
});
