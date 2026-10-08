import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sentinelEnvironment } from '../src/browser-sentinel.mjs';
import { HostResilienceRuntime } from '../src/host-resilience-runtime.mjs';

const base = 'http://127.0.0.1:15433/a2-browser-native-supervisor-v1';
const instanceId = '28da46b7-6e1d-4c6a-b638-f4dc4bd8ee59';
const local = { METAENGINE_STATE_PROVIDER: ' LOCAL_POSTGRES ', METAENGINE_SUPERVISOR_BASE_URL: ` ${base}/ `, METAENGINE_LOCAL_STATE_INSTANCE_ID: ` ${instanceId} ` };
const sentinelBinding = { statePath: 'sentinel-state.json', token: 'sentinel-token', parentPid: 12345 };

test('sentinel recovery inherits only normalized explicit local provider fields and OS environment', () => {
  const result = sentinelEnvironment({ ...local, PATH: 'preserved', SUPABASE_ACCESS_TOKEN: 'secret', PGPASSWORD: 'secret-db', LOCAL_STATE_API_KEY: 'secret-api', METAENGINE_FALLBACK_SUPERVISOR_BASE_URL: 'https://other.cloud' }, sentinelBinding);
  assert.equal(result.PATH, 'preserved');
  assert.equal(result.METAENGINE_STATE_PROVIDER, 'LOCAL_POSTGRES');
  assert.equal(result.METAENGINE_SUPERVISOR_BASE_URL, base);
  assert.equal(result.METAENGINE_LOCAL_STATE_INSTANCE_ID, instanceId);
  assert.equal(result.METAENGINE_SENTINEL_PARENT_PID, '12345');
  assert.equal(result.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(result.SUPABASE_ACCESS_TOKEN, undefined);
  assert.equal(result.PGPASSWORD, undefined);
  assert.equal(result.LOCAL_STATE_API_KEY, undefined);
  assert.equal(result.METAENGINE_FALLBACK_SUPERVISOR_BASE_URL, undefined);
});

test('invalid local recovery provider fails before a stripped marker could relaunch into cloud defaults', () => {
  for (const override of [
    { METAENGINE_STATE_PROVIDER: 'INVALID' },
    { METAENGINE_SUPERVISOR_BASE_URL: 'https://remote.supabase.co/functions/v1/a2-browser-native-supervisor-v1' },
    { METAENGINE_LOCAL_STATE_INSTANCE_ID: '' },
    { METAENGINE_SUPERVISOR_BASE_URL: '' },
  ]) assert.throws(() => sentinelEnvironment({ ...local, ...override }, sentinelBinding));
  assert.equal(sentinelEnvironment({ PATH: 'preserved' }, sentinelBinding).METAENGINE_STATE_PROVIDER, undefined);
});

test('local host resilience reports configuration-required without registering a bare executable at login', async t => {
  const previous = {};
  for (const [key, value] of Object.entries(local)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  let reads = 0;
  let writes = 0;
  const runtime = new HostResilienceRuntime({ platform: 'win32', electron: { app: {
    isPackaged: true,
    getLoginItemSettings: () => { reads += 1; return { openAtLogin: false }; },
    setLoginItemSettings: () => { writes += 1; },
  } } });
  t.after(() => runtime.stop());
  const status = await runtime.start();
  assert.equal(status.login_start_unavailable_reason, 'LOCAL_PROVIDER_CONFIGURATION_REQUIRED');
  assert.equal(status.login_start_provider_qualified, false);
  assert.equal(status.login_start_verified, false);
  assert.equal(status.login_start_configuration_hold, true);
  assert.equal(status.login_start_policy_hold, false);
  assert.equal(status.login_start_retry_pending, false);
  assert.equal(status.login_start_repair_attempts, 0);
  assert.equal(reads, 0);
  assert.equal(writes, 0);
  assert.equal(status.authority_effect, false);
});
