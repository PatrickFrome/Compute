import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computerTargetIdentityDigest,
  hasAdmissibleEffectReadback,
  normalizeComputerRequest,
  normalizeComputerTargetIdentity,
  projectComputerEffectReceipt,
} from '../src/computer-authority-plane.mjs';
import { WindowsLocalComputerExecutor } from '../src/windows-local-computer-executor.mjs';

const target = normalizeComputerTargetIdentity({
  machine_fingerprint_sha256: 'a'.repeat(64),
  session_id: 1,
  process_id: 100,
  process_creation_time_ms: 1791122743585,
  window_handle: '0x1234',
  executable_sha256: 'b'.repeat(64),
  generation: 3,
});
const agentId = 'agent_test-12345678';
const commandId = '2a924f7a-884c-4a10-87b4-1d550561286e';
const argsByAction = {
  UIA_FOCUS: { runtime_id: [1, 2] },
  UIA_SET_VALUE: { runtime_id: [1, 2], value: 'value' },
  UIA_TOGGLE: { runtime_id: [1, 2] },
  UIA_SELECT: { runtime_id: [1, 2] },
  UIA_EXPAND_COLLAPSE: { runtime_id: [1, 2], state: 'EXPAND' },
  UIA_SCROLL: { runtime_id: [1, 2], vertical: 'SMALL_INCREMENT' },
  TYPE_TEXT: { runtime_id: [1, 2], text: 'value' },
  UIA_INVOKE: { runtime_id: [1, 2] },
  KEY_PRESS: { key: 'ENTER' },
  POINTER_CLICK: { x: 10, y: 20, visual_fence: { frame_sha256: 'c'.repeat(64) } },
};
const readbackByAction = {
  UIA_FOCUS: 'UIA_FOCUS_EXACT',
  UIA_SET_VALUE: 'UIA_VALUE_EXACT',
  UIA_TOGGLE: 'UIA_TOGGLE_STATE_CHANGED',
  UIA_SELECT: 'UIA_SELECTION_EXACT',
  UIA_EXPAND_COLLAPSE: 'UIA_EXPAND_STATE_EXACT',
  UIA_SCROLL: 'UIA_SCROLL_PERCENT_CHANGED',
  TYPE_TEXT: 'UIA_VALUE_EXACT',
};

function contextFor(action, exactTarget = target) {
  return {
    command_id: commandId,
    effect_binding: {
      schema: 'metaengine.native-supervisor.computer-effect-binding.v1',
      command_id: commandId,
      action: 'COMPUTER_ACTION',
      computer_action: action,
      agent_id: agentId,
      target_identity_sha256: computerTargetIdentityDigest(exactTarget),
      target: exactTarget,
      automatic_retry_allowed: false,
      page_data_authority: false,
      authority_effect: false,
    },
  };
}

function requestFor(action = 'TYPE_TEXT', exactTarget = target) {
  return normalizeComputerRequest({
    action,
    agent_id: agentId,
    target: exactTarget,
    args: argsByAction[action],
  }, contextFor(action, exactTarget));
}

function proofFor(action = 'TYPE_TEXT', extra = {}) {
  return {
    schema: 'metaengine.windows-computer-executor.effect.v1',
    action,
    target: { ...target },
    ok: true,
    effect_started: true,
    readback_proven: true,
    readback_kind: readbackByAction[action],
    ...extra,
  };
}

function assertTerminalAmbiguous(receipt) {
  assert.equal(receipt.outcome, 'AMBIGUOUS_NO_RETRY');
  assert.equal(receipt.authority_effect, false);
  assert.equal(receipt.automatic_retry_allowed, false);
  assert.equal(receipt.scheduler_authority, false);
  assert.equal(receipt.page_data_authority, false);
}

