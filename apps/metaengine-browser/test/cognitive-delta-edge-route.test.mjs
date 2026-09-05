import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COGNITIVE_DELTA_ACK_SCHEMA,
  COGNITIVE_DELTA_BATCH_SCHEMA,
  COGNITIVE_DELTA_EVENT_SCHEMA,
  COGNITIVE_DELTA_MAX_BODY_BYTES,
  COGNITIVE_DELTA_MAX_EVENTS,
  COGNITIVE_DELTA_ROUTE_PATH,
  createCognitiveDeltaRoutes,
} from '../supabase/a2-browser-native-supervisor-v1/cognitive-delta-routes.mjs';

const STREAM_ID = '123e4567-e89b-42d3-a456-426614174000';
const json = (status, body) => ({ status, body });
const identity = Object.freeze({
  id: 'native-browser-test',
  device_id: '123e4567-e89b-42d3-a456-426614174111',
});

function event(sequence, overrides = {}) {
  return {
    schema: COGNITIVE_DELTA_EVENT_SCHEMA,
    stream_id: STREAM_ID,
    sequence,
    priority: 'P1',
    recorded_at: '2026-09-06T00:00:00.000Z',
    source_sequence: sequence,
    source: 'SEMANTIC',
    type: 'SEMANTIC_EVENT',
    semantic_method: 'DOM.childNodeInserted',
    observed_at: '2026-09-06T00:00:00.000Z',
    tab_id: 'tab_123e4567-e89b-42d3-a456-426614174222',
    target_id: 'target-safe',
    web_contents_id: 9,
    os_pid: 4242,
    process_type: 'renderer',
    reason: null,
    service_name: null,
    name: null,
    raw_payload_exposed: false,
    page_text_exposed: false,
    input_values_exposed: false,
    control_authority: false,
    command_leasing: false,
    authority_effect: false,
    ...overrides,
  };
}

function batch(events = [event(1), event(2)], overrides = {}) {
  return {
    schema: COGNITIVE_DELTA_BATCH_SCHEMA,
    stream_id: STREAM_ID,
    after_sequence: 0,
    through_sequence: events.length,
    event_count: events.length,
    events,
    raw_payload_exposed: false,
    page_text_exposed: false,
    input_values_exposed: false,
    delivery_is_authority: false,
    control_authority: false,
    command_leasing: false,
    authority_effect: false,
    ...overrides,
  };
}

function routeFor(rpc) {
  return createCognitiveDeltaRoutes({
    rpc,
    workspaceId: '2de9f84b-7c0a-4091-911c-894ff1d6eaf4',
    json,
  });
}

async function invoke(route, body, { bodyText = JSON.stringify(body), method = 'POST', path = COGNITIVE_DELTA_ROUTE_PATH } = {}) {
  return route({ req: { method }, path, body, bodyText, identity });
}

test('non-cognitive paths are ignored and method is fenced', async () => {
  const route = routeFor(async () => { throw new Error('must_not_call'); });
  assert.equal(await invoke(route, batch(), { path: '/v1/state' }), null);
  const wrongMethod = await invoke(route, batch(), { method: 'GET', bodyText: '' });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.body.authority_effect, false);
});

test('valid batch produces exact 202 ACK and strips unknown fields before RPC', async () => {
  let captured = null;
  const route = routeFor(async (name, args) => {
    captured = { name, args };
    return {
      accepted: true,
      stream_id: STREAM_ID,
      accepted_through_sequence: 2,
      ignored_server_field: 'not-forwarded-to-client',
    };
  });
  const input = batch([
    event(1, { secret_page_text: 'do not forward', headers: { authorization: 'secret' } }),
    event(2, { post_data: 'do not forward', arbitrary_eval: true }),
  ]);
  const response = await invoke(route, input);
  assert.equal(response.status, 202);
  assert.equal(response.body.schema, COGNITIVE_DELTA_ACK_SCHEMA);
  assert.equal(response.body.accepted, true);
  assert.equal(response.body.stream_id, STREAM_ID);
  assert.equal(response.body.accepted_through_sequence, 2);
  assert.equal(response.body.delivery_is_authority, false);
  assert.equal(response.body.control_authority, false);
  assert.equal(response.body.command_leasing, false);
  assert.equal(response.body.authority_effect, false);

  assert.equal(captured.name, 'h205f22_a2_browser_cognitive_accept_v1');
  assert.equal(captured.args.p_authority_effect, false);
  assert.equal(captured.args.p_events.length, 2);
  assert.equal('secret_page_text' in captured.args.p_events[0], false);
  assert.equal('headers' in captured.args.p_events[0], false);
  assert.equal('post_data' in captured.args.p_events[1], false);
  assert.equal('arbitrary_eval' in captured.args.p_events[1], false);
  assert.deepEqual(
    Object.keys(captured.args.p_events[0]).sort(),
    [
      'authority_effect','command_leasing','control_authority','input_values_exposed','name','observed_at','os_pid',
      'page_text_exposed','priority','process_type','raw_payload_exposed','reason','recorded_at','schema','semantic_method',
      'sequence','service_name','source','source_sequence','stream_id','tab_id','target_id','type','web_contents_id',
    ].sort(),
  );
});

