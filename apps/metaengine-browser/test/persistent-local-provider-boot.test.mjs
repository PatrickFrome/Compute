import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { provisionPersistentClientProvider } from '../../../infra/client-state-runtime/persistent-client-provider.mjs';
import { LOCAL_STATE_PROVIDER_CONFIG_SCHEMA, LOCAL_STATE_PROVIDER_PROFILE, localStateProviderOwnerFile, requirePackagedLocalProviderAdmission } from '../src/local-state-provider-policy.mjs';

const execute = promisify(execFile);
const endpointsUrl = new URL('../src/native-supervisor-endpoints.mjs', import.meta.url).href;
const bootstrapUrl = new URL('../src/local-state-provider-bootstrap.mjs', import.meta.url).href;
const heartbeatUrl = new URL('../src/self-update-signed-heartbeat.mjs', import.meta.url).href;
const resilienceUrl = new URL('../src/host-resilience-runtime.mjs', import.meta.url).href;
const firstId = '28da46b7-6e1d-4c6a-b638-f4dc4bd8ee59';
const secondId = 'bbc91d2a-44a7-4674-b4b4-5e265ebd2770';

async function fixture(t) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-persistent-provider-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  let instanceId = firstId;
  let attested = true;
  let redirect = false;
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url);
    if (redirect) { response.writeHead(302, { location: 'https://example.com/health' }).end(); return; }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true, instance_id: instanceId, state_provider: 'LOCAL_POSTGRES',
      runtime_ready: attested, hosted_supabase_required: false,
      capability_health: { state: attested ? 'ATTESTED' : 'UNATTESTED', authority_effect: false } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/a2-browser-native-supervisor-v1`;
  const appData = path.join(temporary, 'appdata');
  const ownerFile = localStateProviderOwnerFile({ env: { APPDATA: appData }, platform: 'win32' });
  const identityFile = path.join(temporary, 'runtime-instance.json');
  const config = { schema: LOCAL_STATE_PROVIDER_CONFIG_SCHEMA, version: 1, profile: LOCAL_STATE_PROVIDER_PROFILE,
    provider: 'LOCAL_POSTGRES', base_url: base, runtime_identity_file: identityFile, authority_effect: false };
  const writeIdentity = async (id = instanceId, mutation = {}) => fs.writeFile(identityFile, JSON.stringify({
    schema: 'metaengine.client-state.runtime-status.v1', state: 'READY', endpoint: base, instance_id: id,
    runtime_ready: true, state_provider: 'LOCAL_POSTGRES', hosted_supabase_required: false,
    automatic_cloud_fallback: false, capability_health: { state: 'ATTESTED', authority_effect: false },
    authority_effect: false, ...mutation,
  }));
  await fs.mkdir(path.dirname(ownerFile), { recursive: true });
  await fs.writeFile(ownerFile, JSON.stringify(config));
  await writeIdentity();
  return { temporary, appData, ownerFile, identityFile, base, config, requests, writeIdentity,
    changeRuntime: id => { instanceId = id; }, unattest: () => { attested = false; },
    redirect: () => { redirect = true; }, closeServer: () => new Promise(resolve => server.close(resolve)) };
}

async function probe(fixture, { extraEnv = {}, firstImport = endpointsUrl, action = '', argv = [] } = {}) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (/^METAENGINE_(STATE_PROVIDER|SUPERVISOR_BASE_URL|LOCAL_STATE_INSTANCE_ID|LOCAL_PROVIDER_)/.test(name)) delete env[name];
  const code = `try { await import(${JSON.stringify(firstImport)}); const m=await import(${JSON.stringify(endpointsUrl)}); const b=await import(${JSON.stringify(bootstrapUrl)}); ${action} console.log(JSON.stringify({ok:true,base:m.NATIVE_SUPERVISOR_BASE,provider:m.NATIVE_SUPERVISOR_STATE_PROVIDER,instance:process.env.METAENGINE_LOCAL_STATE_INSTANCE_ID,boot:b.persistentLocalProviderBootstrap,argv:process.argv.slice(1)})); } catch(error) { console.log(JSON.stringify({ok:false,error:error.message,provider:process.env.METAENGINE_STATE_PROVIDER,boot_state:process.env.METAENGINE_LOCAL_PROVIDER_BOOT_STATE})); }`;
  const result = await execute(process.execPath, ['--input-type=module', '-e', code, '--', ...argv], { env: { ...env, APPDATA: fixture.appData, XDG_CONFIG_HOME: fixture.appData, ...extraEnv }, windowsHide: true, timeout: 15000 });
  return JSON.parse(result.stdout.trim());
}

test('actual bare-process boot loads owner profile and current attested runtime before endpoint resolution', async t => {
  const f = await fixture(t);
  const result = await probe(f);
  assert.equal(result.ok, true);
  assert.equal(result.base, f.base);
  assert.equal(result.provider, 'LOCAL_POSTGRES');
  assert.equal(result.instance, firstId);
  assert.equal(result.boot.persistent, true);
  assert.equal(result.boot.state, 'READY');
  assert.deepEqual(f.requests, ['/a2-browser-native-supervisor-v1/health']);
});

test('self-update module import and successor/crash argv use the same persisted profile without inherited provider env', async t => {
  const f = await fixture(t);
  for (const argv of [[], ['--updated'], ['--metaengine-sentinel-recovery=fixture-token']]) {
    const result = await probe(f, { firstImport: heartbeatUrl, argv });
    assert.equal(result.ok, true);
    assert.equal(result.base, f.base);
    assert.equal(result.instance, firstId);
    assert.deepEqual(result.argv, argv);
  }
});

test('exact non-runtime diagnostic modes neither read stopped or malformed owner state nor start network', async t => {
  const f = await fixture(t);
  await fs.rm(f.identityFile);
  for (const ownerContents of [JSON.stringify(f.config), 'malformed owner JSON']) {
    await fs.writeFile(f.ownerFile, ownerContents);
    for (const flag of [
      '--metaengine-version-probe', '--metaengine-profile-probe',
      '--metaengine-client-goal-journal-probe', '--metaengine-single-instance-probe',
      '--metaengine-self-update-smoke',
    ]) {
      const result = await probe(f, { firstImport: heartbeatUrl, argv: [flag] });
      assert.equal(result.ok, true, flag);
      assert.equal(result.boot.state, 'OFFLINE_DIAGNOSTIC');
      assert.equal(result.boot.network_started, false);
      assert.equal(result.provider, null);
      assert.equal(result.instance, undefined);
    }
  }
  assert.equal(f.requests.length, 0);
});

test('normal, recovery and lookalike diagnostic flags cannot bypass persistent provider validation', async t => {
  const f = await fixture(t);
  await fs.rm(f.identityFile);
  for (const argv of [[], ['--updated'], ['--metaengine-smoke'], ['--metaengine-devplane-smoke'],
    ['--metaengine-version-probe=true'], ['--metaengine-client-goal-journal-probe-extra']]) {
    const result = await probe(f, { firstImport: heartbeatUrl, argv });
    assert.equal(result.ok, false);
    assert.equal(result.provider, 'LOCAL_POSTGRES');
    assert.equal(result.boot_state, 'BLOCKED');
  }
  assert.equal(f.requests.length, 0);
});

test('runtime restart refreshes inherited old UUID from identity file only when current health attests the new instance', async t => {
  const f = await fixture(t);
  f.changeRuntime(secondId);
  await f.writeIdentity(secondId);
  const result = await probe(f, { extraEnv: {
    METAENGINE_STATE_PROVIDER: 'LOCAL_POSTGRES', METAENGINE_SUPERVISOR_BASE_URL: f.base,
    METAENGINE_LOCAL_STATE_INSTANCE_ID: firstId,
  } });
  assert.equal(result.ok, true);
  assert.equal(result.instance, secondId);
});

test('existing malformed, excessive or credential-bearing configuration sets blocked local marker and cannot fall through to cloud', async t => {
  const f = await fixture(t);
  for (const contents of ['invalid JSON', JSON.stringify({ ...f.config, password: 'forbidden' }), ' '.repeat(16385), JSON.stringify({ ...f.config, base_url: f.base.replace('127.0.0.1', 'user:password@127.0.0.1') })]) {
    await fs.writeFile(f.ownerFile, contents);
    const result = await probe(f);
    assert.equal(result.ok, false);
    assert.equal(result.provider, 'LOCAL_POSTGRES');
    assert.equal(result.boot_state, 'BLOCKED');
  }
  assert.equal(f.requests.length, 0);
});

test('owner file conflicts with inherited cloud or alternate local endpoint fail before any network request', async t => {
  const f = await fixture(t);
  for (const extraEnv of [
    { METAENGINE_STATE_PROVIDER: 'HOSTED' },
    { METAENGINE_SUPERVISOR_BASE_URL: 'https://remote.supabase.co/functions/v1/a2-browser-native-supervisor-v1' },
    { METAENGINE_SUPERVISOR_BASE_URL: f.base.replace('/a2-browser', '/other/a2-browser') },
  ]) {
    const result = await probe(f, { extraEnv });
    assert.equal(result.ok, false);
    assert.equal(result.provider, 'LOCAL_POSTGRES');
  }
  assert.equal(f.requests.length, 0);
});

test('missing/stopped runtime identity, UUID drift and unavailable local health stay blocked without cloud requests', async t => {
  const f = await fixture(t);
  await fs.rm(f.identityFile);
  assert.equal((await probe(f)).ok, false);
  await f.writeIdentity(firstId, { state: 'STOPPED' });
  assert.equal((await probe(f)).ok, false);
  await f.writeIdentity(secondId);
  assert.equal((await probe(f)).ok, false);
  await f.writeIdentity(firstId);
  await f.closeServer();
  const offline = await probe(f);
  assert.equal(offline.ok, false);
  assert.equal(offline.provider, 'LOCAL_POSTGRES');
  assert.equal(offline.boot_state, 'BLOCKED');
});

test('unattested health or HTTP redirect cannot pass boot preflight', async t => {
  const f = await fixture(t);
  f.unattest();
  assert.equal((await probe(f)).ok, false);
  f.redirect();
  const redirected = await probe(f);
  assert.equal(redirected.ok, false);
  assert.equal(redirected.provider, 'LOCAL_POSTGRES');
  assert(f.requests.every(url => url === '/a2-browser-native-supervisor-v1/health'));
});

test('no owner file preserves legacy startup resolution and no readiness probe is sent', async t => {
  const f = await fixture(t);
  await fs.rm(f.ownerFile);
  const result = await probe(f);
  assert.equal(result.ok, true);
  assert.equal(result.provider, null);
  assert.match(result.base, /^https:\/\/jhriwwsryeqsvvvufkok\.supabase\.co\//);
  assert.equal(result.boot.state, 'NO_OWNER_CONFIG');
  assert.equal(f.requests.length, 0);
});

test('persistent attested profile qualifies future login configuration without touching real settings', async t => {
  const f = await fixture(t);
  const action = `let writes=0; const {HostResilienceRuntime}=await import(${JSON.stringify(resilienceUrl)}); const runtime=new HostResilienceRuntime({platform:'win32',electron:{app:{isPackaged:true,getLoginItemSettings:()=>({openAtLogin:true,executableWillLaunchAtLogin:true}),setLoginItemSettings:()=>{writes++;}}}}); const state=await runtime.start(); await runtime.stop(); if(state.login_start_provider_qualified!==true||state.login_start_configuration_hold!==false||writes!==0)throw Error('persistent_login_not_qualified');`;
  assert.equal((await probe(f, { action })).ok, true);
});

test('operator provisioning writes only an explicit external profile choice and never stores runtime credentials', async t => {
  const f = await fixture(t);
  await fs.rm(f.ownerFile);
  const options = { ownerFile: f.ownerFile, appDataDirectory: f.appData, baseUrl: f.base, runtimeIdentityFile: f.identityFile };
  await assert.rejects(provisionPersistentClientProvider(options), /owner_choice_required/);
  const result = await provisionPersistentClientProvider({ ...options, ownerChoice: 'LOCAL_POSTGRES' });
  assert.equal(result.state, 'CONFIGURED');
  assert.deepEqual(JSON.parse(await fs.readFile(f.ownerFile, 'utf8')), f.config);
  assert.equal((await provisionPersistentClientProvider({ ...options, ownerChoice: 'LOCAL_POSTGRES' })).state, 'ALREADY_CONFIGURED');
  await assert.rejects(provisionPersistentClientProvider({ ...options, ownerChoice: 'LOCAL_POSTGRES', baseUrl: f.base.replace('/a2-browser', '/other/a2-browser') }));
});


// The package's local-only policy applies to real normal/updated primary
// launches, not test-only smoke / diagnostic processes. This tests the pure
// guard separately from the older compatibility tests, which retain their
// historical non-packaged cloud-default assertions.
test('packaged local-only primary rejects missing owner before supervisor imports', () => {
  const normal = { isPackaged: true, browserRuntimeNeeded: true, bypassSingleInstance: false };
  assert.equal(requirePackagedLocalProviderAdmission({ ...normal, bootstrapState: 'READY' }), true);
  for (const state of ['NO_OWNER_CONFIG', 'OFFLINE_DIAGNOSTIC', 'BLOCKED', null, '']) {
    assert.throws(() => requirePackagedLocalProviderAdmission({ ...normal, bootstrapState: state }), /local_state_packaged_owner_not_ready/);
  }
  assert.equal(requirePackagedLocalProviderAdmission({ ...normal, isPackaged: false, bootstrapState: 'NO_OWNER_CONFIG' }), true);
  assert.equal(requirePackagedLocalProviderAdmission({ ...normal, browserRuntimeNeeded: false, bootstrapState: 'NO_OWNER_CONFIG' }), true);
  assert.equal(requirePackagedLocalProviderAdmission({ ...normal, bypassSingleInstance: true, bootstrapState: 'NO_OWNER_CONFIG' }), true);
});

test('packaged owner admission precedes HostResilience and main imports', async () => {
  const entry = await fs.readFile(new URL('../src/main-entry.mjs', import.meta.url), 'utf8');
  const boot = entry.indexOf("const providerBoot = await import('./local-state-provider-bootstrap.mjs')");
  const guard = entry.indexOf('requirePackagedLocalProviderAdmission({', boot);
  const resilience = entry.indexOf("await import('./host-resilience-runtime.mjs')", guard);
  const main = entry.indexOf("await import('./main.mjs')", guard);
  assert.ok(boot >= 0 && guard > boot && resilience > guard && main > guard);
  assert.match(entry, /isPackaged: app\.isPackaged/);
  assert.match(entry, /bootstrapState: providerBoot\.persistentLocalProviderBootstrap\.state/);
});
