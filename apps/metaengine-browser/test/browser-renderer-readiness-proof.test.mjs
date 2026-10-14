import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  classifyBrowserRendererReadiness as classify,
  browserRendererReadinessProofContract,
} from '../src/browser-renderer-readiness-proof.mjs';

const SHA = 'a'.repeat(40);
const NOW = 20_000;
const id = Object.freeze({
  web_contents_id: 17,
  owner_incarnation: 'native-owner-epoch-2',
  source_sha: SHA,
  pid: 4100,
  process_creation_time_ms: 10_000,
  navigation_generation: 3,
});
const sample = (extra = {}) => ({
  ...id, observed_at_ms: 19_500, event_seq: 0,
  visibility: 'VISIBLE', destroyed: false, crashed: false,
  ...extra,
});
const frame = (extra = {}) => ({
  ...id, kind: 'NATIVE_FRAME_PIXELS', observed_at_ms: 19_600,
  after_event_seq: 0, pixel_state: 'NON_BLANK',
  sampled_pixels: 128, distinct_colors: 4,
  ...extra,
});
const edge = (seq, type, extra = {}) => ({
  ...id, seq, type, observed_at_ms: 19_500 + seq * 10, ...extra,
});
const judge = (overrides = {}) => classify({
  expected: id, sample: sample(), surface: frame(), events: [], now_ms: NOW,
  ...overrides,
});

test('W14 native visible sampled frame is READY but explicitly not full HEALTHY', () => {
  const r = judge();
  assert.equal(r.state, 'READY');
  assert.equal(r.system_health, 'UNKNOWN');
  assert.equal(r.physical_installed_qualification, 'UNKNOWN');
  assert.equal(r.authority_effect, false);
  assert.equal(r.automatic_retry_allowed, false);
  assert.deepEqual(Object.keys(r.evidence).sort(), [
    'event_seq', 'navigation_generation', 'observed_at_ms', 'owner_incarnation',
    'pid', 'process_creation_time_ms', 'source_sha', 'web_contents_id',
  ]);
});

test('HTTP 200, OPEN, live PID and load success never make a renderer READY', () => {
  const result = judge({
    sample: sample({ http_status: 200, socket_open: true, pid_alive: true, did_finish_load: true }),
    surface: null,
  });
  assert.equal(result.state, 'UNKNOWN');
  assert.equal(result.reason, 'CURRENT_NATIVE_FRAME_PROOF_MISSING');
});

test('native blank frame is classified BLANK despite open socket and live process', () => {
  const result = judge({ sample: sample({ http_status: 200 }), surface: frame({ pixel_state: 'BLANK' }) });
  assert.equal(result.state, 'BLANK');
});

test('hidden/background WebContents cannot be promoted from valid old frame', () => {
  for (const visibility of ['HIDDEN', 'BACKGROUND']) {
    assert.equal(judge({ sample: sample({ visibility }) }).state, 'NOT_VISIBLE');
  }
  assert.equal(judge({ sample: sample({ visibility: 'UNKNOWN' }) }).state, 'UNKNOWN');
});

test('unresponsive event overrides apparent pixels; responsive alone cannot recover', () => {
  const events = [edge(1, 'WEB_CONTENTS_UNRESPONSIVE')];
  assert.equal(judge({
    sample: sample({ event_seq: 1 }),
    events, surface: frame({ after_event_seq: 1 }),
  }).state, 'FROZEN');
  const both = [...events, edge(2, 'WEB_CONTENTS_RESPONSIVE')];
  assert.equal(judge({
    sample: sample({ event_seq: 2 }), events: both, surface: frame({ after_event_seq: 1 }),
  }).state, 'RECOVERING');
  assert.equal(judge({
    sample: sample({ event_seq: 2 }), events: both,
    surface: frame({ observed_at_ms: 19_800, after_event_seq: 2 }),
  }).state, 'READY');
});

test('renderer-gone and WebContents destroyed are decisive native failure signals', () => {
  for (const type of ['RENDER_PROCESS_GONE', 'WEB_CONTENTS_DESTROYED']) {
    assert.equal(judge({
      sample: sample({ event_seq: 1 }), events: [edge(1, type)],
      surface: frame({ after_event_seq: 1 }),
    }).state, 'RENDERER_GONE');
  }
  assert.equal(judge({ sample: sample({ crashed: true }) }).state, 'RENDERER_GONE');
  assert.equal(judge({ sample: sample({ destroyed: true }) }).state, 'RENDERER_GONE');
});

