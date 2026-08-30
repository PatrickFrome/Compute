import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

test('mesh continuity does not become a self-update quiescence prerequisite', async () => {
  const runtime = await fs.readFile(new URL('../src/supervisor-mesh-runtime.mjs', import.meta.url), 'utf8');
  const native = await fs.readFile(new URL('../src/native-supervisor-client.mjs', import.meta.url), 'utf8');
  assert.match(runtime, /same_event_failover_retry: false/);
  assert.match(runtime, /shared trusted actuation lease/i);
  assert.match(native, /confirmSelfUpdateRestartSafety/);
  assert.doesNotMatch(runtime, /canRestart/);
});
