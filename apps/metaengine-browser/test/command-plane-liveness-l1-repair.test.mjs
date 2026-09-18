import test from 'node:test';
import assert from 'node:assert/strict';
import { runBoundedCdpCommand } from '../src/native-browser-control.mjs';
import { classifyNoOpEffectOutcome } from '../src/native-supervisor-client-base.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');

// ---------- F-L1a: bounded command CDP execution ----------

test('F-L1a: a wedged CDP command task fails closed at the deadline and releases the debugger session', async () => {
  const released = [];
  const webContents = { id: 42 };
  const hangingTask = () => new Promise(() => {}); // never settles — the live wedge
  const t0 = Date.now();
  await assert.rejects(
    runBoundedCdpCommand(webContents, hangingTask, {
      deadlineMs: 5000, // clamps to the 5000ms minimum
      releaseDebuggerImpl: (wc) => released.push(wc),
    }),
    (error) => {
      assert.match(error.message, /native_supervisor_cdp_deadline:5000/);
      assert.equal(error.code, 'NATIVE_SUPERVISOR_CDP_TIMEOUT');
      assert.equal(error.automatic_retry_allowed, false); // fail-closed, no blind retry
      return true;
    },
  );
  const waited = Date.now() - t0;
  assert.ok(waited >= 4900 && waited < 2000 + 5000, `deadline fired at ${waited}ms`);
  assert.equal(released.length, 1, 'persistent debugger session must be released on deadline');
  assert.equal(released[0], webContents);
});

test('F-L1a: a completing CDP task passes through untouched', async () => {
  const released = [];
  const result = await runBoundedCdpCommand({ id: 1 }, async () => ({ ok: true, value: 7 }), {
    deadlineMs: 60000,
    releaseDebuggerImpl: (wc) => released.push(wc),
  });
  assert.deepEqual(result, { ok: true, value: 7 });
  assert.equal(released.length, 0);
});

test('F-L1a: deadline is clamped into [5000, 60000]', async () => {
  await assert.rejects(
    runBoundedCdpCommand({ id: 1 }, () => new Promise(() => {}), { deadlineMs: 10, releaseDebuggerImpl: () => {} }),
    /native_supervisor_cdp_deadline:5000/,
  );
});

