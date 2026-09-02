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

  const heartbeatStart = base.indexOf('async #heartbeat()');
  const heartbeatEnd = base.indexOf('async #nextCommand()', heartbeatStart);
  const heartbeat = base.slice(heartbeatStart, heartbeatEnd);
  assert.ok(heartbeatStart >= 0 && heartbeatEnd > heartbeatStart, 'native supervisor heartbeat implementation must remain inspectable');
  assert.match(heartbeat, /supervisor_lifecycle:/);
  assert.match(heartbeat, /self_update:/);
  assert.doesNotMatch(heartbeat, /supervisor_mesh:/, 'mesh projection must not be published to the live Edge state schema before its remote contract is deployed');

  assert.match(core, /extends BaseNativeSupervisorClient/);
  assert.match(publicClient, /NativeSupervisorClient as CoreNativeSupervisorClient/);
  assert.match(publicClient, /extends CoreNativeSupervisorClient/);
  assert.match(publicClient, /await super\.cycle\(\)/);
  assert.doesNotMatch(runtime, /canRestart/);
  assert.doesNotMatch(base, /mesh.*isQuiescent.*canRestart|canRestart[\s\S]{0,300}mesh\.isQuiescent/i);
});
