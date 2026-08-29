import assert from 'node:assert/strict';
import test from 'node:test';
import { createExtensionTypedClickActuator, ExtensionTypedClickActuatorError } from '../coordination/browser-shared/extension-typed-click-actuator-v1.mjs';

const request = Object.freeze({
  action_id: 'r8d.click.001',
  action_kind: 'CLICK',
  namespace: { target_id: 'target.chatgpt', context_id: 'context.main', conversation_epoch: '1', document_epoch: 'doc-1' },
  authority: { decision: 'ALLOW' },
  ephemeral: { platform: 'CHATGPT', role: 'button', accessible_name: 'R8D Canary' },
});

function typed(outcome, physical, extra = {}) {
  return {
    command_id: 'cmd-r8d-001',
    status: 'COMPLETED',
    result: {
      action_id: request.action_id,
      outcome,
      reason_code: `r8d_${outcome.toLowerCase()}`,
      physical_dispatch_started: physical,
      automatic_retry_allowed: false,
      authority_effect: false,
      actuation_eligible: false,
      ...extra,
    },
  };
}

test('COMMITTED maps to one effect receipt and one transport command', async () => {
  const commands = [];
  const actuator = createExtensionTypedClickActuator({ dispatchCommand: async (command) => { commands.push(command); return typed('COMMITTED', true); } });
  const result = await actuator(request);
  assert.equal(commands.length, 1);
  assert.deepEqual(commands[0], {
    action: 'TYPED_CLICK', platform: 'CHATGPT',
    payload: { action_id: 'r8d.click.001', role: 'button', accessible_name: 'R8D Canary' },
    required_mode: 'CONTROL', required_armed: true, automatic_retry_allowed: false,
  });
  assert.equal(result.outcome, 'COMMITTED');
  assert.match(result.effect_receipt_digest, /^sha256:[0-9a-f]{64}$/);
});

test('NO_EFFECT is accepted only before physical dispatch', async () => {
  const actuator = createExtensionTypedClickActuator({ dispatchCommand: async () => typed('NO_EFFECT', false) });
  const result = await actuator(request);
  assert.equal(result.outcome, 'NO_EFFECT');
  assert.match(result.no_effect_evidence_digest, /^sha256:[0-9a-f]{64}$/);
});

test('AMBIGUOUS requires physical dispatch started', async () => {
  const actuator = createExtensionTypedClickActuator({ dispatchCommand: async () => typed('AMBIGUOUS', true) });
  const result = await actuator(request);
  assert.equal(result.outcome, 'AMBIGUOUS');
  assert.match(result.uncertainty_digest, /^sha256:[0-9a-f]{64}$/);
});

for (const [name, completion, code] of [
  ['action mismatch', typed('COMMITTED', true, { action_id: 'other.action' }), 'extension_click_action_id_mismatch'],
  ['NO_EFFECT after dispatch', typed('NO_EFFECT', true), 'extension_click_no_effect_dispatch_invalid'],
  ['COMMITTED before dispatch', typed('COMMITTED', false), 'extension_click_effect_dispatch_invalid'],
  ['retry enabled', typed('COMMITTED', true, { automatic_retry_allowed: true }), 'extension_click_result_authority_invalid'],
  ['authority minted', typed('COMMITTED', true, { authority_effect: true }), 'extension_click_result_authority_invalid'],
]) {
  test(`rejects malformed remote completion: ${name}`, async () => {
    const actuator = createExtensionTypedClickActuator({ dispatchCommand: async () => completion });
    await assert.rejects(() => actuator(request), (error) => error instanceof ExtensionTypedClickActuatorError && error.code === code);
  });
}

test('transport failure is not retried by adapter', async () => {
  let calls = 0;
  const actuator = createExtensionTypedClickActuator({ dispatchCommand: async () => { calls += 1; throw new Error('transport_lost_after_lease'); } });
  await assert.rejects(() => actuator(request), /transport_lost_after_lease/);
  assert.equal(calls, 1);
});

test('rejects non-click and broad semantic roles before transport', async () => {
  let calls = 0;
  const actuator = createExtensionTypedClickActuator({ dispatchCommand: async () => { calls += 1; return typed('COMMITTED', true); } });
  await assert.rejects(() => actuator({ ...request, action_kind: 'TYPE' }), /extension_click_action_kind_invalid/);
  await assert.rejects(() => actuator({ ...request, ephemeral: { platform: 'CHATGPT', role: 'textbox', accessible_name: 'X' } }), /extension_click_role_invalid/);
  assert.equal(calls, 0);
});
