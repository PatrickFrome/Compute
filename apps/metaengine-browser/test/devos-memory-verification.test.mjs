import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserRealtimeProcessPlane } from '../src/browser-realtime-process-plane.mjs';
import { BrowserBrainCollaborationRuntimeV2 } from '../src/browser-brain-collaboration-runtime-v2.mjs';
import { DevOsNativeTaskCycle } from '../src/devos-native-task-cycle-core.mjs';

const context = 'devos-fleet-task-results';
const lease = {
  task_id: '09f2e414-5c31-4fc7-87a3-f5de1315cb81',
  agent_id: 'agent_a2bf77e6-66d3-4f10-9c9c-683df36f4510', role: 'IMPLEMENTER',
  tab_id: 'tab_ff91dce7-eeb3-425d-9052-94d521c2dfa6', target_id: 'webcontents:10',
  agent_generation_epoch: 7, lease_generation: 1, base_sha: 'a'.repeat(40),
  branch_name: 'work/memory-verification', automatic_retry_allowed: false,
  task_spec: { schema: 'metaengine.devos.task.v1', objective: 'Implement independent memory verification' },
};
const response = body => ({ ok: true, status: 200, json: async () => body });
function harness() {
  const runtime = new BrowserBrainCollaborationRuntimeV2({});
  const plane = new BrowserRealtimeProcessPlane({
    app: { getAppMetrics: () => [], on() {}, removeAllListeners() {} }, getWebContents: () => [],
    brainCoordinator: {
      observeEdge() {}, snapshot: () => ({}), pressureBudget: () => ({}),
      recordCollaborationTask: task => runtime.recordTask(task),
      recordCollaborationArtifact: artifact => runtime.recordArtifact(artifact),
      advanceCollaborationTask: progress => runtime.advanceTask(progress),
      retrieveCollaborationMemory: query => runtime.retrieveMemory(query),
    },
  });
  return { runtime, plane };
}
const outcome = state => ({ task_id: lease.task_id, lease_generation: 1, state,
  task_objective: lease.task_spec.objective, owner_agent_id: lease.agent_id });

test('failed RESULT_READY completion then critic rejection never becomes successful memory', async () => {
  const { runtime, plane } = harness();
  let reject = false;
  let posts = 0;
  const cycle = new DevOsNativeTaskCycle({
    getState: async () => ({ fleet: { agents: [{ agent_id: lease.agent_id, role: lease.role,
      lifecycle_state: 'ACTIVE', tab_id: lease.tab_id, target_id: lease.target_id,
      generation_epoch: lease.agent_generation_epoch }] } }),
    executeCommand: async () => { throw Error('no browser effects expected'); },
    recordArtifact: artifact => plane.recordTaskArtifact(artifact),
    advanceTaskOutcome: observation => plane.advanceTaskOutcome(observation),
    signedRequest: async path => {
      if (path === '/v1/devos/complete') {
        posts++;
        if (!reject) throw Error('connection_lost_before_completion_receipt');
        return response({ task_id: lease.task_id, lease_generation: 1, state: 'BLOCKED' });
      }
      if (path.endsWith('/status')) return response({ task_id: lease.task_id, lease_generation: 1, state: 'RUNNING' });
      throw Error('unexpected route');
    },
  });
  await assert.rejects(cycle.completeFromTrustedCommand({ ...lease, state: 'RESULT_READY' }),
    /devos_completion_transport_ambiguous/);
  let task = runtime.taskLedger(context).tasks[0];
  assert.equal(task.status, 'BLOCKED');
  assert.equal(task.blocker, 'INDEPENDENT_COMPLETION_EVIDENCE_REQUIRED');
  assert.equal(runtime.snapshot().episodic_memory.episode_count, 0);
  reject = true;
  await cycle.completeFromTrustedCommand({ ...lease, state: 'BLOCKED',
    summary: { transport_state: 'VERIFIER_REJECTED', result_claim_disposition: 'REJECT' } });
  task = runtime.taskLedger(context).tasks[0];
  assert.equal(task.status, 'BLOCKED');
  assert.equal(task.blocker, 'VERIFIER_REJECTED');
  assert.equal(posts, 2, 'one explicit post per observation, no automatic effect retries');
  assert.equal(runtime.snapshot().episodic_memory.episode_count, 0);
  assert.deepEqual(plane.retrieveCollaborationMemory({ query: 'memory verification' }).results, []);
  // A delayed duplicate success cannot erase the same-generation rejection.
  assert.equal(plane.advanceTaskOutcome(outcome('RESULT_READY')).duplicate, true);
  assert.equal(runtime.taskLedger(context).tasks[0].blocker, 'VERIFIER_REJECTED');
});

test('bare COMPLETED and extra claimed verifier flags cannot mint acceptance evidence', () => {
  const { runtime, plane } = harness();
  const observed = plane.advanceTaskOutcome({ ...outcome('COMPLETED'), verified: true,
    independent_verifier_accepted: true });
  assert.equal(observed.verification_pending, true);
  assert.equal(observed.episode_materialized, false);
  assert.equal(runtime.snapshot().episodic_memory.episode_count, 0);
  assert.equal(runtime.taskLedger(context).tasks[0].status, 'BLOCKED');
});

test('legacy unverified DevOS episodes are retained for audit but excluded from retrieval', () => {
  const { runtime, plane } = harness();
  runtime.recordEpisode({ episode_id: 'episode:old-result-ready', context_id: context,
    task_id: lease.task_id, objective: 'memory verification old success claim', outcome: 'COMPLETED',
    verified_facts: ['the agent claimed success'] });
  runtime.recordEpisode({ episode_id: 'episode:other-history', context_id: 'team-history',
    task_id: 'history-task', objective: 'memory verification reference', outcome: 'COMPLETED' });
  const raw = runtime.retrieveMemory({ query: 'memory verification', max_results: 5 });
  assert.equal(raw.results.length, 2);
  const safe = plane.retrieveCollaborationMemory({ query: 'memory verification', max_results: 5 });
  assert.equal(safe.results.length, 1);
  assert.equal(safe.results[0].episode.context_id, 'team-history');
  assert.equal(safe.excluded_unverified_episode_count, 1);
  assert.equal(safe.estimated_tokens_used, safe.results[0].estimated_tokens);
  assert.equal(runtime.snapshot().episodic_memory.episode_count, 2, 'audit history remains intact');
});

test('recovery preserves pending outcome and cannot rehydrate it into a success episode', () => {
  const { runtime, plane } = harness();
  plane.advanceTaskOutcome(outcome('RESULT_READY'));
  plane.advanceTaskOutcome({ ...outcome('RESULT_READY'), lease_generation: 2 });
  assert.equal(runtime.taskLedger(context).tasks[0].progress_revision, 4);
  assert.equal(runtime.taskLedger(context).tasks[0].status, 'BLOCKED');
  assert.equal(runtime.snapshot().episodic_memory.episode_count, 0);
  const restored = new BrowserBrainCollaborationRuntimeV2({});
  restored.restore(runtime.checkpoint());
  assert.equal(restored.taskLedger(context).tasks[0].status, 'BLOCKED');
  assert.equal(restored.taskLedger(context).tasks[0].blocker, 'INDEPENDENT_COMPLETION_EVIDENCE_REQUIRED');
  assert.equal(restored.snapshot().episodic_memory.episode_count, 0);
  for (const generation of [0, -1, 1.1, Number.MAX_SAFE_INTEGER]) {
    assert.equal(plane.advanceTaskOutcome({ ...outcome('RESULT_READY'), lease_generation: generation }).reason,
      'LEASE_GENERATION_INVALID');
  }
});
