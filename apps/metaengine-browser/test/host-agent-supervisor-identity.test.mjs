import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createHostAgentSessionKey } from '../src/host-agent-protocol.mjs';
import { BrowserIdentitySignerRuntime } from '../src/browser-identity-signer-runtime.mjs';
import { createHostAgentSupervisorIdentity } from '../src/host-agent-supervisor-identity.mjs';

const CLIENT_ID = '11111111-1111-4111-8111-111111111111';
const DEVICE_ID = '22222222-2222-4222-8222-222222222222';
const PREFIX = '/a2-browser-native-supervisor-v1/v1';

function browserIdentity() {
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
        'x-a2-device-timestamp': new Date().toISOString(),
        'x-a2-device-nonce': crypto.randomBytes(18).toString('base64url'),
        'x-a2-device-body-sha256': crypto.createHash('sha256').update(bodyText, 'utf8').digest('hex'),
        'x-a2-device-signature': crypto.randomBytes(64).toString('base64url'),
      };
    },
  };
}

test('Host Agent identity factory connects to Browser signer and exposes a drop-in device identity only', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'metaengine-host-agent-identity-'));
  const sessionKey = createHostAgentSessionKey();
  const browser = new BrowserIdentitySignerRuntime({ identity: browserIdentity(), userDataPath: root, sessionKey });
  await browser.start();
  const host = createHostAgentSupervisorIdentity({ userDataPath: root, sessionKey });
  t.after(async () => {
    host.close();
    await browser.stop().catch(() => {});
    await rm(root, { recursive: true, force: true });
  });

  const connected = await host.connect();
  assert.equal(connected.connected, true);
  assert.equal(connected.device_id_present, true);
  assert.equal(connected.identity_cached, true);
  assert.equal(connected.endpoint_exposed, false);
  assert.equal(connected.session_key_exposed, false);
  assert.equal(connected.private_key_material, false);
  assert.equal(connected.enrollment_authority, false);
  assert.equal(connected.browser_control_authority, false);

  const body = JSON.stringify({ supervisor_mode: 'CONTROL' });
  const headers = await host.identity.deviceHeaders('POST', `${PREFIX}/commands/next`, body);
  assert.equal(headers['x-a2-device-id'], DEVICE_ID);
  assert.equal(headers['x-a2-device-body-sha256'], crypto.createHash('sha256').update(body).digest('hex'));
  await assert.rejects(host.identity.enrollmentHeaders('{}'), /enrollment_forbidden/);
});

test('Host Agent identity snapshot never exposes endpoint or session key material', () => {
  const sessionKey = createHostAgentSessionKey();
  const host = createHostAgentSupervisorIdentity({ userDataPath: '/tmp/metaengine-test', sessionKey, endpoint: '/tmp/private-signer.sock' });
  const serialized = JSON.stringify(host.snapshot());
  assert.equal(serialized.includes(sessionKey), false);
  assert.equal(serialized.includes('/tmp/private-signer.sock'), false);
  assert.equal(host.snapshot().authority_effect, false);
  host.close();
});
