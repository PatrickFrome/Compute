import assert from 'node:assert/strict';
import test from 'node:test';

import { BrowserBrainCollaborationRuntimeV2 } from '../src/browser-brain-collaboration-runtime-v2.mjs';

const SHA = '9'.repeat(40);

function completeTask(runtime, suffix) {
  runtime.recordTask({
    context_id: `ctx.restore-${suffix}`,
    task_id: `task.restore-${suffix}`,
    objective: `restore episode ${suffix}`,
    required_capabilities: ['memory'],
  });
  runtime.recordHandoff({
    handoff_id: `handoff.restore-${suffix}`,
    context_id: `ctx.restore-${suffix}`,
    task_id: `task.restore-${suffix}`,
    from_agent_id: 'agent_restore',
    objective: `complete ${suffix}`,
    verified_facts: [`verified fact ${suffix}`],
    next_actions: [`next action ${suffix}`],
    base_sha: SHA,
  });
  runtime.advanceTask({
    task_id: `task.restore-${suffix}`,
    progress_revision: 2,
    status: 'COMPLETED',
  });
}

test('restore replaces episodic state instead of retaining episodes newer than the checkpoint', () => {
  let now = 10_000;
  const runtime = new BrowserBrainCollaborationRuntimeV2({ clock: () => now++ });

  completeTask(runtime, 'a');
  const checkpointA = runtime.checkpoint();
  assert.equal(runtime.snapshot().episodic_memory.episode_count, 1);

  completeTask(runtime, 'b');
  assert.equal(runtime.snapshot().episodic_memory.episode_count, 2);
  assert.equal(runtime.retrieveMemory({ query: 'restore episode b', context_id: 'ctx.restore-b', base_sha: SHA }).results.length, 1);

  const restored = runtime.restore(checkpointA);
  assert.equal(restored.checkpoint_restored, true);
  assert.equal(restored.episodic_memory_rebuilt, true);
  assert.equal(runtime.snapshot().episodic_memory.episode_count, 1);
  assert.equal(runtime.retrieveMemory({ query: 'restore episode a', context_id: 'ctx.restore-a', base_sha: SHA }).results.length, 1);
  assert.equal(runtime.retrieveMemory({ query: 'restore episode b', context_id: 'ctx.restore-b', base_sha: SHA }).results.length, 0);
});
