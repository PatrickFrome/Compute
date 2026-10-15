import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';

// An explicit offline diagnostic is installed BEFORE any runtime import. This
// test must never inspect the user's configured Owner file or start Host/PG.
process.argv.push('--metaengine-version-probe');
const endpoints = await import('../src/native-supervisor-endpoints.mjs');
const { sentinelEnvironment } = await import('../src/browser-sentinel.mjs');
const { localSupervisorProviderProfile, explicitLocalSupervisorBase } =
  await import('../src/explicit-local-supervisor-provider.mjs');

const BASE = 'http://127.0.0.1:16177/a2-browser-native-supervisor-v1';
const INSTANCE = 'd6ea398b-5a14-43ae-92f0-56dc68f87f83';

test('W70 unbound native Supervisor cannot make URLs or select hosted/default transport', () => {
  assert.equal(endpoints.NATIVE_SUPERVISOR_BASE, null);
  assert.equal(endpoints.NATIVE_SUPERVISOR_DEFAULT_BASE, null);
  assert.equal(endpoints.NATIVE_SUPERVISOR_PINNED_INSTANCE_ID, null);
  assert.equal(endpoints.resolveNativeSupervisorBase(), null);
  assert.throws(() => endpoints.nativeSupervisorRuntimeUrl('/v1/state'), /native_supervisor_local_provider_unattested/);
  assert.throws(() => endpoints.nativeSupervisorRuntimeUrl('/v1/command/result'), /native_supervisor_local_provider_unattested/);
  assert.throws(() => endpoints.resolveNativeSupervisorBase(BASE), /native_supervisor_local_provider_endpoint_pinned/);
  assert.throws(() => endpoints.setNativeSupervisorBase(BASE), /native_supervisor_local_provider_endpoint_pinned/);
  assert.equal(endpoints.nativeSupervisorSigningPath('/v1/state'), '/a2-browser-native-supervisor-v1/v1/state');
  assert.throws(() => endpoints.nativeSupervisorSigningPath('/v1/../private'), /native_supervisor_runtime_path_invalid/);
});

test('W70 valid syntax is not an Owner proof; blocked and forged READY markers cannot reach detached worker', () => {
  const env = {
    METAENGINE_STATE_PROVIDER: 'LOCAL_POSTGRES',
    METAENGINE_SUPERVISOR_BASE_URL: BASE,
    METAENGINE_LOCAL_STATE_INSTANCE_ID: INSTANCE,
    METAENGINE_LOCAL_PROVIDER_BOOT_STATE: 'BLOCKED',
    METAENGINE_FALLBACK_SUPERVISOR_BASE_URL: 'https://hosted.example.invalid',
    SUPABASE_URL: 'https://hosted.example.invalid',
    PATH: 'test-path',
  };
  assert.deepEqual(localSupervisorProviderProfile(env),
    { provider: 'LOCAL_POSTGRES', base_url: BASE, instance_id: INSTANCE });
  assert.equal(explicitLocalSupervisorBase({env}), null);
  const child = sentinelEnvironment(env, {statePath:'disposable-state',token:'only-fixture',parentPid:4321});
  assert.equal(child.METAENGINE_SUPERVISOR_BASE_URL, undefined);
  assert.equal(child.METAENGINE_STATE_PROVIDER, undefined);
  assert.equal(child.METAENGINE_LOCAL_STATE_INSTANCE_ID, undefined);
  assert.equal(child.SUPABASE_URL, undefined);
  assert.equal(child.METAENGINE_FALLBACK_SUPERVISOR_BASE_URL, undefined);
  assert.equal(child.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(child.METAENGINE_SENTINEL_STATE_PATH, 'disposable-state');
  assert.throws(() => sentinelEnvironment({...env,METAENGINE_LOCAL_PROVIDER_BOOT_STATE:'READY'},
    {statePath:'disposable-state',token:'only-fixture',parentPid:4321}), /browser_sentinel_local_owner_unattested/);
});

test('W70 all native Supervisor fetch composition sites use the pinned runtime URL guard', async () => {
  for (const file of [
    'native-supervisor-client-base.mjs',
    'native-supervisor-client-core-base.mjs',
    'native-supervisor-client.mjs',
  ]) {
    const source = await fs.readFile(new URL(`../src/${file}`, import.meta.url), 'utf8');
    assert.match(source, /nativeSupervisorRuntimeUrl\(/, file);
    assert.doesNotMatch(source, /\`\$\{NATIVE_SUPERVISOR_BASE\}/, file);
    assert.doesNotMatch(source, /https?:\/\/[^\s'"]*supabase\./i, file);
  }
});
test('W70 forged READY environment cannot pin native transport during offline source probe', async t => {
  const { execFileSync } = await import('node:child_process');
  const os = await import('node:os');
  const path = await import('node:path');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-w70-offline-probe-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const moduleUrl = new URL('../src/native-supervisor-endpoints.mjs', import.meta.url).href;
  const code = `process.argv.push('--metaengine-version-probe');
    try { await import(${JSON.stringify(moduleUrl)}); console.log('UNSAFE_PIN'); }
    catch (error) { console.log(error.message); }`;
  const env = { ...process.env,
    APPDATA: path.join(directory, 'roaming'),
    LOCALAPPDATA: path.join(directory, 'local'),
    XDG_CONFIG_HOME: path.join(directory, 'xdg'),
    HOME: directory,
    USERPROFILE: directory,
    METAENGINE_STATE_PROVIDER: 'LOCAL_POSTGRES',
    METAENGINE_LOCAL_PROVIDER_BOOT_STATE: 'READY',
    METAENGINE_SUPERVISOR_BASE_URL: BASE,
    METAENGINE_LOCAL_STATE_INSTANCE_ID: INSTANCE,
  };
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', code],
    {env, encoding:'utf8', windowsHide:true, timeout:10000});
  assert.equal(stdout.trim(), 'native_supervisor_local_provider_unattested');
});


test('W70 signed cognitive transport rejects absent Owner before fetch, even with syntactic device headers', async () => {
  const { sendNativeSupervisorCognitiveBatch } = await import('../src/native-supervisor-client.mjs');
  const { BROWSER_COGNITIVE_BATCH_SCHEMA } = await import('../src/browser-cognitive-delta-transport.mjs');
  const calls = [];
  const signatures = [];
  const batch = {
    schema: BROWSER_COGNITIVE_BATCH_SCHEMA,
    raw_payload_exposed: false,
    page_text_exposed: false,
    input_values_exposed: false,
    delivery_is_authority: false,
    control_authority: false,
    command_leasing: false,
    authority_effect: false,
    events: [],
  };
  const identity = {
    ensure: async () => ({ device_id: INSTANCE }),
    deviceHeaders: async (method, path, body) => {
      signatures.push({method, path, body});
      return {'x-w70-fixture': 'staging-only'};
    },
  };
  const fetchImpl = async (url, init) => {
    calls.push({url, init});
    throw new Error('SECURITY_REGRESSION_NATIVE_FETCH_REACHED');
  };
  await assert.rejects(
    () => sendNativeSupervisorCognitiveBatch({identity, fetchImpl, batch}),
    /native_supervisor_local_provider_unattested/,
  );
  assert.equal(calls.length, 0, 'no network-hosted or unbound loopback fetch is permitted');
  assert.equal(signatures.length, 1);
  assert.equal(signatures[0].method, 'POST');
  assert.match(signatures[0].path, /^\/a2-browser-native-supervisor-v1\/v1\//);
  assert.deepEqual(JSON.parse(signatures[0].body), batch);
});
