import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FleetRuntimeStore } from '../src/fleet-runtime-store-v1.mjs';
import { FleetRuntime } from '../src/fleet-runtime-v1.mjs';
import { SupervisorKeepalive } from '../src/supervisor-keepalive-v1.mjs';
import { NativeSupervisorKeepaliveTransport } from '../src/supervisor-keepalive-transport-v1.mjs';

async function harness({ outcome = 'CONFIRMED', watchdogMs = 60000 } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-c5-keepalive-'));
  let now = Date.parse('2026-08-29T16:00:00Z');
  let seq = 0;
  const clock = () => now;
  const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
  const statePath = path.join(dir, 'state.json');
  const store = new FleetRuntimeStore({ statePath, clock });
  const runtime = new FleetRuntime({ store, clock, uuid });
  await runtime.init();
  const sends = [];
  let transportOutcome = outcome;
  let ready = true;
  const transport = {
    configured: true,
    setOutcome(value) { transportOutcome = value; },
    setReady(value) { ready = value; },
    async proveIdleComposerReady(binding) {
      return {
        ok: ready,
        idle: ready,
        composer_ready: ready,
        unique_composer: ready,
        unique_send_control: ready,
        exact_conversation: ready,
        target_incarnation: binding.target_incarnation,
        authority: 'TRUSTED_NATIVE_SEMANTIC_PROBE',
      };
    },
    async semanticSend(input) {
      sends.push(input);
      return { outcome: transportOutcome, proof: transportOutcome === 'CONFIRMED' ? 'TEST_ACK' : null };
    },
  };
  const keepalive = new SupervisorKeepalive({
    store,
    runtime,
    transport,
    clock,
    intervalMs: 500,
    cooldownMs: 5000,
    watchdogMs,
  });
  await keepalive.init();
  await keepalive.bindSupervisor({
    supervisor_id: 'METAENGINE_SUPERVISOR',
    supervisor_epoch: 1,
    conversation_id: '01234567-89ab-cdef-0123-456789abcdef',
    conversation_url: 'https://chatgpt.com/c/01234567-89ab-cdef-0123-456789abcdef',
  });
  await keepalive.bindTargetIncarnation({ tab_id: 'supervisor-tab', target_incarnation: 'webcontents:99' });
  await keepalive.resume();
  return {
    dir, statePath, clock, uuid, store, runtime, keepalive, transport, sends,
    advance(ms) { now += ms; },
  };
}

test('keepalive wakes only for authorized durable work and deduplicates duplicate cause', async (t) => {
  const h = await harness();
  t.after(() => fs.rm(h.dir, { recursive: true, force: true }));
  assert.deepEqual(await h.keepalive.tick(), { woke: false, reason: 'NO_AUTHORIZED_WAKE' });

  await h.runtime.authorizeWake({
    cycle_id: 'cycle-settled-1',
    reason: 'WORKER_RESULT_READY',
    cause_id: 'receipt-1',
    authority: 'TRUSTED_CONTROL_PLANE',
  });
  const first = await h.keepalive.tick();
  assert.equal(first.woke, true);
  assert.equal(h.sends.length, 1);
  assert.match(h.sends[0].message, /^METAENGINE_SUPERVISOR_WAKE_V1 cycle_id=cycle-settled-1 wake_id=wake_[a-f0-9]{24} reason=WORKER_RESULT_READY\./);
  assert.match(h.sends[0].message, /Re-read authoritative GitHub\/Supabase\/native-browser state/);
  assert.doesNotMatch(h.sends[0].message, /receipt-1/);

  h.advance(6000);
  await h.keepalive.tick();
  await h.runtime.authorizeWake({
    cycle_id: 'cycle-settled-1',
    reason: 'WORKER_RESULT_READY',
    cause_id: 'receipt-1',
    authority: 'TRUSTED_CONTROL_PLANE',
  });
  const duplicate = await h.keepalive.tick();
  assert.equal(duplicate.woke, false);
  assert.equal(h.sends.length, 1);
});

