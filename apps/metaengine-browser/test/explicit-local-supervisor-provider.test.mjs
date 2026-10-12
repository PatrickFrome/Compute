import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { test } from 'node:test';
import {
  explicitLocalSupervisorBase, localSupervisorHealthAttested, localSupervisorProviderProfile,
} from '../src/explicit-local-supervisor-provider.mjs';

const local = 'http://127.0.0.1:15433/a2-browser-native-supervisor-v1';
const instanceId = '28da46b7-6e1d-4c6a-b638-f4dc4bd8ee59';
const owner = { METAENGINE_STATE_PROVIDER: 'LOCAL_POSTGRES', METAENGINE_SUPERVISOR_BASE_URL: local,
  METAENGINE_LOCAL_STATE_INSTANCE_ID: instanceId };

test('own database requires exact selected provider, loopback endpoint and instance', () => {
  assert.equal(explicitLocalSupervisorBase({ env: owner, activeBase: local }), local);
  assert.equal(explicitLocalSupervisorBase({ env: {}, activeBase: local }), null);
  assert.equal(explicitLocalSupervisorBase({ env: { ...owner, METAENGINE_STATE_PROVIDER: '' }, activeBase: local }), null);
  assert.equal(explicitLocalSupervisorBase({ env: owner, activeBase: null }), null);
  assert.deepEqual(localSupervisorProviderProfile({ ...owner, METAENGINE_SUPERVISOR_BASE_URL: ' ' + local + '/ ' }),
    { provider: 'LOCAL_POSTGRES', base_url: local, instance_id: instanceId });
});

test('hosted backend, wrong mount, invalid instance and endpoint credentials are rejected', () => {
  for (const value of [
    'https://example.supabase.co/functions/v1/a2-browser-native-supervisor-v1',
    'http://127.0.0.1:15433/wrong',
    'http://user:secret@127.0.0.1:15433/a2-browser-native-supervisor-v1',
  ]) assert.throws(() => explicitLocalSupervisorBase({ env: { ...owner, METAENGINE_SUPERVISOR_BASE_URL: value }, activeBase: value }), /local_supervisor_base_invalid/);
  assert.throws(() => explicitLocalSupervisorBase({ env: { ...owner, METAENGINE_LOCAL_STATE_INSTANCE_ID: '' }, activeBase: local }), /local_supervisor_instance_invalid/);
});

test('local host attestation is tied to current instance and rejects unsafe payloads', () => {
  const valid = { ok: true, instance_id: instanceId, state_provider: 'LOCAL_POSTGRES',
    hosted_supabase_required: false, runtime_ready: true,
    capability_health: { state: 'ATTESTED', authority_effect: false } };
  assert.equal(localSupervisorHealthAttested(valid, instanceId), true);
  for (const patch of [
    { instance_id: 'wrong' }, { hosted_supabase_required: true },
    { state_provider: 'SUPABASE' }, { runtime_ready: false },
    { capability_health: { state: 'ATTESTED', authority_effect: true } },
  ]) assert.equal(localSupervisorHealthAttested({ ...valid, ...patch }, instanceId), false);
});

test('main does not construct a cloud sentinel and connection status rejects hosted fallback', async () => {
  const source = await fs.readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /const reserveSentinel = createSupabaseHealthSentinel\(/);
  assert.match(source, /hosted_supabase_required: false/);
  assert.match(source, /fallback_enabled: false/);
  assert.match(source, /state_provider: localProvider \? 'LOCAL_POSTGRES' : 'UNCONFIGURED'/);
});
