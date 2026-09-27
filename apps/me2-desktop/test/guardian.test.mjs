/**
 * R81 tests — Guardian-parity light (GAP #2; TOP-8 must-carry item 2).
 * Pure decisions only; spawn/beacon wiring is asserted indirectly via
 * packaging-contract (main.mjs must import makeBeacon; scripts/guardian.mjs
 * is syntax-checked) and via the in-process createGuardian integration tests.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  makeBeacon, validateBeacon, evaluateBeacon, nextBackoffMs,
  decideRestart, computeRestartsInWindow,
} from '../src/me2/guardian-contract.mjs';
import { GUARDIAN } from '../src/shared/me2-constants.mjs';
import { createGuardian } from '../scripts/guardian.mjs';

const NOW = 10_000_000;

describe('makeBeacon', () => {
  test('shape: pid, boot_id, ts, clean_exit default false', () => {
    const b = makeBeacon({ pid: 4242, bootId: 'boot-1', now: NOW });
    assert.deepEqual(b, { pid: 4242, boot_id: 'boot-1', ts: NOW, clean_exit: false });
  });

  test('cleanExit is normalized to boolean', () => {
    assert.equal(makeBeacon({ pid: 1, bootId: 'x', now: NOW, cleanExit: 'yes' }).clean_exit, true);
    assert.equal(makeBeacon({ pid: 1, bootId: 'x', now: NOW }).clean_exit, false);
  });
});

describe('validateBeacon (pure)', () => {
  test('absent / corrupt (readJson null) / arrays → beacon_absent', () => {
    assert.equal(validateBeacon(null).reason, 'beacon_absent');
    assert.equal(validateBeacon(undefined).reason, 'beacon_absent');
    assert.equal(validateBeacon('garbage').reason, 'beacon_absent');
    assert.equal(validateBeacon([1]).reason, 'beacon_absent');
  });

  test('malformed fields are named honestly', () => {
    assert.equal(validateBeacon({ pid: 0, boot_id: 'b', ts: NOW }).reason, 'beacon_pid_malformed');
    assert.equal(validateBeacon({ pid: -5, boot_id: 'b', ts: NOW }).reason, 'beacon_pid_malformed');
    assert.equal(validateBeacon({ pid: 1.5, boot_id: 'b', ts: NOW }).reason, 'beacon_pid_malformed');
    assert.equal(validateBeacon({ pid: 7, boot_id: '', ts: NOW }).reason, 'beacon_boot_id_malformed');
    assert.equal(validateBeacon({ pid: 7, boot_id: 'b' }).reason, 'beacon_ts_absent');
  });

  test('well-formed → ok with the beacon passed through', () => {
    const b = makeBeacon({ pid: 4242, bootId: 'boot-1', now: NOW });
    const v = validateBeacon(b);
    assert.equal(v.ok, true);
    assert.equal(v.beacon, b);
  });
});

describe('evaluateBeacon (pure)', () => {
  test('alive fresh beacon reports ageMs', () => {
    const b = makeBeacon({ pid: 4242, bootId: 'b', now: NOW - 1000 });
    const e = evaluateBeacon({ beacon: b, now: NOW, aliveImpl: () => true });
    assert.equal(e.alive, true);
    assert.equal(e.reason, 'alive');
    assert.equal(e.ageMs, 1000);
  });

  test('clean_exit is never alive — the operator decides', () => {
    const b = makeBeacon({ pid: 4242, bootId: 'b', now: NOW, cleanExit: true });
    const e = evaluateBeacon({ beacon: b, now: NOW, aliveImpl: () => true });
    assert.equal(e.alive, false);
    assert.equal(e.reason, 'clean_exit');
  });

  test('clock sanity: ts in the future is not trusted', () => {
    const b = makeBeacon({ pid: 4242, bootId: 'b', now: NOW + 60_000 });
    assert.equal(evaluateBeacon({ beacon: b, now: NOW, aliveImpl: () => true }).reason, 'ts_in_future');
  });

  test('dead pid wins over fresh ts (crash beats the beat)', () => {
    const b = makeBeacon({ pid: 4242, bootId: 'b', now: NOW - 1000 });
    assert.equal(evaluateBeacon({ beacon: b, now: NOW, aliveImpl: () => false }).reason, 'pid_dead');
  });

  test('live pid but stale beat → beacon_stale (hung client)', () => {
    const b = makeBeacon({ pid: 4242, bootId: 'b', now: NOW - GUARDIAN.STALE_MS - 1 });
    assert.equal(evaluateBeacon({ beacon: b, now: NOW, aliveImpl: () => true }).reason, 'beacon_stale');
  });

  test('null beacon → beacon_absent, alive=false, no throw', () => {
    const e = evaluateBeacon({ beacon: null, now: NOW });
    assert.equal(e.alive, false);
    assert.equal(e.reason, 'beacon_absent');
  });
});

describe('nextBackoffMs', () => {
  test('null/0 → start', () => {
    assert.equal(nextBackoffMs({}), GUARDIAN.BACKOFF_START_MS);
    assert.equal(nextBackoffMs({ currentMs: 0 }), GUARDIAN.BACKOFF_START_MS);
  });

  test('doubling progression capped at max', () => {
    assert.equal(nextBackoffMs({ currentMs: 15_000 }), 30_000);
    assert.equal(nextBackoffMs({ currentMs: 30_000 }), 60_000);
    assert.equal(nextBackoffMs({ currentMs: 60_000 }), GUARDIAN.BACKOFF_MAX_MS);
    assert.equal(nextBackoffMs({ currentMs: 120_000 }), GUARDIAN.BACKOFF_MAX_MS);
  });
});

describe('decideRestart (pure)', () => {
  test('alive → monitor without reset before the stability window', () => {
    const d = decideRestart({ alive: true, now: NOW, lastAliveAt: NOW - 1000 });
    assert.equal(d.action, 'monitor');
    assert.equal(d.reason, 'alive');
    assert.equal(d.resetBackoff, false);
  });

  test('alive 5+ min → monitor with backoff reset (stable)', () => {
    const d = decideRestart({ alive: true, now: NOW, lastAliveAt: NOW - GUARDIAN.STABLE_RESET_MS });
    assert.equal(d.action, 'monitor');
    assert.equal(d.reason, 'stable');
    assert.equal(d.resetBackoff, true);
  });

  test('clean_exit → monitor, never restart, backoff resets', () => {
    const d = decideRestart({ alive: false, reason: 'clean_exit', now: NOW });
    assert.equal(d.action, 'monitor');
    assert.equal(d.reason, 'clean_exit');
    assert.equal(d.resetBackoff, true);
  });

  test('down inside the backoff window → wait with honest retryInMs', () => {
    const d = decideRestart({ alive: false, restartsInWindow: 0, now: NOW, lastRestartAt: NOW - 5_000, currentBackoffMs: 30_000 });
    assert.equal(d.action, 'wait');
    assert.equal(d.reason, 'backoff');
    assert.equal(d.retryInMs, 25_000);
  });

  test('down past backoff → restart', () => {
    const d = decideRestart({ alive: false, restartsInWindow: 0, now: NOW, lastRestartAt: NOW - 31_000, currentBackoffMs: 30_000 });
    assert.equal(d.action, 'restart');
    assert.equal(d.reason, 'client_down');
  });

  test('cap reached → give_up (no restart storms, honest surrender)', () => {
    const d = decideRestart({ alive: false, restartsInWindow: GUARDIAN.MAX_RESTARTS_PER_WINDOW, now: NOW });
    assert.equal(d.action, 'give_up');
    assert.equal(d.reason, 'restart_cap');
  });

  test('first-ever failure (no lastRestartAt) restarts immediately', () => {
    const d = decideRestart({ alive: false, restartsInWindow: 0, now: NOW, lastRestartAt: null, currentBackoffMs: GUARDIAN.BACKOFF_START_MS });
    assert.equal(d.action, 'restart');
  });
});

describe('computeRestartsInWindow (pure)', () => {
  test('counts journal records by ISO `at` inside the window', () => {
    const records = [
      { at: new Date(NOW - 1000).toISOString(), event: 'guardian_restart' },
      { at: new Date(NOW - GUARDIAN.MAX_RESTARTS_WINDOW_MS - 1000).toISOString(), event: 'guardian_restart' }, // outside
      { at: new Date(NOW - 2000).toISOString(), event: 'guardian_observation' }, // other event
      { at: 'not-a-date', event: 'guardian_restart' }, // corrupt → skipped honestly
      null,
    ];
    assert.equal(computeRestartsInWindow(records, { now: NOW }), 1);
  });

  test('accepts raw numeric ts fallback and non-array input', () => {
    assert.equal(computeRestartsInWindow([{ ts: NOW - 5, event: 'guardian_restart' }], { now: NOW }), 1);
    assert.equal(computeRestartsInWindow(undefined, { now: NOW }), 0);
    assert.equal(computeRestartsInWindow([], { now: NOW }), 0);
  });
});

describe('createGuardian (integration, real files, fake spawn)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'me2-guardian-'));
  const beaconFile = join(dir, GUARDIAN.BEACON_NAME);

  const writeBeacon = (obj) => writeFileSync(beaconFile, JSON.stringify(obj), 'utf8');
  const readJournal = () => readFileSync(join(dir, GUARDIAN.JOURNAL_NAME), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l));

  test('alive → monitor; fallen pid → restart with journaled evidence', () => {
    writeBeacon(makeBeacon({ pid: 999_999, bootId: 'b1', now: Date.now() }));
    let alive = true;
    const g = createGuardian({
      userDataDir: dir,
      clientCmd: 'echo client',
      aliveImpl: () => alive,
      spawnImpl: () => ({ pid: 7777 }),
    });

    const first = g.tick();
    assert.equal(first.decision.action, 'monitor');

    // client crashed: same pid, fresh ts, but the process is gone
    alive = false;
    writeBeacon(makeBeacon({ pid: 999_999, bootId: 'b1', now: Date.now() }));
    const second = g.tick(Date.now() + 1);
    assert.equal(second.decision.action, 'restart');
    assert.equal(second.evaluation.reason, 'pid_dead');

    const recs = readJournal();
    assert.ok(recs.some((r) => r.event === 'guardian_restart' && r.spawned_pid === 7777 && r.reason === 'pid_dead'));
  });

  test('clean_exit beacon is monitored, never resurrected', () => {
    writeBeacon(makeBeacon({ pid: 999_999, bootId: 'b2', now: Date.now(), cleanExit: true }));
    const g = createGuardian({ userDataDir: dir, clientCmd: 'echo x', aliveImpl: () => true, spawnImpl: () => ({ pid: 1 }) });
    const { decision } = g.tick();
    assert.equal(decision.action, 'monitor');
    assert.equal(decision.reason, 'clean_exit');
  });

  test('restart cap: 8 restarts in the journal window → give_up, journaled once', () => {
    const dirCap = mkdtempSync(join(tmpdir(), 'me2-guardian-cap-'));
    const beaconCap = join(dirCap, GUARDIAN.BEACON_NAME);
    writeFileSync(beaconCap, JSON.stringify(makeBeacon({ pid: 1, bootId: 'b3', now: Date.now() })), 'utf8');
    const g = createGuardian({ userDataDir: dirCap, clientCmd: 'echo x', aliveImpl: () => false, spawnImpl: () => ({ pid: 2 }) });

    // advance the clock past the max backoff every tick → one restart per tick
    const t0 = Date.now();
    let last;
    for (let i = 0; i < 10; i += 1) last = g.tick(t0 + i * (GUARDIAN.BACKOFF_MAX_MS + 1000));
    assert.equal(last.decision.action, 'give_up');

    const recs = readFileSync(join(dirCap, GUARDIAN.JOURNAL_NAME), 'utf8')
      .split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.event === 'guardian_give_up');
    assert.equal(recs.length, 1, 'give_up journaled exactly once');
    rmSync(dirCap, { recursive: true, force: true });
  });

  test('beacon corrupt file → beacon_absent verdict (honest absent)', () => {
    writeFileSync(beaconFile, '{corrupt json', 'utf8');
    const g = createGuardian({ userDataDir: dir, clientCmd: 'echo x', aliveImpl: () => true, spawnImpl: () => ({ pid: 1 }) });
    const { evaluation } = g.tick();
    assert.equal(evaluation.reason, 'beacon_absent');
    assert.equal(evaluation.alive, false);
  });

  test('no file left behind: real spawnImpl stays out of tests; tmp cleaned', () => {
    assert.ok(existsSync(beaconFile));
    rmSync(dir, { recursive: true, force: true });
    assert.equal(existsSync(dir), false);
  });
});
