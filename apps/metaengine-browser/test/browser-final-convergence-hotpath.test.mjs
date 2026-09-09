import assert from 'node:assert/strict';
import test from 'node:test';

import { BrowserBrainContinuousCoordinator } from '../src/browser-brain-continuous-coordinator.mjs';
import { BrowserBrainObservationCursorLedger } from '../src/browser-brain-observation-cursors.mjs';
import { resumeObservationCursorCohorts } from '../src/browser-brain-observation-cursor-cohorts.mjs';
import {
  BrowserBrainFanoutPlanError,
  BrowserBrainParallelFanoutCoordinator,
} from '../src/browser-brain-parallel-fanout.mjs';

const TAB_ID = 'tab_00000000-0000-4000-8000-000000000901';
const digest = (char) => char.repeat(64);

function processSnapshot(sequence = 1) {
  return {
    schema: 'metaengine.browser.realtime-process-plane.v1',
    running: true,
    sequence,
    observed_at: `2026-09-09T20:00:0${sequence}.000Z`,
    event_driven_lifecycle: true,
    processes: [{ pid: 901, process_key: '901:9001', creation_time_ms: 9001, type: 'Tab' }],
    web_contents: [{ web_contents_id: 901, os_pid: 901, process_key: '901:9001', tab_id: TAB_ID, destroyed: false }],
    semantic_plane: {
      target_count: 1,
      targets: [{ tab_id: TAB_ID, target_id: 'target-901', document_generation: 1, semantic_revision: 1 }],
    },
    events: [],
  };
}

function command(commandId, tabId) {
  return {
    command_id: commandId,
    type: 'PROVIDER_NEUTRAL_ACTION',
    payload: { tab_id: tabId, provider: 'opaque-provider', action: { kind: 'opaque', value: commandId } },
  };
}

test('semantic hot path reuses pressure and coverage only when process evidence is reused', () => {
  const pressureSequences = [];
  const pressureBridge = {
    observe(snapshot) {
      pressureSequences.push(snapshot.sequence);
      return Object.freeze({ budget: Object.freeze({ pressure_band: 'NORMAL', read_concurrency: 8, mutation_concurrency: 4, resource_sample_ms: snapshot.sequence, live_cells: 1 }) });
    },
    snapshot() { return Object.freeze({ authority_effect: false }); },
  };
  const coordinator = new BrowserBrainContinuousCoordinator({ pressureBridge });
  coordinator.reconcile(processSnapshot(1));
  const before = coordinator.snapshot();

  const reused = coordinator.observeEdge({ type: 'SEMANTIC_EVENT', tab_id: TAB_ID, semantic_sequence: 2 });
  assert.equal(reused.pressure_evaluated, false);
  assert.equal(reused.coverage_evaluated, false);
  assert.deepEqual(pressureSequences, [1]);

  const refreshed = coordinator.observeEdge({ type: 'SEMANTIC_EVENT', tab_id: TAB_ID, semantic_sequence: 3 }, {
    process_snapshot: processSnapshot(2),
  });
  assert.equal(refreshed.pressure_evaluated, true);
  assert.equal(refreshed.coverage_evaluated, true);
  assert.equal(refreshed.pressure.budget.resource_sample_ms, 2);
  assert.deepEqual(pressureSequences, [1, 2]);
  const after = coordinator.snapshot();
  assert.equal(after.pressure_reuse_count, before.pressure_reuse_count + 1);
  assert.equal(after.coverage_reuse_count, before.coverage_reuse_count + 1);
  assert.equal(refreshed.scheduler_authority, false);
  assert.equal(refreshed.command_leasing, false);
  assert.equal(refreshed.authority_effect, false);
});

test('coverage counts live and exact-bound WebContents in one semantic result', () => {
  const snapshot = processSnapshot(3);
  snapshot.web_contents = [
    { web_contents_id: 1, tab_id: TAB_ID, destroyed: false },
    { web_contents_id: 2, tab_id: null, destroyed: false },
    { web_contents_id: 3, tab_id: 'tab_destroyed', destroyed: true },
    null,
  ];
  const result = new BrowserBrainContinuousCoordinator().reconcile(snapshot);
  assert.equal(result.coverage.web_contents_count, 4);
  assert.equal(result.coverage.live_web_contents_count, 2);
  assert.equal(result.coverage.exact_tab_bound_web_contents_count, 1);
  assert.equal(result.coverage.unbound_live_web_contents_count, 1);
});