test('receipt projection accepts only the action-specific positive readback', async (t) => {
  for (const [action, kind] of Object.entries(readbackByAction)) {
    await t.test(action, () => {
      const request = requestFor(action);
      const result = proofFor(action);
      assert.equal(result.readback_kind, kind);
      assert.equal(hasAdmissibleEffectReadback(request, result), true);
      const receipt = projectComputerEffectReceipt({ request, result, outcome: 'EFFECT_PROVEN' });
      assert.equal(receipt.outcome, 'EFFECT_PROVEN');
      assert.equal(receipt.authority_effect, true);
      assert.equal(receipt.command_id, commandId);
      assert.equal(receipt.target_identity_sha256, computerTargetIdentityDigest(target));
      assert.equal(receipt.automatic_retry_allowed, false);
      assert.equal(receipt.scheduler_authority, false);
      assert.equal(receipt.page_data_authority, false);
    });
  }
});

test('every wrong typed readback and delivery-only proof is rejected at the receipt boundary', async (t) => {
  const kinds = [...new Set(Object.values(readbackByAction)), 'DELIVERY_ONLY'];
  for (const [action, expected] of Object.entries(readbackByAction)) {
    await t.test(action, () => {
      const request = requestFor(action);
      for (const kind of kinds.filter((value) => value !== expected)) {
        const result = proofFor(action, { readback_kind: kind });
        assert.equal(hasAdmissibleEffectReadback(request, result), false, kind);
        assertTerminalAmbiguous(projectComputerEffectReceipt({ request, result, outcome: 'EFFECT_PROVEN' }));
      }
    });
  }
});

test('invoke, key and pointer delivery cannot manufacture semantic effect proof', async (t) => {
  for (const action of ['UIA_INVOKE', 'KEY_PRESS', 'POINTER_CLICK']) {
    await t.test(action, () => {
      const request = requestFor(action);
      for (const kind of [...new Set(Object.values(readbackByAction)), 'DELIVERY_ONLY']) {
        const result = proofFor('TYPE_TEXT', { readback_kind: kind });
        assert.equal(hasAdmissibleEffectReadback(request, result), false);
        assertTerminalAmbiguous(projectComputerEffectReceipt({ request, result, outcome: 'EFFECT_PROVEN' }));
      }
    });
  }
});

test('untyped, missing and malformed success evidence cannot be projected as EFFECT_PROVEN', async (t) => {
  const cases = [
    ['missing result', undefined],
    ['null result', null],
    ['empty result', {}],
    ['array result', []],
    ['legacy generic readback', { readback: true }],
    ['untyped readback', { ok: true, effect_started: true, readback_proven: true }],
    ['missing boundary', proofFor('TYPE_TEXT', { effect_started: undefined })],
    ['null boundary', proofFor('TYPE_TEXT', { effect_started: null })],
    ['pre-effect boundary', proofFor('TYPE_TEXT', { effect_started: false })],
    ['string true boundary', proofFor('TYPE_TEXT', { effect_started: 'true' })],
    ['string false boundary', proofFor('TYPE_TEXT', { effect_started: 'false' })],
    ['numeric boundary', proofFor('TYPE_TEXT', { effect_started: 1 })],
    ['false success', proofFor('TYPE_TEXT', { ok: false })],
    ['string success', proofFor('TYPE_TEXT', { ok: 'true' })],
    ['false readback', proofFor('TYPE_TEXT', { readback_proven: false })],
    ['string readback', proofFor('TYPE_TEXT', { readback_proven: 'true' })],
    ['lowercase readback kind', proofFor('TYPE_TEXT', { readback_kind: 'uia_value_exact' })],
  ];
  for (const [name, result] of cases) {
    await t.test(name, () => {
      const request = requestFor();
      assert.equal(hasAdmissibleEffectReadback(request, result), false);
      const receipt = projectComputerEffectReceipt({ request, result, outcome: 'EFFECT_PROVEN' });
      assertTerminalAmbiguous(receipt);
      assert.equal(receipt.error, 'computer_effect_readback_not_proven');
    });
  }
});

