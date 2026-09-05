import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { createBoundedSupervisorFetch } from '../src/native-supervisor-client-core.mjs';

const appRoot = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(appRoot, '..', '..');

function between(text, start, end) {
  const source = String(text).replace(/\r\n?/g, '\n');
  const from = source.indexOf(start);
  assert.ok(from >= 0, `${start} missing`);
  const to = source.indexOf(end, from + start.length);
  assert.ok(to > from, `${end} missing after ${start}`);
  return source.slice(from, to);
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
  assert.ok(calls[2].signal instanceof AbortSignal, 'held transport remains bounded above the current 4s Edge wait');
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

test('base command lane precedes heavy maintenance, preserves 750ms fallback, and hands off to held batch transport', () => {
  const source = fs.readFileSync(path.join(appRoot, 'src', 'native-supervisor-client-base.mjs'), 'utf8');
  const cycle = between(source, '  async cycle() {', '\n  }\n}');
  const next = cycle.indexOf('const commands = await this.#nextCommands()');
  const maintenance = cycle.indexOf('this.#kickMaintenance()');
  assert.ok(next >= 0, 'batch command lease missing');
  assert.ok(maintenance > next, 'maintenance must never sit in front of lease');
  assert.match(source, /\/v1\/commands\/wait-batch/);
  assert.match(source, /\/v1\/commands\/result-batch/);
  assert.match(source, /long_poll_replaces_idle_timer_latency/);
  assert.match(source, /commandFastlane === true\s*\?\s*new NativeSupervisorCommandFastlane/);
  assert.match(source, /this\.#batchTransport = 'SUPPORTED';\s*\n\s*this\.#commandFastlane\?\.stop\(\)/);
  assert.match(source, /legacy_fallback_suppressed_by_batch_transport:\s*this\.#batchTransport === 'SUPPORTED'/);
  assert.match(source, /one_steady_state_lease_loop:\s*true/);
  assert.doesNotMatch(source, /row\.descriptor === COMMAND_LANES\.READ_ONLY/);
  assert.match(source, /descriptor\.read_only \? null : 'AMBIGUOUS'/);
});

test('Edge realtime wait is race-free, uses a non-secret URL key, and delivery never grants authority', () => {
  const source = fs.readFileSync(path.join(appRoot, 'supabase', 'a2-browser-native-supervisor-v1', 'index.ts'), 'utf8');
  for (const token of [
    "'/v1/commands/next-batch'",
    "'/v1/commands/wait-batch'",
    "'/v1/commands/result-batch'",
    'h205f22_a2_browser_supervisor_lease_batch_v1',
    'h205f22_a2_browser_supervisor_complete_batch_v1',
    'openRealtimeCommandWake',
    "wake_reason:'SUBSCRIBED_RECHECK'",
    'const wake=await subscription.wake',
    'transport_delivery_is_authority:false',
    'realtime_process_plane:boundedObject',
    'control_latency:boundedObject',
    "Deno.env.get('SUPABASE_PUBLISHABLE_KEY')",
    "Deno.env.get('SUPABASE_ANON_KEY')",
    'apikey=${encodeURIComponent(REALTIME_API_KEY)}',
    'accessToken:SERVICE_ROLE',
    'realtime_url_uses_service_role:false',
  ]) assert.ok(source.includes(token), `${token} missing from Edge fast lane`);
  assert.doesNotMatch(source, /apikey=\$\{encodeURIComponent\(SERVICE_ROLE\)\}/, 'service role must never enter a websocket URL/query');
  assert.doesNotMatch(source, /finish\(['"]SUBSCRIBED_RECHECK['"]\)/, 'subscription acknowledgement must not itself wake the lease loop');
  assert.doesNotMatch(source, /eval\s*\(|new\s+Function\s*\(/);
});

test('Realtime wake helper fails join errors fast without inventing authority', () => {
  const source = fs.readFileSync(path.join(appRoot, 'supabase', 'a2-browser-native-supervisor-v1', 'realtime-command-wake.mjs'), 'utf8');
  assert.match(source, /JOIN_REJECTED/);
  assert.match(source, /JOIN_SEND_FAILED/);
  assert.match(source, /finishWake\(reason\)/);
  assert.match(source, /transport_delivery_is_authority:\s*false/);
  assert.match(source, /authority_effect:\s*false/);
});

test('Realtime wake trigger is source-only, advisory, private and payload-minimal', () => {
  const wakeSqlPath = path.join(repoRoot, 'sql', 'browser_control_plane_realtime_wake_v1.sql');
  const sql = fs.readFileSync(wakeSqlPath, 'utf8');
  assert.match(sql, /realtime\.send\s*\(/i);
  assert.match(sql, /'COMMAND_AVAILABLE'/);
  assert.match(sql, /'metaengine-control:'/);
  assert.match(sql, /transport_delivery_is_authority[^\n]*false/i);
  assert.match(sql, /authority_effect[^\n]*false/i);
  assert.match(sql, /after insert/i);
  assert.match(sql, /when \(new\.status = 'PENDING'\)/i);
  assert.match(sql, /rollback;\s*$/i);
  assert.doesNotMatch(sql, /new\.payload/i, 'wake payload must not disclose command payload');
  assert.doesNotMatch(sql, /^\s*commit;\s*$/im);
  assert.equal(fs.existsSync(path.join(repoRoot, 'supabase', 'migrations', 'browser_control_plane_realtime_wake_v1.sql')), false);
});

test('fast-lane SQL stays source-only, rollback-only, and requires mutation post-condition readback', () => {
  const sqlPath = path.join(repoRoot, 'sql', 'browser_control_plane_fast_lane_v1.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  assert.match(sql, /h205f22_a2_browser_supervisor_lease_batch_v1/i);
  assert.match(sql, /h205f22_a2_browser_supervisor_complete_batch_v1/i);
  for (const action of ['PROCESS_CENSUS','PROCESS_EVENTS','SEMANTIC_CENSUS','SEMANTIC_EVENTS','CONTROL_LATENCY_STATUS','GATE_STATUS','TAB_CENSUS','FLEET_STATUS']) assert.match(sql, new RegExp(action));
  assert.match(sql, /command_lane\s*<>\s*'READ_ONLY'\s+and\s+v_ok\s+and\s+v_outcome\s*<>\s*'CONFIRMED'/i);
  assert.match(sql, /postcondition_readback_required/i);
  assert.match(sql, /transport_delivery_is_authority[^\n]*false/i);
  assert.match(sql, /automatic_retry_allowed[^\n]*false/i);
  assert.match(sql, /rollback;\s*$/i);
  assert.doesNotMatch(sql, /^\s*commit;\s*$/im);
  assert.doesNotMatch(sql, /grant\s+execute[^;]+\s+to\s+(public|anon|authenticated)\s*;/i);
  assert.equal(fs.existsSync(path.join(repoRoot, 'supabase', 'migrations', 'browser_control_plane_fast_lane_v1.sql')), false);
});

test('realtime process plane is observation-only and cannot become a second command scheduler', () => {
  const source = fs.readFileSync(path.join(appRoot, 'src', 'browser-realtime-process-plane.mjs'), 'utf8');
  assert.match(source, /getAppMetrics/);
  assert.match(source, /WEB_CONTENTS_CREATED/);
  assert.match(source, /CHILD_PROCESS_GONE/);
  assert.match(source, /RENDER_PROCESS_GONE/);
  assert.match(source, /persistent_cdp_sessions:\s*true/);
  assert.match(source, /cdp_attach_per_command:\s*false/);
  assert.match(source, /second_scheduler:\s*false/);
  assert.match(source, /command_leasing:\s*false/);
  assert.match(source, /control_authority:\s*false/);
  assert.doesNotMatch(source, /commands\/next|lease_batch|executeCommand/);
});

test('fast lane keeps bounded admission even under very large command bursts', async () => {
  const { NativeSupervisorCommandLaneScheduler } = await import('../src/native-supervisor-command-lanes.mjs');
  const scheduler = new NativeSupervisorCommandLaneScheduler({ readConcurrency: 128, mutationConcurrency: 32, maxBatch: 256 });
  const observationActions = ['PROCESS_CENSUS','PROCESS_EVENTS','SEMANTIC_CENSUS','SEMANTIC_EVENTS','CONTROL_LATENCY_STATUS'];
  const commands = Array.from({ length: 256 }, (_, index) => ({
    command_id: `read-${index}`,
    action: observationActions[index % observationActions.length],
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
