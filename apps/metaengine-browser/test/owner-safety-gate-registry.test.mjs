import test from 'node:test';
import assert from 'node:assert/strict';
import { OwnerSafetyGateRegistry } from '../src/owner-safety-gate-registry.mjs';

function harness() {
  let persisted = null;
  let now = Date.parse('2026-08-30T08:10:00.000Z');
  const registry = new OwnerSafetyGateRegistry({
    loadState: async () => persisted,
    saveState: async (value) => { persisted = structuredClone(value); },
    clock: () => now,
  });
  return { registry, advance: (ms) => { now += ms; }, state: () => persisted };
}

test('owner can disable and re-enable one internal gate with readback', async () => {
  const h = harness();
  await h.registry.init();
  const off = await h.registry.disable({
    gate_id: 'fleet.fanout_limit',
    reason: 'OWNER_REQUESTED_EXCEPTION',
    override_id: 'owner.override.0001',
  });
  assert.equal(off.disabled, true);
  assert.equal(await h.registry.isDisabled('fleet.fanout_limit'), true);
  const decision = await h.registry.decision('fleet.fanout_limit', { default_allowed: false });
  assert.equal(decision.allowed, true);
  const on = await h.registry.enable({
    gate_id: 'fleet.fanout_limit',
    reason: 'OWNER_REENABLED',
    override_id: 'owner.override.0002',
  });
  assert.equal(on.disabled, false);
  assert.equal(await h.registry.isDisabled('fleet.fanout_limit'), false);
});

test('wildcard override disables every registered internal gate until explicitly cleared', async () => {
  const h = harness();
  await h.registry.init();
  await h.registry.disable({
    gate_id: '*',
    reason: 'OWNER_GLOBAL_BREAK_GLASS',
    override_id: 'owner.override.global1',
  });
  assert.equal(await h.registry.isDisabled('browser.exact_target_fence'), true);
  assert.equal(await h.registry.isDisabled('fleet.semantic_claim_conflict'), true);
  assert.equal(h.registry.snapshot().wildcard_disabled, true);
  await h.registry.enableAll({ reason: 'OWNER_GLOBAL_RESTORE', override_id: 'owner.override.global2' });
  assert.equal(await h.registry.isDisabled('browser.exact_target_fence'), false);
});

test('ttl override expires automatically and leaves an audit receipt', async () => {
  const h = harness();
  await h.registry.init();
  await h.registry.disable({
    gate_id: 'self_update.restart_gate',
    ttl_seconds: 5,
    reason: 'RECOVERY_TEST',
    override_id: 'owner.override.ttl01',
  });
  assert.equal(await h.registry.isDisabled('self_update.restart_gate'), true);
  h.advance(6000);
  assert.equal(await h.registry.isDisabled('self_update.restart_gate'), false);
  assert.ok(h.registry.snapshot().audit.some((row) => row.event === 'EXPIRED'));
});

test('override ids and reasons are typed and bounded', async () => {
  const h = harness();
  await h.registry.init();
  await assert.rejects(() => h.registry.disable({ gate_id: 'x', reason: 'r', override_id: 'short' }), /owner_gate_id_invalid/);
  await assert.rejects(() => h.registry.disable({ gate_id: 'fleet.test', reason: '', override_id: 'owner.override.1' }), /owner_gate_reason_invalid/);
  await assert.rejects(() => h.registry.disable({ gate_id: 'fleet.test', ttl_seconds: 86401, reason: 'x', override_id: 'owner.override.1' }), /owner_gate_ttl_invalid/);
});

test('state survives restart without page text or secret material', async () => {
  let persisted = null;
  const first = new OwnerSafetyGateRegistry({
    loadState: async () => persisted,
    saveState: async (value) => { persisted = structuredClone(value); },
    clock: () => Date.parse('2026-08-30T08:10:00.000Z'),
  });
  await first.init();
  await first.disable({ gate_id: 'fleet.idle_provisioning', reason: 'OWNER_OVERRIDE', override_id: 'owner.override.persist1' });
  const second = new OwnerSafetyGateRegistry({
    loadState: async () => persisted,
    saveState: async (value) => { persisted = structuredClone(value); },
    clock: () => Date.parse('2026-08-30T08:10:01.000Z'),
  });
  await second.init();
  assert.equal(await second.isDisabled('fleet.idle_provisioning'), true);
  const serialized = JSON.stringify(persisted);
  assert.equal(serialized.includes('cookie'), false);
  assert.equal(serialized.includes('prompt_body'), false);
});
