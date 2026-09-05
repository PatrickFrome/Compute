import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { createBoundedSupervisorFetch } from '../src/native-supervisor-client-core.mjs';

const appRoot = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(appRoot, '..', '..');

function between(text, start, end) {
  const from = text.indexOf(start);
  assert.ok(from >= 0, `${start} missing`);
  const to = text.indexOf(end, from + start.length);
  assert.ok(to > from, `${end} missing after ${start}`);
  return text.slice(from, to);
}

test('batch and legacy effect receipts are never locally aborted after physical execution', async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), signal: init.signal || null });
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const bounded = createBoundedSupervisorFetch(fetchImpl, { deadlineMs: 1000 });

  await bounded('https://example.test/a2-browser-native-supervisor-v1/v1/commands/11111111-1111-4111-8111-111111111111/result', { method: 'POST' });
  await bounded('https://example.test/a2-browser-native-supervisor-v1/v1/commands/result-batch', { method: 'POST' });
  await bounded('https://example.test/a2-browser-native-supervisor-v1/v1/commands/wait-batch', { method: 'POST' });

  assert.equal(calls[0].signal, null);
  assert.equal(calls[1].signal, null);
  assert.ok(calls[2].signal instanceof AbortSignal, 'ordinary transport request must remain bounded');
});

test('core scheduler admits remote command lane before worker observation and DevOS idle work', () => {
  const source = fs.readFileSync(path.join(appRoot, 'src', 'native-supervisor-client-core.mjs'), 'utf8');
  const cycle = between(source, '  async cycle() {', '\n  }\n}');
  assert.ok(cycle.indexOf('await super.cycle()') >= 0, 'base command cycle missing');
  assert.ok(cycle.indexOf('this.#kickIdleWork()') > cycle.indexOf('await super.cycle()'), 'idle work must follow command admission');
  assert.doesNotMatch(cycle, /await\s+this\.#observeWorkers\(/);
  assert.doesNotMatch(cycle, /await\s+this\.#devosTaskCycle\.cycle\(/);
  assert.match(source, /if \(!descriptor\.read_only && clientRef\.#idleWorkPromise\) await clientRef\.#idleWorkPromise/);
});

test('base command lane precedes heavy maintenance and supports held batch transport', () => {
  const source = fs.readFileSync(path.join(appRoot, 'src', 'native-supervisor-client-base.mjs'), 'utf8');
  const cycle = between(source, '  async cycle() {', '\n  }\n}');
  const next = cycle.indexOf('const commands = await this.#nextCommands()');
  const maintenance = cycle.indexOf('this.#kickMaintenance()');
  assert.ok(next >= 0, 'batch command lease missing');
  assert.ok(maintenance > next, 'maintenance must never sit in front of lease');
  assert.match(source, /\/v1\/commands\/wait-batch/);
  assert.match(source, /\/v1\/commands\/result-batch/);
  assert.match(source, /long_poll_replaces_idle_timer_latency/);
});

test('Edge route exposes authenticated bounded batch wait but never treats delivery as authority', () => {
  const source = fs.readFileSync(path.join(appRoot, 'supabase', 'a2-browser-native-supervisor-v1', 'index.ts'), 'utf8');
  for (const token of [
    "'/v1/commands/next-batch'",
    "'/v1/commands/wait-batch'",
    "'/v1/commands/result-batch'",
    'h205f22_a2_browser_supervisor_lease_batch_v1',
    'h205f22_a2_browser_supervisor_complete_batch_v1',
    'MAX_BATCH_WAIT_MS=15000',
    'transport_delivery_is_authority:false',
  ]) assert.ok(source.includes(token), `${token} missing from Edge fast lane`);
  assert.doesNotMatch(source, /eval\s*\(|new\s+Function\s*\(/);
});

test('fast-lane SQL stays source-only, rollback-only, and requires mutation post-condition readback', () => {
  const sqlPath = path.join(repoRoot, 'sql', 'browser_control_plane_fast_lane_v1.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  assert.match(sql, /h205f22_a2_browser_supervisor_lease_batch_v1/i);
  assert.match(sql, /h205f22_a2_browser_supervisor_complete_batch_v1/i);
  assert.match(sql, /DEV_PLANE_STATUS/);
  assert.match(sql, /DEV_PLANE_PROCESS_METRICS/);
  assert.match(sql, /command_lane\s*<>\s*'READ_ONLY'\s+and\s+v_ok\s+and\s+v_outcome\s*<>\s*'CONFIRMED'/i);
  assert.match(sql, /postcondition_readback_required/i);
  assert.match(sql, /transport_delivery_is_authority[^\n]*false/i);
  assert.match(sql, /automatic_retry_allowed[^\n]*false/i);
  assert.match(sql, /rollback;\s*$/i);
  assert.doesNotMatch(sql, /^\s*commit;\s*$/im);
  assert.doesNotMatch(sql, /grant\s+execute[^;]+\s+to\s+(public|anon|authenticated)\s*;/i);
  assert.equal(fs.existsSync(path.join(repoRoot, 'supabase', 'migrations', 'browser_control_plane_fast_lane_v1.sql')), false);
});

test('fast lane keeps bounded admission even under very large command bursts', async () => {
  const { NativeSupervisorCommandLaneScheduler } = await import('../src/native-supervisor-command-lanes.mjs');
  const scheduler = new NativeSupervisorCommandLaneScheduler({ readConcurrency: 128, mutationConcurrency: 32, maxBatch: 256 });
  const commands = Array.from({ length: 256 }, (_, index) => ({
    command_id: `read-${index}`,
    action: 'DEV_PLANE_STATUS',
    payload: {},
  }));
  let active = 0;
  let peak = 0;
  let completed = 0;
  const rows = await scheduler.drain(commands, async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setImmediate(resolve));
    active -= 1;
    completed += 1;
    return { ok: true };
  });
  assert.equal(rows.length, 256);
  assert.equal(completed, 256);
  assert.ok(peak <= 128, `read concurrency escaped bound: ${peak}`);
  assert.ok(peak >= 16, `read concurrency unexpectedly serialized: ${peak}`);
});
