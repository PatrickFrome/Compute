import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DaemonHost } from '../src/me2/daemon-host.mjs';
import { UiHost } from '../src/me2/ui-host.mjs';
import { probeDaemon } from '../src/me2/probes.mjs';

test('daemon-host: spawn refused when daemon dir invalid (no network needed)', async () => {
  const host = new DaemonHost({ daemonDir: '/nonexistent/me2-daemon' });
  const r = await host.spawnDaemon();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'daemon_dir_invalid');
  assert.equal(host.status, 'degraded');
});

test('daemon-host: bringUp is environment-honest (live daemon in sandbox → adopted; none → degraded)', async () => {
  const live = await probeDaemon(3041, { timeoutMs: 1500 });
  const host = new DaemonHost({ daemonDir: '/nonexistent/me2-daemon' });
  const r = await host.bringUp({ backoffMs: 1 });
  if (live.ok) {
    assert.equal(r.ok, true);
    assert.equal(r.mode, 'adopted');
    assert.equal(host.status, 'adopted');
  } else {
    assert.equal(r.ok, false);
    assert.equal(r.mode, 'degraded');
    assert.equal(host.status, 'degraded');
  }
});

test('daemon-host: snapshot shape is machine-readable', () => {
  const host = new DaemonHost({ daemonDir: null });
  const snap = host.snapshot();
  assert.deepEqual(Object.keys(snap).sort(), ['pid', 'restarts', 'status']);
});

test('ui-host: missing dist → refused, unless :3000 already live (sandbox) → adopted', async () => {
  const { probeUi } = await import('../src/me2/probes.mjs');
  const live = await probeUi(3000, { timeoutMs: 1500 });
  const host = new UiHost({ uiDistDir: '/nonexistent/me2-ui-dist' });
  const r = await host.bringUp();
  if (live.ok) {
    assert.equal(r.ok, true);
    assert.equal(r.mode, 'adopted');
  } else {
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'ui_dist_missing');
    assert.equal(host.status, 'degraded');
  }
});

test('ui-host: spawn plan respects bun absence via injected probe', () => {
  const host = new UiHost({
    uiDistDir: '/x',
    spawnSyncImpl: () => ({ status: 1 }),
    electronExecPath: '/fake/electron',
  });
  const plan = host.buildSpawnPlan();
  assert.equal(plan.mode, 'electron-node');
  assert.equal(plan.runAsNode, true);
});

test('ui-host: contract files check catches incomplete dist', () => {
  const host = new UiHost({ uiDistDir: '/tmp' }); // exists but not a UI dist
  assert.equal(host.contractFilesPresent(), false);
});