test('new PID or creation time invalidates prior renderer even if PID is recycled', () => {
  for (const updated of [
    { pid: id.pid + 1 },
    { process_creation_time_ms: id.process_creation_time_ms + 5 },
    { navigation_generation: id.navigation_generation + 1 },
  ]) {
    assert.equal(judge({ sample: sample(updated) }).state, 'RECOVERING');
  }
});

test('owner epoch/source SHA/WebContents binding conflicts fail closed', () => {
  for (const conflict of [
    { owner_incarnation: 'different-epoch' },
    { source_sha: 'b'.repeat(40) },
    { web_contents_id: id.web_contents_id + 1 },
  ]) {
    const r = judge({ sample: sample(conflict) });
    assert.equal(r.state, 'UNKNOWN');
    assert.equal(r.evidence, null);
  }
});

test('fake pixel text, unbound frame and empty/default frame are not proof', () => {
  assert.equal(judge({ surface: frame({ kind: 'WEB_PAGE_CLAIM' }) }).state, 'UNKNOWN');
  assert.equal(judge({ surface: frame({ source_sha: 'b'.repeat(40) }) }).state, 'UNKNOWN');
  assert.equal(judge({ surface: frame({ distinct_colors: 1 }) }).state, 'UNKNOWN');
  assert.equal(judge({ surface: frame({ sampled_pixels: 10 }) }).state, 'UNKNOWN');
  assert.equal(judge({ surface: frame({ pixel_state: 'UNKNOWN' }) }).state, 'UNKNOWN');
});

test('stale/forward-clock native observation fails closed', () => {
  assert.equal(judge({ sample: sample({ observed_at_ms: 10_000 }) }).state, 'UNKNOWN');
  assert.equal(judge({ surface: frame({ observed_at_ms: 26_000 }) }).state, 'UNKNOWN');
  assert.equal(judge({ sample: sample({ observed_at_ms: NOW + 1 }) }).state, 'UNKNOWN');
});

test('event cursor duplicates, future edges, truncated window and excessive edges are rejected', () => {
  const e = edge(1, 'WEB_CONTENTS_UNRESPONSIVE');
  for (const events of [[e, e], [edge(2, 'WEB_CONTENTS_RESPONSIVE')]]) {
    assert.equal(judge({ sample: sample({ event_seq: 2 }), events }).state, 'UNKNOWN');
  }
  assert.equal(judge({ sample: sample({ events_truncated: true }) }).state, 'UNKNOWN');
  assert.equal(judge({ events: Array.from({ length: 65 }, (_, i) => edge(i + 1, 'NOOP')) }).state, 'UNKNOWN');
});

test('event with mismatched process identity/source is not trusted even if responsive', () => {
  const result = judge({
    sample: sample({ event_seq: 1 }),
    events: [edge(1, 'WEB_CONTENTS_RESPONSIVE', { process_creation_time_ms: 9_000 })],
    surface: frame({ after_event_seq: 1 }),
  });
  assert.equal(result.state, 'UNKNOWN');
});

test('non-lifecycle event does not create readiness or update proof', () => {
  assert.equal(judge({
    sample: sample({ event_seq: 1 }),
    events: [edge(1, 'REQUEST_FINISHED')],
    surface: frame({ after_event_seq: 0 }),
  }).state, 'UNKNOWN');
});

test('missing identity and malformed caller data never imply health or authority', () => {
  assert.equal(classify({ now_ms: NOW }).state, 'UNKNOWN');
  assert.equal(judge({ expected: { ...id, source_sha: 'not-git-sha' } }).state, 'UNKNOWN');
  assert.equal(judge({ events: 'untrusted page string' }).state, 'UNKNOWN');
  const contract = browserRendererReadinessProofContract();
  assert.equal(contract.accepts_http_or_pid_as_readiness, false);
  assert.equal(contract.authority_effect, false);
  assert.equal(contract.max_events, 64);
});

test('existing Electron source emits typed lifecycle events; no installed-package oracle is asserted', () => {
  const source = readFileSync(new URL('../src/browser-realtime-process-plane.mjs', import.meta.url), 'utf8');
  assert.match(source, /RENDER_PROCESS_GONE/);
  assert.match(source, /WEB_CONTENTS_UNRESPONSIVE/);
  assert.match(source, /WEB_CONTENTS_RESPONSIVE/);
  assert.match(source, /WEB_CONTENTS_DESTROYED/);
  // W14 is a separate read-only classifier; it is intentionally not wired to live Main.
  assert.equal(judge().physical_installed_qualification, 'UNKNOWN');
});
