import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ChatDevelopmentControlState,
  CHAT_DEVELOPMENT_CONTROL_MAX_CI,
  CHAT_DEVELOPMENT_CONTROL_MAX_EVIDENCE,
} from '../src/chat-development-control-state.mjs';
import { FAST_CONTEXT_ORDINARY_BUDGET_BYTES } from '../src/fast-context-v1.mjs';

const source = (head = 'a'.repeat(40)) => ({
  repository: 'PatrickFrome/Compute',
  branch: 'work/browser-command-fabric-v2-p0',
  head_sha: head,
  base_sha: 'b'.repeat(40),
  pr: 453,
  dirty: false,
  authority_effect: false,
});

test('event-driven state serves context, CI, and evidence search from bounded memory', () => {
  const state = new ChatDevelopmentControlState();
  state.setSource(source(), '2026-09-10T10:00:00.000Z');
  state.setCapabilityRevision(`sha256:${'c'.repeat(64)}`);
  state.setRepoIndexRevision('repoidx:test', { head_sha: 'a'.repeat(40) });
  state.upsertEvidence({
    id: 'blocker:abort', kind: 'BLOCKER', title: 'Wire command scoped AbortSignal',
    text: 'boundedNavigation should receive AbortSignal', path: 'apps/metaengine-browser/src/main.mjs', severity: 'CRITICAL', authority_effect: false,
  });
  state.upsertCi({ id: 101, name: 'Shell', status: 'completed', conclusion: 'failure', head_sha: 'a'.repeat(40), authority_effect: false });

  const query = state.query({ query: 'bounded navigation abort signal', limit: 6 });
  assert.equal(query.total_hits, 1);
  assert.equal(query.hits[0].id, 'blocker:abort');
  const ciQuery = state.query({ query: 'shell failure', kinds: ['CI'], limit: 4 });
  assert.equal(ciQuery.total_hits, 1);
  assert.equal(ciQuery.hits[0].id, 'ci-run:101');
  assert.equal(ciQuery.hits[0].kind, 'CI');

  const context = state.fastContext({
    state: { client_id: 'client-1', heartbeat_at: '2026-09-10T10:00:00.000Z' },
    now_ms: Date.parse('2026-09-10T10:00:00.500Z'),
  });
  assert.equal(context.context.development_capsule.focus.kind, 'CI_FAILURE');
  assert.equal(context.context.development_capsule.search.preferred_tool, 'dev_query');
  assert.equal(context.context.development.head_sha, 'a'.repeat(40));
  assert.ok(context.bytes <= FAST_CONTEXT_ORDINARY_BUDGET_BYTES);
  assert.equal(state.snapshot().indexed_rows, 2);
  assert.equal(state.snapshot().query_network_reads, 0);
  assert.equal(state.snapshot().query_filesystem_reads, 0);
  assert.equal(state.snapshot().second_scheduler, false);
});

test('new exact head atomically clears stale CI and development evidence', () => {
  const state = new ChatDevelopmentControlState();
  state.setSource(source('a'.repeat(40)));
  state.upsertEvidence({ id: 'blocker:old', kind: 'BLOCKER', title: 'Old blocker', severity: 'HIGH', authority_effect: false });
  state.upsertCi({ id: 1, name: 'Old shell', status: 'completed', conclusion: 'failure', head_sha: 'a'.repeat(40), authority_effect: false });
  const before = state.snapshot();

  state.setSource(source('c'.repeat(40)));
  const after = state.snapshot();
  assert.equal(after.source_epoch, before.source_epoch + 1);
  assert.equal(after.ci_rows, 0);
  assert.equal(after.evidence_rows, 0);
  assert.equal(after.indexed_rows, 0);
  assert.equal(after.repo_index_revision, null);
  assert.equal(state.query({ query: 'old blocker' }).total_hits, 0);
  assert.equal(state.capsule().focus.kind, 'NONE');
});

