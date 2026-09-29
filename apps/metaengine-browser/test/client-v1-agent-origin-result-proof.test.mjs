import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  CLIENT_GOAL_EXECUTION_PROOF_SCHEMA,
  normalizeClientGoalExecutionProofReadback,
  normalizeClientGoalProgressReadback,
} from '../src/client-control-contract.mjs';
import { createMetaSupervisorRoutes } from '../supabase/a2-browser-native-supervisor-v1/meta-routes.mjs';

const sql = await readFile(
  new URL('../../../supabase/migrations/20260929224500_client_v1_agent_origin_result_proof_v1.sql', import.meta.url),
  'utf8',
);
const main = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
const native = await readFile(new URL('../src/native-supervisor-client-base.mjs', import.meta.url), 'utf8');
const me2 = await readFile(new URL('../../me2-ui/src/components/me2/shell/me2-shell.tsx', import.meta.url), 'utf8');

const workspaceId = '2de9f84b-7c0a-4091-911c-894ff1d6eaf4';
const requestId = '11111111-1111-4111-8111-111111111111';
const taskId = '98903ffd-dc3f-4a3e-ab09-55931c5100a9';
const pointId = 'obj.ship-useful-work.v1';
const conversation = 'a'.repeat(64);

const receipt = Object.freeze({
  request_id: requestId,
  workspace_id: workspaceId,
  roadmap_id: 'metaengine-client-v1',
  plan_generation: 4,
  alignment_epoch: 3,
  baseline_sha: 'b'.repeat(40),
  plan_sha256: 'c'.repeat(64),
  point_ids: [pointId],
  task_id: taskId,
  task_spec_sha256: 'd'.repeat(64),
});

function proof(overrides = {}) {
  return {
    schema: 'metaengine.client-v1.goal-execution-proof.v1',
    found: true,
    request_id: requestId,
    workspace_id: workspaceId,
    roadmap_id: 'metaengine-client-v1',
    plan_generation: 4,
    alignment_epoch: 3,
    baseline_sha: 'b'.repeat(40),
    plan_sha256: 'c'.repeat(64),
    point_id: pointId,
    task_id: taskId,
    task_spec_sha256: 'd'.repeat(64),
    task_state: 'RESULT_READY',
    terminal: false,
    lease_generation: 2,
    survives_plan_retirement: true,
    agent_origin_proof: {
      proven: true,
      contract: 'ZAI_AGENT_SURFACE_CAUSAL_V1',
      conversation_url_sha256: conversation,
      agent_surface_sha256: 'e'.repeat(64),
      prompt_sha256: 'f'.repeat(64),
      effect_state: 'PROVEN_GENERATING',
      lease_generation: 2,
      proven_at: '2026-09-30T00:00:00Z',
      agent_identity_returned: false,
      tab_identity_returned: false,
      target_identity_returned: false,
      authority_effect: false,
    },
    result_proof: {
      available: true,
      result_summary_sha256: '1'.repeat(64),
      result_sha256: '1'.repeat(64),
      claim_valid: true,
      claim_schema: 'metaengine.agent-result-claim.v1',
      claim_sha256: '2'.repeat(64),
      claim_disposition: 'READY',
      conversation_url_sha256: conversation,
      origin_bound: true,
      accepted: true,
      result_summary_returned: false,
      model_output_returned: false,
      page_content_returned: false,
      authority_effect: false,
    },
    user_goal_to_agent_readback: true,
    user_goal_to_result_readback: true,
    task_payload_returned: false,
    result_summary_returned: false,
    page_content_returned: false,
    model_output_returned: false,
    scheduler_identity_returned: false,
    automatic_retry_allowed: false,
    scheduler_authority: false,
    browser_authority: false,
    release_authority: false,
    authority_effect: false,
    ...overrides,
  };
}

test('Client execution proof binds exact request to Agent-origin and typed result digests only', () => {
  const out = normalizeClientGoalExecutionProofReadback(proof(), requestId, receipt);
  assert.equal(out.schema, CLIENT_GOAL_EXECUTION_PROOF_SCHEMA);
  assert.equal(out.user_goal_to_agent_readback, true);
  assert.equal(out.user_goal_to_result_readback, true);
  assert.equal(out.agent_origin_proof.contract, 'ZAI_AGENT_SURFACE_CAUSAL_V1');
  assert.equal(out.result_proof.claim_schema, 'metaengine.agent-result-claim.v1');
  assert.equal(out.result_proof.origin_bound, true);
  assert.equal(out.scheduler_identity_exposed, false);
  assert.equal(Object.hasOwn(out, 'agent_id'), false);
  assert.equal(Object.hasOwn(out, 'result_summary'), false);
});

test('Client execution proof fails closed on receipt or conversation drift', () => {
  assert.throws(
    () => normalizeClientGoalExecutionProofReadback(
      proof({ task_id: '22222222-2222-4222-8222-222222222222' }),
      requestId,
      receipt,
    ),
    /client_goal_execution_proof_receipt_drift/,
  );

  const drift = proof();
  drift.result_proof = { ...drift.result_proof, conversation_url_sha256: '9'.repeat(64) };
  assert.throws(
    () => normalizeClientGoalExecutionProofReadback(drift, requestId, receipt),
    /client_goal_execution_proof_result_origin_invalid/,
  );
});

