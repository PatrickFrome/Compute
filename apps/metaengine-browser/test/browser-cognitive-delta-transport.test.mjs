import assert from 'node:assert/strict';
import test from 'node:test';

import { BrowserCognitiveDeltaBus } from '../src/browser-cognitive-delta-bus.mjs';
import {
  BROWSER_COGNITIVE_ACK_SCHEMA,
  BrowserCognitiveDeltaTransport,
} from '../src/browser-cognitive-delta-transport.mjs';

const STREAM_A = '11111111-1111-4111-8111-111111111111';
const STREAM_B = '22222222-2222-4222-8222-222222222222';

function senderFrom(received) {
  return async (batch) => {
    received.push(batch);
    return {
      status: 202,
      body: {
        schema: BROWSER_COGNITIVE_ACK_SCHEMA,
        accepted: true,
        stream_id: batch.stream_id,
        accepted_through_sequence: batch.through_sequence,
      },
    };
  };
}

test('stream identity survives every delta in one Browser process incarnation', () => {
  const bus = new BrowserCognitiveDeltaBus({ streamId: STREAM_A, maxEvents: 16 });
  const a = bus.publish({ type: 'WEB_CONTENTS_CREATED' }).event;
  const b = bus.publish({ type: 'SEMANTIC_EVENT', semantic_method: 'DOM.documentUpdated' }).event;
  assert.equal(a.stream_id, STREAM_A);
  assert.equal(b.stream_id, STREAM_A);
  assert.equal(bus.snapshot().stream_id, STREAM_A);
  assert.equal(bus.readSince(0, 8).dedupe_key, 'stream_id+sequence');
});

test('different Browser process incarnations never share a dedupe namespace', () => {
  const a = new BrowserCognitiveDeltaBus({ streamId: STREAM_A, maxEvents: 8 });
  const b = new BrowserCognitiveDeltaBus({ streamId: STREAM_B, maxEvents: 8 });
  assert.notEqual(a.publish({ type: 'WEB_CONTENTS_CREATED' }).event.stream_id, b.publish({ type: 'WEB_CONTENTS_CREATED' }).event.stream_id);
  assert.equal(a.snapshot().sequence, 1);
  assert.equal(b.snapshot().sequence, 1);
});

test('transport advances cursor only after exact 202 stream+sequence acknowledgement', async () => {
  const bus = new BrowserCognitiveDeltaBus({ streamId: STREAM_A, maxEvents: 32 });
  for (let i = 0; i < 5; i += 1) bus.publish({ type: 'SEMANTIC_EVENT', semantic_method: 'DOM.documentUpdated', web_contents_id: 7 });
  const received = [];
  const transport = new BrowserCognitiveDeltaTransport({
    readDeltas: (after, limit) => bus.readSince(after, limit),
    sendBatch: senderFrom(received),
    resync: async () => true,
    batchSize: 3,
  });

  assert.equal(await transport.flush(), true);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(received.map((batch) => [batch.after_sequence, batch.through_sequence]), [[0, 3], [3, 5]]);
  assert.equal(received[0].event_count, 3);
  assert.equal(received[0].delivery_is_authority, false);
  const snapshot = transport.snapshot();
  assert.equal(snapshot.state, 'SUPPORTED');
  assert.equal(snapshot.acknowledged_through_sequence, 5);
  assert.equal(snapshot.sent_events, 5);
  assert.equal(snapshot.timer_delay_ms, 0);
  assert.equal(snapshot.second_command_scheduler, false);
  assert.equal(snapshot.full_state_fallback_required, false);
});

test('404/405/501 capability result disables hot route and requires full-state fallback', async () => {
  for (const status of [404, 405, 501]) {
    const bus = new BrowserCognitiveDeltaBus({ streamId: STREAM_A, maxEvents: 16 });
    bus.publish({ type: 'WEB_CONTENTS_CREATED' });
    let calls = 0;
    const transport = new BrowserCognitiveDeltaTransport({
      readDeltas: (after, limit) => bus.readSince(after, limit),
      sendBatch: async () => { calls += 1; return { status, body: {} }; },
      resync: async () => true,
    });
    assert.equal(await transport.flush(), false);
    assert.equal(transport.snapshot().state, 'UNAVAILABLE');
    assert.equal(transport.snapshot().acknowledged_through_sequence, 0);
    assert.equal(transport.snapshot().full_state_fallback_required, true);
    transport.notify();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 1);
  }
});

