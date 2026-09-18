
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { BrowserBrainWorkingMemory } from '../src/browser-brain-working-memory.mjs';
import { RsiShadowObserver } from '../src/rsi-shadow-observer.mjs';
import { createRsiSearchContext } from '../src/rsi-search-mode-router.mjs';
import { RsiRuntimeService } from '../src/rsi-runtime-service.mjs';

const SOURCE_SHA = 'a0af13c0640fffb4b6d5da1645220e32786b5ec0';
const TAB = 'tab_00000000-0000-4000-8000-000000000001';

function observation() {
  const memory = new BrowserBrainWorkingMemory({ maxEvents: 64, maxCells: 8, clock: () => 1_800_000_000_000 });
  memory.rememberBinding({
    valid: true,
    tab_id: TAB,
    binding_generation: 1,
    web_contents_id: 7,
    renderer_pid: 77,
    renderer_process_key: '77:1234',
    target_id: 'target-7',
    document_generation: 1,
    semantic_revision: 1,
  });
  memory.rememberCommandOutcome({
    command_id: 'cmd-ambiguous-runtime-controller-1',
    action: 'TYPE',
    tab_id: TAB,
    status: 'AMBIGUOUS',
    effect_outcome: 'AMBIGUOUS',
    recorded_at: '2027-01-15T08:01:00.000Z',
  });
  return new RsiShadowObserver({
    source_sha: SOURCE_SHA,
    clock: () => 1_800_000_001_000,
  }).observeBrainSnapshot(memory.snapshot());
}

function context() {
  return createRsiSearchContext({
    context_id: 'rsi-context-runtime-controller-1',
    mutation_surface: 'BROWSER_RUNTIME',
    problem_class: 'AMBIGUITY_RECONCILIATION',
    budget_class: 'NORMAL',
    skeleton_available: false,
    trace_history_available: true,
    lineage_candidate_count: 2,
    failure_class: 'TRANSPORT_AMBIGUITY',
    novelty_pressure: 0.4,
    external_context_owner: true,
    authored_by_candidate: false,
  });
}

function input() {
  const obs = observation();
  const opportunity = obs.opportunities.find((row) => row.signal === 'AMBIGUOUS_COMMAND_OUTCOMES');
  return {
    observation: obs,
    opportunity_id: opportunity.opportunity_id,
    search_context: context(),
    search_outcomes: [],
    cycle_generation: 1,
    max_candidates: 4,
    proposal_budget_units: 100,
    exploration_fraction: 0.2,
  };
}

test('runtime prepares two routed RSI candidate requests without becoming scheduler authority', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-autonomous-runtime-'));
  const ledgerPath = path.join(root, 'rsi.jsonl');
  try {
    const runtime = new RsiRuntimeService({ source_sha: SOURCE_SHA, ledgerPath });
    await runtime.start();
    const cycle = await runtime.prepareAutonomousEpisodeCycle(input());

    assert.equal(cycle.request_count, 2);
    assert.equal(cycle.newly_persisted_request_count, 2);
    assert.equal(cycle.existing_devos_scheduler_required, true);
    assert.equal(cycle.scheduler_action_authorized, false);
    assert.equal(cycle.task_created, false);
    assert.equal(cycle.lease_created, false);
    assert.equal(cycle.command_created, false);
    assert.equal(cycle.execution_authority, false);
    assert.equal(cycle.promotion_authority, false);
    assert.equal(cycle.self_update_authority, false);
    assert.ok(cycle.requests.every((row) => row.request.dispatch_authorized === false));
    assert.ok(cycle.requests.every((row) => row.request.task_created === false));
    assert.equal(runtime.snapshot().autonomous_prepared_request_count, 2);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('identical autonomous cycle is idempotent and does not append duplicate request intents', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-autonomous-idempotent-'));
  const ledgerPath = path.join(root, 'rsi.jsonl');
  try {
    const runtime = new RsiRuntimeService({ source_sha: SOURCE_SHA, ledgerPath });
    await runtime.start();
    const first = await runtime.prepareAutonomousEpisodeCycle(input());
    const firstCount = runtime.snapshot().ledger.event_count;
    const second = await runtime.prepareAutonomousEpisodeCycle(input());
    const secondCount = runtime.snapshot().ledger.event_count;

    assert.equal(first.newly_persisted_request_count, 2);
    assert.equal(second.newly_persisted_request_count, 0);
    assert.ok(second.requests.every((row) => row.already_prepared === true));
    assert.equal(secondCount, firstCount);
    assert.equal(second.episode.episode_id, first.episode.episode_id);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('restart replays durable episode and prepared-request fences before accepting the same cycle', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-autonomous-restart-'));
  const ledgerPath = path.join(root, 'rsi.jsonl');
  try {
    const first = new RsiRuntimeService({ source_sha: SOURCE_SHA, ledgerPath });
    await first.start();
    const firstCycle = await first.prepareAutonomousEpisodeCycle(input());
    assert.equal(firstCycle.newly_persisted_request_count, 2);

    const second = new RsiRuntimeService({ source_sha: SOURCE_SHA, ledgerPath });
    await second.start();
    const replayed = await second.prepareAutonomousEpisodeCycle(input());
    assert.equal(replayed.newly_persisted_request_count, 0);
    assert.ok(replayed.requests.every((row) => row.already_prepared === true));
    assert.equal(second.snapshot().autonomous_prepared_request_count, 2);
    assert.equal(replayed.episode.episode_id, firstCycle.episode.episode_id);
    assert.equal(replayed.automatic_retry_allowed, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
