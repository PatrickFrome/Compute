import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatDevelopmentIndex } from '../src/chat-development-index.mjs';

function record(id, title, options = {}) {
  return {
    id,
    kind: options.kind || 'BLOCKER',
    title,
    text: options.text || `${title} evidence`,
    ref: options.ref || `ref:${id}`,
    path: options.path || `apps/metaengine-browser/src/${id}.mjs`,
    sha: options.sha || 'a'.repeat(40),
    severity: options.severity || 'INFO',
    updated_at: options.updated_at || '2026-09-10T00:00:00.000Z',
    authority_effect: false,
  };
}

test('evidence index moves record tokenization to replace-time and uses bounded top-k', () => {
  const index = new ChatDevelopmentIndex({ records: [record('a', 'alpha beta')] });
  const snapshot = index.snapshot();
  assert.equal(snapshot.warm_query_record_tokenization, 'BUILD_TIME');
  assert.equal(snapshot.warm_query_ranking, 'BOUNDED_TOP_K');
  assert.equal(snapshot.network_reads, 0);
  assert.equal(snapshot.filesystem_reads, 0);
  assert.equal(snapshot.authority_effect, false);
});

test('bounded top-k preserves deterministic score/update/id ordering and total hit count', () => {
  const index = new ChatDevelopmentIndex({
    records: [
      record('alpha', 'sharedNeedle', { updated_at: '2026-09-10T01:00:00.000Z' }),
      record('middle', 'sharedNeedle', { updated_at: '2026-09-10T02:00:00.000Z' }),
      record('zeta', 'sharedNeedle', { updated_at: '2026-09-10T03:00:00.000Z' }),
    ],
  });
  const result = index.query({ query: 'sharedNeedle', limit: 2 });
  assert.equal(result.total_hits, 3);
  assert.deepEqual(result.hits.map((hit) => hit.id), ['zeta', 'middle']);
  assert.equal(result.truncated, true);
});

test('partial matches remain eligible when an exact multi-term match exists', () => {
  const index = new ChatDevelopmentIndex({
    records: [
      record('exact', 'alpha beta'),
      record('partial', 'alpha only'),
    ],
  });
  const result = index.query({ query: 'alpha beta', limit: 8 });
  assert.equal(result.total_hits, 2);
  assert.deepEqual(result.hits.map((hit) => hit.id), ['exact', 'partial']);
});

test('result byte accounting is exact after bounded fitting', () => {
  const index = new ChatDevelopmentIndex({
    records: Array.from({ length: 6 }, (_, i) => record(
      `row${i}`,
      'commonNeedle',
      { text: `commonNeedle ${'x'.repeat(500)} ${i}` },
    )),
  });
  const result = index.query({ query: 'commonNeedle', limit: 6, max_bytes: 900 });
  assert.equal(Buffer.byteLength(JSON.stringify(result), 'utf8'), result.bytes);
  assert.equal(result.truncated, true);
  assert.ok(result.bytes <= 900);
});

test('not-modified envelope also reports exact serialized bytes', () => {
  const index = new ChatDevelopmentIndex({ records: [record('one', 'cache needle')] });
  const first = index.query({ query: 'cache needle' });
  const second = index.query({ query: 'cache needle', if_none_match: first.query_revision });
  assert.equal(second.status, 'NOT_MODIFIED');
  assert.equal(Buffer.byteLength(JSON.stringify(second), 'utf8'), second.bytes);
  assert.equal(second.authority_effect, false);
});