test('network ambiguity never advances cursor and duplicate resend is sequence-safe', async () => {
  const bus = new BrowserCognitiveDeltaBus({ streamId: STREAM_A, maxEvents: 16 });
  bus.publish({ type: 'WEB_CONTENTS_CREATED', web_contents_id: 9 });
  const batches = [];
  let attempt = 0;
  const transport = new BrowserCognitiveDeltaTransport({
    readDeltas: (after, limit) => bus.readSince(after, limit),
    sendBatch: async (batch) => {
      batches.push(batch);
      attempt += 1;
      if (attempt === 1) throw new Error('socket_reset_after_send');
      return {
        status: 202,
        body: {
          schema: BROWSER_COGNITIVE_ACK_SCHEMA,
          accepted: true,
          stream_id: batch.stream_id,
          accepted_through_sequence: batch.through_sequence,
        },
      };
    },
    resync: async () => true,
  });

  assert.equal(await transport.flush(), false);
  assert.equal(transport.snapshot().state, 'DEGRADED');
  assert.equal(transport.snapshot().acknowledged_through_sequence, 0);
  assert.equal(await transport.flush(), true);
  assert.equal(transport.snapshot().acknowledged_through_sequence, 1);
  assert.equal(batches.length, 2);
  assert.equal(batches[0].stream_id, batches[1].stream_id);
  assert.equal(batches[0].through_sequence, batches[1].through_sequence);
  assert.equal(transport.snapshot().duplicate_safe_retries, 1);
});

test('an invalid acknowledgement is never treated as delivery success', async () => {
  const bus = new BrowserCognitiveDeltaBus({ streamId: STREAM_A, maxEvents: 16 });
  bus.publish({ type: 'WEB_CONTENTS_CREATED' });
  const transport = new BrowserCognitiveDeltaTransport({
    readDeltas: (after, limit) => bus.readSince(after, limit),
    sendBatch: async () => ({
      status: 202,
      body: { schema: BROWSER_COGNITIVE_ACK_SCHEMA, accepted: true, stream_id: STREAM_B, accepted_through_sequence: 1 },
    }),
    resync: async () => true,
  });
  assert.equal(await transport.flush(), false);
  assert.equal(transport.snapshot().acknowledged_through_sequence, 0);
  assert.equal(transport.snapshot().state, 'DEGRADED');
  assert.match(transport.snapshot().last_error, /ack_invalid/);
});

test('gap invokes one full-snapshot recovery before cursor skips lost deltas', async () => {
  const bus = new BrowserCognitiveDeltaBus({ streamId: STREAM_A, maxEvents: 8 });
  for (let i = 0; i < 8; i += 1) bus.publish({ type: 'WEB_CONTENTS_DESTROYED', web_contents_id: i + 1 });
  bus.publish({ type: 'METRICS_SAMPLE' }); // dropped because critical ring is full
  const resyncs = [];
  const transport = new BrowserCognitiveDeltaTransport({
    readDeltas: (after, limit) => bus.readSince(after, limit),
    sendBatch: async () => { throw new Error('must_not_send_stale_delta'); },
    resync: async (request) => { resyncs.push(request); return true; },
  });
  assert.equal(await transport.flush(), true);
  assert.equal(resyncs.length, 1);
  assert.equal(resyncs[0].stream_id, STREAM_A);
  assert.equal(resyncs[0].authority_effect, false);
  assert.equal(transport.snapshot().resync_count, 1);
  assert.equal(transport.snapshot().acknowledged_through_sequence, bus.snapshot().sequence);
});

test('one in-flight send coalesces concurrent notify edges without a timer loop', async () => {
  const bus = new BrowserCognitiveDeltaBus({ streamId: STREAM_A, maxEvents: 32 });
  bus.publish({ type: 'WEB_CONTENTS_CREATED' });
  let release;
  const firstGate = new Promise((resolve) => { release = resolve; });
  const batches = [];
  const transport = new BrowserCognitiveDeltaTransport({
    readDeltas: (after, limit) => bus.readSince(after, limit),
    sendBatch: async (batch) => {
      batches.push(batch);
      if (batches.length === 1) await firstGate;
      return {
        status: 202,
        body: {
          schema: BROWSER_COGNITIVE_ACK_SCHEMA,
          accepted: true,
          stream_id: batch.stream_id,
          accepted_through_sequence: batch.through_sequence,
        },
      };
    },
    resync: async () => true,
  });

  const first = transport.flush();
  bus.publish({ type: 'SEMANTIC_EVENT', semantic_method: 'DOM.documentUpdated' });
  transport.notify();
  transport.notify();
  assert.equal(transport.snapshot().in_flight, true);
  assert.equal(transport.snapshot().pending, true);
  release();
  await first;
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(batches.length, 2);
  assert.equal(transport.snapshot().acknowledged_through_sequence, 2);
  assert.equal(transport.snapshot().timer_delay_ms, 0);
});