test('WAKE_AMBIGUOUS is sticky and has no blind retry or resume bypass', async (t) => {
  const h = await harness({ outcome: 'AMBIGUOUS' });
  t.after(() => fs.rm(h.dir, { recursive: true, force: true }));
  await h.runtime.authorizeWake({
    cycle_id: 'cycle-ambiguous-1',
    reason: 'WORKER_FAILED',
    cause_id: 'failed-1',
    authority: 'TRUSTED_CONTROL_PLANE',
  });
  const first = await h.keepalive.tick();
  assert.equal(first.state, 'WAKE_AMBIGUOUS');
  assert.equal(first.retry_allowed, false);
  assert.equal(h.sends.length, 1);

  const second = await h.keepalive.tick();
  assert.equal(second.blocked, 'WAKE_AMBIGUOUS');
  assert.equal(h.sends.length, 1);
  await assert.rejects(() => h.keepalive.resume(), /reconciliation_required/);
});

test('PAUSE and OFF are durable local emergency stops', async (t) => {
  const h = await harness();
  t.after(() => fs.rm(h.dir, { recursive: true, force: true }));
  await h.runtime.authorizeWake({
    cycle_id: 'cycle-pause-1',
    reason: 'WORKER_LOST',
    cause_id: 'lost-1',
    authority: 'TRUSTED_CONTROL_PLANE',
  });
  await h.keepalive.pause();
  assert.equal((await h.keepalive.tick()).suppressed, 'PAUSE');
  assert.equal(h.sends.length, 0);
  await h.keepalive.off();
  assert.equal((await h.keepalive.tick()).suppressed, 'OFF');
  assert.equal(h.keepalive.status().emergency_state, 'OFF');
});

test('watchdog is coarse and only wakes after durable deadline', async (t) => {
  const h = await harness({ watchdogMs: 60000 });
  t.after(() => fs.rm(h.dir, { recursive: true, force: true }));
  h.advance(59000);
  assert.equal((await h.keepalive.tick()).woke, false);
  h.advance(2000);
  const result = await h.keepalive.tick();
  assert.equal(result.woke, true);
  assert.equal(result.reason, 'WATCHDOG_DEADLINE');
  assert.equal(h.sends.length, 1);
});

test('settled worker result receipt produces exactly one supervisor wake', async (t) => {
  const h = await harness();
  t.after(() => fs.rm(h.dir, { recursive: true, force: true }));
  const binding = await h.runtime.bindWorkerIncarnation({
    agent_id: 'agent_result01',
    role: 'SYNTHESIZER',
    lifecycle_state: 'BOUND_UNVERIFIED',
    tab_id: 'tab-result',
    target_id: 'webcontents:77',
    generation_epoch: 1,
    conversation_epoch: 0,
  });
  await h.runtime.createAssignment({
    assignment_id: 'assignment-result-1',
    attempt_id: 'attempt-result-1',
    worker_id: 'agent_result01',
    cycle_id: 'cycle-result-1',
    authority_refs: [{ system: 'GITHUB', ref: 'checkpoint:c5-result' }],
  });
  await h.runtime.recordReadinessProof({
    assignment_id: 'assignment-result-1',
    attempt_id: 'attempt-result-1',
    worker_incarnation_id: binding.worker_incarnation_id,
    proof_id: 'proof-result-1',
    authority: 'TRUSTED_NATIVE_CONTROL_PLANE',
    source_taint: 'TRUSTED_CONTROL_PLANE',
    transport_kind: 'SUPERVISOR_MEDIATED_ROUNDTRIP',
    transport_session_id: 'transport-result-1',
    ready: true,
  });
  await h.runtime.startAssignment({ assignment_id: 'assignment-result-1', attempt_id: 'attempt-result-1' });
  await h.runtime.recordResultReceipt({
    assignment_id: 'assignment-result-1',
    attempt_id: 'attempt-result-1',
    worker_incarnation_id: binding.worker_incarnation_id,
    receipt_id: 'receipt-result-1',
    result_status: 'SUCCEEDED',
    effect_outcome: 'CONFIRMED_EFFECT',
    evidence_refs: [{ kind: 'TRACE', ref: 'artifact:opaque-result', sha256: 'b'.repeat(64) }],
  });

  const first = await h.keepalive.tick();
  assert.equal(first.woke, true);
  assert.equal(first.reason, 'WORKER_RESULT_READY');
  assert.equal(h.sends.length, 1);
  assert.doesNotMatch(h.sends[0].message, /opaque-result|artifact|TRACE/);

  h.advance(6000);
  await h.keepalive.tick();
  assert.equal(h.sends.length, 1);
  assert.equal(h.runtime.snapshot().wake_events[0].status, 'SENT');
});

