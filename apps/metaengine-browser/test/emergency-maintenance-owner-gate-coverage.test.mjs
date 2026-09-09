import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OWNER_INTERNAL_GATE_CATALOG,
  OwnerSafetyGateRegistry,
} from '../src/owner-safety-gate-registry.mjs';

async function registryHarness() {
  let state = null;
  const registry = new OwnerSafetyGateRegistry({
    loadState: async () => state,
    saveState: async (value) => { state = structuredClone(value); },
    clock: () => Date.parse('2026-09-09T16:00:00.000Z'),
  });
  await registry.init();
  return registry;
}

test('owner wildcard operational plane covers every catalog gate without per-gate emergency mapping', async () => {
  const registry = await registryHarness();
  await registry.disable({
    gate_id: '*',
    ttl_seconds: 60,
    reason: 'SIGNED_EMERGENCY_COVERAGE_TEST',
    override_id: 'emergency.coverage.current',
  });
  for (const gate of OWNER_INTERNAL_GATE_CATALOG) {
    assert.equal(await registry.isDisabled(gate.gate_id), true, gate.gate_id);
  }
});

test('owner wildcard also covers a newly introduced syntactically valid operational gate by default', async () => {
  const registry = await registryHarness();
  await registry.disable({
    gate_id: '*',
    ttl_seconds: 60,
    reason: 'SIGNED_EMERGENCY_FUTURE_GATE_TEST',
    override_id: 'emergency.coverage.future',
  });
  assert.equal(await registry.isDisabled('future.runtime.new_operational_hold'), true);
});
