import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { persistPreInstallReceipt, persistUpdatedSuccessorReceipt } from '../src/self-update-handoff.mjs';
import {
  inspectSignedNativeSupervisorStateRequest,
  installSignedSupervisorHeartbeatQualificationHook,
} from '../src/self-update-signed-heartbeat.mjs';
import { acceptedSignedSupervisorHeartbeatSnapshot } from '../src/self-update-successor-qualification.mjs';

const STATE_URL = 'https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-browser-native-supervisor-v1/v1/state';

function heartbeat(version) {
  return {
    state: {
      shell_version: version,
      self_update_session_continuity: { state: 'RESTORED', authority_effect: false },
      self_update: {
        state: 'CURRENT', current_version: version, last_error: null,
        host_resilience: { state: 'ACTIVE', sentinel: { lifecycle: 'ARMED' } },
      },
    },
  };
}

function signedInit(body) {
  return {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/json',
      'x-a2-chat-bridge-client': '11111111-1111-4111-8111-111111111111',
      'x-a2-device-profile': 'A2_DEVICE_HTTP_SIGNATURE_V1',
      'x-a2-device-id': '22222222-2222-4222-8222-222222222222',
      'x-a2-device-timestamp': '2026-08-30T10:00:00.000Z',
      'x-a2-device-nonce': 'abcdefghijklmnopQRSTUVWX12345678',
      'x-a2-device-body-sha256': createHash('sha256').update(body).digest('hex'),
      'x-a2-device-signature': 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-',
    },
  };
}

async function appFixture() {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-signed-heartbeat-'));
  let version = '0.6.3-dev.152.0';
  const app = {
    isPackaged: true,
    getPath: (name) => { assert.equal(name, 'userData'); return userData; },
    getVersion: () => version,
    hasSingleInstanceLock: () => true,
    setVersion: (value) => { version = String(value); },
  };
  const target = '0.6.3-dev.152.1';
  await persistPreInstallReceipt(app, {
    schema: 'metaengine.self-update.pre-install-receipt.v1',
    version: target,
    available_version: target,
    metadata_verified: true,
    publisher_verified: true,
    restart_gate_safe: true,
    restart_gate_since: new Date().toISOString(),
    recorded_at: new Date().toISOString(),
    authority_effect: false,
  });
  app.setVersion(target);
  await persistUpdatedSuccessorReceipt(app, { argv: ['browser','--updated'], primaryInstance: true });
  return { app, target };
}

test('only exact Supabase state endpoint with body-bound device signature shape is eligible', () => {
  const body = JSON.stringify(heartbeat('0.6.3-dev.152.1'));
  const init = signedInit(body);
  assert.equal(inspectSignedNativeSupervisorStateRequest(STATE_URL, init).valid, true);
  assert.equal(inspectSignedNativeSupervisorStateRequest('https://example.com/functions/v1/a2-browser-native-supervisor-v1/v1/state', init).valid, false);
  assert.equal(inspectSignedNativeSupervisorStateRequest(`${STATE_URL}/extra`, init).valid, false);
  assert.equal(inspectSignedNativeSupervisorStateRequest(STATE_URL, { ...init, body: `${body} ` }).reason, 'body_hash_mismatch');
  assert.equal(inspectSignedNativeSupervisorStateRequest(STATE_URL, { ...init, headers: { ...init.headers, 'x-a2-device-signature': '' } }).reason, 'signature_missing');
});

test('only a 202 response to the eligible signed heartbeat records successor health', async () => {
  const { app, target } = await appFixture();
  const body = JSON.stringify(heartbeat(target));
  const wrappedRejected = installSignedSupervisorHeartbeatQualificationHook({
    app,
    fetchImpl: async () => new Response('', { status: 503 }),
  });
  await wrappedRejected(STATE_URL, signedInit(body));
  assert.equal(acceptedSignedSupervisorHeartbeatSnapshot(), null);

  const wrappedAccepted = installSignedSupervisorHeartbeatQualificationHook({
    app,
    fetchImpl: async () => new Response('', { status: 202 }),
  });
  const response = await wrappedAccepted(STATE_URL, signedInit(body));
  assert.equal(response.status, 202);
  const health = acceptedSignedSupervisorHeartbeatSnapshot();
  assert.equal(health.version, target);
  assert.equal(health.signed_heartbeat_accepted, true);
  assert.equal(health.self_update_runtime_healthy, true);
  assert.equal(health.sentinel_armed, true);
});
