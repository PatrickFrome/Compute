import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';

// This is an isolated, source-backed Owner integration fixture. Pinned
// local selection happens BEFORE loading any Supervisor/native modules.
// Reassigning process.env after an ESM module has pinned its endpoint
// cannot grant authority, and former tests inadvertently assumed it could.
const saved = new Map();
for (const key of ['APPDATA','XDG_CONFIG_HOME','METAENGINE_STATE_PROVIDER',
  'METAENGINE_SUPERVISOR_BASE_URL','METAENGINE_LOCAL_STATE_INSTANCE_ID',
  'METAENGINE_LOCAL_PROVIDER_BOOT_STATE','METAENGINE_LOCAL_PROVIDER_BOOT_REASON']) {
  saved.set(key, process.env[key]);
}
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'meta-local-heartbeat-owner-'));
const instanceId='28da46b7-6e1d-4c6a-b638-f4dc4bd8ee59';
const mount='/a2-browser-native-supervisor-v1';
const server=createServer((req,res)=>{
  if(req.method!=='GET'||req.url!==mount+'/health'){
    res.writeHead(404);res.end();return;
  }
  res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
  res.end(JSON.stringify({ok:true,instance_id:instanceId,
    state_provider:'LOCAL_POSTGRES',hosted_supabase_required:false,runtime_ready:true,
    capability_health:{state:'ATTESTED',authority_effect:false}}));
});
await new Promise((resolve,reject)=>{
  server.once('error',reject);
  server.listen(0,'127.0.0.1',resolve);
});
const local='http://127.0.0.1:'+server.address().port+mount;
const ownerDir=path.join(tmp,'@metaengine','browser-shell');
const identityFile=path.join(tmp,'local-runtime-identity.json');
await fs.mkdir(ownerDir,{recursive:true});
await fs.writeFile(identityFile,JSON.stringify({
  schema:'metaengine.client-state.runtime-status.v1',state:'READY',
  runtime_ready:true,state_provider:'LOCAL_POSTGRES',hosted_supabase_required:false,
  automatic_cloud_fallback:false,authority_effect:false,
  instance_id:instanceId,endpoint:local,
  capability_health:{state:'ATTESTED',authority_effect:false}
}));
await fs.writeFile(path.join(ownerDir,'metaengine-state-provider-v1.json'),JSON.stringify({
  schema:'metaengine.browser.local-state-provider-config.v1',version:1,
  profile:'CLIENT_LOCAL_POSTGRES_V1',provider:'LOCAL_POSTGRES',base_url:local,
  runtime_identity_file:identityFile,authority_effect:false
}));
process.env.APPDATA=tmp;
process.env.XDG_CONFIG_HOME=tmp;
for(const key of ['METAENGINE_STATE_PROVIDER','METAENGINE_SUPERVISOR_BASE_URL',
  'METAENGINE_LOCAL_STATE_INSTANCE_ID','METAENGINE_LOCAL_PROVIDER_BOOT_STATE',
  'METAENGINE_LOCAL_PROVIDER_BOOT_REASON']) delete process.env[key];

const {explicitLocalSupervisorBase,localSupervisorHealthAttested,localSupervisorProviderProfile}
  =await import('../src/explicit-local-supervisor-provider.mjs');
const {NATIVE_SUPERVISOR_DEFAULT_BASE,setNativeSupervisorBase}
  =await import('../src/native-supervisor-endpoints.mjs');
const {inspectSignedNativeSupervisorStateRequest,installSignedSupervisorHeartbeatQualificationHook}
  =await import('../src/self-update-signed-heartbeat.mjs');
const {persistPreInstallReceipt,persistUpdatedSuccessorReceipt}
  =await import('../src/self-update-handoff.mjs');
const {acceptedSignedSupervisorHeartbeatSnapshot}
  =await import('../src/self-update-successor-qualification.mjs');
assert.equal(process.env.METAENGINE_LOCAL_PROVIDER_BOOT_STATE,'READY');

after(async()=>{
  await new Promise(resolve=>server.close(resolve));
  await fs.rm(tmp,{recursive:true,force:true});
  for(const [key,value] of saved){
    if(value===undefined)delete process.env[key];
    else process.env[key]=value;
  }
});
function selectLocal(){
  process.env.METAENGINE_STATE_PROVIDER='LOCAL_POSTGRES';
  process.env.METAENGINE_SUPERVISOR_BASE_URL=local;
  process.env.METAENGINE_LOCAL_STATE_INSTANCE_ID=instanceId;
  process.env.METAENGINE_LOCAL_PROVIDER_BOOT_STATE='READY';
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
    assert.throws(() => explicitLocalSupervisorBase({ env: { ...providerEnv, METAENGINE_SUPERVISOR_BASE_URL: base }, activeBase: base }), /local_supervisor_base_(?:invalid|required)/);
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
    `${local}/v1/state/extra`, `${local}/v1/state#fragment`, local.replace(':'+server.address().port, ':'+(server.address().port===65535?65534:server.address().port+1)) + '/v1/state',
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
