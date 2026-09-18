import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ChatDevelopmentCursor,
  CHAT_DEVELOPMENT_CURSOR_MAX_BYTES,
  CHAT_DEVELOPMENT_CURSOR_MAX_HITS,
  isContinuationIntent,
  normalizeContinuationIntent,
} from '../src/chat-development-cursor.mjs';
import { CHAT_DEVELOPMENT_PROVIDER_SCHEMA } from '../src/chat-development-query-provider.mjs';

function result(overrides = {}) {
  return {
    schema: CHAT_DEVELOPMENT_PROVIDER_SCHEMA,
    status: 'OK',
    query_revision: `dq:${'a'.repeat(64)}`,
    orientation: {
      revision: `capsule:${'b'.repeat(64)}`,
      head_sha: 'c'.repeat(40),
      branch: 'work/browser-command-fabric-v2-p0',
      pr: null,
      ci_state: 'RED',
      ci_failed: 1,
      ci_pending: 0,
      focus_kind: 'CI_FAILURE',
      focus_id: 'ci-run:123',
      focus_title: 'Critical Audit',
      authority_effect: false,
    },
    hits: [{
      source: 'REPO',
      kind: 'SOURCE',
      id: 'repo:main:1',
      title: 'apps/metaengine-browser/src/main.mjs',
      path: 'apps/metaengine-browser/src/main.mjs',
      line: 1,
      text: 'boundedNavigation AbortSignal',
      ref: `sha256:${'d'.repeat(64)}`,
      score: 90,
      authority_effect: false,
    }],
    total_hits: 1,
    truncated: false,
    authority_effect: false,
    ...overrides,
  };
}

test('continuation intent normalizes Russian, English and punctuation without fuzzy authority', () => {
  assert.equal(normalizeContinuationIntent('  Продолжи!!! '), 'продолжи');
  assert.equal(isContinuationIntent('Продолжи!!!'), true);
  assert.equal(isContinuationIntent('continue.'), true);
  assert.equal(isContinuationIntent('what next?'), true);
  assert.equal(isContinuationIntent('continue deleting files'), false, 'cursor intent must remain an exact bounded allowlist');
});

test('captured frontier replays at exact state revision with zero Development Plane, network or filesystem reads', () => {
  const cursor = new ChatDevelopmentCursor();
  assert.equal(cursor.capture({ state_revision: 'dcs:one', query: 'critical audit abort signal', result: result() }), true);
  const replay = cursor.resolve({ state_revision: 'dcs:one', query: 'продолжи' });
  assert.equal(replay.schema, CHAT_DEVELOPMENT_PROVIDER_SCHEMA);
  assert.equal(replay.status, 'OK');
  assert.equal(replay.cursor_hit, true);
  assert.equal(replay.cursor_source_query, 'critical audit abort signal');
  assert.equal(replay.orientation.pr, null, 'missing PR must stay null rather than becoming zero');
  assert.equal(replay.development_plane_calls, 0);
  assert.equal(replay.network_reads_required, 0);
  assert.equal(replay.filesystem_reads_required, 0);
  assert.equal(replay.authority_effect, false);
  assert.ok(replay.bytes <= CHAT_DEVELOPMENT_CURSOR_MAX_BYTES);
});

test('state revision mismatch refuses stale continuation frontier', () => {
  const cursor = new ChatDevelopmentCursor();
  cursor.capture({ state_revision: 'dcs:one', query: 'shell failure', result: result() });
  assert.equal(cursor.resolve({ state_revision: 'dcs:two', query: 'продолжи' }), null);
  const snap = cursor.snapshot('dcs:two');
  assert.equal(snap.present, true);
  assert.equal(snap.current_revision_match, false);
  assert.equal(snap.hits, 0);
  assert.equal(snap.misses, 1);
});

test('authority-bearing or continuation results are never captured', () => {
  const cursor = new ChatDevelopmentCursor();
  assert.equal(cursor.capture({ state_revision: 'dcs:one', query: 'danger', result: result({ authority_effect: true }) }), false);
  assert.equal(cursor.capture({ state_revision: 'dcs:one', query: 'continue', result: result() }), false);
  assert.equal(cursor.snapshot('dcs:one').present, false);
});

test('cursor sanitizes authority-bearing hits and remains hard bounded under huge input', () => {
  const cursor = new ChatDevelopmentCursor();
  const hits = Array.from({ length: 50 }, (_, index) => ({
    source: index === 0 ? 'EVIDENCE' : 'REPO',
    kind: 'SOURCE',
    id: `row:${index}`,
    title: 'T'.repeat(2000),
    path: `apps/metaengine-browser/src/${'p'.repeat(800)}-${index}.mjs`,
    line: index + 1,
    text: 'S'.repeat(5000),
    ref: 'R'.repeat(500),
    score: 100 - index,
    authority_effect: index === 0,
  }));
  assert.equal(cursor.capture({ state_revision: 'dcs:huge', query: 'large source frontier', result: result({ hits, total_hits: hits.length }) }), true);
  const replay = cursor.resolve({ state_revision: 'dcs:huge', query: 'next' });
  assert.ok(replay.hits.length <= CHAT_DEVELOPMENT_CURSOR_MAX_HITS);
  assert.equal(replay.hits.some((row) => row.id === 'row:0'), false, 'authority-bearing hit must be dropped');
  assert.ok(replay.bytes <= CHAT_DEVELOPMENT_CURSOR_MAX_BYTES);
  assert.equal(replay.truncated, true);
});

test('snapshot proves cursor owns no timers, filesystem, network or authority', () => {
  const cursor = new ChatDevelopmentCursor();
  const snap = cursor.snapshot();
  assert.equal(snap.timers, false);
  assert.equal(snap.network_reads, 0);
  assert.equal(snap.filesystem_reads, 0);
  assert.equal(snap.authority_effect, false);
});