test('durable binding and emergency PAUSE/OFF survive runtime restart', async (t) => {
  const h = await harness();
  t.after(() => fs.rm(h.dir, { recursive: true, force: true }));
  await h.keepalive.pause();

  const pausedStore = new FleetRuntimeStore({ statePath: h.statePath, clock: h.clock });
  const pausedRuntime = new FleetRuntime({ store: pausedStore, clock: h.clock, uuid: h.uuid });
  await pausedRuntime.init();
  const pausedTransport = {
    configured: false,
    async proveIdleComposerReady() { return { ok: false }; },
    async semanticSend() { throw new Error('must_not_send'); },
  };
  const pausedKeepalive = new SupervisorKeepalive({ store: pausedStore, runtime: pausedRuntime, transport: pausedTransport, clock: h.clock });
  await pausedKeepalive.init();
  assert.equal(pausedKeepalive.status().emergency_state, 'PAUSE');
  assert.equal(pausedKeepalive.status().binding.conversation_id, '01234567-89ab-cdef-0123-456789abcdef');

  await pausedKeepalive.off();
  const offStore = new FleetRuntimeStore({ statePath: h.statePath, clock: h.clock });
  const offRuntime = new FleetRuntime({ store: offStore, clock: h.clock, uuid: h.uuid });
  await offRuntime.init();
  const offKeepalive = new SupervisorKeepalive({ store: offStore, runtime: offRuntime, transport: pausedTransport, clock: h.clock });
  await offKeepalive.init();
  assert.equal(offKeepalive.status().emergency_state, 'OFF');
  assert.equal(offKeepalive.status().keepalive_state, 'OFF');
  assert.equal(offKeepalive.status().binding.conversation_url, 'https://chatgpt.com/c/01234567-89ab-cdef-0123-456789abcdef');
});

test('native transport uses semantic type/click only and classifies unproven send readback as ambiguous', async () => {
  const commands = [];
  let frames = 0;
  const fakeWebContents = {};
  const transport = new NativeSupervisorKeepaliveTransport({
    resolveBoundView: async () => ({
      tab: { tab_id: 'supervisor-tab' },
      view: { webContents: fakeWebContents },
      target_incarnation: 'webcontents:99',
    }),
    captureSemanticFrame: async () => {
      frames += 1;
      return {
        url: 'https://chatgpt.com/c/01234567-89ab-cdef-0123-456789abcdef',
        semantic_targets: [
          { role: 'textbox', name: 'Prompt' },
          { role: 'button', name: 'Send prompt' },
        ],
        text_excerpt: '',
      };
    },
    executeSemanticCommand: async (_wc, command) => { commands.push(command); return { ok: true }; },
    composerName: 'Prompt',
    sendName: 'Send prompt',
    readbackDelaysMs: [0],
  });
  const binding = {
    conversation_url: 'https://chatgpt.com/c/01234567-89ab-cdef-0123-456789abcdef',
    target_incarnation: 'webcontents:99',
  };
  const proof = await transport.proveIdleComposerReady(binding);
  assert.equal(proof.ok, true);
  const result = await transport.semanticSend({
    binding,
    message: 'METAENGINE_SUPERVISOR_WAKE_V1 cycle_id=c wake_id=w reason=WORKER_RESULT_READY.',
    wake_id: 'w',
    cycle_id: 'c',
    reason: 'WORKER_RESULT_READY',
  });
  assert.equal(result.outcome, 'AMBIGUOUS');
  assert.deepEqual(commands.map((row) => row.action), ['SEMANTIC_TYPE','TYPED_CLICK']);
  assert.ok(frames >= 2);
  assert.equal('evaluateJavaScript' in fakeWebContents, false);
});
