import assert from 'node:assert/strict';
import test from 'node:test';
// Offline contract probe: never start installed local Host or PostgreSQL.
process.argv.push('--metaengine-version-probe');
const {
  NATIVE_SUPERVISOR_BASE,
  NATIVE_SUPERVISOR_DEFAULT_BASE,
  NATIVE_SUPERVISOR_RUNTIME_PATH,
  nativeSupervisorRuntimeUrl,
  nativeSupervisorSigningPath,
  resolveNativeSupervisorBase,
  setNativeSupervisorBase,
  validateNativeSupervisorLocalBase,
} = await import('../src/native-supervisor-endpoints.mjs');

const LOCAL = 'http://127.0.0.1:3031/a2-browser-native-supervisor-v1';

test('W54: default without trusted own-PG Owner is unbound, never cloud-first', () => {
  assert.equal(NATIVE_SUPERVISOR_DEFAULT_BASE, null);
  assert.equal(NATIVE_SUPERVISOR_BASE, null);
  assert.equal(resolveNativeSupervisorBase(null), null);
  assert.equal(resolveNativeSupervisorBase(''), null);
  assert.equal(resolveNativeSupervisorBase('   '), null);
  assert.throws(() => nativeSupervisorRuntimeUrl('/v1/state'), /local_provider_unattested/);
});

test('W54: syntax validation permits only literal loopback fixed path, but grants no transport', () => {
  assert.equal(validateNativeSupervisorLocalBase(LOCAL + '/'), LOCAL);
  assert.throws(() => resolveNativeSupervisorBase(LOCAL), /endpoint_pinned/);
  assert.throws(() => setNativeSupervisorBase(LOCAL), /endpoint_pinned/);
});

test('W54: hosted, credential-bearing, alternate-path and arbitrary local endpoints are refused', () => {
  for (const raw of [
    'https://edge.example.org/functions/v1/a2-browser-native-supervisor-v1',
    'https://jhriwwsryeqsvvvufkok.supabase.co/functions/v1/a2-browser-native-supervisor-v1',
    'http://localhost:3031/a2-browser-native-supervisor-v1',
    'http://127.0.0.2:3031/a2-browser-native-supervisor-v1',
    'http://127.0.0.1:3031/elsewhere',
    'http://admin:secret@127.0.0.1:3031/a2-browser-native-supervisor-v1',
    LOCAL + '?token=secret', LOCAL + '#fragment',
    'ftp://127.0.0.1:3031/a2-browser-native-supervisor-v1',
    'not a url',
  ]) {
    assert.throws(() => validateNativeSupervisorLocalBase(raw), /local_base_invalid/, raw);
    assert.throws(() => resolveNativeSupervisorBase(raw), /local_base_invalid/, raw);
  }
  assert.throws(() => setNativeSupervisorBase(null), /base_url_required/);
  assert.throws(() => setNativeSupervisorBase(''), /base_url_required/);
  assert.equal(NATIVE_SUPERVISOR_BASE, null, 'rejected inputs cannot activate transport');
});

test('W54: signed route never becomes arbitrary file, query, or traversal URL', () => {
  assert.equal(NATIVE_SUPERVISOR_RUNTIME_PATH, '/a2-browser-native-supervisor-v1');
  assert.equal(nativeSupervisorSigningPath('/v1/device/heartbeat'),
    '/a2-browser-native-supervisor-v1/v1/device/heartbeat');
  for (const path of ['/v1/../etc', '/v1/x?y=1', '/relative/path', '/v1//double',
    '/v1/x#fragment', '/v1/\\windows']) {
    assert.throws(() => nativeSupervisorRuntimeUrl(path), /runtime_path_invalid/);
    assert.throws(() => nativeSupervisorSigningPath(path), /runtime_path_invalid/);
  }
  assert.equal(NATIVE_SUPERVISOR_BASE, null);
});
