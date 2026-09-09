import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { NativeSupervisorCommandLaneScheduler } from '../src/native-supervisor-command-lanes.mjs';

const tab = (n) => `tab_00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function command(action, tabId, id) {
  return {
    command_id: id,
    action,
    payload: action === 'NAVIGATE'
      ? { tab_id: tabId, url: `https://chatgpt.com/?q=${encodeURIComponent(id)}` }
      : { tab_id: tabId },
  };
}

test('scheduler contract exposes linear dependency precompute and O(1) causal pending lookup', () => {
  const scheduler = new NativeSupervisorCommandLaneScheduler();
  const snapshot = scheduler.snapshot();
  assert.equal(snapshot.causal_dependency_precompute, 'O(n)');
  assert.equal(snapshot.causal_pending_lookup, 'O(1)');
  assert.equal(snapshot.repeated_pending_causal_scan, false);
  assert.equal(snapshot.immutable_original_order_barriers, true);
});

test('scheduler hot path no longer performs pending.some causal scans', async () => {
  const modulePath = fileURLToPath(new URL('../src/native-supervisor-command-lanes.mjs', import.meta.url));
  const source = await fs.readFile(modulePath, 'utf8');
  assert.equal(source.includes('pending.some('), false);
  assert.match(source, /prior_mutation_count/);
  assert.match(source, /launchedMutationsByKey/);
});

test('256-command mixed batch preserves per-tab causal order while fanning out across 32 BrowserCells', async () => {
  const scheduler = new NativeSupervisorCommandLaneScheduler({
    readConcurrency: 128,
    mutationConcurrency: 32,
    maxBatch: 256,
  });
  const rows = [];
  const ordinalById = new Map();
  for (let round = 0; round < 8; round += 1) {
    for (let cell = 1; cell <= 32; cell += 1) {
      const tabId = tab(cell);
      const action = round % 2 === 0 ? 'CAPTURE' : 'NAVIGATE';
      const id = `${cell}:${round}`;
      ordinalById.set(id, { tabId, round });
      rows.push(command(action, tabId, id));
    }
  }

  const completedRoundByTab = new Map();
  let active = 0;
  let peak = 0;
  const result = await scheduler.drain(rows, async (row) => {
    const meta = ordinalById.get(row.command_id);
    const expectedPrevious = meta.round - 1;
    assert.equal(Number(completedRoundByTab.get(meta.tabId) ?? -1), expectedPrevious,
      `causal predecessor not complete for ${row.command_id}`);
    active += 1;
    peak = Math.max(peak, active);
    await sleep(1);
    completedRoundByTab.set(meta.tabId, meta.round);
    active -= 1;
    return { ok: true };
  });

  assert.equal(result.length, 256);
  assert.equal(result.every((row) => row.ok === true), true);
  assert.ok(peak >= 16, `expected wide cross-cell fanout, peak=${peak}`);
  for (let cell = 1; cell <= 32; cell += 1) assert.equal(completedRoundByTab.get(tab(cell)), 7);
});

test('same-tab read/read fanout remains parallel when no mutation creates a causal edge', async () => {
  const scheduler = new NativeSupervisorCommandLaneScheduler({ readConcurrency: 32, mutationConcurrency: 8, maxBatch: 64 });
  const rows = Array.from({ length: 32 }, (_, index) => command('CAPTURE', tab(1), `read:${index}`));
  let active = 0;
  let peak = 0;
  await scheduler.drain(rows, async () => {
    active += 1;
    peak = Math.max(peak, active);
    await sleep(2);
    active -= 1;
    return { ok: true };
  });
  assert.ok(peak >= 16, `same-tab read fanout regressed, peak=${peak}`);
});
