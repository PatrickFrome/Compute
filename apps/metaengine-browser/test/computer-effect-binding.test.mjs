import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NATIVE_COMPUTER_EFFECT_BINDING_SCHEMA,
  buildNativeComputerEffectBinding,
  assertNativeComputerEffectBindingMatches,
} from '../src/computer-effect-binding.mjs';
import { computerTargetIdentityDigest } from '../src/computer-authority-plane.mjs';

const target = {
  machine_fingerprint_sha256:'a'.repeat(64),
  session_id:1,
  process_id:4242,
  process_creation_time_ms:1791122743585,
  window_handle:'0x1234',
  executable_sha256:'b'.repeat(64),
  generation:9,
};

const command = () => ({
  command_id:'4b670824-0c7d-4a69-98a3-77ee392ce86b',
  idempotency_key:'computer-effect-test-0001',
  action:'COMPUTER_ACTION',
  expires_at:'2099-01-02T03:04:05.123Z',
  payload:{
    action:'TYPE_TEXT',
    agent_id:'agent_test-12345678',
    target,
    target_identity_sha256:computerTargetIdentityDigest(target),
    args:{ text:'hello', runtime_id:[1,2,3] },
  },
});

test('computer effect binding seals exact command, agent and Windows incarnation', () => {
  const binding = buildNativeComputerEffectBinding({
    command:command(),
    clientId:'2a60d6a2-c7c2-4dcc-b4c9-99de768443c9',
    observedTarget:target,
    observedAt:'2026-10-05T05:30:00.000Z',
  });
  assert.equal(binding.schema, NATIVE_COMPUTER_EFFECT_BINDING_SCHEMA);
  assert.equal(binding.action, 'COMPUTER_ACTION');
  assert.equal(binding.computer_action, 'TYPE_TEXT');
  assert.equal(binding.agent_id, 'agent_test-12345678');
  assert.equal(binding.target_identity_sha256, computerTargetIdentityDigest(target));
  assert.equal(binding.page_data_authority, false);
  assert.equal(binding.automatic_retry_allowed, false);
  assert.equal(binding.authority_effect, false);

  const readback = assertNativeComputerEffectBindingMatches({
    command:command(),
    binding,
    clientId:'2a60d6a2-c7c2-4dcc-b4c9-99de768443c9',
    observedTarget:target,
    now:Date.parse('2026-10-05T05:31:00.000Z'),
  });
  assert.deepEqual(readback, binding);
});

test('computer effect binding fails closed on target reincarnation', () => {
  assert.throws(() => buildNativeComputerEffectBinding({
    command:command(),
    clientId:'2a60d6a2-c7c2-4dcc-b4c9-99de768443c9',
    observedTarget:{ ...target, generation:10 },
  }), /native_computer_effect_binding_target_drift/);
});

test('computer effect binding fails closed on agent mismatch and digest drift', () => {
  const wrongAgent = command();
  wrongAgent.payload.agent_id='worker';
  assert.throws(() => buildNativeComputerEffectBinding({
    command:wrongAgent,
    clientId:'2a60d6a2-c7c2-4dcc-b4c9-99de768443c9',
    observedTarget:target,
  }), /native_computer_effect_binding_agent_id_invalid/);

  const wrongDigest = command();
  wrongDigest.payload.target_identity_sha256='c'.repeat(64);
  assert.throws(() => buildNativeComputerEffectBinding({
    command:wrongDigest,
    clientId:'2a60d6a2-c7c2-4dcc-b4c9-99de768443c9',
    observedTarget:target,
  }), /native_computer_effect_binding_target_digest_mismatch/);
});