test('positive readback requires the fixed bridge effect envelope and exact action', async (t) => {
  const cases = [
    ['missing schema', { schema: undefined }],
    ['wrong schema', { schema: 'metaengine.windows-computer-executor.status.v1' }],
    ['missing action', { action: undefined }],
    ['wrong action with the same readback kind', { action: 'UIA_SET_VALUE' }],
    ['lowercase action', { action: 'type_text' }],
    ['delivery-only action', { action: 'KEY_PRESS' }],
    ['missing target', { target: undefined }],
    ['null target', { target: null }],
    ['array target', { target: [] }],
    ['incomplete target', { target: { process_id: target.process_id } }],
    ['digest alone cannot replace identity', { target: undefined, target_identity_sha256: computerTargetIdentityDigest(target) }],
  ];
  for (const [name, extra] of cases) {
    await t.test(name, () => {
      const request = requestFor();
      const result = proofFor('TYPE_TEXT', extra);
      assert.equal(hasAdmissibleEffectReadback(request, result), false);
      const receipt = projectComputerEffectReceipt({ request, result, outcome: 'EFFECT_PROVEN' });
      assertTerminalAmbiguous(receipt);
      assert.equal(receipt.error, 'computer_effect_readback_not_proven');
    });
  }
});

const identityDriftCases = [
  ['machine fingerprint', { machine_fingerprint_sha256: 'd'.repeat(64) }],
  ['desktop session', { session_id: target.session_id + 1 }],
  ['process ID', { process_id: target.process_id + 1 }],
  ['process incarnation', { process_creation_time_ms: target.process_creation_time_ms + 1 }],
  ['window handle', { window_handle: '0x5678' }],
  ['executable SHA', { executable_sha256: 'e'.repeat(64) }],
  ['runtime generation', { generation: target.generation + 1 }],
];

test('every semantic action rejects post-effect drift in every exact identity field', async (t) => {
  for (const action of Object.keys(readbackByAction)) {
    await t.test(action, () => {
      const request = requestFor(action);
      for (const [name, drift] of identityDriftCases) {
        const result = proofFor(action, {
          target: { ...target, ...drift },
          target_identity_sha256: request.target_identity_sha256,
        });
        assert.equal(hasAdmissibleEffectReadback(request, result), false, name);
        const receipt = projectComputerEffectReceipt({ request, result, outcome: 'EFFECT_PROVEN' });
        assertTerminalAmbiguous(receipt);
        assert.equal(receipt.target_identity_sha256, request.target_identity_sha256);
        assert.notEqual(computerTargetIdentityDigest(receipt.result.target), receipt.target_identity_sha256, name);
      }
    });
  }
});

test('the exported proof predicate rejects invalid request identity without throwing', () => {
  const request = requestFor();
  const result = proofFor();
  assert.equal(hasAdmissibleEffectReadback({ ...request, target: null }, result), false);
  assert.equal(hasAdmissibleEffectReadback({ ...request, target: [] }, result), false);
  assert.equal(hasAdmissibleEffectReadback({ ...request, target_identity_sha256: undefined }, result), false);
  assert.equal(hasAdmissibleEffectReadback({ ...request, target_identity_sha256: 'f'.repeat(64) }, result), false);
});

test('executor rejects drifted positive proof without a second physical dispatch', async (t) => {
  for (const action of Object.keys(readbackByAction)) {
    await t.test(action, async () => {
      for (const [name, drift] of identityDriftCases) {
        let dispatches = 0;
        const executor = new WindowsLocalComputerExecutor({
          platform: 'win32',
          runner: async () => {
            dispatches += 1;
            return proofFor(action, { target: { ...target, ...drift } });
          },
        });
        const receipt = await executor.act(requestFor(action), contextFor(action));
        assertTerminalAmbiguous(receipt);
        assert.equal(dispatches, 1, `${action}:${name}`);
      }
    });
  }
});

test('executor accepts an exact bridge proof for every semantic action', async (t) => {
  for (const action of Object.keys(readbackByAction)) {
    await t.test(action, async () => {
      let dispatches = 0;
      const executor = new WindowsLocalComputerExecutor({
        platform: 'win32',
        runner: async () => { dispatches += 1; return proofFor(action); },
      });
      const receipt = await executor.act(requestFor(action), contextFor(action));
      assert.equal(receipt.outcome, 'EFFECT_PROVEN');
      assert.equal(receipt.authority_effect, true);
      assert.equal(receipt.automatic_retry_allowed, false);
      assert.equal(dispatches, 1);
    });
  }
});

