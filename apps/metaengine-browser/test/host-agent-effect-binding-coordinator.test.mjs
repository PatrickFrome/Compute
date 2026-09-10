import assert from 'node:assert/strict';
import test from 'node:test';
import { HostAgentEffectBindingCoordinator } from '../src/host-agent-effect-binding-coordinator.mjs';

const COMMAND_ID = '123e4567-e89b-42d3-a456-426614174000';
const TAB_ID = 'tab_123e4567-e89b-42d3-a456-426614174001';
const OBSERVED_AT = '2026-09-10T20:00:00.000Z';

function command(overrides = {}) {
  return {
    command_id: COMMAND_ID,
    action: 'SEMANTIC_TYPE',
    platform: 'CHATGPT',
    payload: { tab_id: TAB_ID, text: 'hello' },
    idempotency_key: 'effect-coordinator:test:0001',
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}

function localBinding(overrides = {}) {
  return {
    schema: 'metaengine.native-supervisor.effect-binding.v2',
    command_id: COMMAND_ID,
    idempotency_key: 'effect-coordinator:test:0001',
    action: 'SEMANTIC_TYPE',
    client_id: '223e4567-e89b-42d3-a456-426614174000',
    process_incarnation_id: '323e4567-e89b-42d3-a456-426614174000',
    tab_id: TAB_ID,
    target_id: 'webcontents:42',
    observed_at: OBSERVED_AT,
    runtime_observation_id: `obs_${'a'.repeat(32)}`,
    web_contents_id: 42,
    binding_generation: 7,
    document_generation: 9,
    page_data_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
    ...overrides,
  };
}

function coordinator({ prepare = null, seal = null } = {}) {
  const calls = [];
  const instance = new HostAgentEffectBindingCoordinator({
    browserExecutorClient: {
      prepareEffectBinding: async (value) => {
        calls.push(['prepare', structuredClone(value)]);
        if (prepare) return prepare(value);
        return {
          command_id: value.command_id,
          action: value.action,
          binding: localBinding(),
          binding_built_in_browser_process: true,
          authority_effect: false,
        };
      },
    },
    transport: {
      sealEffectIntent: async (commandId, binding) => {
        calls.push(['seal', commandId, structuredClone(binding)]);
        if (seal) return seal(commandId, binding);
        return {
          server_accepted: true,
          effect_binding: { ...binding, server_seal_version: 1 },
          effect_binding_sha256: 'b'.repeat(64),
          transport_delivery_is_authority: false,
          authority_effect: false,
        };
      },
    },
  });
  return { instance, calls };
}

test('Host Agent performs Browser prepare then server seal and attaches full sealed binding to original command', async () => {
  const h = coordinator();
  const original = command({ transport_marker: { leased: true, authority_effect: false } });
  const result = await h.instance.prepareCommand(original);

  assert.deepEqual(h.calls.map((row) => row[0]), ['prepare', 'seal']);
  assert.equal(h.calls[0][1].payload.text, 'hello');
  assert.equal(h.calls[1][1], COMMAND_ID);
  assert.deepEqual(h.calls[1][2], localBinding());
  assert.equal(result.command_id, COMMAND_ID);
  assert.equal(result.payload.text, 'hello');
  assert.deepEqual(result.transport_marker, original.transport_marker);
  assert.equal(result.effect_binding.server_seal_version, 1);
  assert.equal(result.effect_binding_sha256, 'b'.repeat(64));
  assert.equal(result.effect_binding_transport.local_binding_built_in_browser_process, true);
  assert.equal(result.effect_binding_transport.server_accepted, true);
  assert.equal(result.effect_binding_transport.browser_revalidation_required_before_effect, true);
  assert.equal(result.effect_binding_transport.transport_delivery_is_authority, false);
  assert.equal(result.effect_binding_transport.automatic_effect_retry_allowed, false);
});

test('non effect-binding actions bypass Browser preparation and server sealing', async () => {
  const h = coordinator();
  const read = command({ action: 'CAPTURE', idempotency_key: undefined });
  const result = await h.instance.prepareCommand(read);
  assert.equal(result.action, 'CAPTURE');
  assert.equal(h.calls.length, 0);
});

test('presealed caller input is rejected instead of trusting or resealing it', async () => {
  const h = coordinator();
  await assert.rejects(
    h.instance.prepareCommand(command({ effect_binding: localBinding(), effect_binding_sha256: 'c'.repeat(64) })),
    /presealed_input_forbidden/,
  );
  assert.equal(h.calls.length, 0);
});

test('Browser preparation must prove local Browser-process construction and fail-closed safety flags', async () => {
  const unproven = coordinator({
    prepare: async () => ({ command_id: COMMAND_ID, action: 'SEMANTIC_TYPE', binding: localBinding(), binding_built_in_browser_process: false }),
  });
  await assert.rejects(unproven.instance.prepareCommand(command()), /preparation_process_unproven/);
  assert.deepEqual(unproven.calls.map((row) => row[0]), ['prepare']);

  const unsafe = coordinator({
    prepare: async () => ({ command_id: COMMAND_ID, action: 'SEMANTIC_TYPE', binding: localBinding({ automatic_retry_allowed: true }), binding_built_in_browser_process: true }),
  });
  await assert.rejects(unsafe.instance.prepareCommand(command()), /preparation_safety_flags_invalid/);
});

test('server seal may add metadata but cannot mutate any Browser-prepared binding field', async () => {
  const drift = coordinator({
    seal: async (_commandId, binding) => ({
      server_accepted: true,
      effect_binding: { ...binding, binding_generation: binding.binding_generation + 1 },
      effect_binding_sha256: 'd'.repeat(64),
    }),
  });
  await assert.rejects(drift.instance.prepareCommand(command()), /seal_drift:binding_generation/);

  const unsafe = coordinator({
    seal: async (_commandId, binding) => ({
      server_accepted: true,
      effect_binding: { ...binding, automatic_retry_allowed: true },
      effect_binding_sha256: 'd'.repeat(64),
    }),
  });
  await assert.rejects(unsafe.instance.prepareCommand(command()), /seal_drift:automatic_retry_allowed|seal_safety_flags_invalid/);
});

test('coordinator has no scheduler execution authority retry or process-local registry reimplementation', () => {
  const h = coordinator();
  const snap = h.instance.snapshot();
  assert.equal(snap.command_leasing, false);
  assert.equal(snap.execution_authority, false);
  assert.equal(snap.timers, false);
  assert.equal(snap.automatic_retry_allowed, false);
  assert.equal(snap.transport_delivery_is_authority, false);
  assert.equal(snap.process_local_runtime_registry_not_reimplemented, true);
});