test('request body and event count are bounded before RPC', async () => {
  let calls = 0;
  const route = routeFor(async () => { calls += 1; return {}; });
  const oversized = await invoke(route, batch(), { bodyText: 'x'.repeat(COGNITIVE_DELTA_MAX_BODY_BYTES + 1) });
  assert.equal(oversized.status, 413);

  const many = Array.from({ length: COGNITIVE_DELTA_MAX_EVENTS + 1 }, (_, index) => event(index + 1));
  const tooMany = await invoke(route, batch(many));
  assert.equal(tooMany.status, 400);
  assert.equal(calls, 0);
});

test('authority fences are required at batch and event boundaries', async () => {
  const route = routeFor(async () => { throw new Error('must_not_call'); });
  const batchAuthority = await invoke(route, batch([event(1)], { delivery_is_authority: true, through_sequence: 1 }));
  assert.equal(batchAuthority.status, 400);
  const eventAuthority = await invoke(route, batch([event(1, { page_text_exposed: true })], { through_sequence: 1 }));
  assert.equal(eventAuthority.status, 400);
});

test('stream identity and sequence continuity are strict', async () => {
  const route = routeFor(async () => { throw new Error('must_not_call'); });
  const gap = await invoke(route, batch([event(1), event(3)], { through_sequence: 2 }));
  assert.equal(gap.status, 400);
  assert.equal(gap.body.full_state_resync_required, true);
  const otherStream = await invoke(route, batch([event(1, { stream_id: '123e4567-e89b-42d3-a456-426614174999' })], { through_sequence: 1 }));
  assert.equal(otherStream.status, 400);
});

test('PID and WebContents identities must be positive safe integers when present', async () => {
  const route = routeFor(async () => { throw new Error('must_not_call'); });
  assert.equal((await invoke(route, batch([event(1, { os_pid: 0 })], { through_sequence: 1 }))).status, 400);
  assert.equal((await invoke(route, batch([event(1, { web_contents_id: -4 })], { through_sequence: 1 }))).status, 400);
  assert.equal((await invoke(route, batch([event(1, { os_pid: null, web_contents_id: null })], { through_sequence: 1 }))).status, 202);
});

test('missing DB acceptor is an explicit 501 capability miss', async () => {
  const route = routeFor(async () => {
    throw new Error('rest_404:{"code":"PGRST202","message":"Could not find the function public.h205f22_a2_browser_cognitive_accept_v1"}');
  });
  const response = await invoke(route, batch());
  assert.equal(response.status, 501);
  assert.equal(response.body.reason, 'DB_ACCEPTOR_NOT_INSTALLED');
  assert.equal(response.body.full_state_resync_required, true);
});

test('acceptor rejection or imprecise ACK returns 503 and never fabricates cursor progress', async () => {
  const rejected = routeFor(async () => ({ accepted: false, reason: 'STREAM_GAP' }));
  const rejection = await invoke(rejected, batch());
  assert.equal(rejection.status, 503);
  assert.equal(rejection.body.full_state_resync_required, true);

  const wrongAck = routeFor(async () => ({
    accepted: true,
    stream_id: STREAM_ID,
    accepted_through_sequence: 1,
  }));
  const imprecise = await invoke(wrongAck, batch());
  assert.equal(imprecise.status, 503);
  assert.equal(imprecise.body.full_state_resync_required, true);
});
