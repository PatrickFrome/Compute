import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import { explicitLocalSupervisorBase, localSupervisorHealthAttested, localSupervisorProviderProfile } from '../src/explicit-local-supervisor-provider.mjs';
import { NATIVE_SUPERVISOR_DEFAULT_BASE, setNativeSupervisorBase } from '../src/native-supervisor-endpoints.mjs';
import { inspectSignedNativeSupervisorStateRequest, installSignedSupervisorHeartbeatQualificationHook } from '../src/self-update-signed-heartbeat.mjs';
import { persistPreInstallReceipt, persistUpdatedSuccessorReceipt } from '../src/self-update-handoff.mjs';
import { acceptedSignedSupervisorHeartbeatSnapshot } from '../src/self-update-successor-qualification.mjs';

const local = 'http://127.0.0.1:15433/a2-browser-native-supervisor-v1';
const instanceId = '28da46b7-6e1d-4c6a-b638-f4dc4bd8ee59';
const oldBase = process.env.METAENGINE_SUPERVISOR_BASE_URL;
const oldInstance = process.env.METAENGINE_LOCAL_STATE_INSTANCE_ID;
const oldProvider = process.env.METAENGINE_STATE_PROVIDER;
after(() => {
  if (oldBase === undefined) delete process.env.METAENGINE_SUPERVISOR_BASE_URL;
  else process.env.METAENGINE_SUPERVISOR_BASE_URL = oldBase;
  if (oldInstance === undefined) delete process.env.METAENGINE_LOCAL_STATE_INSTANCE_ID;
  else process.env.METAENGINE_LOCAL_STATE_INSTANCE_ID = oldInstance;
  if (oldProvider === undefined) delete process.env.METAENGINE_STATE_PROVIDER;
  else process.env.METAENGINE_STATE_PROVIDER = oldProvider;
  setNativeSupervisorBase(NATIVE_SUPERVISOR_DEFAULT_BASE);
});

function selectLocal() {
  process.env.METAENGINE_STATE_PROVIDER = 'LOCAL_POSTGRES';
  process.env.METAENGINE_SUPERVISOR_BASE_URL = local;
  process.env.METAENGINE_LOCAL_STATE_INSTANCE_ID = instanceId;
  setNativeSupervisorBase(local);
}

function signed(version) {
  const body = JSON.stringify({ state: {
    shell_version: version,
    self_update_session_continuity: { state: 'RESTORED', authority_effect: false },
    self_update: { state: 'CURRENT', current_version: version, last_error: null, host_resilience: {
      state: 'ACTIVE', sentinel_worker_healthy: true,
      sentinel: { lifecycle: 'ARMED', worker_ready: true, worker_heartbeat_age_ms: 250 },
    } },
  } });
  return { method: 'POST', body, headers: {
    'x-a2-chat-bridge-client': '11111111-1111-4111-8111-111111111111',
    'x-a2-device-id': '22222222-2222-4222-8222-222222222222',
    'x-a2-device-profile': 'A2_DEVICE_HTTP_SIGNATURE_V1',
    'x-a2-device-timestamp': '2026-10-08T00:00:00Z',
    'x-a2-device-nonce': 'abcdefghijklmnopQRSTUVWX12345678',
    'x-a2-device-body-sha256': createHash('sha256').update(body).digest('hex'),
    'x-a2-device-signature': 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-',
  } };
}

async function appFixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-local-heartbeat-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let version = '0.7.0-dev.37628000001.1';
  const app = { isPackaged: true, getPath: () => directory, getVersion: () => version, hasSingleInstanceLock: () => true };
  const target = '0.7.0-dev.37628000001.2';
  await persistPreInstallReceipt(app, {
    schema: 'metaengine.self-update.pre-install-receipt.v1', version: target, available_version: target,
    metadata_verified: true, publisher_verified: true, restart_gate_safe: true,
    restart_gate_since: new Date().toISOString(), recorded_at: new Date().toISOString(), authority_effect: false,
  });
  version = target;
  await persistUpdatedSuccessorReceipt(app, { argv: ['client', '--updated'], primaryInstance: true });
  return { app, target };
}

function health(overrides = {}) {
  return { ok: true, instance_id: instanceId, state_provider: 'LOCAL_POSTGRES', hosted_supabase_required: false,
    runtime_ready: true, capability_health: { state: 'ATTESTED', authority_effect: false }, ...overrides };
}

