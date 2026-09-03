import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { NATIVE_SUPERVISOR_RUNTIME_CAPABILITIES } from '../supabase/a2-browser-native-supervisor-v1/runtime-capabilities.mjs';
import { projectNativeSupervisorRuntimeCapabilityHealth } from '../supabase/a2-browser-native-supervisor-v1/runtime-capability-health.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverSource = fs.readFileSync(path.resolve(here, '../supabase/a2-browser-native-supervisor-v1/index.ts'), 'utf8');

test('missing capability RPC degrades readiness without degrading liveness or granting fallback authority', async () => {
  const out = await projectNativeSupervisorRuntimeCapabilityHealth({ rpc: async () => {
    throw new Error('rest_404:{"code":"PGRST202","message":"Could not find the function public.devos_runtime_capabilities_v1"}');
  } });
  assert.equal(out.state, 'UNATTESTED');
  assert.equal(out.reason, 'RUNTIME_NOT_DEPLOYED');
  assert.equal(out.capabilities, null);
  assert.equal(out.readiness_eligible, false);
  assert.equal(out.physical_dispatch_allowed, false);
  assert.equal(out.automatic_retry_allowed, false);
  assert.equal(out.authority_effect, false);
});

test('DB/source capability drift is unadvertised and never falls back to local constants', async () => {
  const drift = structuredClone(NATIVE_SUPERVISOR_RUNTIME_CAPABILITIES);
  drift.features.meta_atomic_frontier_v2 = false;
  const out = await projectNativeSupervisorRuntimeCapabilityHealth({ rpc: async () => drift });
  assert.equal(out.state, 'UNATTESTED');
  assert.equal(out.reason, 'DB_SOURCE_ATTESTATION_FAILED');
  assert.equal(out.capabilities, null);
  assert.equal(out.readiness_eligible, false);
});

test('only exact DB/source match may expose capabilities on the health projection', async () => {
  const out = await projectNativeSupervisorRuntimeCapabilityHealth({ rpc: async () => structuredClone(NATIVE_SUPERVISOR_RUNTIME_CAPABILITIES) });
  assert.equal(out.state, 'ATTESTED');
  assert.equal(out.reason, 'EXACT_DB_SOURCE_MATCH');
  assert.deepEqual(out.capabilities, NATIVE_SUPERVISOR_RUNTIME_CAPABILITIES);
  assert.equal(out.readiness_eligible, true);
  assert.equal(out.physical_dispatch_allowed, false);
  assert.equal(out.scheduler_authority, false);
  assert.equal(out.browser_authority, false);
});

test('native health endpoint is wired through DB-attested projection and does not directly advertise source constants', () => {
  assert.match(serverSource, /projectNativeSupervisorRuntimeCapabilityHealth/);
  assert.match(serverSource, /await\s+projectNativeSupervisorRuntimeCapabilityHealth\(\{\s*rpc\s*\}\)/);
  assert.match(serverSource, /path===['"]\/health['"]/);
  assert.doesNotMatch(serverSource, /capabilities\s*:\s*NATIVE_SUPERVISOR_RUNTIME_CAPABILITIES/);
  assert.match(serverSource, /capability\.capabilities\s*\?\s*\{\s*capabilities:\s*capability\.capabilities\s*\}\s*:\s*\{\}/);
});
