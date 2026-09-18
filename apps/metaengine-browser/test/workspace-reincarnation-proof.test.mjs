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
const tab = 'tab_123e4567-e89b-42d3-a456-426614174011';
const target = 'webcontents:19';
const leaseExpiry = '2026-09-02T09:45:00.000Z';

function fixture() {
  return {
    predecessor: {
      schema: 'metaengine.devos.workspace-binding.v1', state: 'READY', binding_id: ids.binding,
      workspace_id: ids.workspace, workspace_generation: 4, coordination_workspace_id: ids.coordination,
      task_id: ids.task, claim_id: 41, point_id: 'typed-workspaces', claim_class: 'MUTATING', base_sha: sha,
      branch_name: 'work/browser-typed-workspaces-v1', worktree_path: 'C:\\metaengine\\worktrees\\typed-workspaces',
      agent_id: 'agent_12345678', tab_id: 'tab_123e4567-e89b-42d3-a456-426614174010', target_id: 'webcontents:11',
      agent_generation_epoch: 7, lease_generation: 9, initial_head_sha: sha, last_verified_head_sha: sha,
      ambiguity_code: null, dirty_hold: false, automatic_retry_allowed: false, page_data_authority: false, authority_effect: false,
    },
    successor_agent: {
      agent_id: 'agent_12345678', role: 'IMPLEMENTER', ownership: 'FLEET_OWNED', lifecycle_state: 'ACTIVE',
      tab_id: tab, target_id: target, generation_epoch: 8, automatic_retry_allowed: false, browser_authority: false, authority_effect: false,
      transport_proof: {
        schema: 'metaengine.browser.fleet-transport-proof.v1', tab_id: tab, target_id: target, generation_epoch: 8,
        conversation_url_sha256: 'b'.repeat(64), proven_at: '2026-09-02T09:29:58.000Z', authority_effect: false,
      },
    },
    local_target_observation: {
      schema: 'metaengine.browser.fleet-local-target-observation.v1', source: 'METAENGINE_BROWSER_LOCAL_WEBCONTENTS',
      tab_id: tab, target_id: target, tab_exists: true, authority_effect: false,
    },
    scheduler_task: {
      task_id: ids.task, workspace_id: ids.coordination, point_id: 'typed-workspaces', role: 'IMPLEMENTER', claim_class: 'MUTATING',
      base_sha: sha, branch_name: 'work/browser-typed-workspaces-v1', state: 'LEASED', lease_generation: 10,
      lease_agent_id: 'agent_12345678', lease_tab_id: tab, lease_target_id: target, lease_agent_generation_epoch: 8,
      lease_expires_at: leaseExpiry, authority_effect: false,
    },
    claim: {
      claim_id: 52, claim_class: 'MUTATING', state: 'ACTIVE', workspace_id: ids.coordination, task_id: ids.task,
      point_id: 'typed-workspaces', role: 'IMPLEMENTER', base_sha: sha, agent_id: 'agent_12345678', tab_id: tab,
      target_id: target, agent_generation_epoch: 8, lease_generation: 10, expires_at: leaseExpiry,
      scheduler_authority: false, authority_effect: false,
    },
    worktree_readback: {
      schema: 'metaengine.devos.workspace-reincarnation-worktree-readback.v1', branch_name: 'work/browser-typed-workspaces-v1',
      worktree_path: 'C:\\metaengine\\worktrees\\typed-workspaces', head_sha: sha, dirty: false, ambiguous: false, authority_effect: false,
    },
    now_ms: now,
  };
}

test('exact scheduler-admitted successor becomes only a zero-authority DB transition candidate', () => {
  const result = proveWorkspaceReincarnationCandidate(fixture());
  assert.equal(result.eligible_for_db_transition, true);
  assert.equal(result.predecessor.workspace_generation, 4);
  assert.equal(result.successor.workspace_generation, 5);
  assert.equal(result.preexisting_transport_proof_verified, true);
  assert.equal(result.fleet_transport_promoted_by_this_proof, false);
  assert.equal(result.scheduler_claim_created_by_this_proof, false);
  assert.equal(result.transition_rpc_required, true);
  assert.equal(result.transition_already_performed, false);
  assert.equal(result.automatic_retry_allowed, false);
  assert.equal(result.authority_effect, false);
  assert.equal('url' in result.successor, false);
  assert.equal('title' in result.successor, false);
});

