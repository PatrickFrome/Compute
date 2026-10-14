import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

const exec = promisify(execFile);
const nativeUrl = new URL('../src/native-supervisor-endpoints.mjs', import.meta.url).href;
const localUrl = new URL('../src/explicit-local-supervisor-provider.mjs', import.meta.url).href;
const heartbeatUrl = new URL('../src/self-update-signed-heartbeat.mjs', import.meta.url).href;
const sentinelUrl = new URL('../src/browser-sentinel.mjs', import.meta.url).href;
const local = 'http://127.0.0.1:15433/a2-browser-native-supervisor-v1';
const id = '28da46b7-6e1d-4c6a-b638-f4dc4bd8ee59';

// The imported bootstrap is deliberately evaluated in a child with a unique,
// guaranteed-absent Owner directory, never the developer's installed profile.
async function isolated(source, extra = {}) {
  const dir = path.join(os.tmpdir(), 'client-local-contracts-w38-' + randomUUID());
  const env = { ...process.env, APPDATA: path.join(dir, 'roaming'), LOCALAPPDATA: path.join(dir, 'local') };
  for (const key of Object.keys(env)) {
    if (/^(METAENGINE_STATE_PROVIDER|METAENGINE_SUPERVISOR_BASE_URL|METAENGINE_LOCAL_STATE_INSTANCE_ID|METAENGINE_LOCAL_PROVIDER_|SUPABASE_)/i.test(key)) delete env[key];
  }
  const { stdout } = await exec(process.execPath, ['--input-type=module', '-e', source], {
    env: { ...env, ...extra }, windowsHide: true, timeout: 15_000,
  });
  return JSON.parse(stdout.trim());
}

test('W38 missing Owner leaves native base UNKNOWN and rejects both local and hosted heartbeat', async () => {
  const script = [
    'globalThis.fetch = async () => { throw Error("unexpected_network"); };',
    'const native = await import(' + JSON.stringify(nativeUrl) + ');',
    'const hb = await import(' + JSON.stringify(heartbeatUrl) + ');',
    'const endpoint = ' + JSON.stringify(local) + ';',
    'let setError = null;',
    'try { native.setNativeSupervisorBase(endpoint); } catch (e) { setError = e.message; }',
    'console.log(JSON.stringify({base:native.NATIVE_SUPERVISOR_BASE,defaultBase:native.NATIVE_SUPERVISOR_DEFAULT_BASE,provider:native.NATIVE_SUPERVISOR_STATE_PROVIDER,pinnedInstance:native.NATIVE_SUPERVISOR_PINNED_INSTANCE_ID,setError,local:hb.inspectSignedNativeSupervisorStateRequest(endpoint+"/v1/state",{method:"POST"}),hosted:hb.inspectSignedNativeSupervisorStateRequest("https://cloud.example/functions/v1/a2-browser-native-supervisor-v1/v1/state",{method:"POST"})}));'
  ].join('\n');
  const result = await isolated(script);
  assert.equal(result.base, null);
  assert.equal(result.defaultBase, null);
  assert.equal(result.provider, 'LOCAL_POSTGRES');
  assert.equal(result.pinnedInstance, null);
  assert.equal(result.setError, 'native_supervisor_local_provider_endpoint_pinned');
  assert.equal(result.local.reason, 'endpoint_mismatch');
  assert.equal(result.hosted.reason, 'endpoint_mismatch');
});

test('W38 forged READY environment after bootstrap cannot pin a native Owner', async () => {
  const script = [
    'const native = await import(' + JSON.stringify(nativeUrl) + ');',
    'const localProfile = await import(' + JSON.stringify(localUrl) + ');',
    'const injected = { METAENGINE_STATE_PROVIDER:"LOCAL_POSTGRES", METAENGINE_LOCAL_PROVIDER_BOOT_STATE:"READY", METAENGINE_SUPERVISOR_BASE_URL:' + JSON.stringify(local) + ', METAENGINE_LOCAL_STATE_INSTANCE_ID:' + JSON.stringify(id) + ' };',
    'console.log(JSON.stringify({base:native.NATIVE_SUPERVISOR_BASE,profile:localProfile.localSupervisorProviderProfile(injected),accepted:localProfile.explicitLocalSupervisorBase({env:injected,activeBase:' + JSON.stringify(local) + '})}));'
  ].join('\n');
  const result = await isolated(script);
  assert.equal(result.base, null);
  assert.equal(result.profile.base_url, local);
  assert.equal(result.accepted, null);
});

