import assert from 'node:assert/strict';
import test from 'node:test';

import { BrowserCognitiveDeltaBus } from '../src/browser-cognitive-delta-bus.mjs';
import {
  BROWSER_COGNITIVE_ACK_SCHEMA,
  BrowserCognitiveDeltaTransport,
} from '../src/browser-cognitive-delta-transport.mjs';

function event(type, seq = 1) {
  return { seq, type, observed_at: new Date(1_700_000_000_000 + seq).toISOString() };
}

function validAck(envelope) {
  return {
    status: 202,
    body: {
      schema: BROWSER_COGNITIVE_ACK_SCHEMA,
      accepted: true,
      stream_id: envelope.stream_id,
      accepted_through_sequence: envelope.through_sequence,
    },
  };
}

test('invalid ACK after SUPPORTED immediately degrades and asks for durable full-state fallback', async () => {
  const bus = new BrowserCognitiveDeltaBus();
  const fallback = [];
  let sends = 0;
  bus.publish(event('WEB_CONTENTS_CREATED', 1));
  const transport = new BrowserCognitiveDeltaTransport({
    readDeltas: (after, limit) => bus.readSince(after, limit),
    resync: async () => true,
    onFallbackRequired: (edge) => fallback.push(edge),
    sendBatch: async (envelope) => {
      sends += 1;
      if (sends === 1) return validAck(envelope);
      return {
        status: 202,
        body: {
          schema: BROWSER_COGNITIVE_ACK_SCHEMA,
          accepted: true,
          stream_id: envelope.stream_id,
          accepted_through_sequence: envelope.through_sequence + 1,
        },
      };
    },
  });

  assert.equal(await transport.flush(), true);
  assert.equal(transport.snapshot().state, 'SUPPORTED');
  assert.equal(transport.snapshot().acknowledged_through_sequence, 1);

  bus.publish(event('SEMANTIC_EVENT', 2));
  assert.equal(await transport.flush(), false);
  const snapshot = transport.snapshot();
  assert.equal(snapshot.state, 'DEGRADED');
  assert.equal(snapshot.acknowledged_through_sequence, 1);
  assert.equal(snapshot.full_state_fallback_required, true);
  assert.equal(snapshot.fallback_edges, 1);
  assert.equal(fallback.length, 1);
  assert.equal(fallback[0].full_state_required, true);
  assert.equal(fallback[0].authority_effect, false);
});

test('unsupported cognitive route immediately falls back without retry timer', async () => {
  const bus = new BrowserCognitiveDeltaBus();
  const fallback = [];
  bus.publish(event('RENDER_PROCESS_GONE', 1));
  const transport = new BrowserCognitiveDeltaTransport({
    readDeltas: (after, limit) => bus.readSince(after, limit),
    resync: async () => true,
    onFallbackRequired: (edge) => fallback.push(edge),
    sendBatch: async () => ({ status: 404, body: {} }),
  });

  assert.equal(await transport.flush(), false);
  const snapshot = transport.snapshot();
  assert.equal(snapshot.state, 'UNAVAILABLE');
  assert.equal(snapshot.full_state_fallback_required, true);
  assert.equal(snapshot.timer_delay_ms, 0);
  assert.equal(snapshot.scheduled, false);
  assert.equal(fallback.length, 1);
  assert.match(fallback[0].reason, /COGNITIVE_ROUTE_HTTP_404/);
});

test('unknown network outcome preserves cursor and emits one fallback edge', async () => {
  const bus = new BrowserCognitiveDeltaBus();
  const fallback = [];
  bus.publish(event('DOM_UPDATED', 1));
  const transport = new BrowserCognitiveDeltaTransport({
    readDeltas: (after, limit) => bus.readSince(after, limit),
    resync: async () => true,
    onFallbackRequired: (edge) => fallback.push(edge),
    sendBatch: async () => { throw new Error('network_unknown'); },
  });

  assert.equal(await transport.flush(), false);
  const snapshot = transport.snapshot();
  assert.equal(snapshot.acknowledged_through_sequence, 0);
  assert.equal(snapshot.state, 'DEGRADED');
  assert.equal(snapshot.duplicate_safe_retries, 1);
  assert.equal(fallback.length, 1);
  assert.match(fallback[0].reason, /network_unknown/);
});
