import assert from 'node:assert/strict';
import test from 'node:test';
import {
  METAENGINE_DEVOS_SYSTEM_ATTENTION_SCHEMA,
  attachDevOSSystemAttention,
} from '../src/metaengine-devos-system-attention.mjs';

function zeroAuthority() {
  return {
    projection_is_authority: false,
    scheduler_authority: false,
    execution_authority: false,
    command_leasing: false,
    automatic_effect_retry_allowed: false,
    page_model_authority: false,
    authority_effect: false,
  };
}

function attention(kind, { sessionId = null, severity = 'WARNING', priority = 'HIGH', reason = kind } = {}) {
  return Object.freeze({
    kind,
    severity,
    priority,
    session_id: sessionId,
    task_id: sessionId ? `task:${kind}` : null,
    title: kind,
    reason,
    ...zeroAuthority(),
  });
}

function root(rootId, count = 0, state = 'CLEAR') {
  return Object.freeze({ root_id: rootId, label: rootId, source_state: 'AVAILABLE', count, state, ...zeroAuthority() });
}

function devos() {
  return Object.freeze({
    schema: 'metaengine.devos.projection.v1',
    primary_object: 'SESSION',
    attention: Object.freeze([
      attention('SUPERVISOR_ERROR', { severity: 'ERROR', priority: 'CRITICAL', reason: 'supervisor failed' }),
      attention('TASK_BLOCKED', { sessionId: 'session:a', reason: 'dependency hold' }),
    ]),
    navigation: Object.freeze({
      schema: 'metaengine.devos.navigation.v1',
      roots: Object.freeze([root('NOW', 2, 'ATTENTION'), root('SESSIONS'), root('SYSTEM', 1, 'ATTENTION')]),
      ...zeroAuthority(),
    }),
    ...zeroAuthority(),
  });
}

function assertZeroAuthority(value) {
  assert.equal(value.projection_is_authority, false);
  assert.equal(value.scheduler_authority, false);
  assert.equal(value.execution_authority, false);
  assert.equal(value.command_leasing, false);
  assert.equal(value.automatic_effect_retry_allowed, false);
  assert.equal(value.page_model_authority, false);
  assert.equal(value.authority_effect, false);
}

test('trusted shell runtime signals enrich one canonical Now queue without adding actuation authority', () => {
  const out = attachDevOSSystemAttention(devos(), {
    fleet: { counts: { PROVISIONING_AMBIGUOUS: 2, LOST: 1, BOUND_UNVERIFIED: 3 }, authority_effect: false },
    workspaces: { groups: [{ state: 'FROZEN' }, { state: 'READY' }], authority_effect: false },
    supervisor: {
      supervisor_mesh: { last_error: 'mesh reconciliation failed' },
      self_update: { state: 'ERROR', last_error: 'release discovery failed', authority_effect: false },
      authority_effect: false,
    },
    development_plane: { state: 'CRASHED', authority_effect: false },
    compute: { available: false, authority_effect: false },
  });

  const kinds = out.attention.map((row) => row.kind);
  assert.deepEqual(kinds, [
    'SUPERVISOR_ERROR',
    'SUPERVISOR_MESH_ERROR',
    'FLEET_AMBIGUITY',
    'FLEET_LOST',
    'SELF_UPDATE_HOLD',
    'COMPUTE_OFFLINE',
    'TASK_BLOCKED',
    'WORKSPACE_FROZEN',
    'FLEET_TRANSPORT_UNVERIFIED',
    'DEVELOPMENT_PLANE_DEGRADED',
  ]);
  assert.equal(out.system_attention.schema, METAENGINE_DEVOS_SYSTEM_ATTENTION_SCHEMA);
  assert.equal(out.system_attention.emitted_count, 8);
  assert.equal(out.system_attention.renderer_reconstruction_required, false);
  assert.equal(out.system_attention.automatic_remediation, false);
  assert.equal(out.system_attention.second_polling_loop, false);
  assert.equal(out.navigation.roots.find((row) => row.root_id === 'NOW').count, out.attention.length);
  assert.equal(out.navigation.roots.find((row) => row.root_id === 'SYSTEM').count, 9);
  for (const row of out.attention) assertZeroAuthority(row);
  assertZeroAuthority(out.system_attention);
  assertZeroAuthority(out);
});

test('authority-bearing runtime snapshots are ignored instead of becoming trusted attention', () => {
  const out = attachDevOSSystemAttention(devos(), {
    fleet: { counts: { PROVISIONING_AMBIGUOUS: 99, LOST: 99, BOUND_UNVERIFIED: 99 }, authority_effect: true },
    workspaces: { groups: [{ state: 'FROZEN' }], authority_effect: true },
    supervisor: {
      supervisor_mesh: { last_error: 'must not surface' },
      self_update: { state: 'ERROR', last_error: 'must not surface', authority_effect: false },
      authority_effect: true,
    },
    development_plane: { state: 'CRASHED', authority_effect: true },
    compute: { available: false, authority_effect: true },
  });
  assert.deepEqual(out.attention.map((row) => row.kind), ['SUPERVISOR_ERROR', 'TASK_BLOCKED']);
  assert.equal(out.system_attention.emitted_count, 0);
  assert.equal(out.navigation.roots.find((row) => row.root_id === 'NOW').count, 2);
  assert.equal(out.navigation.roots.find((row) => row.root_id === 'SYSTEM').count, 1);
});

test('invalid canonical DevOS is returned unchanged and never repaired by the system-attention layer', () => {
  const invalid = { ...devos(), scheduler_authority: true };
  const out = attachDevOSSystemAttention(invalid, { compute: { available: false, authority_effect: false } });
  assert.equal(out, invalid);
  assert.equal(out.system_attention, undefined);
});
