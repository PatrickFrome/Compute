import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BrowserBrainCollaborationRuntimeV2,
  BROWSER_BRAIN_COLLABORATION_WORKBENCH_SCHEMA,
} from '../src/browser-brain-collaboration-runtime-v2.mjs';

test('collaboration runtime exposes bounded task-first workbench metadata without authority', () => {
  let now = Date.parse('2026-09-07T00:00:00.000Z');
  const runtime = new BrowserBrainCollaborationRuntimeV2({ clock: () => now });

  runtime.recordTask({ context_id: 'ctx.alpha', task_id: 'task.ready', objective: 'Prepare evidence', required_capabilities: ['research'] });
  now += 1000;
  runtime.recordTask({ context_id: 'ctx.alpha', task_id: 'task.active', objective: 'Implement projection', owner_agent_id: 'agent.impl' });
  runtime.advanceTask({ task_id: 'task.active', progress_revision: 2, status: 'ACTIVE', owner_agent_id: 'agent.impl' });
  now += 1000;
  runtime.recordTask({ context_id: 'ctx.alpha', task_id: 'task.blocked', objective: 'Validate physical UI' });
  runtime.advanceTask({ task_id: 'task.blocked', progress_revision: 2, status: 'BLOCKED', blocker: 'Windows evidence pending' });
  now += 1000;
  runtime.recordTask({ context_id: 'ctx.beta', task_id: 'task.beta', objective: 'Independent verification' });

  const projection = runtime.workbenchProjection({ max_contexts: 1, max_tasks_per_context: 2 });
  assert.equal(projection.schema, BROWSER_BRAIN_COLLABORATION_WORKBENCH_SCHEMA);
  assert.equal(projection.context_count, 2);
  assert.equal(projection.visible_context_count, 1);
  assert.equal(projection.contexts_truncated, true);
  assert.equal(projection.bounded, true);
  assert.equal(projection.message_bodies_exposed, false);
  assert.equal(projection.raw_page_content_exposed, false);
  assert.equal(projection.projection_is_authority, false);
  assert.equal(projection.scheduler_authority, false);
  assert.equal(projection.execution_authority, false);
  assert.equal(projection.command_leasing, false);
  assert.equal(projection.work_cycle_limit, null);
  assert.equal(projection.authority_effect, false);

  const beta = projection.contexts[0];
  assert.equal(beta.context_id, 'ctx.beta');
  assert.equal(beta.tasks.length, 1);
  assert.equal(beta.tasks[0].task_id, 'task.beta');
  assert.equal(beta.tasks[0].scheduler_authority, false);
  assert.equal(beta.tasks[0].execution_authority, false);

  const alphaOnly = runtime.workbenchProjection({ max_contexts: 2, max_tasks_per_context: 2 }).contexts.find((row) => row.context_id === 'ctx.alpha');
  assert.ok(alphaOnly);
  assert.equal(alphaOnly.task_count, 3);
  assert.equal(alphaOnly.tasks_truncated, true);
  assert.deepEqual(alphaOnly.tasks.map((row) => row.status), ['ACTIVE', 'BLOCKED']);
  assert.equal(alphaOnly.progress.active, 1);
  assert.equal(alphaOnly.progress.blocked, 1);
  assert.equal(alphaOnly.blockers[0].blocker, 'Windows evidence pending');
});

test('collaboration snapshot carries the same bounded workbench projection for shell readback', () => {
  const runtime = new BrowserBrainCollaborationRuntimeV2({ clock: () => Date.parse('2026-09-07T00:00:00.000Z') });
  runtime.recordTask({ context_id: 'ctx.shell', task_id: 'task.shell', objective: 'Expose current work to the shell' });
  const snapshot = runtime.snapshot();
  assert.equal(snapshot.workbench.schema, BROWSER_BRAIN_COLLABORATION_WORKBENCH_SCHEMA);
  assert.equal(snapshot.workbench.contexts[0].tasks[0].objective, 'Expose current work to the shell');
  assert.equal(snapshot.workbench.advisory_only, true);
  assert.equal(snapshot.workbench.authority_effect, false);
});
