import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { buildSupervisorMeshWireProjectionV1 } from '../src/supervisor-mesh-wire-projection.mjs';

function peer(url, status = 'ACTIVE', selected = false, tab = null) {
  const hash = crypto.createHash('sha256').update(url, 'utf8').digest('hex');
  return {
    supervisor_id: `sup_${hash.slice(0, 24)}`,
    conversation_url_sha256: hash,
    status,
    tab_id: tab,
    selected,
    authority_effect: false,
  };
}

function runtime(peers) {
  return {
    schema: 'metaengine.supervisor-mesh-runtime.v2',
    running: true,
    last_reconcile_at: '2026-08-31T12:00:00.000Z',
    last_error: null,
    authority_effect: false,
    mesh: {
      schema: 'metaengine.supervisor-mesh.state.v2',
      version: '1.1.0-devos',
      mesh_epoch: 9,
      coordinator_supervisor_id: peers[0]?.supervisor_id || null,
      supervisors: peers,
      authority_effect: false,
    },
  };
}

test('current local mesh v2 projects exactly to the deployed bounded v1 wire contract', () => {
  const a = peer('https://chatgpt.com/c/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ACTIVE', true, 'tab_a');
  const b = peer('https://chatgpt.com/c/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'LOST', false, 'tab_stale');
  const wire = buildSupervisorMeshWireProjectionV1(runtime([a, b]));
  assert.equal(wire.schema, 'metaengine.supervisor-mesh-runtime.v1');
  assert.equal(wire.mesh.schema, 'metaengine.supervisor-mesh.state.v1');
  assert.equal(wire.mesh.mesh_epoch, 9);
  assert.equal(wire.mesh.preferred_supervisor_id, a.supervisor_id);
  assert.equal(wire.mesh.supervisors[0].tab_id, 'tab_a');
  assert.equal(wire.mesh.supervisors[1].tab_id, null);
  assert.equal(wire.authority_effect, false);
  assert.equal(wire.mesh.authority_effect, false);
});

test('wire projection never silently truncates a local mesh larger than live DB capacity', () => {
  const peers = Array.from({ length: 17 }, (_, i) => peer(`https://chatgpt.com/c/${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`, 'ACTIVE', i === 0, `tab_${i}`));
  assert.throws(() => buildSupervisorMeshWireProjectionV1(runtime(peers)), /supervisor_mesh_wire_capacity_exceeded/);
});

test('wire projection rejects identity laundering and authoritative page/model flags', () => {
  const p = peer('https://chatgpt.com/c/cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'ACTIVE', true, 'tab_c');
  assert.throws(() => buildSupervisorMeshWireProjectionV1(runtime([{ ...p, supervisor_id: 'sup_000000000000000000000000' }])), /identity_mismatch/);
  assert.throws(() => buildSupervisorMeshWireProjectionV1(runtime([{ ...p, authority_effect: true }])), /state_invalid/);
});
