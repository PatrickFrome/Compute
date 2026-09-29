import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  normalizeClientGoalProgressReadback,
  normalizeClientGoalSubmissionReadback,
} from '../src/client-control-contract.mjs';

const sql = await readFile(
  new URL('../../../supabase/migrations/20260929211500_client_v1_goal_progress_reconciliation_v1.sql', import.meta.url),
  'utf8',
);
const routes = await readFile(
  new URL('../supabase/a2-browser-native-supervisor-v1/meta-routes.mjs', import.meta.url),
  'utf8',
);
const main = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
const preload = await readFile(new URL('../src/preload-shell.cjs', import.meta.url), 'utf8');
const me2 = await readFile(new URL('../../me2-ui/src/components/me2/shell/me2-shell.tsx', import.meta.url), 'utf8');

const requestId = '11111111-1111-4111-8111-111111111111';
const workspaceId = '2de9f84b-7c0a-4091-911c-894ff1d6eaf4';
const taskId = '98903ffd-dc3f-4a3e-ab09-55931c5100a9';
const pointId = 'obj.ship-useful-work.v1';
const goal = 'Ship useful work';

function submission() {
  return {
    schema: 'metaengine.meta-orchestrator.objective-activation.v1',
    request_id: requestId,
    request_replayed: false,
    exact_request_correlation: true,
    objective: goal,
    roadmap_id: 'metaengine-client-v1',
    plan_generation: 2,
    point_ids: [pointId],
    node_count: 1,
    task_ids: [taskId],
    task_admission_state: 'ADMITTED',
    atomic_plan_and_admission: true,
    activation: {
      schema: 'metaengine.meta-orchestrator.plan-state.v1',
      workspace_id: workspaceId,
      roadmap_id: 'metaengine-client-v1',
      plan_generation: 2,
      alignment_epoch: 3,
      baseline_sha: 'a'.repeat(40),
      plan_sha256: 'b'.repeat(64),
      state: 'ACTIVE',
      automatic_retry_allowed: false,
      scheduler_authority: false,
      browser_authority: false,
      release_authority: false,
      authority_effect: false,
    },
    admission: {
      schema: 'metaengine.meta-orchestrator.task-admission.v1',
      workspace_id: workspaceId,
      roadmap_id: 'metaengine-client-v1',
      plan_generation: 2,
      alignment_epoch: 3,
      task_spec_sha256: 'c'.repeat(64),
      point_id: pointId,
      task_id: taskId,
      task_content_authority: false,
      task_payload_returned: false,
      scheduler_identity_returned: false,
      automatic_retry_allowed: false,
      scheduler_authority: false,
      browser_authority: false,
      release_authority: false,
      authority_effect: false,
    },
    operator_initiated: true,
    automatic_retry_allowed: false,
    scheduler_authority: false,
    browser_authority: false,
    release_authority: false,
    authority_effect: false,
  };
}

function progress(overrides = {}) {
  return {
    schema: 'metaengine.client-v1.goal-progress.v1',
    found: true,
    request_id: requestId,
    workspace_id: workspaceId,
    roadmap_id: 'metaengine-client-v1',
    plan_generation: 2,
    alignment_epoch: 3,
    baseline_sha: 'a'.repeat(40),
    plan_sha256: 'b'.repeat(64),
    point_id: pointId,
    task_id: taskId,
    task_spec_sha256: 'c'.repeat(64),
    task_state: 'RUNNING',
    terminal: false,
    lease_generation: 1,
    result_checkpoint_id: null,
    result_summary_sha256: null,
    result_sha256: null,
    error_code: null,
    created_at: '2026-09-29T20:45:09Z',
    updated_at: '2026-09-29T20:50:00Z',
    finished_at: null,
    survives_plan_retirement: true,
    task_payload_returned: false,
    result_summary_returned: false,
    scheduler_identity_returned: false,
    automatic_retry_allowed: false,
    scheduler_authority: false,
    browser_authority: false,
    release_authority: false,
    authority_effect: false,
    ...overrides,
  };
}

test('submission readback binds caller request id to exact admitted goal', () => {
  const out = normalizeClientGoalSubmissionReadback(submission(), goal, requestId);
  assert.equal(out.request_id, requestId);
  assert.equal(out.task_id, taskId);
  assert.equal(out.exact_request_correlation, true);
  assert.equal(out.request_replayed, false);
  assert.equal(out.automatic_retry_allowed, false);

  assert.throws(
    () => normalizeClientGoalSubmissionReadback({ ...submission(), request_id: '22222222-2222-4222-8222-222222222222' }, goal, requestId),
    /client_goal_request_binding_invalid/,
  );
});

