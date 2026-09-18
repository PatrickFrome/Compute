import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ChatDevelopmentIndex,
  CHAT_DEVELOPMENT_MAX_RECORDS,
  CHAT_DEVELOPMENT_MAX_RESULT_BYTES,
} from '../src/chat-development-index.mjs';

const records = [
  {
    id: 'blocker:emergency-abort',
    kind: 'BLOCKER',
    title: 'Emergency AbortSignal propagation',
    text: 'Propagate command scoped AbortSignal into boundedNavigation and preserve ambiguous effect readback.',
    path: 'apps/metaengine-browser/src/main.mjs',
    ref: 'PR#453',
    sha: 'a'.repeat(40),
    severity: 'CRITICAL',
    updated_at: '2026-09-10T09:00:00.000Z',
    authority_effect: false,
  },
  {
    id: 'ci:shell-stale-test',
    kind: 'CI',
    title: 'Shell stale fast-open contract',
    text: 'Legacy assertion looked for direct loadURL after runtime moved to boundedNavigation.',
    path: 'apps/metaengine-browser/test/browser-chatgpt-fast-open.test.mjs',
    ref: 'run:34461467252',
    severity: 'HIGH',
    updated_at: '2026-09-10T09:36:32.000Z',
    authority_effect: false,
  },
  {
    id: 'next:chat-index',
    kind: 'NEXT_ACTION',
    title: 'Chat development query hot path',
    text: 'Expose one bounded query over source CI checkpoints changes hotspots blockers and next actions.',
    path: 'apps/metaengine-browser/src/chat-development-index.mjs',
    severity: 'MEDIUM',
    updated_at: '2026-09-10T10:00:00.000Z',
    authority_effect: false,
  },
];

test('chat development search uses one bounded in-memory inverted index with zero authority', () => {
  const index = new ChatDevelopmentIndex({ records });
  const snapshot = index.snapshot();
  assert.equal(snapshot.records, 3);
  assert.ok(snapshot.indexed_tokens > 0);
  assert.equal(snapshot.network_reads, 0);
  assert.equal(snapshot.filesystem_reads, 0);
  assert.equal(snapshot.scheduler_authority, false);
  assert.equal(snapshot.command_authority, false);

  const result = index.query({ query: 'boundedNavigation emergency AbortSignal' });
  assert.equal(result.status, 'OK');
  assert.equal(result.hits[0].id, 'blocker:emergency-abort');
  assert.equal(result.search_strategy, 'IN_MEMORY_INVERTED_INDEX');
  assert.ok(result.bytes <= CHAT_DEVELOPMENT_MAX_RESULT_BYTES);
  assert.equal(result.authority_effect, false);
});

test('query can narrow source-of-truth domain without scanning unrelated records', () => {
  const index = new ChatDevelopmentIndex({ records });
  const result = index.query({ query: 'boundedNavigation', kinds: ['CI'], limit: 4 });
  assert.equal(result.total_hits, 1);
  assert.equal(result.hits[0].kind, 'CI');
  assert.equal(result.hits[0].id, 'ci:shell-stale-test');
});

test('query revision supports tiny not-modified chat turns', () => {
  const index = new ChatDevelopmentIndex({ records });
  const first = index.query({ query: 'boundedNavigation' });
  const second = index.query({ query: 'boundedNavigation', if_none_match: first.query_revision });
  assert.equal(second.status, 'NOT_MODIFIED');
  assert.equal(second.query_revision, first.query_revision);
  assert.ok(second.bytes < 512);
});

test('index revision changes only when normalized development evidence changes', () => {
  const index = new ChatDevelopmentIndex({ records });
  const before = index.snapshot().revision;
  index.replace(records.map((row) => ({ ...row })));
  assert.equal(index.snapshot().revision, before);
  index.replace(records.map((row, i) => i === 2 ? { ...row, text: `${row.text} Revision changed.` } : row));
  assert.notEqual(index.snapshot().revision, before);
});

test('chat search result stays hard bounded under large evidence text', () => {
  const huge = Array.from({ length: 80 }, (_, i) => ({
    id: `change:${i}`,
    kind: 'CHANGE',
    title: `FastLoop boundedNavigation change ${i}`,
    text: 'boundedNavigation '.repeat(300),
    path: `apps/metaengine-browser/src/change-${i}.mjs`,
    severity: 'INFO',
    authority_effect: false,
  }));
  const index = new ChatDevelopmentIndex({ records: huge });
  const result = index.query({ query: 'boundedNavigation', limit: 12, max_bytes: 2048 });
  assert.ok(result.bytes <= 2048, `bytes=${result.bytes}`);
  assert.equal(result.truncated, true);
});

test('authority-bearing, duplicate, unsupported and oversized evidence fail closed before indexing', () => {
  assert.throws(() => new ChatDevelopmentIndex({ records: [{ ...records[0], authority_effect: true }] }), /authority_forbidden/);
  assert.throws(() => new ChatDevelopmentIndex({ records: [records[0], { ...records[0] }] }), /record_duplicate/);
  assert.throws(() => new ChatDevelopmentIndex({ records: [{ ...records[0], kind: 'PAGE_TEXT' }] }), /kind_invalid/);
  assert.throws(() => new ChatDevelopmentIndex({ records: Array.from({ length: CHAT_DEVELOPMENT_MAX_RECORDS + 1 }, (_, i) => ({ ...records[0], id: `x:${i}` })) }), /records_invalid/);
});