test('F-L1a contract: executeSemanticCommand is wrapped by the bounded command runner', () => {
  const source = fs.readFileSync(path.join(appRoot, 'src', 'native-browser-control.mjs'), 'utf8');
  assert.match(source, /return runBoundedCdpCommand\(webContents, \(\) => withDebugger\(webContents/);
  // SCROLL keeps its dispatch and gains a bounded postcondition readback.
  assert.match(source, /VIEWPORT_PAGE_Y_CHANGED/);
  assert.match(source, /SCROLL_BOUNDARY_REACHED/);
});

// ---------- F-L1b contract: result delivery deadline wired into the fetch factory ----------

test('F-L1b contract: bounded supervisor fetch distinguishes result delivery deadline', () => {
  const source = fs.readFileSync(path.join(appRoot, 'src', 'native-supervisor-client-core-base.mjs'), 'utf8');
  assert.match(source, /resultDeliveryDeadlineMs/);
  assert.match(source, /native_supervisor_result_delivery_deadline/);
  // The old unconditional escape hatch must be gone.
  assert.doesNotMatch(source, /if \(isCommandResultUrl\(url\) \|\| init\.signal\) return fetchImpl\(url, init\)/);
});

// ---------- F-L1c/F-L1d contract: cycle stall guard + command plane observability ----------

test('F-L1c/F-L1d contract: snapshot exposes command_plane in-flight ages and cycle() guards stalls', () => {
  const source = fs.readFileSync(path.join(appRoot, 'src', 'native-supervisor-client-base.mjs'), 'utf8');
  assert.match(source, /command_plane: Object\.freeze\(/);
  assert.match(source, /command-plane-observability\.v1/);
  assert.match(source, /in_flight_commands/);
  assert.match(source, /cycle_age_ms/);
  assert.match(source, /command_cycle_stall:/);
  assert.match(source, /COMMAND_CYCLE_STALL_GUARD_MS = 900000/);
  // Per-command start times must be tracked and cleaned up.
  assert.match(source, /#commandStartsAtMs\.set\(/);
  assert.match(source, /#commandStartsAtMs\.delete\(/);
});

// ---------- D-L2: no-op effect outcome classification ----------

test('D-L2: BACK/FORWARD classify navigated=false as NO_EFFECT_PROVEN and navigated=true as CONFIRMED', () => {
  assert.equal(classifyNoOpEffectOutcome('BACK', { navigated: false }), 'NO_EFFECT_PROVEN');
  assert.equal(classifyNoOpEffectOutcome('FORWARD', { navigated: false }), 'NO_EFFECT_PROVEN');
  assert.equal(classifyNoOpEffectOutcome('BACK', { navigated: true }), 'CONFIRMED');
  assert.equal(classifyNoOpEffectOutcome('FORWARD', { navigated: true }), 'CONFIRMED');
  // Missing proof stays unclassified (falls through to AMBIGUOUS quarantine).
  assert.equal(classifyNoOpEffectOutcome('BACK', {}), null);
  assert.equal(classifyNoOpEffectOutcome('BACK', null), null);
});

test('D-L2: RELOAD initiation is CONFIRMED', () => {
  assert.equal(classifyNoOpEffectOutcome('RELOAD', { reload_initiated: true }), 'CONFIRMED');
  assert.equal(classifyNoOpEffectOutcome('RELOAD', {}), 'CONFIRMED');
});

test('D-L2: SCROLL classifies movement vs boundary no-op vs unproven', () => {
  assert.equal(
    classifyNoOpEffectOutcome('SCROLL', { scroll: { proof: 'VIEWPORT_PAGE_Y_CHANGED', moved: true } }),
    'CONFIRMED',
  );
  assert.equal(
    classifyNoOpEffectOutcome('SCROLL', { scroll: { proof: 'SCROLL_BOUNDARY_REACHED', moved: false, at_boundary: true } }),
    'NO_EFFECT_PROVEN',
  );
  // No readback (older shape or readback failure) stays unclassified -> AMBIGUOUS.
  assert.equal(classifyNoOpEffectOutcome('SCROLL', {}), null);
  assert.equal(classifyNoOpEffectOutcome('SCROLL', { scroll: { proof: null } }), null);
});

test('D-L2: SELF_UPDATE_CHECK while CURRENT is NO_EFFECT_PROVEN; any other state is CONFIRMED', () => {
  assert.equal(classifyNoOpEffectOutcome('SELF_UPDATE_CHECK', { state: 'CURRENT' }), 'NO_EFFECT_PROVEN');
  assert.equal(classifyNoOpEffectOutcome('SELF_UPDATE_CHECK', { state: 'READY_RESTART' }), 'CONFIRMED');
  assert.equal(classifyNoOpEffectOutcome('SELF_UPDATE_CHECK', { state: 'DOWNLOADING' }), 'CONFIRMED');
});

test('D-L2: unmodelled actions remain unclassified (AMBIGUOUS quarantine preserved)', () => {
  assert.equal(classifyNoOpEffectOutcome('SEMANTIC_FOCUS', { anything: true }), null);
  assert.equal(classifyNoOpEffectOutcome('TYPED_CLICK', { anything: true }), null);
  assert.equal(classifyNoOpEffectOutcome('', null), null);
});

test('D-L2 contract: fast-lane SQL accepts NO_EFFECT_PROVEN as a proven terminal outcome', () => {
  const repoRoot = path.resolve(appRoot, '..', '..');
  for (const rel of [
    path.join('supabase', 'migrations', '20260906172000_browser_control_plane_fast_lane_release_v1.sql'),
    path.join('sql', 'browser_control_plane_fast_lane_v1.sql'),
  ]) {
    const sql = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
    assert.match(sql, /v_outcome not in \('CONFIRMED','NO_EFFECT_PROVEN'\)/i, `${rel} must accept NO_EFFECT_PROVEN`);
    assert.doesNotMatch(sql, /v_outcome\s*<>\s*'CONFIRMED'/i, `${rel} must not reject NO_EFFECT_PROVEN`);
  }
});

// ---------- main.mjs navigation executors report navigated/reload flags ----------

test('D-L2 contract: main.mjs BACK/FORWARD/RELOAD executors report navigated and reload_initiated', () => {
  const source = fs.readFileSync(path.join(appRoot, 'src', 'main.mjs'), 'utf8');
  assert.match(source, /return \{ ok: true, navigated \};/);
  assert.match(source, /return \{ ok: true, tab_id: tab\.tab_id, \.\.\.\(action === 'RELOAD' \? \{ reload_initiated: true \} : \{ navigated \}\), authority_effect: true \};/);
});
