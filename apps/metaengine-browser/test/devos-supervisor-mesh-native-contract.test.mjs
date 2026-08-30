import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

test('mesh continuity is wired locally without becoming a self-update quiescence prerequisite', async () => {
  const mesh = await fs.readFile(new URL('../src/supervisor-mesh.mjs', import.meta.url), 'utf8');
  const runtime = await fs.readFile(new URL('../src/supervisor-mesh-runtime.mjs', import.meta.url), 'utf8');
  const native = await fs.readFile(new URL('../src/native-supervisor-client.mjs', import.meta.url), 'utf8');
  assert.match(runtime, /same_event_failover_retry: false/);
  assert.match(mesh, /shared trusted actuation lease/i);
  assert.match(native, /new SupervisorMeshRuntime/);
  assert.match(native, /dispatchRecoveryIfNeeded/);
  assert.match(native, /confirmSelfUpdateRestartSafety/);
  assert.match(native, /Do not publish the new mesh projection to live Edge/);
  assert.doesNotMatch(runtime, /canRestart/);
  assert.doesNotMatch(native, /mesh.*isQuiescent.*canRestart|canRestart[\s\S]{0,300}mesh\.isQuiescent/i);
});
