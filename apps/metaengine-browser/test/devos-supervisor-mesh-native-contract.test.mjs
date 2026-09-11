import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

test('mesh continuity is preserved in exact base and the public DevOS client cannot bypass it', async () => {
  const mesh = await fs.readFile(new URL('../src/supervisor-mesh.mjs', import.meta.url), 'utf8');
  const runtime = await fs.readFile(new URL('../src/supervisor-mesh-runtime.mjs', import.meta.url), 'utf8');
  const base = await fs.readFile(new URL('../src/native-supervisor-client-base.mjs', import.meta.url), 'utf8');
  const core = await fs.readFile(new URL('../src/native-supervisor-client-core.mjs', import.meta.url), 'utf8');
  const publicClient = await fs.readFile(new URL('../src/native-supervisor-client.mjs', import.meta.url), 'utf8');
  assert.match(runtime, /same_event_failover_retry: false/);
  assert.match(mesh, /shared trusted actuation lease/i);
  assert.match(base, /new SupervisorMeshRuntime/);
  assert.match(base, /dispatchRecoveryIfNeeded/);
  assert.match(base, /confirmSelfUpdateRestartSafety/);
  assert.match(base, /supervisor_mesh:\s*this\.\#mesh\?\.snapshot\(\)\s*\|\|\s*null/);
  assert.match(base, /await this\.\#mesh\?\.reconcile\(\)/);
  assert.match(core, /extends BaseNativeSupervisorClient/);
  assert.match(publicClient, /NativeSupervisorClient as CoreNativeSupervisorClient/);
  assert.match(publicClient, /extends CoreNativeSupervisorClient/);
  assert.match(publicClient, /await super\.cycle\(\)/);
  assert.doesNotMatch(runtime, /canRestart/);
  assert.doesNotMatch(base, /mesh.*isQuiescent.*canRestart|canRestart[\s\S]{0,300}mesh\.isQuiescent/i);
});
