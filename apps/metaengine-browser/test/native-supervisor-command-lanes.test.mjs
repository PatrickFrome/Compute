import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMMAND_LANES,
  NativeSupervisorCommandLaneScheduler,
  classifyNativeSupervisorCommand,
} from '../src/native-supervisor-command-lanes.mjs';

const tab = (n) => `tab_00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function command(action, payload = {}, id = crypto.randomUUID()) {
  return { command_id: id, action, payload };
}

test('all current Browser observations are zero-authority READ_ONLY lane commands', () => {
  for (const action of [
    'DEV_PLANE_STATUS', 'DEV_PLANE_HEALTH', 'DEV_PLANE_CAPABILITIES',
    'DEV_PLANE_PROCESS_METRICS', 'DEV_PLANE_REPO_HEAD', 'CAPTURE', 'CAPTURE_VIEW',
    'POLL', 'CONTROL_CAPABILITIES', 'PROCESS_CENSUS', 'PROCESS_EVENTS',
    'CONTROL_LATENCY_STATUS', 'DOWNLOAD_STATUS', 'SELF_UPDATE_STATUS', 'GATE_STATUS',
    'TAB_CENSUS', 'FLEET_STATUS',
  ]) {
    const out = classifyNativeSupervisorCommand(command(action));
    assert.equal(out.lane, COMMAND_LANES.READ_ONLY, action);
    assert.equal(out.read_only, true);
    assert.equal(out.effect_key, null);
    assert.equal(out.authority_effect, false);
  }
});

test('explicit tab mutations bind to one stable per-tab effect key', () => {
  const tabId = tab(1);
  for (const action of ['STOP_GENERATION', 'SCROLL', 'SEMANTIC_FOCUS', 'SEMANTIC_TYPE', 'TYPED_CLICK', 'CLOSE_TAB', 'NAVIGATE', 'RELOAD']) {
    const out = classifyNativeSupervisorCommand(command(action, { tab_id: tabId }));
    assert.equal(out.lane, COMMAND_LANES.TAB_MUTATION, action);
    assert.equal(out.effect_key, `tab:${tabId}`);
    assert.equal(out.exclusive, false);
  }
});

test('implicit selected-tab mutations fail toward global serialization', () => {
  for (const action of ['SCROLL', 'SEMANTIC_TYPE', 'TYPED_CLICK', 'CLOSE_TAB']) {
    const out = classifyNativeSupervisorCommand(command(action));
    assert.equal(out.lane, COMMAND_LANES.GLOBAL_MUTATION, action);
    assert.equal(out.exclusive, true);
  }
});

test('DISARM and mode OFF are exclusive emergency controls', () => {
  assert.equal(classifyNativeSupervisorCommand(command('DISARM')).lane, COMMAND_LANES.EMERGENCY);
  assert.equal(classifyNativeSupervisorCommand(command('SET_SUPERVISOR_MODE', { mode: 'OFF' })).lane, COMMAND_LANES.EMERGENCY);
  assert.equal(classifyNativeSupervisorCommand(command('SET_SUPERVISOR_MODE', { mode: 'CONTROL' })).lane, COMMAND_LANES.GLOBAL_MUTATION);
});

test('read-only batch fans out to configured concurrency instead of serial execution', async () => {
  const scheduler = new NativeSupervisorCommandLaneScheduler({ readConcurrency: 8, mutationConcurrency: 2, maxBatch: 32 });
  let active = 0;
  let peak = 0;
  const rows = Array.from({ length: 16 }, (_, i) => command(i % 2 ? 'PROCESS_CENSUS' : 'PROCESS_EVENTS', {}, `read-${i}`));
  const result = await scheduler.drain(rows, async () => {
    active += 1;
    peak = Math.max(peak, active);
    await sleep(20);
    active -= 1;
    return { ok: true };
  });
  assert.equal(result.length, rows.length);
  assert.equal(result.every((row) => row.ok), true);
  assert.equal(peak, 8);
});

test('mutations on distinct explicit tabs may overlap but one tab is strictly serialized', async () => {
  const scheduler = new NativeSupervisorCommandLaneScheduler({ readConcurrency: 4, mutationConcurrency: 4, maxBatch: 16 });
  const events = [];
  const activeByKey = new Set();
  let peakMutation = 0;
  const rows = [
    command('SCROLL', { tab_id: tab(1) }, 'a1'),
    command('TYPED_CLICK', { tab_id: tab(1) }, 'a2'),
    command('SCROLL', { tab_id: tab(2) }, 'b1'),
    command('SCROLL', { tab_id: tab(3) }, 'c1'),
  ];
  await scheduler.drain(rows, async (row, descriptor) => {
    assert.equal(activeByKey.has(descriptor.effect_key), false, `duplicate active key ${descriptor.effect_key}`);
    activeByKey.add(descriptor.effect_key);
    peakMutation = Math.max(peakMutation, activeByKey.size);
    events.push(`start:${row.command_id}`);
    await sleep(20);
    events.push(`end:${row.command_id}`);
    activeByKey.delete(descriptor.effect_key);
    return { ok: true };
  });
  assert.ok(events.indexOf('end:a1') < events.indexOf('start:a2'), events.join(','));
  assert.ok(peakMutation >= 2, `expected cross-tab overlap, peak=${peakMutation}`);
});

test('global mutation is an ordering barrier for later tab mutations while reads may pass', async () => {
  const scheduler = new NativeSupervisorCommandLaneScheduler({ readConcurrency: 8, mutationConcurrency: 8, maxBatch: 16 });
  const events = [];
  const rows = [
    command('SCROLL', { tab_id: tab(1) }, 'before'),
    command('FLEET_RECONCILE', { active: false }, 'global'),
    command('SCROLL', { tab_id: tab(2) }, 'after'),
    command('PROCESS_CENSUS', {}, 'read'),
  ];
  await scheduler.drain(rows, async (row) => {
    events.push(`start:${row.command_id}`);
    await sleep(row.command_id === 'before' ? 30 : 5);
    events.push(`end:${row.command_id}`);
    return { ok: true };
  });
  assert.ok(events.indexOf('end:before') < events.indexOf('start:global'), events.join(','));
  assert.ok(events.indexOf('end:global') < events.indexOf('start:after'), events.join(','));
  assert.ok(events.indexOf('start:read') < events.indexOf('end:global'), 'read-only should not be trapped behind global mutation barrier');
});

test('unknown actions receive no optimistic parallelism', () => {
  const out = classifyNativeSupervisorCommand(command('FUTURE_UNKNOWN_EFFECT'));
  assert.equal(out.lane, COMMAND_LANES.GLOBAL_MUTATION);
  assert.equal(out.exclusive, true);
  assert.equal(out.read_only, false);
});

test('batch and concurrency limits are bounded to protect event-loop memory', async () => {
  const scheduler = new NativeSupervisorCommandLaneScheduler({ readConcurrency: 9999, mutationConcurrency: 9999, maxBatch: 2 });
  const snap = scheduler.snapshot();
  assert.equal(snap.read_concurrency, 128);
  assert.equal(snap.mutation_concurrency, 32);
  await assert.rejects(
    () => scheduler.drain([command('POLL'), command('PROCESS_CENSUS'), command('PROCESS_EVENTS')], async () => null),
    /native_supervisor_command_batch_too_large/,
  );
});