test('explicit local recognition requires the selected canonical endpoint; cloud default never becomes local', () => {
  const providerEnv = { METAENGINE_STATE_PROVIDER: 'LOCAL_POSTGRES', METAENGINE_LOCAL_STATE_INSTANCE_ID: instanceId };
  assert.equal(explicitLocalSupervisorBase({ env: {}, activeBase: local }), null);
  assert.equal(explicitLocalSupervisorBase({ env: { ...providerEnv, METAENGINE_SUPERVISOR_BASE_URL: local }, activeBase: local }), local);
  assert.equal(explicitLocalSupervisorBase({ env: { METAENGINE_SUPERVISOR_BASE_URL: local }, activeBase: local }), null);
  for (const base of [NATIVE_SUPERVISOR_DEFAULT_BASE, 'http://127.0.0.1:15433/wrong', 'http://user:secret@127.0.0.1:15433/a2-browser-native-supervisor-v1']) {
    assert.throws(() => explicitLocalSupervisorBase({ env: { ...providerEnv, METAENGINE_SUPERVISOR_BASE_URL: base }, activeBase: base }), /local_supervisor_base_invalid/);
  }
  assert.equal(explicitLocalSupervisorBase({ env: { ...providerEnv, METAENGINE_SUPERVISOR_BASE_URL: local }, activeBase: NATIVE_SUPERVISOR_DEFAULT_BASE }), null);
});

test('provider marker, endpoint and instance use the same whitespace normalization as startup', () => {
  const env = { METAENGINE_STATE_PROVIDER: ' LOCAL_POSTGRES ', METAENGINE_SUPERVISOR_BASE_URL: ` ${local}/ `, METAENGINE_LOCAL_STATE_INSTANCE_ID: ` ${instanceId} ` };
  assert.deepEqual(localSupervisorProviderProfile(env), { provider: 'LOCAL_POSTGRES', base_url: local, instance_id: instanceId });
  assert.equal(explicitLocalSupervisorBase({ env, activeBase: local }), local);
});

test('main gates cloud sentinel creation on explicit local selection and reports cloud unconfigured', async () => {
  const source = await fs.readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
  assert.match(source, /if \(!fallbackConsole && !explicitLocalSupervisorBase\(\)\)\s*\{/);
  assert.match(source, /cloud_health: localProvider \? 'NOT_CONFIGURED'/);
});

test('local heartbeat qualification accepts only the selected exact paths and keeps device proof checks', () => {
  selectLocal();
  const init = signed('0.7.0-dev.37628000001.2');
  assert.equal(inspectSignedNativeSupervisorStateRequest(`${local}/v1/state`, init).valid, true);
  assert.equal(inspectSignedNativeSupervisorStateRequest(`${local}/v1/heartbeat`, init).valid, true);
  for (const url of [
    `${NATIVE_SUPERVISOR_DEFAULT_BASE}/v1/state`, `${local}/v1/state?token=1`,
    `${local}/v1/state/extra`, `${local}/v1/state#fragment`, local.replace('15433', '15434') + '/v1/state',
    local.replace('127.0.0.1', 'other.example') + '/v1/state',
  ]) assert.equal(inspectSignedNativeSupervisorStateRequest(url, init).valid, false);
  assert.equal(inspectSignedNativeSupervisorStateRequest(`${local}/v1/state`, { ...init, body: `${init.body} ` }).reason, 'body_hash_mismatch');
  assert.equal(inspectSignedNativeSupervisorStateRequest(`${local}/v1/state`, { ...init, headers: { ...init.headers, 'x-a2-device-signature': '' } }).reason, 'signature_missing');
});

test('health proof rejects a different runtime, unattested source or authority-contaminated response', () => {
  assert.equal(localSupervisorHealthAttested(health(), instanceId), true);
  for (const override of [
    { instance_id: 'other' }, { runtime_ready: false }, { state_provider: 'SUPABASE' },
    { hosted_supabase_required: true }, { capability_health: { state: 'UNATTESTED', authority_effect: false } },
    { capability_health: { state: 'ATTESTED', authority_effect: true } },
  ]) assert.equal(localSupervisorHealthAttested(health(override), instanceId), false);
});

test('a local accepted signed heartbeat records successor health only after matching runtime attestation', async t => {
  selectLocal();
  const { app, target } = await appFixture(t);
  const calls = [];
  const wrapped = installSignedSupervisorHeartbeatQualificationHook({ app, fetchImpl: async url => {
    calls.push(url);
    return url.endsWith('/health') ? Response.json(health()) : new Response('', { status: 202 });
  } });
  await wrapped(`${local}/v1/state`, signed(target));
  assert.equal(acceptedSignedSupervisorHeartbeatSnapshot()?.version, target);
  assert.equal(acceptedSignedSupervisorHeartbeatSnapshot()?.sentinel_worker_healthy, true);
  await wrapped(`${local}/v1/heartbeat`, signed(target));
  assert.equal(calls.filter(url => url.endsWith('/health')).length, 1);
  assert(calls.every(url => url.startsWith(local)));
});

test('local HTTP 202 without the selected instance attestation cannot qualify a successor', async t => {
  selectLocal();
  const { app, target } = await appFixture(t);
  const wrapped = installSignedSupervisorHeartbeatQualificationHook({ app, fetchImpl: async url => (
    url.endsWith('/health') ? Response.json(health({ instance_id: 'another-runtime' })) : new Response('', { status: 202 })
  ) });
  const prior = acceptedSignedSupervisorHeartbeatSnapshot();
  await wrapped(`${local}/v1/state`, signed(target));
  assert.deepEqual(acceptedSignedSupervisorHeartbeatSnapshot(), prior);
});