test('BOUND_UNVERIFIED or missing transport proof cannot bypass the existing C5 admission boundary', () => {
  const unverified = fixture();
  unverified.successor_agent.lifecycle_state = 'BOUND_UNVERIFIED';
  assert.throws(() => proveWorkspaceReincarnationCandidate(unverified), /successor_not_transport_admitted/);

  const noProof = fixture();
  noProof.successor_agent.transport_proof = null;
  assert.throws(() => proveWorkspaceReincarnationCandidate(noProof), /transport_proof_invalid/);

  const drift = fixture();
  drift.successor_agent.transport_proof.target_id = 'webcontents:20';
  assert.throws(() => proveWorkspaceReincarnationCandidate(drift), /transport_proof_target_mismatch/);
});

test('successor must be a new physical tab and target incarnation with advanced generation', () => {
  const sameTab = fixture();
  sameTab.successor_agent.tab_id = sameTab.predecessor.tab_id;
  assert.throws(() => proveWorkspaceReincarnationCandidate(sameTab), /tab_incarnation_not_replaced/);

  const sameTarget = fixture();
  sameTarget.successor_agent.target_id = sameTarget.predecessor.target_id;
  assert.throws(() => proveWorkspaceReincarnationCandidate(sameTarget), /target_incarnation_not_replaced/);

  const staleAgent = fixture();
  staleAgent.successor_agent.generation_epoch = 7;
  assert.throws(() => proveWorkspaceReincarnationCandidate(staleAgent), /agent_generation_not_advanced/);
});

test('scheduler task and ACTIVE claim must describe the same fresh exact lease', () => {
  const staleLease = fixture();
  staleLease.claim.lease_generation = 9;
  assert.throws(() => proveWorkspaceReincarnationCandidate(staleLease), /lease_generation_not_advanced/);

  const expired = fixture();
  expired.claim.expires_at = '2026-09-02T09:29:59.000Z';
  assert.throws(() => proveWorkspaceReincarnationCandidate(expired), /lease_not_fresh/);

  const mismatchedExpiry = fixture();
  mismatchedExpiry.claim.expires_at = '2026-09-02T09:44:00.000Z';
  assert.throws(() => proveWorkspaceReincarnationCandidate(mismatchedExpiry), /claim_task_expiry_mismatch/);

  const inactive = fixture();
  inactive.claim.state = 'EXPIRED';
  assert.throws(() => proveWorkspaceReincarnationCandidate(inactive), /claim_not_active/);

  const taskTargetDrift = fixture();
  taskTargetDrift.scheduler_task.lease_target_id = 'webcontents:20';
  assert.throws(() => proveWorkspaceReincarnationCandidate(taskTargetDrift), /task_target_mismatch/);
});

test('claim cannot drift from task, predecessor or fresh Fleet incarnation', () => {
  const targetDrift = fixture();
  targetDrift.claim.target_id = 'webcontents:20';
  assert.throws(() => proveWorkspaceReincarnationCandidate(targetDrift), /claim_target_mismatch/);

  const taskDrift = fixture();
  taskDrift.claim.task_id = '123e4567-e89b-42d3-a456-426614174099';
  assert.throws(() => proveWorkspaceReincarnationCandidate(taskDrift), /claim_task_mismatch/);

  const branchDrift = fixture();
  branchDrift.scheduler_task.branch_name = 'work/other';
  assert.throws(() => proveWorkspaceReincarnationCandidate(branchDrift), /task_branch_mismatch/);
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

test('FROZEN or dirty predecessor cannot use restart as a recovery bypass', () => {
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
