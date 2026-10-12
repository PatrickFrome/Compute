import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NATIVE_SUPERVISOR_DEFAULT_BASE,
  NATIVE_SUPERVISOR_BASE,
  NATIVE_SUPERVISOR_RUNTIME_PATH,
  nativeSupervisorRuntimeUrl,
  nativeSupervisorSigningPath,
  resolveNativeSupervisorBase,
  setNativeSupervisorBase,
} from '../src/native-supervisor-endpoints.mjs';

const local = 'http://127.0.0.1:15433/a2-browser-native-supervisor-v1';

test('no own-Postgres owner means no hosted default and no runtime URL', () => {
  assert.equal(NATIVE_SUPERVISOR_DEFAULT_BASE, null);
  assert.equal(NATIVE_SUPERVISOR_BASE, null);
  assert.throws(() => resolveNativeSupervisorBase(null), /local_base_required/);
  assert.throws(() => resolveNativeSupervisorBase(''), /local_base_required/);
  assert.throws(() => nativeSupervisorRuntimeUrl('/v1/state'), /local_owner_unconfigured/);
  assert.throws(() => setNativeSupervisorBase(local), /local_owner_unconfigured/);
});

test('only strict loopback canonical native supervisor URL is valid', () => {
  assert.equal(resolveNativeSupervisorBase(local + '/'), local);
  for (const value of [
    'https://example.supabase.co/functions/v1/a2-browser-native-supervisor-v1',
    'https://edge.example.org/a2-browser-native-supervisor-v1',
    'http://localhost:15433/a2-browser-native-supervisor-v1',
    'http://127.0.0.1:80/a2-browser-native-supervisor-v1',
    'http://127.0.0.1:15433/wrong',
    'http://user:secret@127.0.0.1:15433/a2-browser-native-supervisor-v1',
    local + '?token=1', local + '#fragment',
    'ftp://127.0.0.1:15433/a2-browser-native-supervisor-v1',
  ]) assert.throws(() => resolveNativeSupervisorBase(value), /base_url_(invalid|protocol_denied)/);
});

test('signing remains the exact canonical path without transport authority', () => {
  assert.equal(NATIVE_SUPERVISOR_RUNTIME_PATH, '/a2-browser-native-supervisor-v1');
  assert.equal(nativeSupervisorSigningPath('/v1/heartbeat'), '/a2-browser-native-supervisor-v1/v1/heartbeat');
  assert.throws(() => nativeSupervisorSigningPath('/v1/../etc'), /path_invalid/);
  assert.throws(() => nativeSupervisorSigningPath('/v1/anything?secret=1'), /path_invalid/);
});