test('NO_EFFECT_PROVEN requires an explicit boolean false boundary even for an error response', async (t) => {
  const cases = [
    ['missing result', undefined],
    ['null result', null],
    ['empty result', {}],
    ['array result', []],
    ['error alone', { ok: false, error: 'transport_lost' }],
    ['null boundary', { effect_started: null }],
    ['string false boundary', { effect_started: 'false' }],
    ['string true boundary', { effect_started: 'true' }],
    ['zero boundary', { effect_started: 0 }],
    ['one boundary', { effect_started: 1 }],
    ['crossed boundary', { effect_started: true }],
    ['positive proof claimed as no effect', proofFor()],
  ];
  for (const [name, result] of cases) {
    await t.test(name, () => {
      const receipt = projectComputerEffectReceipt({ request: requestFor(), result, outcome: 'NO_EFFECT_PROVEN' });
      assertTerminalAmbiguous(receipt);
      assert.equal(receipt.error, 'computer_effect_start_unconfirmed');
    });
  }
});

test('explicit pre-effect readback remains NO_EFFECT_PROVEN without granting retry', () => {
  const receipt = projectComputerEffectReceipt({
    request: requestFor(),
    result: { ok: false, effect_started: false },
    outcome: 'NO_EFFECT_PROVEN',
    error: 'computer_target_identity_drift',
  });
  assert.equal(receipt.outcome, 'NO_EFFECT_PROVEN');
  assert.equal(receipt.error, 'computer_target_identity_drift');
  assert.equal(receipt.authority_effect, false);
  assert.equal(receipt.automatic_retry_allowed, false);
});

test('an ambiguous attempt is not upgraded by later positive or negative evidence', () => {
  for (const result of [proofFor(), { effect_started: false }]) {
    assertTerminalAmbiguous(projectComputerEffectReceipt({
      request: requestFor(), result, outcome: 'AMBIGUOUS_NO_RETRY',
    }));
  }
});

test('receipt proof is evaluated against the same detached result that is recorded', () => {
  const result = proofFor();
  const receipt = projectComputerEffectReceipt({ request: requestFor(), result, outcome: 'EFFECT_PROVEN' });
  result.readback_kind = 'DELIVERY_ONLY';
  result.effect_started = false;
  result.action = 'UIA_SET_VALUE';
  result.target.generation += 1;
  assert.equal(receipt.result.readback_kind, 'UIA_VALUE_EXACT');
  assert.equal(receipt.result.effect_started, true);
  assert.equal(receipt.result.action, 'TYPE_TEXT');
  assert.equal(receipt.result.target.generation, target.generation);
  assert.equal(receipt.outcome, 'EFFECT_PROVEN');
  assert.ok(Object.isFrozen(receipt));
});

test('receipt projection revalidates the DB lease, exact target and action binding', () => {
  const request = requestFor();
  const project = (value) => projectComputerEffectReceipt({ request: value, result: proofFor(), outcome: 'EFFECT_PROVEN' });
  assert.throws(() => project({ ...request, lease: null }), /computer_db_lease_command_id_required/);
  assert.throws(() => project({ ...request, target_identity_sha256: 'd'.repeat(64) }), /computer_target_identity_digest_mismatch/);
  assert.throws(() => project({
    ...request,
    lease: { ...request.lease, effect_binding: { ...request.lease.effect_binding, computer_action: 'UIA_TOGGLE' } },
  }), /computer_effect_binding_subaction_mismatch/);
  assert.throws(() => project(normalizeComputerRequest({ action: 'STATUS' })), /computer_receipt_mutation_required/);
  assert.throws(() => projectComputerEffectReceipt({ request, outcome: 'DELIVERED', result: proofFor() }), /computer_effect_outcome_invalid/);
});

