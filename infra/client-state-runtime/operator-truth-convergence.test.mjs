import test from 'node:test';
import assert from 'node:assert/strict';
import { HOST_OWNER_SCHEMA, createTrustedHostObservationReadback } from './operator-trusted-host-readback.mjs';
import { qualifyOperatorOwner } from './operator-own-pg-fleet-truth.mjs';
import { startOperatorReadOnlyGateway } from './operator-readonly-gateway.mjs';

// W1, W2, W3 use different, deliberately non-interchangeable provenance.
// The Host's process identity is not an implicit own-PG query capability,
// and importing the Gateway must not start an ambient listener or scheduler.
test('W1 Host readback cannot impersonate a W2 authoritative project Owner', async () => {
  const t = Date.now();
  const host = {
    schema: HOST_OWNER_SCHEMA, source: 'LOCAL_HOST_OWNER',
    authority_effect: false, verified: true,
    owner_id: 'trusted-owner-0001', device_id: '00000000-0000-4000-8000-000000000001',
    pid: 1234, created_at: new Date(t).toISOString(),
    observed_at: new Date(t).toISOString(), heartbeat_at: new Date(t).toISOString(),
    generation: 1, process_incarnation_id: 'incarnation-0001'
  };
  assert.equal(qualifyOperatorOwner(host, t), false,
    'Host process identity is never a PostgreSQL transaction/lease capability');
  assert.equal(typeof startOperatorReadOnlyGateway, 'function');
});
test('missing Guardian or OS witness stays UNKNOWN, never an implicit Host AVAILABLE', async () => {
  const read = createTrustedHostObservationReadback({
    readOwner: async () => null,
    readGuardianStatus: async () => { throw Error('must_not_be_called'); },
    readGuardianHealth: async () => { throw Error('must_not_be_called'); },
    readOsProcess: async () => { throw Error('must_not_be_called'); }
  });
  assert.equal(await read(), null);
  assert.equal(qualifyOperatorOwner(null), false);
});
test('W2 owner refuses caller-shaped claims without trusted in-process provenance', () => {
  const t = Date.now();
  const forged = {
    schema: 'metaengine.operator.trusted-owner.v1',
    source: 'HTTP_REQUEST', verified: true,
    project_id: '00000000-0000-4000-8000-000000000001',
    workspace_id: '00000000-0000-4000-8000-000000000002',
    device_id: '00000000-0000-4000-8000-000000000003',
    owner_id: 'owner-00001', client_id: 'owner-00001',
    admin_grant_epoch: 1, owner_generation: 1,
    process_incarnation: 'incarnation-00001',
    observed_at: new Date(t).toISOString(), heartbeat_at: new Date(t).toISOString(),
  };
  assert.equal(qualifyOperatorOwner(forged,t),false);
  assert.equal(qualifyOperatorOwner({...forged,source:'TRUSTED_OWNER_READBACK',verified:false},t),false);
});
