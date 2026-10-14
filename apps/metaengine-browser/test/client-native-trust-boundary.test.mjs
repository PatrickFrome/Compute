import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  assertClientNativeShellIpcSender, assertGenericShellCommandAllowed,
  projectOwnPostgresClientConnection,
} from '../src/client-native-trust-boundary.mjs';

function fixture(mode = 'ME2_PRIMARY') {
  const frame = {};
  const webContents = {
    id: 42, mainFrame: frame,
    getURL: () => mode === 'ME2_PRIMARY'
      ? 'http://127.0.0.1:8137/#now'
      : 'metaengine://recovery/?reason=ME2_PRIMARY_DEGRADED',
  };
  return {
    event: { sender: webContents, senderFrame: frame },
    shellView: { webContents },
    primaryShellMode: mode,
    primaryShellUrl: mode === 'ME2_PRIMARY' ? 'http://127.0.0.1:8137/#browser' : null,
  };
}
const validate = x => assertClientNativeShellIpcSender(x);

test('W35: only the exact primary main-frame WebContents and pinned loopback origin is admitted', () => {
  assert.equal(validate(fixture()), true);
  for (const mutate of [
    x => { x.event.senderFrame = { ...x.event.senderFrame }; },
    x => { x.event.sender = { id: 42 }; },
    x => { x.shellView.webContents.mainFrame = {}; },
    x => { x.shellView = null; },
    x => { x.primaryShellUrl = null; },
    x => { x.primaryShellUrl = 'https://evil.example/#browser'; },
    x => { x.primaryShellUrl = 'http://127.0.0.1:8138/#browser'; },
    x => { x.shellView.webContents.getURL = () => 'http://127.0.0.2:8137/'; },
    x => { x.shellView.webContents.getURL = () => 'http://localhost:8137/'; },
    x => { x.shellView.webContents.getURL = () => 'http://127.0.0.1:8138/'; },
    x => { x.shellView.webContents.getURL = () => 'http://127.0.0.1:8137/evil'; },
    x => { x.shellView.webContents.getURL = () => 'http://127.0.0.1:8137/?redirect=https://evil.example'; },
    x => { x.shellView.webContents.getURL = () => 'javascript:alert(1)'; },
    x => { x.shellView.webContents.getURL = () => 'not-a-url'; },
    x => { x.primaryShellMode = 'FAKE_PRIMARY'; },
  ]) {
    const x = fixture();
    mutate(x);
    assert.throws(() => validate(x), /client_native_ipc_/, mutate.toString());
  }
});

test('W35: packaged fail-closed recovery is allowed but never a remote or alternate renderer', () => {
  assert.equal(validate(fixture('FAIL_CLOSED_RECOVERY')), true);
  for (const value of [
    'https://recovery/', 'http://127.0.0.1:8137/',
    'metaengine://evil/', 'metaengine://recovery/evil',
    'metaengine://recovery/?reason=ok&url=https://evil.example',
    'metaengine://recovery/#unexpected',
    'file:///C:/temporary/recovery.html',
    'metaengine://recovery/?reason=' + 'x'.repeat(97),
  ]) {
    const x = fixture('FAIL_CLOSED_RECOVERY');
    x.shellView.webContents.getURL = () => value;
    assert.throws(() => validate(x), /client_native_ipc_/, value);
  }
});

test('W35: legacy generic dispatcher can never be reached from the primary ME2 page', () => {
  assert.throws(() => assertGenericShellCommandAllowed('ME2_PRIMARY'), /forbidden/);
  assert.throws(() => assertGenericShellCommandAllowed('CLOUD_PRIMARY'), /untrusted/);
  assert.equal(assertGenericShellCommandAllowed('FAIL_CLOSED_RECOVERY'), true);
});

test('W35: missing / corrupt Owner forces own-DB UNKNOWN, not hosted fallback', () => {
  const raw = {
    local_runtime_ready: true, admin_ready: true, access_tier: 'ADMIN',
    secure_device_key_ready: true, device_enrolled: true,
    enrollment_state: 'ENROLLED', admin_scopes: ['OWNER'],
    admin_grant_epoch: 99, hosted_supabase_required: true,
    fallback_ready: true, fallback_enabled: true, fallback_mode: 'CLOUD_AUTHORITY',
    cloud_health: 'HEALTHY', cloud_control_state: 'ACTIVE',
  };
  for (const source of [undefined, null, false, 'READY', 1]) {
    const result = projectOwnPostgresClientConnection(raw, { localProviderAttested: source });
    assert.equal(result.state_provider, 'UNVERIFIED');
    assert.equal(result.local_runtime_ready, false);
    assert.equal(result.admin_ready, false);
    assert.equal(result.admin_grant_epoch, null);
    assert.equal(result.fallback_ready, false);
    assert.equal(result.fallback_enabled, false);
    assert.equal(result.hosted_supabase_required, false);
    assert.equal(result.automatic_cloud_fallback, false);
    assert.equal(result.cloud_control_state, 'DISABLED');
    assert.equal(result.authority_effect, false);
  }
});

