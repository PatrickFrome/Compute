import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  installSelfUpdateHealthQualificationFetchHook,
} from '../src/self-update-health-qualification.mjs';
import {
  beginSelfUpdateTransaction,
  readSelfUpdateTransaction,
  transitionSelfUpdateTransaction,
} from '../src/self-update-transaction-journal.mjs';

const version = String(process.env.METAENGINE_PACKAGED_HEALTH_VERSION || '');
if (!version) throw new Error('packaged_health_version_required');

const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-packaged-health-'));
const app = {
  getPath(name) { if (name !== 'userData') throw new Error('unexpected_path'); return userData; },
  getVersion() { return version; },
};

await beginSelfUpdateTransaction(app, {
  version,
  available_version: version,
  metadata_verified: true,
  restart_gate_safe: true,
  resolved_git_sha: 'c'.repeat(40),
  authority_effect: false,
});
await transitionSelfUpdateTransaction(app, 'SUCCESSOR_BOOTED', { requireTargetVersion: version });

const heartbeat = {
  state: {
    shell_version: version,
    self_update_session_continuity: { state: 'RESTORED', authority_effect: false },
    self_update: {
      state: 'CURRENT',
      current_version: version,
      last_error: null,
      host_resilience: { state: 'ACTIVE', sentinel: { lifecycle: 'ARMED' } },
    },
  },
};
const body = JSON.stringify(heartbeat);
const bodyHash = createHash('sha256').update(body).digest('hex');
const init = {
  method: 'POST',
  body,
  headers: {
    'content-type': 'application/json',
    'x-a2-chat-bridge-client': '11111111-1111-4111-8111-111111111111',
    'x-a2-device-profile': 'A2_DEVICE_HTTP_SIGNATURE_V1',
    'x-a2-device-id': '22222222-2222-4222-8222-222222222222',
    'x-a2-device-timestamp': new Date().toISOString(),
    'x-a2-device-nonce': 'packaged-health-probe-nonce-123456789',
    'x-a2-device-body-sha256': bodyHash,
    'x-a2-device-signature': 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-',
  },
};
const wrapped = installSelfUpdateHealthQualificationFetchHook({
  app,
  fetchImpl: async () => new Response('', { status: 202 }),
});
await wrapped('https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-browser-native-supervisor-v1/v1/state', init);
const transaction = await readSelfUpdateTransaction(app);
assert.equal(transaction.state, 'QUALIFIED');
assert.equal(transaction.qualified, true);
assert.equal(transaction.evidence.session_continuity_restored, true);
assert.equal(transaction.evidence.sentinel_armed, true);

console.log(JSON.stringify({
  schema: 'metaengine.self-update.packaged-health-probe.v1',
  version,
  qualified: true,
  exact_host_bound: true,
  signed_envelope_shape_bound: true,
  authority_effect: false,
}));
