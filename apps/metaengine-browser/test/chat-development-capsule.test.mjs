import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildChatDevelopmentCapsule,
  CHAT_DEVELOPMENT_CAPSULE_MAX_BYTES,
} from '../src/chat-development-capsule.mjs';

const head = 'a'.repeat(40);
const source = {
  repository: 'PatrickFrome/Compute',
  branch: 'work/browser-command-fabric-v2-p0',
  head_sha: head,
  base_sha: 'b'.repeat(40),
  pr: 453,
  dirty: false,
};

const evidence = [
  { id: 'blocker:abort', kind: 'BLOCKER', title: 'Wire command-scoped AbortSignal', path: 'apps/metaengine-browser/src/main.mjs', severity: 'CRITICAL', authority_effect: false },
  { id: 'next:context', kind: 'NEXT_ACTION', title: 'Expose chat development capsule in context_get', path: 'apps/metaengine-browser/src/fast-context-v1.mjs', severity: 'HIGH', authority_effect: false },
  { id: 'hotspot:gateway', kind: 'HOTSPOT', title: 'Fast control gateway', path: 'apps/metaengine-browser/src/fast-control-gateway-core.mjs', severity: 'MEDIUM', authority_effect: false },
  { id: 'checkpoint:p0', kind: 'CHECKPOINT', title: 'Command Fabric P0', ref: 'PR#453', severity: 'INFO', authority_effect: false },
];

test('capsule compresses exact source CI blockers and next action into one chat turn', () => {
  const capsule = buildChatDevelopmentCapsule({
    source,
    ci_runs: [
      { id: 101, name: 'Shell', status: 'completed', conclusion: 'failure', head_sha: head, authority_effect: false },
      { id: 102, name: 'Fast Lane', status: 'completed', conclusion: 'success', head_sha: head, authority_effect: false },
      { id: 103, name: 'Critical Audit', status: 'in_progress', conclusion: null, head_sha: head, authority_effect: false },
    ],
    evidence,
    evidence_revision: 'dev:test',
    repo_index_revision: 'repoidx:test',
    capability_revision: 'sha256:test',
    generated_at: '2026-09-10T10:00:00.000Z',
  });
  assert.equal(capsule.source.head_sha, head);
  assert.equal(capsule.source.pr, 453);
  assert.equal(capsule.ci.state, 'RED');
  assert.equal(capsule.ci.failed, 1);
  assert.equal(capsule.ci.pending, 1);
  assert.equal(capsule.focus.kind, 'CI_FAILURE');
  assert.equal(capsule.blockers[0].id, 'blocker:abort');
  assert.equal(capsule.next_actions[0].id, 'next:context');
  assert.equal(capsule.search.preferred_tool, 'dev_query');
  assert.ok(capsule.bytes <= CHAT_DEVELOPMENT_CAPSULE_MAX_BYTES);
  assert.equal(capsule.command_authority, false);
  assert.equal(capsule.browser_execution_authority, false);
  assert.equal(capsule.authority_effect, false);
});

test('stale CI rows are ignored instead of contaminating exact-head focus', () => {
  const capsule = buildChatDevelopmentCapsule({
    source,
    ci_runs: [
      { id: 201, name: 'Old failure', status: 'completed', conclusion: 'failure', head_sha: 'c'.repeat(40), authority_effect: false },
      { id: 202, name: 'Current Fast Lane', status: 'completed', conclusion: 'success', head_sha: head, authority_effect: false },
    ],
    evidence,
  });
  assert.equal(capsule.ci.state, 'GREEN');
  assert.equal(capsule.ci.failed, 0);
  assert.equal(capsule.ci.stale_rows_ignored, 1);
  assert.equal(capsule.focus.kind, 'BLOCKER');
});

test('focus is deterministic: exact CI failure before blocker before next action', () => {
  const blocker = buildChatDevelopmentCapsule({ source, evidence });
  assert.equal(blocker.focus.kind, 'BLOCKER');
  const nextOnly = buildChatDevelopmentCapsule({ source, evidence: evidence.filter((row) => row.kind !== 'BLOCKER') });
  assert.equal(nextOnly.focus.kind, 'NEXT_ACTION');
  const none = buildChatDevelopmentCapsule({ source, evidence: [] });
  assert.equal(none.focus.kind, 'NONE');
});

test('capsule revision ignores generation time but changes with development evidence', () => {
  const first = buildChatDevelopmentCapsule({ source, evidence, generated_at: '2026-09-10T10:00:00.000Z' });
  const second = buildChatDevelopmentCapsule({ source, evidence, generated_at: '2026-09-10T10:01:00.000Z' });
  assert.equal(first.revision, second.revision);
  const changed = buildChatDevelopmentCapsule({ source, evidence: evidence.map((row, i) => i === 0 ? { ...row, title: 'Different blocker' } : row) });
  assert.notEqual(first.revision, changed.revision);
});

test('large evidence and CI sets remain bounded while preserving highest-priority rows', () => {
  const largeEvidence = Array.from({ length: 160 }, (_, i) => ({
    id: `blocker:${String(i).padStart(3, '0')}`,
    kind: i % 2 === 0 ? 'BLOCKER' : 'HOTSPOT',
    title: `Evidence ${i} ${'x'.repeat(400)}`,
    path: `apps/metaengine-browser/src/file-${i}.mjs`,
    severity: i === 0 ? 'CRITICAL' : 'LOW',
    authority_effect: false,
  }));
  const ciRuns = Array.from({ length: 80 }, (_, i) => ({
    id: 1000 + i,
    name: `Workflow ${i} ${'x'.repeat(200)}`,
    status: i % 3 === 0 ? 'completed' : 'queued',
    conclusion: i % 3 === 0 ? 'failure' : null,
    head_sha: head,
    authority_effect: false,
  }));
  const capsule = buildChatDevelopmentCapsule({ source, ci_runs: ciRuns, evidence: largeEvidence });
  assert.ok(Buffer.byteLength(JSON.stringify(capsule), 'utf8') <= CHAT_DEVELOPMENT_CAPSULE_MAX_BYTES);
  assert.equal(capsule.blockers[0].id, 'blocker:000');
  assert.equal(capsule.focus.kind, 'CI_FAILURE');
});

test('authority-bearing input fails closed before entering chat context', () => {
  assert.throws(() => buildChatDevelopmentCapsule({ source, evidence: [{ ...evidence[0], authority_effect: true }] }), /evidence_invalid/);
  assert.throws(() => buildChatDevelopmentCapsule({ source, ci_runs: [{ id: 1, name: 'x', status: 'completed', conclusion: 'success', head_sha: head, authority_effect: true }] }), /ci_invalid/);
});