test('W38 native syntax validation rejects hosted, credentialed and alternate local endpoints', async () => {
  const script = [
    'const m = await import(' + JSON.stringify(nativeUrl) + ');',
    'const items = ' + JSON.stringify([
      'https://cloud.example/functions/v1/a2-browser-native-supervisor-v1',
      'http://127.0.0.1:15433/other',
      local + '?key=1', local + '#fragment',
      local.replace('127.0.0.1', 'localhost'),
      local.replace('127.0.0.1', 'user:pass@127.0.0.1'),
    ]) + ';',
    'console.log(JSON.stringify({valid:m.validateNativeSupervisorLocalBase(' + JSON.stringify(local + '/') + '),errors:items.map(x=>{try{return m.validateNativeSupervisorLocalBase(x)}catch(e){return e.message}})}));',
  ].join('\n');
  const result = await isolated(script);
  assert.equal(result.valid, local);
  assert.deepEqual(result.errors, Array(6).fill('native_supervisor_local_base_invalid'));
});

test('W38 Sentinel drops blocked Owner data, never inherits hosted credentials, and rejects forged READY', async () => {
  const script = [
    'const m = await import(' + JSON.stringify(sentinelUrl) + ');',
    'const bind={statePath:"unit-only.json",token:"unit-token",parentPid:1234};',
    'const blocked=m.sentinelEnvironment({METAENGINE_STATE_PROVIDER:"LOCAL_POSTGRES",METAENGINE_LOCAL_PROVIDER_BOOT_STATE:"BLOCKED",METAENGINE_SUPERVISOR_BASE_URL:"https://cloud.example/hosted",PGPASSWORD:"secret",SUPABASE_ACCESS_TOKEN:"secret",PATH:"safe"},bind);',
    'let readyRejected=null;try{m.sentinelEnvironment({METAENGINE_STATE_PROVIDER:" LOCAL_POSTGRES ",METAENGINE_LOCAL_PROVIDER_BOOT_STATE:"READY",METAENGINE_SUPERVISOR_BASE_URL:' + JSON.stringify(local + '/') + ',METAENGINE_LOCAL_STATE_INSTANCE_ID:' + JSON.stringify(id) + '},bind)}catch(e){readyRejected=e.message}',
    'let forged=null;try{m.sentinelEnvironment({METAENGINE_STATE_PROVIDER:"LOCAL_POSTGRES",METAENGINE_LOCAL_PROVIDER_BOOT_STATE:"READY",METAENGINE_SUPERVISOR_BASE_URL:"https://cloud.example/hosted",METAENGINE_LOCAL_STATE_INSTANCE_ID:' + JSON.stringify(id) + '},bind)}catch(e){forged=e.message}',
    'console.log(JSON.stringify({blocked,readyRejected,forged}));'
  ].join('\n');
  const result = await isolated(script);
  assert.equal(result.blocked.METAENGINE_STATE_PROVIDER, undefined);
  assert.equal(result.blocked.METAENGINE_SUPERVISOR_BASE_URL, undefined);
  assert.equal(result.blocked.PGPASSWORD, undefined);
  assert.equal(result.blocked.SUPABASE_ACCESS_TOKEN, undefined);
  assert.equal(result.blocked.PATH, 'safe');
  assert.equal(result.readyRejected, 'browser_sentinel_local_owner_unattested');
  assert.equal(result.forged, 'local_supervisor_base_invalid');
});
