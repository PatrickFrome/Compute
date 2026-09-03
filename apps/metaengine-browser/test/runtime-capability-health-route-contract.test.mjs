import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.resolve(here, '../supabase/a2-browser-native-supervisor-v1/index.ts'), 'utf8');

test('health liveness remains HTTP 200 while readiness comes only from bounded DB attestation', () => {
  assert.match(source, /projectNativeSupervisorRuntimeCapabilityHealth/);
  assert.match(source, /runtimeCapabilityHealthResponseFields/);
  assert.match(source, /HEALTH_CAPABILITY_ATTESTATION_TIMEOUT_MS\s*=\s*1500/);
  assert.match(source, /AbortSignal\.timeout\(HEALTH_CAPABILITY_ATTESTATION_TIMEOUT_MS\)/);
  assert.match(source, /name!=='devos_runtime_capabilities_v1'/);
  assert.match(source, /if\(req\.method==='GET'&&path==='\/health'\)return json\(200,await health\(\)\)/);
});

test('health route has no local capability-envelope fallback or scheduler loop', () => {
  assert.doesNotMatch(source, /NATIVE_SUPERVISOR_RUNTIME_CAPABILITIES/);
  assert.doesNotMatch(source, /setInterval\s*\(/);
  assert.doesNotMatch(source, /setTimeout\s*\(/);
  assert.doesNotMatch(source, /automatic_retry_allowed\s*:\s*true/);
  assert.doesNotMatch(source, /physical_dispatch_allowed\s*:\s*true/);
});
