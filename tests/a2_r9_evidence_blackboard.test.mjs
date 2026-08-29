import test from 'node:test';
import assert from 'node:assert/strict';
import { EvidenceBlackboardV1 } from '../coordination/browser-shared/evidence-blackboard-v1.mjs';

const D1 = `sha256:${'1'.repeat(64)}`;
const D2 = `sha256:${'2'.repeat(64)}`;

function clock() {
  let n = 0;
  return () => new Date(Date.UTC(2026, 7, 29, 6, 10, n++));
}

test('blackboard is append-only metadata with digest-only evidence', () => {
  const agents = new Set(['agent.a', 'agent.b']);
  const board = new EvidenceBlackboardV1({ clock: clock(), agentExists: (id) => agents.has(id) });
  const first = board.append({
    evidence_id: 'evidence.001', point_id: 'point.001', author_agent_id: 'agent.a', kind: 'PROPOSAL',
    content_digest: D1, refs: [], tainted: true,
  });
  assert.equal(first.seq, 1);
  assert.equal(first.content_digest, D1);
  assert.equal(Object.hasOwn(first, 'content'), false);
  const second = board.append({
    evidence_id: 'evidence.002', point_id: 'point.001', author_agent_id: 'agent.b', kind: 'CRITIQUE',
    content_digest: D2, refs: ['evidence.001'], tainted: true,
  });
  assert.deepEqual(second.refs, ['evidence.001']);
  assert.equal(board.size(), 2);
  assert.deepEqual(board.query({ point_id: 'point.001' }).map((row) => row.evidence_id), ['evidence.001', 'evidence.002']);
  assert.deepEqual(board.query({ kind: 'CRITIQUE' }).map((row) => row.evidence_id), ['evidence.002']);
});

test('duplicate ids, unknown refs, unknown authors and response bodies fail closed', () => {
  const board = new EvidenceBlackboardV1({ clock: clock(), agentExists: (id) => id === 'agent.a' });
  const row = { evidence_id: 'evidence.001', point_id: 'point.001', author_agent_id: 'agent.a', kind: 'FINDING', content_digest: D1, refs: [], tainted: false };
  board.append(row);
  assert.throws(() => board.append(row), /evidence_id_exists/);
  assert.throws(() => board.append({ ...row, evidence_id: 'evidence.002', refs: ['evidence.missing'] }), /evidence_ref_unknown/);
  assert.throws(() => board.append({ ...row, evidence_id: 'evidence.003', author_agent_id: 'agent.unknown' }), /evidence_author_agent_unknown/);
  assert.throws(() => board.append({ ...row, evidence_id: 'evidence.004', content: 'raw model response' }), /evidence_fields_invalid/);
});

test('taint metadata is filterable but grants no authority', () => {
  const board = new EvidenceBlackboardV1({ clock: clock() });
  board.append({ evidence_id: 'evidence.tainted', point_id: 'point.001', author_agent_id: 'agent.a', kind: 'OBSERVATION', content_digest: D1, refs: [], tainted: true });
  board.append({ evidence_id: 'evidence.trustedmeta', point_id: 'point.001', author_agent_id: 'agent.a', kind: 'TEST', content_digest: D2, refs: [], tainted: false });
  const rows = board.query({ tainted: true });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].authority_effect, false);
  assert.equal(rows[0].actuation_eligible, false);
});
