import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  NATIVE_SUPERVISOR_BASE,
  NATIVE_SUPERVISOR_RUNTIME_PATH,
  nativeSupervisorRuntimeUrl,
  nativeSupervisorSigningPath,
} from '../src/native-supervisor-endpoints.mjs';

test('lightweight endpoint constants remain exact with the legacy native supervisor base contract', async () => {
  const source = await readFile(new URL('../src/native-supervisor-client-base.mjs', import.meta.url), 'utf8');
  assert.match(source, new RegExp(`export const NATIVE_SUPERVISOR_BASE = '${NATIVE_SUPERVISOR_BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
  assert.match(source, new RegExp(`export const NATIVE_SUPERVISOR_RUNTIME_PATH = '${NATIVE_SUPERVISOR_RUNTIME_PATH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
});

test('runtime URL and signing path accept only fixed v1 relative paths', () => {
  assert.equal(nativeSupervisorRuntimeUrl('/v1/state'), `${NATIVE_SUPERVISOR_BASE}/v1/state`);
  assert.equal(nativeSupervisorSigningPath('/v1/state'), `${NATIVE_SUPERVISOR_RUNTIME_PATH}/v1/state`);
  for (const value of ['/state', '/v1/state?x=1', '/v1/state#x', '/v1/../state', '/v1//state', '/v1\\state']) {
    assert.throws(() => nativeSupervisorRuntimeUrl(value), /path_invalid/);
    assert.throws(() => nativeSupervisorSigningPath(value), /path_invalid/);
  }
});
