import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NATIVE_EFFECT_BINDING_SCHEMA,
  NATIVE_TAB_EFFECT_ACTIONS,
  assertNativeEffectBindingMatches,
  buildNativeEffectBinding,
  nativeActionRequiresEffectBinding,
} from '../src/native-effect-binding.mjs';

const COMMAND_ID = '11111111-1111-4111-8111-111111111111';
const CLIENT_ID = '22222222-2222-4222-8222-222222222222';
const PROCESS_ID = '33333333-3333-4333-8333-333333333333';
const TAB_ID = 'tab_44444444-4444-4444-8444-444444444444';
const TARGET_ID = 'webcontents:77';
const EXPIRES_AT = '2099-01-02T03:04:05.123456+00:00';

function command(overrides = {}) {
  return {
    command_id: COMMAND_ID,
    idempotency_key: 'native.effect.intent.0001',
    action: 'SEMANTIC_TYPE',
    payload: { tab_id: TAB_ID, role: 'textbox', accessible_name: 'Chat with ChatGPT', text: 'x' },
    expires_at: EXPIRES_AT,
    ...overrides,
  };
}

function build(overrides = {}) {
  return buildNativeEffectBinding({
    command: command(overrides.command),
    clientId: overrides.clientId ?? CLIENT_ID,
    processIncarnationId: overrides.processIncarnationId ?? PROCESS_ID,
    tabId: overrides.tabId ?? TAB_ID,
    targetId: overrides.targetId ?? TARGET_ID,
    observedAt: '2026-08-31T07:00:00.000Z',
  });
}

test('semantic effect set is narrow and navigation stays outside C1 slice', () => {
  assert.deepEqual(NATIVE_TAB_EFFECT_ACTIONS, [
    'STOP_GENERATION','SCROLL','SEMANTIC_FOCUS','SEMANTIC_TYPE','TYPED_CLICK',
  ]);
  for (const action of NATIVE_TAB_EFFECT_ACTIONS) assert.equal(nativeActionRequiresEffectBinding(action), true);
  for (const action of ['POLL','CAPTURE','NAVIGATE','NEW_TAB','FLEET_RECONCILE','SELF_UPDATE_APPLY']) {
    assert.equal(nativeActionRequiresEffectBinding(action), false);
  }
});

test('binding preserves exact leased command identity and has zero page authority', () => {
  const binding = build();
  assert.equal(binding.schema, NATIVE_EFFECT_BINDING_SCHEMA);
  assert.equal(binding.command_id, COMMAND_ID);
  assert.equal(binding.client_id, CLIENT_ID);
  assert.equal(binding.process_incarnation_id, PROCESS_ID);
  assert.equal(binding.tab_id, TAB_ID);
  assert.equal(binding.target_id, TARGET_ID);
  assert.equal(binding.command_expires_at, EXPIRES_AT);
  assert.equal(binding.page_data_authority, false);
  assert.equal(binding.automatic_retry_allowed, false);
  assert.equal(binding.authority_effect, false);
});

test('remote semantic effect requires explicit exact tab binding', () => {
  assert.throws(() => build({ command: { payload: { role: 'textbox' } } }), /explicit_tab_required/);
  assert.throws(() => build({ tabId: 'tab_55555555-5555-4555-8555-555555555555' }), /explicit_tab_required/);
});

test('revalidation rejects target and process incarnation replacement before effect', () => {
  const binding = build();
  assert.throws(() => assertNativeEffectBindingMatches({
    command: command(), binding, clientId: CLIENT_ID, processIncarnationId: PROCESS_ID,
    tabId: TAB_ID, targetId: 'webcontents:88', now: Date.parse('2026-08-31T07:00:01Z'),
  }), /target_id_mismatch/);
  assert.throws(() => assertNativeEffectBindingMatches({
    command: command(), binding, clientId: CLIENT_ID,
    processIncarnationId: '66666666-6666-4666-8666-666666666666',
    tabId: TAB_ID, targetId: TARGET_ID, now: Date.parse('2026-08-31T07:00:01Z'),
  }), /process_incarnation_id_mismatch/);
});

test('revalidation rejects expired lease even when all identities still match', () => {
  const expiredCommand = command({ expires_at: '2026-08-31T06:59:59.000Z' });
  assert.throws(() => buildNativeEffectBinding({
    command: expiredCommand,
    clientId: CLIENT_ID,
    processIncarnationId: PROCESS_ID,
    tabId: TAB_ID,
    targetId: TARGET_ID,
  }), /command_expired/);
});

test('safety flags cannot be laundered in DB readback', () => {
  const binding = build();
  for (const patch of [
    { page_data_authority: true },
    { automatic_retry_allowed: true },
    { authority_effect: true },
  ]) {
    assert.throws(() => assertNativeEffectBindingMatches({
      command: command(), binding: { ...binding, ...patch }, clientId: CLIENT_ID,
      processIncarnationId: PROCESS_ID, tabId: TAB_ID, targetId: TARGET_ID,
      now: Date.parse('2026-08-31T07:00:01Z'),
    }), /invalid|safety_flags/);
  }
});
