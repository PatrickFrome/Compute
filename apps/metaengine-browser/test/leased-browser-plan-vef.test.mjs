import assert from 'node:assert/strict';
import test from 'node:test';
import { LeasedBrowserPlanExecutor, LEASED_BROWSER_PLAN_SCHEMA } from '../src/leased-browser-plan.mjs';
import { VERIFIED_EXECUTION_OUTCOME_SCHEMA } from '../src/verified-execution-outcome.mjs';

const COMMAND_ID = '123e4567-e89b-42d3-a456-426614174000';
const TAB_ID = 'tab_123e4567-e89b-42d3-a456-426614174001';

function command() {
  return {
    command_id: COMMAND_ID,
    action: 'SEMANTIC_TYPE',
    platform: 'CHATGPT',
    payload: { tab_id: TAB_ID, text: 'vef' },
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    idempotency_key: 'leased-plan:vef:00000001',
    effect_binding: {
      schema: 'metaengine.native-supervisor.effect-binding.v2',
      command_id: COMMAND_ID,
      action: 'SEMANTIC_TYPE',
      tab_id: TAB_ID,
      page_data_authority: false,
      automatic_retry_allowed: false,
      authority_effect: false,
    },
    effect_binding_sha256: 'a'.repeat(64),
    authority_effect: false,
  };
}

function plan() {
  return {
    schema: LEASED_BROWSER_PLAN_SCHEMA,
    plan_id: 'leased:vef:0001',
    allowed_origins: ['https://chatgpt.com'],
    deadline_ms: 10_000,
    commands: [command()],
  };
}

function executor({ executeCommand, verifyCommand } = {}) {
  return new LeasedBrowserPlanExecutor({
    authorizeCommand: async () => ({ authorized: true, authority_effect: false }),
    executeCommand: executeCommand || (async () => ({ dispatched: true })),
    verifyCommand: verifyCommand || (async () => ({ confirmed: true, authority_effect: false })),
    getCurrentUrl: async () => 'https://chatgpt.com/c/vef',
  });
}

test('confirmed mutation carries VEF CONFIRMED proof without changing plan completion contract', async () => {
  const runtime = executor();
  const receipt = await runtime.execute(plan());
  assert.equal(receipt.state, 'COMPLETED');
  assert.equal(receipt.completed_commands, 1);
  assert.equal(receipt.results[0].verified_execution.schema, VERIFIED_EXECUTION_OUTCOME_SCHEMA);
  assert.equal(receipt.results[0].verified_execution.state, 'CONFIRMED');
  assert.equal(receipt.results[0].verified_execution.reason, 'POSITIVE_READBACK');
  assert.equal(receipt.results[0].verified_execution.automatic_retry_allowed, false);
  assert.equal(runtime.snapshot().verified_execution_classifier, true);
  assert.equal(runtime.snapshot().verified_execution_outcome_schema, VERIFIED_EXECUTION_OUTCOME_SCHEMA);
});

test('proven no-effect remains NEEDS_REPLAN and carries VEF NO_EFFECT_PROVEN proof', async () => {
  const runtime = executor({ verifyCommand: async () => ({ confirmed: false, no_effect_proven: true }) });
  const receipt = await runtime.execute(plan());
  assert.equal(receipt.state, 'NEEDS_REPLAN');
  assert.equal(receipt.reason, 'NO_EFFECT_PROVEN');
  assert.equal(receipt.verified_execution.state, 'NO_EFFECT_PROVEN');
  assert.equal(receipt.verified_execution.reason, 'NEGATIVE_READBACK');
  assert.equal(receipt.automatic_effect_retry_allowed, false);
});

test('unproven postcondition remains AMBIGUOUS with deterministic VEF unknown-after-dispatch proof', async () => {
  const runtime = executor({ verifyCommand: async () => ({ confirmed: false, no_effect_proven: false }) });
  const receipt = await runtime.execute(plan());
  assert.equal(receipt.state, 'AMBIGUOUS');
  assert.equal(receipt.reason, 'POSTCONDITION_UNPROVEN');
  assert.equal(receipt.verified_execution.state, 'AMBIGUOUS');
  assert.equal(receipt.verified_execution.reason, 'POST_DISPATCH_EFFECT_UNKNOWN');
  assert.equal(receipt.verified_execution.automatic_retry_allowed, false);
});

test('contradictory positive and negative readback is fail-closed AMBIGUOUS instead of false success', async () => {
  const runtime = executor({ verifyCommand: async () => ({ confirmed: true, no_effect_proven: true }) });
  const receipt = await runtime.execute(plan());
  assert.equal(receipt.state, 'AMBIGUOUS');
  assert.equal(receipt.reason, 'EVIDENCE_CONFLICT');
  assert.equal(receipt.completed_commands, 0);
  assert.equal(receipt.verified_execution.state, 'AMBIGUOUS');
  assert.equal(receipt.verified_execution.reason, 'EVIDENCE_CONFLICT');
  assert.equal(receipt.verified_execution.evidence_conflict, true);
});

test('mutating execution error after dispatch entry is VEF AMBIGUOUS and never authorizes retry', async () => {
  const runtime = executor({ executeCommand: async () => { throw new Error('transport_lost_after_dispatch'); } });
  const receipt = await runtime.execute(plan());
  assert.equal(receipt.state, 'AMBIGUOUS');
  assert.equal(receipt.reason, 'EXECUTION_ERROR');
  assert.equal(receipt.verified_execution.state, 'AMBIGUOUS');
  assert.equal(receipt.verified_execution.reason, 'POST_DISPATCH_EFFECT_UNKNOWN');
  assert.equal(receipt.verified_execution.automatic_retry_allowed, false);
});
