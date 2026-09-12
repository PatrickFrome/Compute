import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NativeSupervisorClient,
  nativeSupervisorEmergencyProductionWiringContract,
} from '../src/native-supervisor-client-core.mjs';

function baseIdentity(overrides = {}) {
  return {
    ensure: async () => ({ client_id: 'client-test', device_id: 'device-test' }),
    snapshot: () => ({ client_id: 'client-test', device_id: 'device-test' }),
    deviceHeaders: async () => ({ 'content-type': 'application/json' }),
    ...overrides,
  };
}

function options(identity, extra = {}) {
  return {
    identity,
    fetchImpl: async () => new Response('{}', { status: 202, headers: { 'content-type': 'application/json' } }),
    getState: async () => ({ tabs: [], active_tab: null }),
    executeCommand: async () => ({ ok: true }),
    version: '0.7.0-dev.2.1',
    ...extra,
  };
}

test('release identity with Guardian proof surface auto-wires native emergency handler', () => {
  const identity = baseIdentity({
    guardianOwnerChallenge: async () => ({}),
    guardianUpdateActuatorProof: async () => ({}),
  });
  const client = new NativeSupervisorClient(options(identity));
  assert.equal(client.snapshot().developer_emergency_update.configured, true);
});

test('mock identity without Guardian proof surface remains fail-closed', () => {
  const client = new NativeSupervisorClient(options(baseIdentity()));
  assert.equal(client.snapshot().developer_emergency_update.configured, false);
});

test('explicit null disables auto-wiring even for capable release identity', () => {
  const identity = baseIdentity({
    guardianOwnerChallenge: async () => ({}),
    guardianUpdateActuatorProof: async () => ({}),
  });
  const client = new NativeSupervisorClient(options(identity, { developerEmergencyUpdate: null }));
  assert.equal(client.snapshot().developer_emergency_update.configured, false);
});

test('explicit handler remains authoritative for tests and controlled overrides', () => {
  const handler = async () => ({ state: 'HOLD', effect_outcome: 'NO_EFFECT_PROVEN' });
  const client = new NativeSupervisorClient(options(baseIdentity(), { developerEmergencyUpdate: handler }));
  assert.equal(client.snapshot().developer_emergency_update.configured, true);
});

test('non-release version never acquires physical emergency update power implicitly', () => {
  const identity = baseIdentity({
    guardianOwnerChallenge: async () => ({}),
    guardianUpdateActuatorProof: async () => ({}),
  });
  const client = new NativeSupervisorClient(options(identity, { version: '0.7.0-dev.test' }));
  assert.equal(client.snapshot().developer_emergency_update.configured, false);
});

test('production wiring contract preserves fail-closed boundaries', () => {
  const contract = nativeSupervisorEmergencyProductionWiringContract();
  assert.equal(contract.explicit_null_disables_auto_wiring, true);
  assert.equal(contract.release_version_required_for_auto_wiring, true);
  assert.equal(contract.enrolled_guardian_proof_surface_required, true);
  assert.equal(contract.native_guardian_actuator_only, true);
  assert.equal(contract.electron_updater_fallback_allowed, false);
  assert.equal(contract.automatic_retry_allowed, false);
});