test('absence remains an explicit non-claim', () => {
  const out = normalizeClientGoalExecutionProofReadback({
    schema: 'metaengine.client-v1.goal-execution-proof.v1',
    found: false,
    request_id: requestId,
    workspace_id: workspaceId,
    user_goal_to_agent_readback: false,
    user_goal_to_result_readback: false,
    task_payload_returned: false,
    result_summary_returned: false,
    page_content_returned: false,
    model_output_returned: false,
    scheduler_identity_returned: false,
    automatic_retry_allowed: false,
    scheduler_authority: false,
    browser_authority: false,
    release_authority: false,
    authority_effect: false,
  }, requestId);
  assert.equal(out.found, false);
  assert.equal(out.user_goal_to_agent_readback, false);
});

test('BLOCKED is a first-class terminal Client progress state', () => {
  const out = normalizeClientGoalProgressReadback({
    schema: 'metaengine.client-v1.goal-progress.v1',
    found: true,
    request_id: requestId,
    workspace_id: workspaceId,
    roadmap_id: 'metaengine-client-v1',
    plan_generation: 4,
    alignment_epoch: 3,
    baseline_sha: 'b'.repeat(40),
    plan_sha256: 'c'.repeat(64),
    point_id: pointId,
    task_id: taskId,
    task_spec_sha256: 'd'.repeat(64),
    task_state: 'BLOCKED',
    terminal: true,
    lease_generation: 2,
    result_checkpoint_id: null,
    result_summary_sha256: '1'.repeat(64),
    result_sha256: '1'.repeat(64),
    error_code: 'RESULT_CLAIM_MISSING_OR_INVALID',
    survives_plan_retirement: true,
    task_payload_returned: false,
    result_summary_returned: false,
    scheduler_identity_returned: false,
    automatic_retry_allowed: false,
    scheduler_authority: false,
    browser_authority: false,
    release_authority: false,
    authority_effect: false,
  }, requestId, receipt);
  assert.equal(out.task_state, 'BLOCKED');
  assert.equal(out.terminal, true);
});

test('SQL repairs completion state drift and emits durable digest-only result event', () => {
  assert.match(sql, /'BLOCKED','COMPLETED','FAILED','AMBIGUOUS','FENCED'/);
  assert.match(sql, /v_final not in \('COMPLETED','FAILED','RESULT_READY','BLOCKED','AMBIGUOUS'\)/);
  assert.match(sql, /'TASK_RESULT_' \|\| v_final/);
  assert.match(sql, /result_summary_included',false/);
  assert.match(sql, /model_claim_authority',false/);
  assert.match(sql, /page_data_authority',false/);
  assert.doesNotMatch(sql, /'result_summary'\s*,\s*v_summary/);
});

test('SQL proof starts from Client request ledger and exposes no scheduler identities', () => {
  const proofSql = sql.slice(sql.indexOf('create or replace function public.client_v1_goal_execution_proof_v1'));
  assert.match(proofSql, /client_v1_goal_request_h205f22/);
  assert.match(proofSql, /event_type='TASK_TRANSPORT_PROVEN'/);
  assert.match(proofSql, /ZAI_AGENT_SURFACE_CAUSAL_V1/);
  assert.match(proofSql, /metaengine\.agent-result-claim\.v1/);
  assert.match(proofSql, /v_result_conversation_sha=v_origin_conversation_sha/);
  assert.match(proofSql, /'scheduler_identity_returned',false/);
  assert.match(proofSql, /'agent_identity_returned',false/);
  assert.match(proofSql, /'tab_identity_returned',false/);
  assert.match(proofSql, /'target_identity_returned',false/);
  assert.doesNotMatch(proofSql, /'agent_id'\s*,\s*v_origin\.agent_id/);
  assert.doesNotMatch(proofSql, /'result_summary'\s*,\s*v_task\.result_summary/);
});

test('Edge proof route is read-only and fixes workspace server-side', async () => {
  const calls = [];
  const routes = createMetaSupervisorRoutes({
    workspaceId,
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === 'client_v1_goal_execution_proof_v1') return proof();
      throw new Error('unexpected_rpc');
    },
  });
  const response = await routes({
    req: { method: 'POST' },
    path: '/v1/meta/client-goal-execution-proof',
    body: { request_id: requestId },
    clientId: 'device',
  });
  assert.equal(response.status, 200);
  const body = JSON.parse(await response.text());
  assert.equal(body.user_goal_to_agent_readback, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    name: 'client_v1_goal_execution_proof_v1',
    args: { p_workspace_id: workspaceId, p_request_id: requestId },
  });
});

test('Browser reconciliation reads execution proof without another goal effect', () => {
  assert.match(native, /clientGoalExecutionProof/);
  assert.match(native, /\/v1\/meta\/client-goal-execution-proof/);
  assert.match(main, /nativeSupervisor\.clientGoalExecutionProof\(\{ request_id: requestId \}\)/);
  assert.match(main, /journal\.recordExecutionProof\(proof\)/);
  const reconcile = main.slice(main.indexOf('async function reconcileClientGoal'), main.indexOf('async function submitClientGoal'));
  assert.equal([...reconcile.matchAll(/clientGoalSubmit\s*\(/g)].length, 0);
});

test('product readback distinguishes Agent proof and accepted result proof', () => {
  assert.match(me2, /data-testid="client-goal-execution-proof"/);
  assert.match(me2, /RESULT PROVEN · Agent origin bound/);
  assert.match(me2, /Agent proven/);
  assert.match(me2, /NO AGENT PROOF/);
});
