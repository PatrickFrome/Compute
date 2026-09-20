import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import { BrowserBrainCollaborationFabric } from '../src/browser-brain-collaboration-fabric.mjs';
import { BrowserRealtimeProcessPlane } from '../src/browser-realtime-process-plane.mjs';

const coreSource = await fs.readFile(new URL('../src/devos-native-task-cycle-core.mjs', import.meta.url), 'utf8');
const wrapperSource = await fs.readFile(new URL('../src/devos-native-task-cycle.mjs', import.meta.url), 'utf8');
const clientSource = await fs.readFile(new URL('../src/native-supervisor-client.mjs', import.meta.url), 'utf8');

const TASK_ID = '550e8400-e29b-41d4-a716-446655440000';
const CONVERSATION_SHA = 'a'.repeat(64);

function stubApp() {
  const handlers = new Map();
  return {
    getAppMetrics: () => ({ metrics: [], pid: 1 }),
    on: (name, fn) => { handlers.set(name, fn); },
    once: () => {},
    removeListener: () => {},
  };
}

test('realtime plane records a DevOS task-result artifact into the collaboration fabric', () => {
  const fabric = new BrowserBrainCollaborationFabric();
  const brain = {
    observeEdge: () => null,
    snapshot: () => ({}),
    pressureBudget: () => ({}),
    recordCollaborationTask: (task) => fabric.recordTask(task),
    recordCollaborationArtifact: (artifact) => fabric.recordArtifact(artifact),
  };
  const plane = new BrowserRealtimeProcessPlane({
    app: stubApp(),
    getWebContents: () => [],
    brainCoordinator: brain,
  });
  const contentDigest = `sha256:${'b'.repeat(64)}`;
  const first = plane.recordTaskArtifact({
    artifact_id: `devos.task-result.${TASK_ID}.1`,
    context_id: 'devos-fleet-task-results',
    task_id: TASK_ID,
    kind: 'task-result-result_ready',
    content_digest: contentDigest,
    refs: [`devos_task:${TASK_ID}`, `conversation:${CONVERSATION_SHA}`],
    base_sha: 'c'.repeat(40),
    branch: null,
    task_objective: 'verify the toolbelt',
    owner_agent_id: 'agent_fleetabcd',
  });
  assert.equal(first.recorded, true);
  assert.equal(first.duplicate, false);
  const snapshot = fabric.snapshot();
  assert.equal(snapshot.artifact_count, 1);
  assert.equal(snapshot.task_count, 1);
  assert.equal(snapshot.immutable_artifact_refs, true);
  const ledger = fabric.taskLedger('devos-fleet-task-results');
  assert.equal(ledger.tasks.length, 1);
  assert.equal(ledger.tasks[0].task_id, TASK_ID);
  assert.equal(ledger.tasks[0].owner_agent_id, 'agent_fleetabcd');
  assert.deepEqual(ledger.artifact_refs, [`devos.task-result.${TASK_ID}.1`]);
  assert.equal(ledger.authority_effect, false);

  // Idempotent duplicate (retry / ambiguous-write reconciliation).
  const again = plane.recordTaskArtifact({
    artifact_id: `devos.task-result.${TASK_ID}.1`,
    context_id: 'devos-fleet-task-results',
    task_id: TASK_ID,
    kind: 'task-result-result_ready',
    content_digest: contentDigest,
    refs: [`devos_task:${TASK_ID}`, `conversation:${CONVERSATION_SHA}`],
    base_sha: 'c'.repeat(40),
    branch: null,
    task_objective: 'verify the toolbelt',
    owner_agent_id: 'agent_fleetabcd',
  });
  assert.equal(again.recorded, true);
  assert.equal(again.duplicate, true);
  assert.equal(fabric.snapshot().artifact_count, 1);

  // Immutable conflict is surfaced, never thrown.
  const conflict = plane.recordTaskArtifact({
    artifact_id: `devos.task-result.${TASK_ID}.1`,
    context_id: 'devos-fleet-task-results',
    task_id: TASK_ID,
    kind: 'task-result-result_ready',
    content_digest: `sha256:${'d'.repeat(64)}`,
    refs: [`devos_task:${TASK_ID}`],
    base_sha: null,
    branch: null,
  });
  assert.equal(conflict.recorded, false);
  assert.match(conflict.reason, /immutable_conflict/);
  assert.equal(fabric.snapshot().artifact_count, 1);
});

test('plane degrades gracefully when the coordinator rejects or throws', () => {
  const throwing = new BrowserRealtimeProcessPlane({
    app: stubApp(),
    getWebContents: () => [],
    brainCoordinator: {
      observeEdge: () => null,
      snapshot: () => ({}),
      pressureBudget: () => ({}),
      recordCollaborationArtifact: () => { throw new Error('coordinator_down'); },
    },
  });
  const thrown = throwing.recordTaskArtifact({ artifact_id: 'a'.repeat(40), context_id: 'ctx', kind: 'k', content_digest: `sha256:${'e'.repeat(64)}` });
  assert.equal(thrown.recorded, false);
  assert.equal(thrown.reason, 'coordinator_down');

  // Validation failures surface as reasons too — never thrown to the cycle.
  const plane = new BrowserRealtimeProcessPlane({ app: stubApp(), getWebContents: () => [] });
  const invalid = plane.recordTaskArtifact({ artifact_id: 'x'.repeat(40), kind: 'k', content_digest: `sha256:${'e'.repeat(64)}` });
  assert.equal(invalid.recorded, false);
  assert.match(invalid.reason, /context_invalid/);
});

test('devos cycle records one artifact per terminal completion through the late-bound recorder', () => {
  // Wiring contract: the completion funnel records before the completion
  // write (artifact exists even on ambiguous writes), the recorder is
  // late-bound (plane constructed after the cycle), and the chain
  // client -> wrapper -> core forwards correctly.
  assert.match(coreSource, /this\.#recordTaskOutcomeArtifact\(lease, state, summary\);/);
  const funnelStart = coreSource.indexOf('async #postCompletionWithReadback(lease, state, summary, error = null)');
  const recordCall = coreSource.indexOf('this.#recordTaskOutcomeArtifact(lease, state, summary);', funnelStart);
  const completeCall = coreSource.indexOf("await this.#signedRequest('/v1/devos/complete'", funnelStart);
  assert.ok(funnelStart >= 0 && recordCall > funnelStart && completeCall > recordCall, 'artifact must be recorded before the completion write');
  // Deterministic artifact id per (task, lease_generation) -> idempotent.
  assert.match(coreSource, /artifact_id: `devos\.task-result\.\$\{taskId\}\.\$\{Number\(lease\.lease_generation\)\}`/);
  assert.match(coreSource, /context_id: 'devos-fleet-task-results'/);
  assert.match(coreSource, /kind: `task-result-\$\{normalizedState\.toLowerCase\(\)\}`/);
  // Never gates completion.
  assert.match(coreSource, /\/\/ Artifact recording must never gate task completion\./);
  // Late-bound chain.
  assert.match(coreSource, /bindArtifactRecorder\(fn\)/);
  assert.match(wrapperSource, /bindArtifactRecorder\(fn\) \{\s*\n\s*if \(typeof this\.#inner\?\.bindArtifactRecorder === 'function'\) this\.#inner\.bindArtifactRecorder\(fn\);/);
  assert.match(clientSource, /this\.bindDevosArtifactRecorder\(\(artifact\) => plane\.recordTaskArtifact\(artifact\)\);/);
});
