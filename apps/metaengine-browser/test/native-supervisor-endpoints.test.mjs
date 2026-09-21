import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import {
  NATIVE_SUPERVISOR_DEFAULT_BASE,
  NATIVE_SUPERVISOR_RUNTIME_PATH,
  nativeSupervisorRuntimeUrl,
  resolveNativeSupervisorBase,
  setNativeSupervisorBase,
} from '../src/native-supervisor-endpoints.mjs';

const ORIGINAL_BASE = setNativeSupervisorBase(NATIVE_SUPERVISOR_DEFAULT_BASE);

// Startup resolution reads METAENGINE_SUPERVISOR_BASE_URL; pin the sandbox
// explicitly so the default-resolution assertions are environment-proof.
const ORIGINAL_ENV = process.env.METAENGINE_SUPERVISOR_BASE_URL;
delete process.env.METAENGINE_SUPERVISOR_BASE_URL;
after(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.METAENGINE_SUPERVISOR_BASE_URL;
  else process.env.METAENGINE_SUPERVISOR_BASE_URL = ORIGINAL_ENV;
  setNativeSupervisorBase(ORIGINAL_BASE);
});

test('pinned default stays cloud-first and is the fallback for empty input', () => {
  assert.equal(NATIVE_SUPERVISOR_DEFAULT_BASE, 'https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-browser-native-supervisor-v1');
  assert.equal(resolveNativeSupervisorBase(null), NATIVE_SUPERVISOR_DEFAULT_BASE);
  assert.equal(resolveNativeSupervisorBase(''), NATIVE_SUPERVISOR_DEFAULT_BASE);
  assert.equal(resolveNativeSupervisorBase('   '), NATIVE_SUPERVISOR_DEFAULT_BASE);
});

test('R5: https override is accepted and normalized (trailing slash trimmed)', () => {
  const out = resolveNativeSupervisorBase('https://edge.example.org/functions/v1/a2-browser-native-supervisor-v1/');
  assert.equal(out, 'https://edge.example.org/functions/v1/a2-browser-native-supervisor-v1');
});

test('R5: http is allowed only for loopback hosts (local reserve edge rehearsal)', () => {
  assert.equal(
    resolveNativeSupervisorBase('http://127.0.0.1:3031/a2-browser-native-supervisor-v1'),
    'http://127.0.0.1:3031/a2-browser-native-supervisor-v1',
  );
  assert.equal(
    resolveNativeSupervisorBase('http://localhost:3031/a2-browser-native-supervisor-v1'),
    'http://localhost:3031/a2-browser-native-supervisor-v1',
  );
  assert.throws(() => resolveNativeSupervisorBase('http://edge.example.org/functions/v1/x'), /protocol_denied/);
  assert.throws(() => resolveNativeSupervisorBase('ftp://edge.example.org'), /protocol_denied/);
  assert.throws(() => resolveNativeSupervisorBase('http://loopback.example/functions/v1/x'), /protocol_denied/);
});

test('R5: malformed URLs and URLs carrying query/hash are refused', () => {
  assert.throws(() => resolveNativeSupervisorBase('not a url'), /invalid/);
  assert.throws(() => resolveNativeSupervisorBase('https://edge.example.org/x?token=1'), /invalid/);
  assert.throws(() => resolveNativeSupervisorBase('https://edge.example.org/x#frag'), /invalid/);
});

test('guarded setter refuses empty values (no silent mid-run detach) and updates the live binding', () => {
  try {
    assert.throws(() => setNativeSupervisorBase(''), /base_url_required/);
    assert.throws(() => setNativeSupervisorBase(null), /base_url_required/);
    assert.throws(() => setNativeSupervisorBase('http://not-loopback.example'), /protocol_denied/);
    const swapped = setNativeSupervisorBase('http://127.0.0.1:3031/a2-browser-native-supervisor-v1');
    assert.equal(swapped, 'http://127.0.0.1:3031/a2-browser-native-supervisor-v1');
    assert.equal(nativeSupervisorRuntimeUrl('/v1/device/heartbeat'), 'http://127.0.0.1:3031/a2-browser-native-supervisor-v1/v1/device/heartbeat');
  } finally {
    setNativeSupervisorBase(ORIGINAL_BASE);
  }
});

test('runtime URL builder stays pinned to the live base and rejects traversal tricks', () => {
  try {
    setNativeSupervisorBase('https://edge.example.org/functions/v1/a2-browser-native-supervisor-v1');
    assert.equal(
      nativeSupervisorRuntimeUrl('/v1/command/wait-batch'),
      'https://edge.example.org/functions/v1/a2-browser-native-supervisor-v1/v1/command/wait-batch',
    );
    assert.throws(() => nativeSupervisorRuntimeUrl('/v1/../etc'), /path_invalid/);
    assert.throws(() => nativeSupervisorRuntimeUrl('/v1/x?y=1'), /path_invalid/);
    assert.throws(() => nativeSupervisorRuntimeUrl('/relative/path'), /path_invalid/);
    assert.throws(() => nativeSupervisorRuntimeUrl('/v1//double'), /path_invalid/);
  } finally {
    setNativeSupervisorBase(ORIGINAL_BASE);
  }
});

test('signing path constant is the canonical supervisor mount', () => {
  assert.equal(NATIVE_SUPERVISOR_RUNTIME_PATH, '/a2-browser-native-supervisor-v1');
});
