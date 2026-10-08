import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';

const execute = promisify(execFile);
const moduleUrl = new URL('../src/native-supervisor-endpoints.mjs', import.meta.url).href;
const local = 'http://127.0.0.1:15433/a2-browser-native-supervisor-v1';
const instanceId = '28da46b7-6e1d-4c6a-b638-f4dc4bd8ee59';

async function inspect(extraEnv, action = '') {
  const env = { ...process.env };
  delete env.METAENGINE_STATE_PROVIDER;
  delete env.METAENGINE_SUPERVISOR_BASE_URL;
  delete env.METAENGINE_LOCAL_STATE_INSTANCE_ID;
  const code = `try { const m = await import(${JSON.stringify(moduleUrl)}); ${action} console.log(JSON.stringify({ok:true,base:m.NATIVE_SUPERVISOR_BASE,provider:m.NATIVE_SUPERVISOR_STATE_PROVIDER})); } catch(error) { console.log(JSON.stringify({ok:false,error:error.message})); }`;
  const result = await execute(process.execPath, ['--input-type=module', '-e', code], { env: { ...env, ...extraEnv }, windowsHide: true, timeout: 15000 });
  return JSON.parse(result.stdout.trim());
}

test('actual module startup validates local provider base and UUID before any cloud default can resolve', async () => {
  const valid = { METAENGINE_STATE_PROVIDER: 'LOCAL_POSTGRES', METAENGINE_SUPERVISOR_BASE_URL: local, METAENGINE_LOCAL_STATE_INSTANCE_ID: instanceId };
  assert.deepEqual(await inspect(valid), { ok: true, base: local, provider: 'LOCAL_POSTGRES' });
  for (const override of [
    { METAENGINE_SUPERVISOR_BASE_URL: '' },
    { METAENGINE_LOCAL_STATE_INSTANCE_ID: '' },
    { METAENGINE_LOCAL_STATE_INSTANCE_ID: 'wrong' },
    { METAENGINE_SUPERVISOR_BASE_URL: 'https://jhriwwsryeqsvvvufkok.supabase.co/functions/v1/a2-browser-native-supervisor-v1' },
    { METAENGINE_SUPERVISOR_BASE_URL: local.replace('/a2-browser', '/wrong/a2-browser') },
    { METAENGINE_SUPERVISOR_BASE_URL: `${local}?token=1` },
    { METAENGINE_SUPERVISOR_BASE_URL: local.replace('127.0.0.1', 'user:secret@127.0.0.1') },
    { METAENGINE_STATE_PROVIDER: 'UNKNOWN' },
  ]) {
    const result = await inspect({ ...valid, ...override });
    assert.equal(result.ok, false);
    assert.match(result.error, /^native_supervisor_(local|state_provider)/);
  }
});

test('actual local profile setter cannot switch to cloud, another port or another mount', async () => {
  const env = { METAENGINE_STATE_PROVIDER: 'LOCAL_POSTGRES', METAENGINE_SUPERVISOR_BASE_URL: local, METAENGINE_LOCAL_STATE_INSTANCE_ID: instanceId };
  for (const target of [
    'https://jhriwwsryeqsvvvufkok.supabase.co/functions/v1/a2-browser-native-supervisor-v1',
    local.replace('15433', '15435'), local.replace('/a2-browser', '/other/a2-browser'),
  ]) {
    const result = await inspect(env, `m.setNativeSupervisorBase(${JSON.stringify(target)});`);
    assert.deepEqual(result, { ok: false, error: 'native_supervisor_local_provider_endpoint_pinned' });
  }
  const unchanged = await inspect(env, `m.setNativeSupervisorBase(${JSON.stringify(`${local}/`)});`);
  assert.equal(unchanged.base, local);
});

test('without a local provider marker legacy cloud and reserve swaps remain available', async () => {
  const result = await inspect({}, `m.setNativeSupervisorBase(${JSON.stringify(local)});`);
  assert.equal(result.ok, true);
  assert.equal(result.base, local);
  assert.equal(result.provider, null);
});
