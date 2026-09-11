import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEVOS_REQUIRED_SERVER_FEATURES,
  evaluateDevosRuntimeCompatibility,
} from '../src/devos-runtime-compatibility.mjs';
import {
  NATIVE_SUPERVISOR_RUNTIME_CAPABILITIES,
  probeNativeSupervisorRuntimeCapabilities,
  validateDevosRecoveryDebtSnapshot,
} from '../supabase/a2-browser-native-supervisor-v1/runtime-capabilities.mjs';

const health = (capabilities = NATIVE_SUPERVISOR_RUNTIME_CAPABILITIES) => ({
  ok: true,
  schema: 'metaengine.native-browser-supervisor.health.v1',
  typed_commands_only: true,
  arbitrary_eval: false,
  devos_routes: true,
  devos_promotion_routes: true,
  meta_orchestrator_routes: true,
  capabilities,
});

test('current explicit protocol capability contract admits the DevOS physical cycle', () => {
  const out = evaluateDevosRuntimeCompatibility(health());
  assert.equal(out.state, 'COMPATIBLE');
  assert.equal(out.protocol_generation, 2);
  assert.equal(out.devos_cycle_allowed, true);
  assert.equal(out.physical_dispatch_allowed, true);
  assert.equal(out.ambiguity_recovery_allowed, true);
  assert.equal(out.transport_promotion_allowed, true);
  assert.equal(out.meta_orchestrator_allowed, true);
  assert.equal(out.automatic_retry_allowed, false);
  assert.equal(out.scheduler_authority, false);
  assert.equal(out.authority_effect, false);
});

test('deployed legacy health shape is classified explicitly instead of silently degrading', () => {
  const out = evaluateDevosRuntimeCompatibility({
    ok: true,
    schema: 'metaengine.native-browser-supervisor.health.v1',
    typed_commands_only: true,
    arbitrary_eval: false,
    supervisor_mesh: true,
    devos_routes: true,
  });
  assert.equal(out.state, 'LEGACY_SERVER_CAPABILITY_INCOMPLETE');
  assert.equal(out.reason, 'CAPABILITIES_MISSING');
  assert.equal(out.devos_cycle_allowed, false);
  assert.equal(out.physical_dispatch_allowed, false);
  assert.equal(out.ambiguity_recovery_allowed, false);
});

test('one missing recovery route fences the whole physical compatibility boundary', () => {
  const capabilities = structuredClone(NATIVE_SUPERVISOR_RUNTIME_CAPABILITIES);
  capabilities.features.devos_ambiguity_reconcile_v2 = false;
  const out = evaluateDevosRuntimeCompatibility(health(capabilities));
  assert.equal(out.state, 'SERVER_RUNTIME_SKEW');
  assert.equal(out.reason, 'REQUIRED_FEATURE_MISSING');
  assert.deepEqual(out.missing_features, ['devos_ambiguity_reconcile_v2']);
  assert.equal(out.physical_dispatch_allowed, false);
  assert.equal(out.automatic_retry_allowed, false);
});

test('old protocol generation is fenced even if booleans are spoofed present', () => {
  const capabilities = structuredClone(NATIVE_SUPERVISOR_RUNTIME_CAPABILITIES);
  capabilities.protocol_generation = 1;
  const out = evaluateDevosRuntimeCompatibility(health(capabilities));
  assert.equal(out.state, 'SERVER_RUNTIME_SKEW');
  assert.equal(out.reason, 'PROTOCOL_GENERATION_TOO_OLD');
  assert.equal(out.physical_dispatch_allowed, false);
});

test('authority contamination in capability metadata fails closed', () => {
  const capabilities = structuredClone(NATIVE_SUPERVISOR_RUNTIME_CAPABILITIES);
  capabilities.authority_effect = true;
  const out = evaluateDevosRuntimeCompatibility(health(capabilities));
  assert.equal(out.state, 'INVALID_SERVER_CAPABILITY');
  assert.equal(out.reason, 'CAPABILITY_SAFETY_CONTRACT_INVALID');
  assert.equal(out.physical_dispatch_allowed, false);
});

test('required feature list covers recovery, promotion, capacity, meta leader and post-lock fencing', () => {
  for (const feature of [
    'devos_ambiguity_reconcile_v2',
    'devos_transport_promotion_v1',
    'devos_scheduler_capacity_v1',
    'meta_orchestrator_superstep_v1',
    'meta_orchestrator_controller_lease_v1',
    'meta_atomic_frontier_v2',
    'post_lock_transport_revalidation_v1',
  ]) assert.equal(DEVOS_REQUIRED_SERVER_FEATURES.includes(feature), true, feature);
});

test('Edge source capability declaration is usable only after exact DB runtime attestation', async () => {
  const calls = [];
  const out = await probeNativeSupervisorRuntimeCapabilities({ rpc: async (name, args) => {
    calls.push({ name, args });
    return structuredClone(NATIVE_SUPERVISOR_RUNTIME_CAPABILITIES);
  } });
  assert.equal(out, NATIVE_SUPERVISOR_RUNTIME_CAPABILITIES);
  assert.deepEqual(calls, [{ name: 'devos_runtime_capabilities_v1', args: {} }]);
});

test('source/DB capability drift is rejected instead of advertising a partial protocol', async () => {
  const drift = structuredClone(NATIVE_SUPERVISOR_RUNTIME_CAPABILITIES);
  drift.features.meta_atomic_frontier_v2 = false;
  await assert.rejects(
    () => probeNativeSupervisorRuntimeCapabilities({ rpc: async () => drift }),
    /native_runtime_capability_attestation_drift/,
  );
});

test('recovery debt partitions exact effect proof from effect-unknown without granting retry', () => {
  const out = validateDevosRecoveryDebtSnapshot({
    schema: 'metaengine.devos.recovery-debt.v1',
    workspace_id: '2de9f84b-7c0a-4091-911c-894ff1d6eaf4',
    state: 'EFFECT_UNKNOWN_PRESENT',
    ambiguous_total: 70,
    effect_proven_count: 4,
    effect_unknown_count: 66,
    lease_expired_effect_unknown_count: 70,
    ready_backlog: 5,
    inflight_backlog: 0,
    active_claims: 0,
    task_content_returned: false,
    physical_effect_replayed: false,
    automatic_retry_allowed: false,
    scheduler_authority: false,
    browser_authority: false,
    release_authority: false,
    authority_effect: false,
  }, { workspaceId: '2de9f84b-7c0a-4091-911c-894ff1d6eaf4' });
  assert.equal(out.effect_proven_count, 4);
  assert.equal(out.effect_unknown_count, 66);
  assert.equal(out.automatic_retry_allowed, false);
  assert.equal(out.scheduler_authority, false);
});
