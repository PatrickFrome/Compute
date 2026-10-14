import test from 'node:test';
import assert from 'node:assert/strict';
import { PRIMARY_OPERATOR_VIEWS, projectPrimaryOperatorView as project } from './operator-primary-views.mjs';

const stamp = '2026-10-14T20:00:00.000Z';
const identity = Object.freeze({
  run_id: 'run:1', owner_id: 'owner:1', owner_epoch: 7, event_seq: 10,
  source_sha: 'a'.repeat(40), proof_identity: 'b'.repeat(64),
});
const frame = (patch = {}) => ({
  schema: 'metaengine.operator.observatory-resync.v1',
  mode: 'TRACKING', requires_explicit_resync: false,
  authority_effect: false, scheduler_authority: false, automatic_retry_allowed: false,
  identity,
  projection: {
    schema: 'metaengine.operator.observatory.v1', state: 'OBSERVED',
    cursor_state: 'VERIFIED_CURSOR', run_id: identity.run_id,
    event_seq: identity.event_seq, proof_identity: identity.proof_identity,
    planes: {
      database: { state: 'AVAILABLE', proof: 'TRUSTED_READBACK', fresh: true, observed_at: stamp, password: 'SECRET' },
      fleet: { state: 'UNKNOWN', proof: 'NONE', fresh: false, observed_at: null },
      continuity: { state: 'AVAILABLE', proof: 'TRUSTED_READBACK', fresh: true, observed_at: stamp },
      host: { state: 'UNKNOWN', proof: 'NONE', fresh: false, observed_at: null },
    },
  },
  ...patch,
});
test('Now/Missions/Fleet are curated projections from the identical frame, not independent liveness', () => {
  assert.deepEqual(PRIMARY_OPERATOR_VIEWS, ['Now', 'Missions', 'Fleet']);
  const now = project(frame(), 'Now', { firstTruthMs: 218 });
  const missions = project(frame(), 'Missions', { firstTruthMs: 218 });
  const fleet = project(frame(), 'Fleet', { firstTruthMs: 218 });
  assert.equal(now.source_bound, true);
  assert.equal(missions.event_seq, now.event_seq);
  assert.equal(fleet.run_id, now.run_id);
  assert.deepEqual(missions.facets.map(x => x.name), ['fleet', 'continuity']);
  assert.deepEqual(fleet.facets.map(x => x.name), ['fleet', 'supervisor', 'host']);
  assert.equal(fleet.facets[0].state, 'UNKNOWN');
  assert.equal(now.facets[0].state, 'AVAILABLE');
  assert.equal(now.first_truth_ms, 218);
  assert.equal(now.authority_effect, false);
  assert.equal(now.automatic_retry_allowed, false);
});
test('unbound reader, initial loading, timeout, failure and stale snapshot never show cached positive data', () => {
  for (const [delivery, phase] of [
    ['UNBOUND', 'UNBOUND'], ['LOADING', 'LOADING'], ['TIMED_OUT', 'TIMED_OUT'], ['FAILED', 'FAILED'],
  ]) {
    // Even a forged previous TRACKING frame cannot survive an explicit transport loss.
    const state = project(frame(), 'Now', { delivery, firstTruthMs: 200 });
    assert.equal(state.phase, phase);
    assert.equal(state.source_bound, false);
    assert.equal(state.facets.every(x => x.state === 'UNKNOWN'), true);
    assert.equal(state.first_truth_ms, null);
  }
  const stale = project(frame({ mode: 'STALE' }), 'Now');
  assert.equal(stale.phase, 'STALE');
  assert.equal(stale.facets.every(x => x.state === 'UNKNOWN'), true);
  const first = project(null, 'Now', { delivery: 'LOADING' });
  assert.equal(first.source_bound, false);
  assert.equal(first.run_id, null);
});
test('resync/rollback conflicts hide all three primary views and never release epoch', () => {
  for (const view of PRIMARY_OPERATOR_VIEWS) {
    const result = project(frame({ mode: 'RESYNC_REQUIRED', requires_explicit_resync: true }), view);
    assert.equal(result.phase, 'RECONCILE');
    assert.equal(result.run_id, null);
    assert.equal(result.facets.every(x => x.state === 'UNKNOWN'), true);
  }
});
test('positive claims without matching source-bound identity are never drawn as live', () => {
  for (const broken of [
    { identity: null },
    { identity: { ...identity, event_seq: 11 } },
    { identity: { ...identity, run_id: 'other' } },
    { identity: { ...identity, proof_identity: 'c'.repeat(64) } },
    { authority_effect: true }, { scheduler_authority: true },
    { mode: 'UNKNOWN' },
    { projection: { ...frame().projection, cursor_state: 'UNKNOWN' } },
  ]) {
    for (const view of PRIMARY_OPERATOR_VIEWS) {
      const result = project(frame(broken), view);
      assert.equal(result.source_bound, false);
      assert.equal(result.facets.every(x => x.state === 'UNKNOWN'), true);
    }
  }
});
test('no private input fields or raw error text enter the UI projection', () => {
  const payload = frame({ private_url: 'SECRET', message: 'SECRET', raw_dom: 'SECRET' });
  const output = project(payload, 'Now');
  assert.equal(JSON.stringify(output).includes('SECRET'), false);
  assert.equal(output.facets[0].proof, 'TRUSTED_READBACK');
  assert.equal(Object.hasOwn(output.facets[0], 'password'), false);
  assert.equal(project(payload, 'Missions').missing_detail.includes('UNKNOWN, not zero'), true);
  assert.equal(project(payload, 'Fleet').missing_detail.includes('UNKNOWN, not zero'), true);
});
test('forged positive plane, effectful projection and malformed identity fail closed', () => {
  const original = frame();
  for (const witness of [
    { state: 'READY', proof: 'NONE', fresh: true, observed_at: stamp },
    { state: 'AVAILABLE', proof: 'TRUSTED_READBACK', fresh: false, observed_at: stamp },
  ]) {
    const trial = frame({ projection: { ...original.projection,
      planes: { ...original.projection.planes, database: witness } } });
    const result = project(trial, 'Now');
    assert.equal(result.facets[0].state, 'UNVERIFIED');
    assert.equal(result.facets[0].fresh, false);
  }
  for (const malformed of [
    { ...identity, owner_epoch: -1 }, { ...identity, source_sha: 'junk' },
    { ...identity, run_id: '<private-token>' }, { ...identity, proof_identity: 'bad' },
  ]) assert.equal(project(frame({ identity: malformed }), 'Now').source_bound, false);
  const effectful = frame({ projection: { ...original.projection,
    authority_effect: true, automatic_retry_allowed: false } });
  assert.equal(project(effectful, 'Now').source_bound, false);
});
test('TTFT is from the first bound read only and rejects fake and unbounded duration', () => {
  for (const ms of [-1, 1.2, Infinity, 300_001, '100', null]) {
    assert.equal(project(frame(), 'Now', { firstTruthMs: ms }).first_truth_ms, null);
  }
  assert.equal(project(frame(), 'Now', { firstTruthMs: 0 }).first_truth_ms, 0);
  assert.equal(project(null, 'Now', { firstTruthMs: 100 }).first_truth_ms, null);
});
test('invalid view and delivery fail closed', () => {
  assert.throws(() => project(frame(), '__proto__'), /primary_view_invalid/);
  assert.throws(() => project(frame(), 'Now', { delivery: 'SUCCESS_FROM_HTTP' }), /primary_delivery_invalid/);
});