test('observation cohorts expose direct changed-work and request-order indexes', () => {
  const ledger = new BrowserBrainObservationCursorLedger({ capacity: 8 });
  ledger.checkpointBatch([
    { consumer: 'browsercell-reader', epoch: 1, observation_digest: digest('a') },
    { consumer: 'process-reader', epoch: 1, observation_digest: digest('b') },
    { consumer: 'semantic-reader', epoch: 1, observation_digest: digest('c') },
  ]);
  const revision = ledger.snapshot().revision;
  ledger.checkpoint({ consumer: 'semantic-reader', epoch: 2, observation_digest: digest('d') });
  const current = ledger.snapshot().revision;

  const result = resumeObservationCursorCohorts(ledger, [current, revision - 1, current, revision]);
  assert.deepEqual(result.request_cohort_indexes, [2, 0, 2, 1]);
  assert.deepEqual(result.changed_cohort_indexes, [0, 1]);
  assert.deepEqual(result.changed_request_indexes, [1, 3]);
  assert.equal(result.changed_cohort_count, 2);
  assert.equal(result.changed_request_count, 2);
  assert.equal(result.authority_effect, false);
});

test('fanout starts all read-only preflight lanes before any effect and preserves result order', async () => {
  const started = [];
  const releases = new Map();
  const effects = [];
  const coordinator = new BrowserBrainParallelFanoutCoordinator({
    readMutationBudget: () => new Promise((resolve) => {
      started.push('budget');
      releases.set('budget', () => resolve(3));
    }),
    resolveCellKey: (entry) => new Promise((resolve) => {
      started.push(`cell:${entry.command_id}`);
      releases.set(entry.command_id, () => resolve(entry.payload.tab_id));
    }),
    execute: (_entry, context) => {
      effects.push(context.commandId);
      return `ok:${context.commandId}`;
    },
  });

  const pending = coordinator.dispatch([
    command('cmd-a', 'tab-a'),
    command('cmd-b', 'tab-b'),
    command('cmd-c', 'tab-c'),
  ]);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(new Set(started), new Set(['budget', 'cell:cmd-a', 'cell:cmd-b', 'cell:cmd-c']));
  assert.deepEqual(effects, []);
  releases.get('cmd-c')();
  releases.get('cmd-a')();
  releases.get('budget')();
  releases.get('cmd-b')();
  const result = await pending;
  assert.deepEqual(effects, ['cmd-a', 'cmd-b', 'cmd-c']);
  assert.deepEqual(result.map((entry) => entry.command_id), ['cmd-a', 'cmd-b', 'cmd-c']);
  assert.deepEqual(result.map((entry) => entry.status), ['fulfilled', 'fulfilled', 'fulfilled']);
});

test('fanout abort during unresolved preflight fails closed before any effect', async () => {
  const controller = new AbortController();
  const releases = [];
  let effects = 0;
  const pendingRead = (value) => new Promise((resolve) => releases.push(() => resolve(value)));
  const coordinator = new BrowserBrainParallelFanoutCoordinator({
    readMutationBudget: () => pendingRead(2),
    resolveCellKey: (entry) => pendingRead(entry.payload.tab_id),
    execute: () => { effects += 1; },
  });
  const dispatch = coordinator.dispatch([
    command('cmd-a', 'tab-a'),
    command('cmd-b', 'tab-b'),
  ], { signal: controller.signal });
  await Promise.resolve();
  await Promise.resolve();
  controller.abort();
  await assert.rejects(dispatch, (error) => error instanceof BrowserBrainFanoutPlanError && error.code === 'aborted');
  assert.equal(effects, 0);
  for (const release of releases) release();
  await Promise.resolve();
  assert.equal(effects, 0);
});

test('fanout synchronous executor failure is isolated without blind retry', async () => {
  const calls = [];
  const coordinator = new BrowserBrainParallelFanoutCoordinator({
    readMutationBudget: () => 3,
    execute: (_entry, context) => {
      calls.push(context.commandId);
      if (context.commandId === 'cmd-a') throw new Error('sync adapter failure');
      return `ok:${context.commandId}`;
    },
  });
  const result = await coordinator.dispatch([
    command('cmd-a', 'tab-a'),
    command('cmd-b', 'tab-b'),
    command('cmd-c', 'tab-c'),
  ]);
  assert.deepEqual(calls, ['cmd-a', 'cmd-b', 'cmd-c']);
  assert.deepEqual(result.map((entry) => entry.status), ['rejected', 'fulfilled', 'fulfilled']);
});