test('stale CI event is rejected without changing current state revision', () => {
  const state = new ChatDevelopmentControlState();
  state.setSource(source());
  const before = state.snapshot().revision;
  const result = state.upsertCi({ id: 1, name: 'Stale', status: 'completed', conclusion: 'failure', head_sha: 'd'.repeat(40), authority_effect: false });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'STALE_HEAD');
  assert.equal(state.snapshot().revision, before);
  assert.equal(state.snapshot().ci_rows, 0);
});

test('CI completion event changes deterministic chat focus without a discovery pass', () => {
  const state = new ChatDevelopmentControlState();
  state.setSource(source());
  state.upsertEvidence({ id: 'next:one', kind: 'NEXT_ACTION', title: 'Continue source work', severity: 'HIGH', authority_effect: false });
  state.upsertCi({ id: 9, name: 'Shell', status: 'in_progress', conclusion: null, head_sha: 'a'.repeat(40), authority_effect: false });
  assert.equal(state.capsule().focus.kind, 'NEXT_ACTION');
  assert.equal(state.query({ query: 'shell in_progress', kinds: ['CI'] }).total_hits, 1);
  state.upsertCi({ id: 9, name: 'Shell', status: 'completed', conclusion: 'failure', head_sha: 'a'.repeat(40), authority_effect: false });
  assert.equal(state.capsule().focus.kind, 'CI_FAILURE');
  assert.equal(state.query({ query: 'shell failure', kinds: ['CI'] }).total_hits, 1);
  state.upsertCi({ id: 9, name: 'Shell', status: 'completed', conclusion: 'success', head_sha: 'a'.repeat(40), authority_effect: false });
  assert.equal(state.capsule().focus.kind, 'NEXT_ACTION');
  assert.equal(state.query({ query: 'shell success', kinds: ['CI'] }).total_hits, 1);
});

test('CI and evidence memory stay bounded under long chat-driven development', () => {
  const state = new ChatDevelopmentControlState();
  state.setSource(source());
  for (let i = 0; i < CHAT_DEVELOPMENT_CONTROL_MAX_CI + 30; i += 1) {
    state.upsertCi({ id: `ci:${i}`, name: `CI ${i}`, status: 'completed', conclusion: 'success', head_sha: 'a'.repeat(40), updated_at: new Date(1_700_000_000_000 + i).toISOString(), authority_effect: false });
  }
  for (let i = 0; i < CHAT_DEVELOPMENT_CONTROL_MAX_EVIDENCE + 40; i += 1) {
    state.upsertEvidence({ id: `change:${i}`, kind: 'CHANGE', title: `Change ${i}`, text: `source ${i}`, severity: 'INFO', updated_at: new Date(1_700_000_000_000 + i).toISOString(), authority_effect: false });
  }
  assert.equal(state.snapshot().ci_rows, CHAT_DEVELOPMENT_CONTROL_MAX_CI);
  assert.equal(state.snapshot().evidence_rows, CHAT_DEVELOPMENT_CONTROL_MAX_EVIDENCE);
  assert.equal(state.snapshot().indexed_rows, CHAT_DEVELOPMENT_CONTROL_MAX_CI + CHAT_DEVELOPMENT_CONTROL_MAX_EVIDENCE);
});

test('cross-head evidence and authority-bearing events fail closed', () => {
  const state = new ChatDevelopmentControlState();
  state.setSource(source());
  assert.throws(() => state.upsertEvidence({ id: 'x', kind: 'BLOCKER', sha: 'b'.repeat(40), authority_effect: false }), /evidence_head_mismatch/);
  assert.throws(() => state.upsertEvidence({ id: 'x', kind: 'BLOCKER', authority_effect: true }), /evidence_invalid/);
  assert.throws(() => state.upsertEvidence({ id: 'ci-run:forged', kind: 'CI', authority_effect: false }), /evidence_id_reserved/);
  assert.throws(() => state.upsertCi({ id: 1, name: 'x', status: 'completed', conclusion: 'success', authority_effect: true }), /ci_invalid/);
});