test('progress binds to exact receipt and keeps ADMITTED distinct from completion', () => {
  const receipt = normalizeClientGoalSubmissionReadback(submission(), goal, requestId);
  const out = normalizeClientGoalProgressReadback(progress(), requestId, receipt);
  assert.equal(out.task_state, 'RUNNING');
  assert.equal(out.terminal, false);
  assert.equal(out.task_payload_exposed, false);
  assert.equal(out.result_summary_exposed, false);
  assert.equal(out.scheduler_identity_exposed, false);

  const completed = normalizeClientGoalProgressReadback(progress({ task_state: 'COMPLETED', terminal: true }), requestId, receipt);
  assert.equal(completed.terminal, true);

  assert.throws(
    () => normalizeClientGoalProgressReadback(progress({ task_state: 'RUNNING', terminal: true }), requestId, receipt),
    /client_goal_progress_binding_invalid|client_goal_progress_terminal_invalid/,
  );
  assert.throws(
    () => normalizeClientGoalProgressReadback(progress({ task_id: '22222222-2222-4222-8222-222222222222' }), requestId, receipt),
    /client_goal_progress_receipt_drift/,
  );
});

test('server correlation is atomic, replay-safe and independent of ACTIVE plan state', () => {
  assert.match(sql, /client_v1_goal_request_h205f22/);
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\('client-v1-goal:' \|\| p_request_id::text/);
  assert.match(sql, /client_v1_goal_submit_v1\(/);
  assert.match(sql, /request_replayed',true/);
  assert.match(sql, /client_v1_goal_request_collision/);
  assert.match(sql, /client_v1_goal_progress_v1/);
  assert.match(sql, /where workspace_id = v_request\.workspace_id\s+and task_id = v_request\.task_id/i);
  assert.match(sql, /survives_plan_retirement',true/);
  assert.doesNotMatch(sql, /client_v1_goal_progress_v1[\s\S]*state\s*=\s*'ACTIVE'/i);
});

test('progress membrane never exposes task/result content or scheduler-owned identity', () => {
  assert.match(sql, /'task_payload_returned',false/);
  assert.match(sql, /'result_summary_returned',false/);
  assert.match(sql, /'scheduler_identity_returned',false/);
  const progressFn = sql.slice(sql.indexOf('create or replace function public.client_v1_goal_progress_v1'));
  for (const forbidden of [
    /'result_summary'\s*,\s*v_task\.result_summary/i,
    /'lease_agent_id'/i,
    /'lease_tab_id'/i,
    /'lease_target_id'/i,
  ]) assert.doesNotMatch(progressFn, forbidden);
});

test('typed Edge routes support request-correlated submit and read-only progress only', () => {
  assert.match(routes, /path==='\/v1\/meta\/client-goal-submit'/);
  assert.match(routes, /client_v1_goal_submit_v2/);
  assert.match(routes, /path==='\/v1\/meta\/client-goal-progress'/);
  assert.match(routes, /client_v1_goal_progress_v1/);
  assert.match(routes, /client_goal_progress_drift/);
  assert.doesNotMatch(routes, /client-goal-progress[\s\S]{0,2000}devos_fleet_lease_v1/);
});

test('Browser persists correlation before effect and uses read-only reconciliation after ambiguity/restart', () => {
  const begin = main.indexOf('await journal.begin({ request_id: requestId, goal: intent.goal })');
  const effect = main.indexOf('nativeSupervisor.clientGoalSubmit({ request_id: requestId, objective: intent.goal })');
  assert.ok(begin >= 0 && effect > begin);
  assert.match(main, /await journal\.markReconcileRequired\(requestId, error\)/);
  assert.match(main, /await reconcileClientGoal\(requestId\)/);
  assert.match(main, /latestClientGoal/);
  const submitBlock = main.slice(main.indexOf('async function submitClientGoal'), main.indexOf('function selectClientAgent'));
  assert.equal([...submitBlock.matchAll(/nativeSupervisor\.clientGoalSubmit\s*\(/g)].length, 1);

  assert.match(preload, /latestGoal: latestClientGoal/);
  assert.match(preload, /goalStatus: clientGoalStatus/);
  assert.match(me2, /ADMITTED ≠ completed/);
  assert.match(me2, /data-testid="client-goal-refresh"/);
});
