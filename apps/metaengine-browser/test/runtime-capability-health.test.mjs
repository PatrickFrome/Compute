import assert from 'node:assert/strict';
import test from 'node:test';
import { NATIVE_SUPERVISOR_RUNTIME_CAPABILITIES } from '../supabase/a2-browser-native-supervisor-v1/runtime-capabilities.mjs';
import {
  projectNativeSupervisorRuntimeCapabilityHealth,
  runtimeCapabilityHealthResponseFields,
} from '../supabase/a2-browser-native-supervisor-v1/runtime-capability-health.mjs';

function assertZeroAuthority(out) {
  assert.equal(out.physical_dispatch_allowed, false);
  assert.equal(out.automatic_retry_allowed, false);
  assert.equal(out.scheduler_authority, false);
  assert.equal(out.browser_authority, false);
  assert.equal(out.release_authority, false);
  assert.equal(out.authority_effect, false);
}

test('missing capability RPC degrades readiness without granting fallback authority', async () => {
  const out = await projectNativeSupervisorRuntimeCapabilityHealth({ rpc: async () => {
    throw new Error('rest_404:{"code":"PGRST202","message":"Could not find the function public.devos_runtime_capabilities_v1"}');
  } });
  assert.equal(out.state, 'UNATTESTED');
  assert.equal(out.reason, 'RUNTIME_NOT_DEPLOYED');
  assert.equal(out.capabilities, null);
  assert.equal(out.readiness_eligible, false);
  assertZeroAuthority(out);
});

test('DB/source capability drift is unadvertised and never falls back to local constants', async () => {
  const drift = structuredClone(NATIVE_SUPERVISOR_RUNTIME_CAPABILITIES);
  drift.features.meta_atomic_frontier_v2 = false;
  const out = await projectNativeSupervisorRuntimeCapabilityHealth({ rpc: async () => drift });
  assert.equal(out.state, 'UNATTESTED');
  assert.equal(out.reason, 'DB_SOURCE_ATTESTATION_FAILED');
  assert.equal(out.capabilities, null);
  assert.equal(out.readiness_eligible, false);
  assertZeroAuthority(out);
});

test('bounded transport timeout stays liveness-neutral and readiness-fail-closed', async () => {
  const out = await projectNativeSupervisorRuntimeCapabilityHealth({ rpc: async () => {
    const error = new Error('capability attestation deadline exceeded');
    error.name = 'TimeoutError';
    throw error;
  } });
  assert.equal(out.state, 'UNATTESTED');
  assert.equal(out.reason, 'ATTESTATION_TIMEOUT');
  assert.equal(out.capabilities, null);
  assert.equal(out.readiness_eligible, false);
  assertZeroAuthority(out);
});

test('only exact DB/source match may expose capabilities and it still grants no dispatch authority', async () => {
  let calls = 0;
  const out = await projectNativeSupervisorRuntimeCapabilityHealth({ rpc: async (name, args) => {
    calls += 1;
    assert.equal(name, 'devos_runtime_capabilities_v1');
    assert.deepEqual(args, {});
    return structuredClone(NATIVE_SUPERVISOR_RUNTIME_CAPABILITIES);
  } });
  assert.equal(calls, 1);
  assert.equal(out.state, 'ATTESTED');
  assert.equal(out.reason, 'EXACT_DB_SOURCE_MATCH');
  assert.deepEqual(out.capabilities, NATIVE_SUPERVISOR_RUNTIME_CAPABILITIES);
  assert.equal(out.readiness_eligible, true);
  assertZeroAuthority(out);
});

test('public health fields omit capability envelope entirely while unattested', async () => {
  const projection = await projectNativeSupervisorRuntimeCapabilityHealth({ rpc: async () => {
    const error = new Error('deadline exceeded');
    error.name = 'TimeoutError';
    throw error;
  } });
  const fields = runtimeCapabilityHealthResponseFields(projection);
  assert.equal(fields.runtime_ready, false);
  assert.equal(Object.hasOwn(fields, 'capabilities'), false);
  assert.equal(Object.hasOwn(fields.capability_health, 'capabilities'), false);
  assert.equal(fields.capability_health.state, 'UNATTESTED');
  assertZeroAuthority(fields.capability_health);
});

test('public health fields expose exact capability envelope only after attestation', async () => {
  const projection = await projectNativeSupervisorRuntimeCapabilityHealth({ rpc: async () => structuredClone(NATIVE_SUPERVISOR_RUNTIME_CAPABILITIES) });
  const fields = runtimeCapabilityHealthResponseFields(projection);
  assert.equal(fields.runtime_ready, true);
  assert.deepEqual(fields.capabilities, NATIVE_SUPERVISOR_RUNTIME_CAPABILITIES);
  assert.equal(Object.hasOwn(fields.capability_health, 'capabilities'), false);
  assert.equal(fields.capability_health.state, 'ATTESTED');
  assertZeroAuthority(fields.capability_health);
});
