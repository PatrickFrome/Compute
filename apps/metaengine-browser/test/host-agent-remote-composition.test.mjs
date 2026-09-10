import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { HostAgentClient } from '../src/host-agent-ipc.mjs';
import { createHostAgentSessionKey } from '../src/host-agent-protocol.mjs';
import { HostAgentRemoteComposition } from '../src/host-agent-remote-composition.mjs';
import { NATIVE_SUPERVISOR_BASE } from '../src/native-supervisor-endpoints.mjs';

const CLIENT_ID = '11111111-1111-4111-8111-111111111111';
const DEVICE_ID = '22222222-2222-4222-8222-222222222222';

function browserIdentity(signCalls) {
  return {
    async ensure() {
      return {
        profile: 'A2_DEVICE_HTTP_SIGNATURE_V1',
        client_id: CLIENT_ID,
        device_id: DEVICE_ID,
        public_jwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' },
        key_fingerprint_sha256: 'f'.repeat(64),
      };
    },
    async deviceHeaders(method, requestPath, bodyText) {
      signCalls.push({ method, requestPath, bodyText });
      return {
        'content-type': 'application/json',
        'x-a2-chat-bridge-client': CLIENT_ID,
        'x-a2-device-profile': 'A2_DEVICE_HTTP_SIGNATURE_V1',
        'x-a2-device-id': DEVICE_ID,
        'x-a2-device-timestamp': new Date().toISOString(),
        'x-a2-device-nonce': crypto.randomBytes(18).toString('base64url'),
        'x-a2-device-body-sha256': crypto.createHash('sha256').update(bodyText, 'utf8').digest('hex'),
        'x-a2-device-signature': crypto.randomBytes(64).toString('base64url'),
      };
    },
  };
}

function response(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() { return structuredClone(body); },
  };
}

test('production-shape composition keeps key in Browser while Host transport waits and Browser executes through typed IPC', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'metaengine-remote-composition-'));
  const hostEndpoint = path.join(root, 'public-host.sock');
  const signerKey = createHostAgentSessionKey();
  const browserKey = createHostAgentSessionKey();
  const hostKey = createHostAgentSessionKey();
  const signCalls = [];
  const fetchCalls = [];
  const browserCalls = [];
  const fastCalls = [];

  const composition = new HostAgentRemoteComposition({
    userDataPath: root,
    identity: browserIdentity(signCalls),
    signerSessionKey: signerKey,
    browserSessionKey: browserKey,
    hostEndpoint,
    hostSessionKey: hostKey,
    developmentPlane: {
      request: async (capability) => ({ capability, repository_present: true, head: 'a'.repeat(40), authority_effect: false }),
      snapshot: () => ({ state: 'READY', authority_effect: false }),
    },
    fastControl: {
      invoke: async (tool, payload) => {
        fastCalls.push({ tool, payload });
        return { result: { tool, payload, authority_effect: false } };
      },
      snapshot: () => ({ second_scheduler: false, authority_effect: false }),
    },
    browserStatus: async () => ({ state: 'READY', target_generation: 9, authority_effect: false }),
    browserPlanExecute: async (payload) => {
      browserCalls.push(['execute', payload]);
      return { state: 'COMPLETED', plan_id: payload.plan_id, authority_effect: false };
    },
    browserPlanCancel: async (payload) => {
      browserCalls.push(['cancel', payload]);
      return { state: 'CANCEL_REQUESTED', plan_id: payload.plan_id, authority_effect: false };
    },
    fetchImpl: async (url, init) => {
      fetchCalls.push({ url, init: structuredClone(init) });
      if (url === `${NATIVE_SUPERVISOR_BASE}/v1/state`) return response(202, { accepted: true });
      if (url === `${NATIVE_SUPERVISOR_BASE}/v1/commands/wait-batch`) {
        return response(200, { commands: [{ command_id: '33333333-3333-4333-8333-333333333333', action: 'CAPTURE' }] });
      }
      return response(200, { accepted: true });
    },
  });
  await composition.start();
  const publicClient = new HostAgentClient({ endpoint: hostEndpoint, sessionKey: hostKey });
  t.after(async () => {
    publicClient.close();
    await composition.stop().catch(() => {});
    await rm(root, { recursive: true, force: true });
  });

  const transport = composition.transport();
  const batch = await transport.waitBatch({ supervisor_mode: 'CONTROL', max_batch: 64, max_tab_mutations: 16, wait_ms: 15000 });
  assert.equal(batch.commands.length, 1);
  assert.equal(fetchCalls.length, 1);
  assert.equal(signCalls.length, 1);
  assert.equal(signCalls[0].requestPath, '/a2-browser-native-supervisor-v1/v1/commands/wait-batch');

  const browserReceipt = await publicClient.request('BROWSER_PLAN_EXECUTE', { plan_id: 'plan:remote:1', steps: [] });
  assert.equal(browserReceipt.state, 'COMPLETED');
  assert.deepEqual(browserCalls.map(([kind]) => kind), ['execute']);
  assert.equal(fastCalls.length, 0);

  await transport.postState({ state: { supervisor_mode: 'CONTROL', authority_effect: false } });
  assert.equal(fetchCalls.length, 2);
  assert.equal(signCalls.length, 2);

  const snapshot = composition.snapshot();
  assert.equal(snapshot.state, 'READY');
  assert.equal(snapshot.private_key_exported, false);
  assert.equal(snapshot.enrollment_authority_moved, false);
  assert.equal(snapshot.browser_execution_via_typed_ipc, true);
  assert.equal(snapshot.transport_via_delegated_identity, true);
  assert.equal(snapshot.second_scheduler, false);
  assert.equal(snapshot.automatic_effect_retry_allowed, false);
  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes(signerKey), false);
  assert.equal(serialized.includes(browserKey), false);
  assert.equal(serialized.includes(hostKey), false);
});

test('composition startup fails closed and tears down partial boundaries when Host Agent endpoint cannot bind', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'metaengine-remote-composition-fail-'));
  const signCalls = [];
  const composition = new HostAgentRemoteComposition({
    userDataPath: root,
    identity: browserIdentity(signCalls),
    signerSessionKey: createHostAgentSessionKey(),
    browserSessionKey: createHostAgentSessionKey(),
    hostEndpoint: path.join(root, 'missing', 'cannot-bind.sock'),
    hostSessionKey: createHostAgentSessionKey(),
    developmentPlane: { request: async () => ({}), snapshot: () => ({ authority_effect: false }) },
    fastControl: { invoke: async () => ({}), snapshot: () => ({ authority_effect: false }) },
    browserStatus: async () => ({ authority_effect: false }),
    browserPlanExecute: async () => ({ authority_effect: false }),
    browserPlanCancel: async () => ({ authority_effect: false }),
    fetchImpl: async () => response(200, {}),
  });
  t.after(async () => {
    await composition.stop().catch(() => {});
    await rm(root, { recursive: true, force: true });
  });

  await assert.rejects(composition.start());
  const snapshot = composition.snapshot();
  assert.equal(snapshot.state, 'FAILED');
  assert.equal(snapshot.signer, null);
  assert.equal(snapshot.browser_executor, null);
  assert.equal(snapshot.host_identity, null);
  assert.equal(snapshot.browser_client, null);
  assert.equal(snapshot.transport, null);
  assert.equal(snapshot.host_runtime, null);
  assert.equal(snapshot.private_key_exported, false);
  assert.equal(snapshot.authority_effect, false);
});
