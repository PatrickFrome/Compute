import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  NATIVE_SUPERVISOR_BASE,
  NATIVE_SUPERVISOR_RUNTIME_PATH,
  createHeartbeatCoherentFetch,
} from '../src/native-supervisor-client-activated.mjs';
import {
  NATIVE_SUPERVISOR_HEARTBEAT_PATH,
  NATIVE_SUPERVISOR_HEARTBEAT_RPC,
  createNativeSupervisorHeartbeatRoute,
} from '../supabase/a2-browser-native-supervisor-v1/heartbeat-route.mjs';
import { createCognitiveDeltaRoutes } from '../supabase/a2-browser-native-supervisor-v1/cognitive-delta-routes.mjs';

const WORKSPACE_ID = '2de9f84b-7c0a-4091-911c-894ff1d6eaf4';

function responseJson(status, body) {
  return { status, body };
}

test('watchdog state publication is rewritten into a minimal path-bound liveness heartbeat', async () => {
  const signatures = [];
  const requests = [];
  const identity = {
    async deviceHeaders(method, path, bodyText) {
      signatures.push({ method, path, bodyText });
      return { 'content-type': 'application/json', 'x-test-signature-path': path };
    },
  };
  const rawFetch = async (url, init) => {
    requests.push({ url: String(url), init: structuredClone(init) });
    return { status: 202 };
  };
  const fetchImpl = createHeartbeatCoherentFetch({ identity, fetchImpl: rawFetch });
  const sourceBody = JSON.stringify({
    state: {
      watchdog_heartbeat: true,
      tabs: [{ tab_id: 'tab_sensitive', url: 'https://example.invalid/private' }],
      supervisor_mesh: { should_not_cross_heartbeat_lane: true },
    },
    last_command_id: 'command_should_not_cross_heartbeat_lane',
  });

  const response = await fetchImpl(`${NATIVE_SUPERVISOR_BASE}/v1/state`, {
    method: 'POST',
    headers: { 'x-original-signature-path': '/v1/state' },
    body: sourceBody,
    cache: 'no-store',
  });

  assert.equal(response.status, 202);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, `${NATIVE_SUPERVISOR_BASE}${NATIVE_SUPERVISOR_HEARTBEAT_PATH}`);
  assert.deepEqual(JSON.parse(requests[0].init.body), { phase: 'WATCHDOG', authority_effect: false });
  assert.equal(Object.hasOwn(JSON.parse(requests[0].init.body), 'state'), false);
  assert.equal(signatures.length, 1);
  assert.equal(signatures[0].method, 'POST');
  assert.equal(signatures[0].path, `${NATIVE_SUPERVISOR_RUNTIME_PATH}${NATIVE_SUPERVISOR_HEARTBEAT_PATH}`);
  assert.equal(signatures[0].bodyText, requests[0].init.body);
});

test('bootstrap and ordinary state publication remain on the canonical state route', async () => {
  const signatures = [];
  const requests = [];
  const identity = {
    async deviceHeaders(...args) {
      signatures.push(args);
      return { 'content-type': 'application/json' };
    },
  };
  const rawFetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return { status: 202 };
  };
  const fetchImpl = createHeartbeatCoherentFetch({ identity, fetchImpl: rawFetch });
  const body = JSON.stringify({ state: { bootstrap_heartbeat: true, shell_version: 'test' } });
  const originalHeaders = { 'x-original-signature-path': '/v1/state' };

  await fetchImpl(`${NATIVE_SUPERVISOR_BASE}/v1/state`, {
    method: 'POST', headers: originalHeaders, body,
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, `${NATIVE_SUPERVISOR_BASE}/v1/state`);
  assert.equal(requests[0].init.body, body);
  assert.equal(requests[0].init.headers, originalHeaders);
  assert.equal(signatures.length, 0);
});

test('heartbeat route forbids state payloads and has zero authority', async () => {
  let rpcCalls = 0;
  const route = createNativeSupervisorHeartbeatRoute({
    workspaceId: WORKSPACE_ID,
    json: responseJson,
    rpc: async () => { rpcCalls += 1; return { accepted: true }; },
  });
  const response = await route({
    req: { method: 'POST' },
    path: NATIVE_SUPERVISOR_HEARTBEAT_PATH,
    body: { phase: 'WATCHDOG', state: { forbidden: true }, authority_effect: false },
    identity: { id: 'client_a', device_id: 'device_a' },
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.state_payload_allowed, false);
  assert.equal(response.body.authority_effect, false);
  assert.equal(rpcCalls, 0);
});

test('authenticated heartbeat delegates only to the liveness rpc and validates acceptance', async () => {
  const calls = [];
  const route = createNativeSupervisorHeartbeatRoute({
    workspaceId: WORKSPACE_ID,
    json: responseJson,
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { accepted: true, last_seen_at: '2026-09-14T10:00:00.000Z', authority_effect: false };
    },
  });
  const response = await route({
    req: { method: 'POST' },
    path: NATIVE_SUPERVISOR_HEARTBEAT_PATH,
    body: { phase: 'WATCHDOG', authority_effect: false },
    identity: { id: 'client_a', device_id: 'device_a' },
  });

  assert.equal(response.status, 202);
  assert.equal(response.body.accepted, true);
  assert.equal(response.body.state_mutated, false);
  assert.equal(response.body.command_leasing, false);
  assert.equal(response.body.control_authority, false);
  assert.equal(response.body.authority_effect, false);
  assert.deepEqual(calls, [{
    name: NATIVE_SUPERVISOR_HEARTBEAT_RPC,
    args: {
      p_workspace_id: WORKSPACE_ID,
      p_client_id: 'client_a',
      p_authority_effect: false,
    },
  }]);
});

test('existing authenticated route dispatcher exposes heartbeat without creating another control plane', async () => {
  const calls = [];
  const routes = createCognitiveDeltaRoutes({
    workspaceId: WORKSPACE_ID,
    json: responseJson,
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { accepted: true, last_seen_at: '2026-09-14T10:00:00.000Z' };
    },
  });
  const response = await routes({
    req: { method: 'POST' },
    path: NATIVE_SUPERVISOR_HEARTBEAT_PATH,
    body: { phase: 'WATCHDOG', authority_effect: false },
    bodyText: JSON.stringify({ phase: 'WATCHDOG', authority_effect: false }),
    identity: { id: 'client_a', device_id: 'device_a' },
  });

  assert.equal(response.status, 202);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, NATIVE_SUPERVISOR_HEARTBEAT_RPC);
});

test('heartbeat SQL mutates only last_seen_at and is service-role-only', async () => {
  const sql = await readFile(new URL('../supabase/native-supervisor-heartbeat-v1.sql', import.meta.url), 'utf8');
  assert.match(sql, /update public\.compute_fabric_a2_browser_supervisor_state_h205f22\s+set last_seen_at = clock_timestamp\(\)/i);
  assert.doesNotMatch(sql, /set\s+state\s*=/i);
  assert.match(sql, /where client_id = p_client_id\s+and workspace_id = p_workspace_id/i);
  assert.match(sql, /revoke all on function[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function[\s\S]*to service_role/i);
});
