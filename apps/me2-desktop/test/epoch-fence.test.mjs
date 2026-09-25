/**
 * R79 tests — daemon epoch fence + keepalive (legacy parity of TOP-8 item 7).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { checkEpoch, nextKeepaliveDelayMs, EpochFence, KEEPALIVE } from '../src/me2/epoch-fence.mjs';

describe('checkEpoch (pure)', () => {
  test('first observation is never stale', () => {
    const v = checkEpoch({ known: null, observed: '2026-09-25T10:00:00.000Z' });
    assert.equal(v.action, 'first-observe');
    assert.equal(v.stale, false);
    assert.equal(v.first, true);
  });

  test('same epoch → keep', () => {
    const v = checkEpoch({ known: 'boot-a', observed: 'boot-a' });
    assert.equal(v.action, 'keep');
    assert.equal(v.stale, false);
  });

  test('changed epoch → stale re-adopt with from/to evidence', () => {
    const v = checkEpoch({ known: 'boot-a', observed: 'boot-b' });
    assert.equal(v.stale, true);
    assert.equal(v.action, 're-adopt');
    assert.equal(v.from, 'boot-a');
    assert.equal(v.to, 'boot-b');
  });

  test('missing observed epoch → honest no-epoch (not stale)', () => {
    const v = checkEpoch({ known: 'boot-a', observed: '' });
    assert.equal(v.action, 'no-epoch');
    assert.equal(v.stale, false);
  });

  test('real daemon /health boot stamp round-trips', () => {
    const boot = '2026-09-24T20:02:17.758Z';
    assert.equal(checkEpoch({ known: boot, observed: boot }).action, 'keep');
  });
});

describe('nextKeepaliveDelayMs (pure backoff)', () => {
  test('healthy streak → base', () => {
    assert.equal(nextKeepaliveDelayMs({ failures: 0 }), KEEPALIVE.BASE_MS);
  });

  test('exponential growth 2^n', () => {
    assert.equal(nextKeepaliveDelayMs({ failures: 1, baseMs: 1000 }), 2000);
    assert.equal(nextKeepaliveDelayMs({ failures: 3, baseMs: 1000 }), 8000);
  });

  test('capped at capMs', () => {
    assert.equal(nextKeepaliveDelayMs({ failures: 20 }), KEEPALIVE.MAX_MS);
  });

  test('negative failures clamped, never below base', () => {
    assert.equal(nextKeepaliveDelayMs({ failures: -5, baseMs: 1000 }), 1000);
  });
});

describe('EpochFence (stateful)', () => {
  const FAKE_NOW = 1_000_000;
  const clock = () => FAKE_NOW;

  test('observe ok first time: first-observe, epoch learned, zero failures', () => {
    const f = new EpochFence({ now: clock });
    const v = f.observe({ ok: true, boot: 'boot-a' });
    assert.equal(v.action, 'first-observe');
    assert.equal(v.epochStale, false);
    assert.equal(f.epoch, 'boot-a');
    assert.equal(v.failures, 0);
  });

  test('observe ok same epoch: keep + base cadence', () => {
    const f = new EpochFence({ now: clock });
    f.observe({ ok: true, boot: 'boot-a' });
    const v = f.observe({ ok: true, boot: 'boot-a' });
    assert.equal(v.action, 'keep');
    assert.equal(v.nextProbeMs, KEEPALIVE.BASE_MS);
  });

  test('observe ok new epoch: stale + breach counted + epoch re-armed', () => {
    const f = new EpochFence({ now: clock });
    f.observe({ ok: true, boot: 'boot-a' });
    const v = f.observe({ ok: true, boot: 'boot-b' });
    assert.equal(v.epochStale, true);
    assert.equal(v.breaches, 1);
    assert.equal(f.epoch, 'boot-b');
  });

  test('observe fail: silent, failures grow, backoff scheduled', () => {
    const f = new EpochFence({ now: clock });
    f.observe({ ok: true, boot: 'boot-a' });
    const v1 = f.observe({ ok: false });
    const v2 = f.observe({ ok: false });
    assert.equal(v1.action, 'silent');
    assert.equal(v1.failures, 1);
    assert.equal(v2.failures, 2);
    assert.ok(v2.nextProbeMs > v1.nextProbeMs);
  });

  test('recovery after silence resets failures to base cadence', () => {
    const f = new EpochFence({ now: clock });
    f.observe({ ok: true, boot: 'boot-a' });
    f.observe({ ok: false });
    const v = f.observe({ ok: true, boot: 'boot-a' });
    assert.equal(v.failures, 0);
    assert.equal(v.nextProbeMs, KEEPALIVE.BASE_MS);
  });

  test('isCurrent: false before first ok, true after, false when silent', () => {
    let t = FAKE_NOW;
    const f = new EpochFence({ now: () => t });
    assert.equal(f.isCurrent(), false);
    f.observe({ ok: true, boot: 'boot-a' });
    assert.equal(f.isCurrent(), true);
    t += 4 * KEEPALIVE.MAX_MS; // silence beyond window
    assert.equal(f.isCurrent(), false);
  });

  test('snapshot is machine-readable and honest', () => {
    const f = new EpochFence({ now: clock });
    f.observe({ ok: true, boot: 'boot-a' });
    f.observe({ ok: false });
    const s = f.snapshot();
    assert.equal(s.epoch, 'boot-a');
    assert.equal(s.failures, 1);
    assert.equal(s.current, false);
    assert.ok(s.nextProbeMs >= KEEPALIVE.BASE_MS);
  });
});