test('W35: native status is a bounded allowlist: secrets and injected authority never reach renderer', () => {
  const raw = {
    local_runtime_ready: true, access_tier: 'ADMIN', admin_ready: true,
    admin_scopes: ['OWNER', 'READ_1', 'OWNER'],
    admin_grant_epoch: 4, device_enrolled: true,
    enrollment_state: 'ENROLLED', secure_device_key_ready: true,
    api_key: 'super-secret', service_role_key: 'must-not-appear',
    arbitrary_private_field: 'sensitive', owner_jwt: 'unsafe-jwt',
    gateway_base_url: 'http://127.0.0.1:1234',
    nested: { password: 'secret' },
    hosted_supabase_required: true, automatic_cloud_fallback: true,
    scheduler_authority: true, authority_effect: true,
  };
  const result = projectOwnPostgresClientConnection(raw, { localProviderAttested: true });
  assert.equal(result.state_provider, 'LOCAL_POSTGRES');
  assert.equal(result.admin_ready, true);
  assert.deepEqual(result.admin_scopes, ['OWNER', 'READ_1']);
  assert.equal(result.admin_grant_epoch, 4);
  assert.equal(result.scheduler_authority, undefined);
  for (const term of ['super-secret', 'must-not-appear', 'sensitive',
    'unsafe-jwt', '1234', 'password', 'supabase_url', 'api_key']) {
    assert.equal(JSON.stringify(result).includes(term), false, term);
  }
  assert.equal(result.hosted_supabase_required, false);
  assert.equal(result.remote_fallback_allowed, false);
  assert.equal(result.authority_effect, false);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.admin_scopes));
  assert.equal(raw.hosted_supabase_required, true, 'no mutation of native status');
});

test('W35: malformed native status cannot forge admin or smuggle sensitive scopes', () => {
  for (const scopes of [null, ['OWNER', 'bad\nsecret'], ['x'.repeat(200)], new Array(33).fill('X')]) {
    const r = projectOwnPostgresClientConnection({
      local_runtime_ready: true, access_tier: 'ADMIN', admin_ready: true,
      admin_scopes: scopes, admin_grant_epoch: Number.MAX_SAFE_INTEGER + 1,
      enrollment_state: 'OK\nsecret',
    }, { localProviderAttested: true });
    assert.deepEqual(r.admin_scopes, []);
    assert.equal(r.admin_grant_epoch, null);
    assert.equal(r.enrollment_state, 'UNKNOWN');
  }
  const r = projectOwnPostgresClientConnection({ admin_ready: true, access_tier: 'ADMIN' },
    { localProviderAttested: true });
  assert.equal(r.admin_ready, false);
});

test('W35: source audit — primary preload has no generic command and all native IPC funnels through main-frame gate', async () => {
  const main = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
  const preload = await readFile(new URL('../src/preload-shell.cjs', import.meta.url), 'utf8');
  const endpoints = await readFile(new URL('../src/native-supervisor-endpoints.mjs', import.meta.url), 'utf8');
  const primary = preload.split('if (isPrimaryMe2PresentationDocument()) {')[1]?.split('\n} else {')[0];
  assert.ok(primary, 'primary preload branch exists');
  assert.match(primary, /contextBridge\.exposeInMainWorld\('metaengineOperator'/);
  assert.match(primary, /readContext: async \(\) =>/);
  assert.doesNotMatch(primary, /command:\s*\(|ipcRenderer\.send\(|ipcRenderer\.invoke\(\s*\w/);
  assert.match(main, /function assertShellSender\(event\)\s*\{\s*return assertClientNativeShellIpcSender/);
  assert.match(main, /ipcMain\.handle\('metaengine:shell:command'[\s\S]*?assertGenericShellCommandAllowed\(primaryShellMode\)/);
  assert.match(main, /return projectOwnPostgresClientConnection\(status, \{ localProviderAttested: Boolean\(localProvider\) \}\)/);
  assert.doesNotMatch(main, /state_provider:\s*localProvider\s*\?\s*'LOCAL_POSTGRES'\s*:\s*'HOSTED'/);
  assert.match(endpoints, /NATIVE_SUPERVISOR_DEFAULT_BASE = null/);
  assert.doesNotMatch(endpoints, /supabase\.co|SUPABASE_URL/);
});
