import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Me2Plane } from '../src/me2/plane.mjs';
function scheduler() {
  const jobs = new Map(); let id = 0;
  return { jobs, schedule: (fn, ms) => { jobs.set(++id, { fn, ms }); return id; },
    cancel: key => jobs.delete(key), run: async () => { const [key, { fn }] = jobs.entries().next().value; jobs.delete(key); await fn(); } };
}
test('late health after stop cannot rearm keepalive or mutate state', async () => {
  const plane = new Me2Plane(); const clock = scheduler(); let release;
  plane.startKeepalive({ ...clock, probe: () => new Promise(r => { release = r; }) });
  const running = clock.run(); plane.stopKeepalive(); release({ ok: true, json: { boot: 'a' } });
  await running; assert.equal(clock.jobs.size, 0); assert.equal(plane.fence.epoch, null);
});
test('unreachable daemon becomes degraded; recovery requires fresh handshake and retries failed handshake', async () => {
  const plane = new Me2Plane(); const clock = scheduler(); let health = false, compatible = false, adopts = 0;
  plane.status.daemon.ok = true;
  plane.daemonHost.adopt = async () => { adopts++; return { handshake: { ok: compatible, reason: 'contract_mismatch' } }; };
  plane.startKeepalive({ ...clock, baseMs: 5, probe: async () => ({ ok: health, json: { boot: 'a' } }) });
  await clock.run(); assert.equal(plane.snapshot().daemon.ok, false);
  health = true; await clock.run(); assert.equal(plane.snapshot().daemon.ok, false);
  compatible = true; await clock.run(); assert.equal(plane.snapshot().daemon.ok, true); assert.equal(adopts, 2);
  plane.stopKeepalive(); assert.equal(clock.jobs.size, 0);
});
test('probe exception degrades and schedules bounded recovery', async () => {
  const plane = new Me2Plane(); const clock = scheduler();
  plane.startKeepalive({ ...clock, baseMs: 5, probe: async () => { throw Error('probe'); } });
  await clock.run(); assert.equal(plane.snapshot().daemon.ok, false);
  assert.equal(clock.jobs.size, 1); plane.stopKeepalive();
});
