import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createHostAgentSessionKey } from '../src/host-agent-protocol.mjs';
import { SupervisorIdentityDelegationSigner } from '../src/supervisor-identity-delegation.mjs';
import {
  SupervisorIdentitySignerClient,
  createSupervisorIdentitySignerServer,
  supervisorIdentitySignerEndpoint,
  supervisorIdentitySignerIpcManifest,
} from '../src/supervisor-identity-delegation-ipc.mjs';

const CLIENT_ID = '11111111-1111-4111-8111-111111111111';
const DEVICE_ID = '22222222-2222-4222-8222-222222222222';
const PREFIX = '/a2-browser-native-supervisor-v1/v1';

function identity() {
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
      return {
        'content-type': 'application/json',
        'x-a2-chat-bridge-client': CLIENT_ID,
        'x-a2-device-profile': 'A2_DEVICE_HTTP_SIGNATURE_V1',
        'x-a2-device-id': DEVICE_ID,
        'x-a2-device-timestamp': '2026-09-10T19:35:00.000Z',
        'x-a2-device-nonce': crypto.randomBytes(18).toString('base64url'),
        'x-a2-device-body-sha256': crypto.createHash('sha256').update(bodyText, 'utf8').digest('hex'),
        'x-a2-device-signature': crypto.randomBytes(64).toString('base64url'),
      };
    },
  };
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'metaengine-identity-signer-'));
  const endpoint = supervisorIdentitySignerEndpoint({ userDataPath: root });
  const sessionKey = createHostAgentSessionKey();
  const signer = new SupervisorIdentityDelegationSigner({ identity: identity() });
  const server = createSupervisorIdentitySignerServer({ endpoint, sessionKey, signer });
  await server.start();
  t.after(async () => {
    await server.close().catch(() => {});
    await rm(root, { recursive: true, force: true });
  });
  return { root, endpoint, sessionKey, signer, server };
}

test('host agent receives device headers over persistent signer connection without private key transfer', async (t) => {
  const h = await fixture(t);
  const client = new SupervisorIdentitySignerClient({ endpoint: h.endpoint, sessionKey: h.sessionKey });
  t.after(() => client.close());
  const delegated = client.delegatedIdentity();
  const snapshot = await delegated.ensure();
  assert.equal(snapshot.device_id, DEVICE_ID);
  assert.equal(snapshot.private_key_exported, false);
  const body = JSON.stringify({ supervisor_mode: 'CONTROL', max_batch: 64 });
  const headers = await delegated.deviceHeaders('POST', `${PREFIX}/commands/wait-batch`, body);
  assert.equal(headers['x-a2-device-id'], DEVICE_ID);
  assert.equal(headers['x-a2-device-body-sha256'], crypto.createHash('sha256').update(body).digest('hex'));
  assert.equal(client.snapshot().connected, true);
  assert.equal(client.snapshot().private_key_material, false);
  assert.equal(h.server.snapshot().connections, 1);
  assert.equal(h.server.snapshot().browser_control_authority, false);
});

test('signer IPC cannot be used to sign enrollment or arbitrary supervisor routes', async (t) => {
  const h = await fixture(t);
  const client = new SupervisorIdentitySignerClient({ endpoint: h.endpoint, sessionKey: h.sessionKey });
  t.after(() => client.close());
  await assert.rejects(
    client.signDeviceRequest({ method: 'POST', request_path: `${PREFIX}/device/enrollment/request`, body_text: '{}' }),
    /route_denied/,
  );
  await assert.rejects(
    client.signDeviceRequest({ method: 'POST', request_path: `${PREFIX}/admin`, body_text: '{}' }),
    /route_denied/,
  );
  assert.equal(h.server.snapshot().private_key_exported, false);
  assert.equal(h.server.snapshot().enrollment_authority, false);
});

test('wrong ephemeral signer session key cannot obtain a signature', async (t) => {
  const h = await fixture(t);
  const attacker = new SupervisorIdentitySignerClient({ endpoint: h.endpoint, sessionKey: createHostAgentSessionKey() });
  t.after(() => attacker.close());
  await assert.rejects(
    attacker.signDeviceRequest({ method: 'POST', request_path: `${PREFIX}/state`, body_text: '{}' }, 500),
    /closed|timeout|auth/i,
  );
});

test('identity signer endpoint is separate from Host Agent control endpoint and deterministic per user-data root', () => {
  const first = supervisorIdentitySignerEndpoint({ userDataPath: 'C:\\Users\\Owner\\AppData\\Roaming\\METAENGINE', platform: 'win32' });
  const second = supervisorIdentitySignerEndpoint({ userDataPath: 'C:\\Users\\Owner\\AppData\\Roaming\\METAENGINE', platform: 'win32' });
  assert.equal(first, second);
  assert.match(first, /^\\\\\.\\pipe\\metaengine-identity-signer-[0-9a-f]{24}$/);
  assert.equal(first.includes('host-agent-'), false);
});

test('signer IPC manifest is effect-poor and has only snapshot and sign-device operations', () => {
  const manifest = supervisorIdentitySignerIpcManifest();
  assert.deepEqual(manifest.operations, ['SNAPSHOT', 'SIGN_DEVICE']);
  assert.equal(manifest.private_key_exported, false);
  assert.equal(manifest.enrollment_authority, false);
  assert.equal(manifest.browser_control_authority, false);
  assert.equal(manifest.arbitrary_eval, false);
  assert.equal(manifest.raw_shell, false);
  assert.equal(manifest.raw_cdp, false);
  assert.equal(manifest.authority_effect, false);
});
