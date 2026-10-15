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