test('positive proof requires native JSON types in all seven observed identity fields', async (t) => {
  const fields = [
    'machine_fingerprint_sha256', 'session_id', 'process_id',
    'process_creation_time_ms', 'window_handle', 'executable_sha256', 'generation',
  ];
  for (const field of fields) {
    await t.test(field, () => {
      const value = target[field];
      const aliases = typeof value === 'number' ? [String(value), [value]] : [[value]];
      for (const action of Object.keys(readbackByAction)) {
        const request = requestFor(action);
        for (const alias of aliases) {
          const result = proofFor(action, { target: { ...target, [field]: alias } });
          assert.equal(hasAdmissibleEffectReadback(request, result), false, `${action}:${field}`);
          assertTerminalAmbiguous(projectComputerEffectReceipt({ request, result, outcome: 'EFFECT_PROVEN' }));
        }
      }
    });
  }
});

test('null, boolean and empty values cannot stand in for exact session or generation readback', async (t) => {
  const cases = [
    ['null session', 'session_id', 0, null],
    ['boolean session', 'session_id', 0, false],
    ['empty string session', 'session_id', 0, ''],
    ['empty array session', 'session_id', 0, []],
    ['boolean process', 'process_id', 1, true],
    ['boolean generation', 'generation', 1, true],
  ];
  for (const [name, field, expected, alias] of cases) {
    await t.test(name, () => {
      const exactTarget = normalizeComputerTargetIdentity({ ...target, [field]: expected });
      const request = requestFor('TYPE_TEXT', exactTarget);
      const result = proofFor('TYPE_TEXT', { target: { ...exactTarget, [field]: alias } });
      assert.equal(hasAdmissibleEffectReadback(request, result), false);
      assertTerminalAmbiguous(projectComputerEffectReceipt({ request, result, outcome: 'EFFECT_PROVEN' }));
    });
  }
});

test('the normalized request preserves an immutable detached DB binding through dispatch', async () => {
  const context = contextFor('TYPE_TEXT');
  let dispatchedRequest;
  let dispatches = 0;
  const executor = new WindowsLocalComputerExecutor({
    platform: 'win32',
    runner: async (request) => {
      dispatches += 1;
      dispatchedRequest = request;
      assert.ok(Object.isFrozen(request.lease.effect_binding));
      assert.ok(Object.isFrozen(request.lease.effect_binding.target));
      assert.throws(() => { request.lease.effect_binding.command_id = 'changed'; }, TypeError);
      assert.throws(() => { request.lease.effect_binding.target.generation += 1; }, TypeError);
      context.effect_binding.command_id = 'changed outside the detached request';
      return proofFor();
    },
  });
  const receipt = await executor.act(requestFor(), context);
  assert.equal(receipt.outcome, 'EFFECT_PROVEN');
  assert.equal(receipt.command_id, commandId);
  assert.equal(dispatchedRequest.lease.effect_binding.command_id, commandId);
  assert.equal(dispatches, 1);
});

test('recorded effect evidence is immutable after proof admission and serializes unchanged', () => {
  const receipt = projectComputerEffectReceipt({ request: requestFor(), result: proofFor(), outcome: 'EFFECT_PROVEN' });
  const recorded = JSON.stringify(receipt);
  assert.ok(Object.isFrozen(receipt.result));
  assert.ok(Object.isFrozen(receipt.result.target));
  assert.throws(() => { receipt.result.readback_kind = 'DELIVERY_ONLY'; }, TypeError);
  assert.throws(() => { receipt.result.effect_started = false; }, TypeError);
  assert.throws(() => { receipt.result.target.generation += 1; }, TypeError);
  assert.equal(JSON.stringify(receipt), recorded);
});

test('a local visual fence rejection records an explicit pre-effect boundary without dispatch', async () => {
  let dispatches = 0;
  const executor = new WindowsLocalComputerExecutor({
    platform: 'win32',
    runner: async () => { dispatches += 1; throw new Error('must_not_dispatch'); },
  });
  const request = requestFor('POINTER_CLICK');
  const receipt = await executor.act(request, contextFor('POINTER_CLICK'));
  assert.equal(receipt.outcome, 'NO_EFFECT_PROVEN');
  assert.equal(receipt.result.effect_started, false);
  assert.equal(receipt.result.schema, 'metaengine.windows-computer-executor.pre-effect.v1');
  assert.equal(receipt.authority_effect, false);
  assert.equal(receipt.automatic_retry_allowed, false);
  assert.equal(dispatches, 0);
});
