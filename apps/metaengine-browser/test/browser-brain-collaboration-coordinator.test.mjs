import assert from 'node:assert/strict';
import test from 'node:test';

import { BrowserBrainContinuousCoordinator } from '../src/browser-brain-continuous-coordinator.mjs';

test('continuous coordinator exposes collaboration ledgers and an unbounded autonomous next-action loop', () => {
  const coordinator = new BrowserBrainContinuousCoordinator({ clock: () => 4_000_000 });

  coordinator.recordCollaborationTask({
    context_id: 'ctx.autonomous-coordination',
    task_id: 'task.research-memory',
    objective: 'research and implement the next memory improvement',
    required_capabilities: ['research', 'memory'],
  });

  const decision = coordinator.autonomousContinuation({
    context_id: 'ctx.autonomous-coordination',
    agent_id: 'agent_research_01',
  });
  assert.equal(decision.action, 'CLAIM_READY_TASK');
  assert.equal(decision.continue_autonomously, true);
  assert.equal(decision.user_confirmation_required, false);
  assert.equal(decision.external_prompt_required, false);
  assert.equal(decision.idle_wait_allowed, false);
  assert.equal(decision.work_cycle_limit, null);

  const snapshot = coordinator.snapshot();
  assert.equal(snapshot.continuous_autonomous_work, true);
  assert.equal(snapshot.external_confirmation_gate, false);
  assert.equal(snapshot.external_prompt_required_for_continuation, false);
  assert.equal(snapshot.idle_wait_allowed, false);
  assert.equal(snapshot.work_cycle_limit, null);
  assert.equal(snapshot.collaboration_fabric.task_count, 1);
  assert.equal(snapshot.second_scheduler, false);
  assert.equal(snapshot.hidden_queue, false);
  assert.equal(snapshot.command_leasing, false);
  assert.equal(snapshot.execution_authority, false);
});
