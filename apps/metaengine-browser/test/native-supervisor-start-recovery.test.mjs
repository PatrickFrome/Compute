import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeSupervisorClient } from '../src/native-supervisor-client-base.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('transient identity failure cannot terminate the native supervisor scheduler', async () => {
  let ensureCalls = 0;
  const identity = {
    ensure: async () => {
      ensureCalls += 1;
      if (ensureCalls === 1) throw new Error('transient_identity_failure');
      return { device_id: null, enrollment_request_id: 'req_pending' };
    },
    snapshot: () => ({ device_id: null, enrollment_request_id: 'req_pending' }),
    enrollmentHeaders: async () => ({}),
    deviceHeaders: async () => ({}),
    clearEnrollmentRequest: async () => {},
    bindEnrollmentRequest: async () => {},
    bindDevice: async () => {},
  };
  const client = new NativeSupervisorClient({
    identity,
    fetchImpl: async () => ({ status: 202, ok: true, json: async () => ({}) }),
    getState: async () => ({ tabs: [], fleet: { agents: [] } }),
    executeCommand: async () => ({ ok: true, authority_effect: false }),
    version: 'test',
    intervalMs: 1000,
  });

  await assert.rejects(client.start(), /transient_identity_failure/);
  assert.equal(client.snapshot().running, true);
  assert.equal(client.snapshot().continuous_service?.startup_scheduler_armed_before_enrollment, true);
  await sleep(1100);
  assert.ok(ensureCalls >= 2, 'scheduler must retry a failed startup without another external start call');
  client.stop();
  assert.equal(client.snapshot().running, false);
});


test('supervisor mesh runtime can recover after a transient local-state startup failure', async () => {
  const { mkdtemp, writeFile, unlink, mkdir, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { SupervisorMeshRuntime } = await import('../src/supervisor-mesh-runtime.mjs');

  const root = await mkdtemp(join(tmpdir(), 'metaengine-mesh-recovery-'));
  const blocker = join(root, 'mesh-parent');
  const statePath = join(blocker, 'mesh.json');
  await writeFile(blocker, 'transient-parent-blocker');

  const runtime = new SupervisorMeshRuntime({
    getState: async () => ({ tabs: [], fleet: { agents: [] } }),
    executeCommand: async () => ({ ok: true, authority_effect: false }),
    statePath,
  });

  try {
    await assert.rejects(runtime.start());
    assert.equal(runtime.snapshot().running, false);

    await unlink(blocker);
    await mkdir(blocker);
    const recovered = await runtime.start();
    assert.equal(recovered.running, true);
    assert.ok(recovered.mesh);
  } finally {
    runtime.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test('native supervisor idle maintenance retries mesh start before reconcile', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/native-supervisor-client-base.mjs', import.meta.url), 'utf8');
  const begin = source.indexOf('#kickMaintenance()');
  const end = source.indexOf('async #nextCommand()', begin);
  assert.ok(begin >= 0 && end > begin, 'maintenance source boundary missing');
  const maintenance = source.slice(begin, end);
  const retryAt = maintenance.indexOf('this.#mesh?.start()');
  const reconcileAt = maintenance.indexOf('this.#mesh?.reconcile()');
  assert.ok(retryAt >= 0, 'maintenance must retry a stopped mesh');
  assert.ok(reconcileAt > retryAt, 'mesh startup recovery must precede reconcile');
  assert.match(maintenance, /snapshot\?\.\(\)\?\.running !== true/);
  assert.match(maintenance, /mesh_start_recovery/);
});


test('maintenance startup retry authority remains mesh-only until other components prove idempotency', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/native-supervisor-client-base.mjs', import.meta.url), 'utf8');
  const begin = source.indexOf('#kickMaintenance()');
  const end = source.indexOf('async #nextCommand()', begin);
  assert.ok(begin >= 0 && end > begin, 'maintenance source boundary missing');
  const maintenance = source.slice(begin, end);

  assert.match(maintenance, /this\\.#mesh\\?\\.start\\(\\)/,
    'proven local/idempotent mesh initialization should remain recoverable');
  assert.doesNotMatch(maintenance, /this\\.#lifecycle\\?\\.start\\(\\)/,
    'lifecycle startup can enter effect-capable forced cycles and must not be blindly retried');
  assert.doesNotMatch(maintenance, /this\\.#selfUpdate\\?\\.start\\(\\)/,
    'self-update startup can bind host/updater state and must not be blindly retried');
});
