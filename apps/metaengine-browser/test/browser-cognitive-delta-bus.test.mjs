import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BrowserCognitiveDeltaBus,
  classifyCognitiveDeltaPriority,
} from '../src/browser-cognitive-delta-bus.mjs';

test('cognitive priority preserves crashes/navigation above telemetry', () => {
  assert.equal(classifyCognitiveDeltaPriority({ type: 'RENDER_PROCESS_GONE' }), 'P0');
  assert.equal(classifyCognitiveDeltaPriority({ type: 'SEMANTIC_EVENT', semantic_method: 'Page.frameNavigated' }), 'P0');
  assert.equal(classifyCognitiveDeltaPriority({ type: 'SEMANTIC_EVENT', semantic_method: 'DOM.documentUpdated' }), 'P1');
  assert.equal(classifyCognitiveDeltaPriority({ type: 'SEMANTIC_EVENT', semantic_method: 'Network.requestWillBeSent' }), 'P2');
  assert.equal(classifyCognitiveDeltaPriority({ type: 'METRICS_SAMPLE' }), 'P3');
});

test('ordered delta reads are bounded and carry no execution authority', () => {
  let now = 1_000;
  const bus = new BrowserCognitiveDeltaBus({ clock: () => now++, maxEvents: 16 });
  bus.publish({ seq: 9, type: 'WEB_CONTENTS_CREATED', web_contents_id: 7, tab_id: 'tab_demo' });
  bus.publish({ seq: 10, type: 'SEMANTIC_EVENT', semantic_method: 'DOM.documentUpdated', tab_id: 'tab_demo' });
  bus.publish({ seq: 11, type: 'METRICS_SAMPLE' });

  const read = bus.readSince(0, 2);
  assert.deepEqual(read.events.map((row) => row.sequence), [1, 2]);
  assert.equal(read.has_more, true);
  assert.equal(read.gap, false);
  assert.equal(read.control_authority, false);
  assert.equal(read.command_leasing, false);
  assert.equal(read.authority_effect, false);
  assert.equal(read.events[0].source_sequence, 9);
});

test('raw page material is stripped at the cognitive boundary', () => {
  const bus = new BrowserCognitiveDeltaBus({ maxEvents: 16 });
  const result = bus.publish({
    seq: 1,
    type: 'SEMANTIC_EVENT',
    semantic_method: 'Network.requestWillBeSent',
    tab_id: 'tab_demo',
    headers: { authorization: 'secret' },
    postData: 'secret-body',
    text_excerpt: 'page secret',
    input_value: 'typed secret',
  });
  assert.equal(result.accepted, true);
  const event = result.event;
  assert.equal('headers' in event, false);
  assert.equal('postData' in event, false);
  assert.equal('text_excerpt' in event, false);
  assert.equal('input_value' in event, false);
  assert.equal(event.raw_payload_exposed, false);
  assert.equal(event.page_text_exposed, false);
  assert.equal(event.input_values_exposed, false);
});

test('critical causal edges evict lower-priority telemetry under pressure', () => {
  const bus = new BrowserCognitiveDeltaBus({ maxEvents: 8 });
  for (let i = 0; i < 8; i += 1) bus.publish({ seq: i + 1, type: 'METRICS_SAMPLE' });
  const critical = bus.publish({ seq: 99, type: 'RENDER_PROCESS_GONE', web_contents_id: 5, reason: 'crashed' });
  assert.equal(critical.accepted, true);

  const snap = bus.snapshot();
  assert.equal(snap.retained_events, 8);
  assert.equal(snap.priority_counts.P0, 1);
  assert.equal(snap.priority_counts.P3, 7);
  assert.equal(snap.dropped_retained, 1);
  assert.equal(snap.second_scheduler, false);
  assert.equal(snap.automatic_retry_allowed, false);
});

test('low-priority telemetry can never evict an all-critical ring', () => {
  const bus = new BrowserCognitiveDeltaBus({ maxEvents: 8 });
  for (let i = 0; i < 8; i += 1) bus.publish({ seq: i + 1, type: 'WEB_CONTENTS_DESTROYED', web_contents_id: i + 1 });
  const telemetry = bus.publish({ seq: 9, type: 'METRICS_SAMPLE' });
  assert.equal(telemetry.accepted, false);
  assert.equal(telemetry.reason, 'LOWER_PRIORITY_DROPPED_UNDER_PRESSURE');
  const snap = bus.snapshot();
  assert.equal(snap.priority_counts.P0, 8);
  assert.equal(snap.priority_counts.P3, 0);
  assert.equal(snap.dropped_incoming, 1);
});

test('any lost delta is explicit gap and requires full snapshot resync', () => {
  const bus = new BrowserCognitiveDeltaBus({ maxEvents: 8 });
  for (let i = 0; i < 8; i += 1) bus.publish({ seq: i + 1, type: 'WEB_CONTENTS_DESTROYED' });
  bus.publish({ seq: 9, type: 'METRICS_SAMPLE' }); // dropped sequence 9
  bus.publish({ seq: 10, type: 'WEB_CONTENTS_CREATED' }); // evicts one retained P0 only as last resort

  const stale = bus.readSince(0, 32);
  assert.equal(stale.gap, true);
  assert.equal(stale.resync_required, true);
  assert.equal(stale.snapshot_is_recovery_authority, true);
  assert.equal(stale.delta_is_execution_authority, false);

  const caughtUp = bus.readSince(stale.latest_sequence, 32);
  assert.equal(caughtUp.gap, false);
  assert.deepEqual(caughtUp.events, []);
});

test('onDelta fires only for retained deltas and cannot gain authority', () => {
  const observed = [];
  const bus = new BrowserCognitiveDeltaBus({ maxEvents: 8, onDelta: (event) => observed.push(event) });
  for (let i = 0; i < 8; i += 1) bus.publish({ type: 'WEB_CONTENTS_DESTROYED' });
  bus.publish({ type: 'METRICS_SAMPLE' });
  assert.equal(observed.length, 8);
  assert.ok(observed.every((row) => row.authority_effect === false && row.control_authority === false));
});
