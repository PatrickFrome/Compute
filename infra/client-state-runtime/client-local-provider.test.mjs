import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import {
  buildLocalClientEnvironment,
  prepareInstalledClientLocalLaunch,
  resolveLocalClientBase,
  verifyLocalClientProvider,
} from './client-local-provider.mjs';

const base = 'http://127.0.0.1:15433/a2-browser-native-supervisor-v1';
const instanceId = '28da46b7-6e1d-4c6a-b638-f4dc4bd8ee59';
const healthy = {
  ok: true, instance_id: instanceId, state_provider: 'LOCAL_POSTGRES',
  hosted_supabase_required: false, runtime_ready: true,
  capability_health: { state: 'ATTESTED', authority_effect: false },
};
const response = body => async () => ({ ok: true, json: async () => body });

test('local Client provider accepts only the exact loopback supervisor mount', () => {
  assert.equal(resolveLocalClientBase(`${base}/`), base);
  for (const value of [
    '', 'https://host.supabase.co/functions/v1/a2-browser-native-supervisor-v1',
    base.replace('127.0.0.1', 'localhost'), base.replace('http:', 'https:'),
    `${base}?token=1`, `${base}#fragment`, base.replace('/a2-browser', '/other/a2-browser'),
    base.replace('127.0.0.1', 'user:password@127.0.0.1'),
  ]) assert.throws(() => resolveLocalClientBase(value));
});

test('Client launch environment pins local endpoint and removes database/runtime credentials', () => {
  const inherited = {
    PATH: '/preserved', METAENGINE_SUPERVISOR_BASE_URL: 'https://old.supabase.co',
    METAENGINE_FALLBACK_SUPERVISOR_BASE_URL: 'https://reserve.supabase.co',
    SUPABASE_ACCESS_TOKEN: 'secret', LOCAL_STATE_INSPECT_DATABASE_URL: 'secret-admin',
    LOCAL_STATE_API_KEY: 'secret-api', PGPASSWORD: 'secret-db',
    ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--require something',
  };
  const env = buildLocalClientEnvironment({ baseUrl: base, inheritedEnv: inherited });
  assert.equal(env.METAENGINE_SUPERVISOR_BASE_URL, base);
  assert.equal(env.PATH, inherited.PATH);
  assert.equal(Object.keys(env).length, 2);
  assert.equal(inherited.LOCAL_STATE_API_KEY, 'secret-api');
});

test('provider preflight checks exact instance, local contract and database attestation', async () => {
  const proof = await verifyLocalClientProvider({ baseUrl: base, instanceId, fetchImpl: response(healthy) });
  assert.equal(proof.attested, true);
  for (const mutation of [
    { instance_id: 'another-runtime' }, { state_provider: 'SUPABASE' },
    { hosted_supabase_required: true }, { runtime_ready: false },
    { capability_health: { state: 'UNATTESTED', authority_effect: false } },
    { capability_health: { state: 'ATTESTED', authority_effect: true } },
  ]) await assert.rejects(verifyLocalClientProvider({ baseUrl: base, instanceId, fetchImpl: response({ ...healthy, ...mutation }) }));
});

test('normal launch plan preserves profile/device identity and contains no updater or singleton bypass arguments', async () => {
  const plan = await prepareInstalledClientLocalLaunch({
    executablePath: path.resolve('installed-client.exe'), baseUrl: base, instanceId,
    inheritedEnv: {}, fetchImpl: response(healthy),
  });
  assert.deepEqual(plan.arguments, []);
  assert.equal(plan.launch_kind, 'NORMAL_COLD_START');
  assert.equal(plan.existing_primary_must_be_closed, true);
  assert.equal(plan.preserve_existing_user_data, true);
  assert.equal(plan.preserve_device_identity, true);
  assert.equal(plan.automatic_cloud_fallback, false);
  assert.equal(plan.environment.METAENGINE_STATE_PROVIDER, 'LOCAL_POSTGRES');
  assert.equal(plan.environment.METAENGINE_LOCAL_STATE_INSTANCE_ID, instanceId);
  assert.equal(plan.authority_effect, false);
});
