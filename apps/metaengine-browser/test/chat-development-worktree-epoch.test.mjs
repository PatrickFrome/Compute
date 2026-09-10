import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatDevelopmentControlState } from '../src/chat-development-control-state.mjs';

const source = (worktreeEpoch, dirty = true) => ({
  repository: 'PatrickFrome/Compute',
  branch: 'work/browser-host-agent-p0',
  head_sha: 'a'.repeat(40),
  base_sha: 'b'.repeat(40),
  pr: 453,
  dirty,
  worktree_epoch: worktreeEpoch,
  authority_effect: false,
});

test('same-head worktree epoch advances source revision without discarding CI or evidence', () => {
  const state = new ChatDevelopmentControlState();
  state.setSource(source(0, false));
  state.setRepoIndexRevision('repoidx:old', { head_sha: 'a'.repeat(40) });
  state.upsertCi({ id: 1, name: 'Shell', status: 'completed', conclusion: 'success', head_sha: 'a'.repeat(40), authority_effect: false });
  state.upsertEvidence({ id: 'next:one', kind: 'NEXT_ACTION', title: 'Continue', severity: 'INFO', authority_effect: false });
  const before = state.snapshot();

  state.setSource(source(1, true));
  const after = state.snapshot();

  assert.equal(after.source_epoch, before.source_epoch + 1);
  assert.equal(after.source.worktree_epoch, 1);
  assert.equal(after.repo_index_revision, null);
  assert.equal(after.ci_rows, 1);
  assert.equal(after.evidence_rows, 1);
  assert.equal(state.query({ query: 'shell success', kinds: ['CI'] }).total_hits, 1);
  assert.equal(state.query({ query: 'continue', kinds: ['NEXT_ACTION'] }).total_hits, 1);
});

test('HEAD change still clears stale CI and evidence even when worktree epoch is present', () => {
  const state = new ChatDevelopmentControlState();
  state.setSource(source(3, true));
  state.upsertCi({ id: 1, name: 'Old', status: 'completed', conclusion: 'failure', head_sha: 'a'.repeat(40), authority_effect: false });
  state.upsertEvidence({ id: 'old:blocker', kind: 'BLOCKER', title: 'Old blocker', severity: 'HIGH', authority_effect: false });

  state.setSource({ ...source(0, false), head_sha: 'c'.repeat(40) });
  const after = state.snapshot();

  assert.equal(after.ci_rows, 0);
  assert.equal(after.evidence_rows, 0);
  assert.equal(after.source.worktree_epoch, 0);
});
