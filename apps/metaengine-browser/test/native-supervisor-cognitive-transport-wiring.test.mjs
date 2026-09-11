import assert from 'node:assert/strict';
import test from 'node:test';

import { BrowserCognitiveDeltaBus } from '../src/browser-cognitive-delta-bus.mjs';
import {
  BROWSER_COGNITIVE_ACK_SCHEMA,
  BROWSER_COGNITIVE_BATCH_SCHEMA,
} from '../src/browser-cognitive-delta-transport.mjs';
import {
  NATIVE_SUPERVISOR_BASE,
  NATIVE_SUPERVISOR_COGNITIVE_DELTA_PATH,
  NATIVE_SUPERVISOR_RUNTIME_PATH,
  createNativeSupervisorCognitiveTransport,
  dispatchRealtimeObservationEdge,
  sendNativeSupervisorCognitiveBatch,
} from '../src/native-supervisor-client.mjs';

const STREAM_ID = '11111111-1111-4111-8111-111111111111';

function batch(sequence = 1) {
  return {
    schema: BROWSER_COGNITIVE_BATCH_SCHEMA,
    stream_id: STREAM_ID,
    after_sequence: sequence - 1,
    through_sequence: sequence,
    event_count: 1,
    events: [{ stream_id: STREAM_ID, sequence }],
    raw_payload_exposed: false,
    page_text_exposed: false,
    input_values_exposed: false,
    delivery_is_authority: false,
    control_authority: false,
    command_leasing: false,
    authority_effect: false,
  };
}

test('cognitive batches use the existing bounded device-authenticated supervisor route', async () => {
  const calls = [];
  const identity = {
    async ensure() { return { device_id: '22222222-2222-4222-8222-222222222222' }; },
    async deviceHeaders(method, path, bodyText) {
      calls.push({ kind: 'headers', method, path, bodyText });
      return { 'x-device-proof': 'bounded' };
    },
  };
  const fetchImpl = async (url, init) => {
    calls.push({ kind: 'fetch', url, init });
    return new Response(JSON.stringify({
      schema: BROWSER_COGNITIVE_ACK_SCHEMA,
      accepted: true,
      stream_id: STREAM_ID,
      accepted_through_sequence: 1,
    }), { status: 202, headers: { 'content-type': 'application/json' } });
  };

  const result = await sendNativeSupervisorCognitiveBatch({ identity, fetchImpl, batch: batch() });
  assert.equal(result.status, 202);
  assert.equal(result.body.accepted, true);
  assert.equal(calls[0].path, `${NATIVE_SUPERVISOR_RUNTIME_PATH}${NATIVE_SUPERVISOR_COGNITIVE_DELTA_PATH}`);
  assert.equal(calls[1].url, `${NATIVE_SUPERVISOR_BASE}${NATIVE_SUPERVISOR_COGNITIVE_DELTA_PATH}`);
  assert.equal(calls[1].init.method, 'POST');
  assert.equal(calls[1].init.cache, 'no-store');
  assert.equal(JSON.parse(calls[1].init.body).authority_effect, false);
  assert.doesNotMatch(calls[1].url, /commands/);
});

test('public cognitive transport advances only on an exact 202 ACK and immediately falls back on route loss', async () => {
  const bus = new BrowserCognitiveDeltaBus({ streamId: STREAM_ID, maxEvents: 16 });
  const fallback = [];
  let routeStatus = 202;
  bus.publish({ type: 'WEB_CONTENTS_CREATED', web_contents_id: 1 });
  const identity = {
    async ensure() { return { device_id: '22222222-2222-4222-8222-222222222222' }; },
    async deviceHeaders() { return { 'x-device-proof': 'bounded' }; },
  };
  const transport = createNativeSupervisorCognitiveTransport({
    identity,
    fetchImpl: async (_url, init) => {
      const envelope = JSON.parse(init.body);
      if (routeStatus !== 202) return new Response('{}', { status: routeStatus });
      return new Response(JSON.stringify({
        schema: BROWSER_COGNITIVE_ACK_SCHEMA,
        accepted: true,
        stream_id: envelope.stream_id,
        accepted_through_sequence: envelope.through_sequence,
      }), { status: 202, headers: { 'content-type': 'application/json' } });
    },
    readDeltas: (after, limit) => bus.readSince(after, limit),
    resync: async () => true,
    onFallbackRequired: (edge) => fallback.push(edge),
  });

  assert.equal(await transport.flush(), true);
  assert.equal(transport.snapshot().state, 'SUPPORTED');
  assert.equal(transport.snapshot().acknowledged_through_sequence, 1);

  routeStatus = 404;
  bus.publish({ type: 'SEMANTIC_EVENT', semantic_method: 'DOM.documentUpdated' });
  assert.equal(await transport.flush(), false);
  assert.equal(transport.snapshot().state, 'UNAVAILABLE');
  assert.equal(transport.snapshot().acknowledged_through_sequence, 1);
  assert.equal(fallback.length, 1);
  assert.equal(fallback[0].full_state_required, true);
});

test('observation edges prefer deltas but preserve the old full-state path when unavailable', () => {
  let cognitive = 0;
  let fullState = 0;
  const preferred = dispatchRealtimeObservationEdge({
    cognitiveTransport: {
      snapshot: () => ({ state: 'SUPPORTED' }),
      notify: () => { cognitive += 1; return true; },
    },
    scheduleFullState: () => { fullState += 1; },
  });
  assert.equal(preferred.transport, 'COGNITIVE_DELTA');
  assert.equal(cognitive, 1);
  assert.equal(fullState, 0);

  const baseline = dispatchRealtimeObservationEdge({
    cognitiveTransport: {
      snapshot: () => ({ state: 'UNKNOWN' }),
      notify: () => { throw new Error('delta_must_follow_baseline'); },
    },
    scheduleFullState: () => { fullState += 1; },
    baselineReady: false,
  });
  assert.equal(baseline.transport, 'FULL_STATE');
  assert.equal(baseline.reason, 'BASELINE_REQUIRED');
  assert.equal(fullState, 1);

  const fallback = dispatchRealtimeObservationEdge({
    cognitiveTransport: {
      snapshot: () => ({ state: 'UNAVAILABLE' }),
      notify: () => { throw new Error('must_not_notify_unavailable_route'); },
    },
    scheduleFullState: () => { fullState += 1; },
  });
  assert.equal(fallback.transport, 'FULL_STATE');
  assert.equal(fullState, 2);
  assert.equal(fallback.authority_effect, false);
});
