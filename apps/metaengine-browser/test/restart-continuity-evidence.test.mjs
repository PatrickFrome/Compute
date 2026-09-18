import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRestartContinuityEvidenceV2,
  RESTART_CONTINUITY_EVIDENCE_SCHEMA,
} from '../src/restart-continuity-evidence.mjs';

const base = (overrides = {}) => ({
  workspaceId: '11111111-1111-1111-1111-111111111111',
  clientId: 'browser-a',
  processIncarnationId: 'proc-old',
  supervisorEpoch: 7,
  sourceGitSha: 'a'.repeat(40),
  stateReadOk: true,
  durableHandoffReady: true,
  activeActuationLease: false,
  verifiedDownloadMutationActive: false,
  supervisorGeneration: 'GENERATING',
  queuedWakes: 3,
  activeModelRequest: true,
  ...overrides,
});

test('active generation, model request and queued wakes remain transferable continuity state', () => {
  const row = buildRestartContinuityEvidenceV2(base());
  assert.equal(row.schema, RESTART_CONTINUITY_EVIDENCE_SCHEMA);
  assert.equal(row.supervisor_generation, 'GENERATING');
  assert.equal(row.queued_wakes, 3);
  assert.equal(row.active_model_request, true);
  assert.equal(row.continuity_safe, true);
  assert.equal(row.restart_authorized, false);
  assert.equal(row.automatic_retry_allowed, false);
  assert.equal(row.authority_effect, false);
  assert.equal(Object.hasOwn(row, 'quiescent'), false);
});

test('active actuation lease blocks continuity readiness without granting retry authority', () => {
  const row = buildRestartContinuityEvidenceV2(base({ activeActuationLease: true }));
  assert.equal(row.continuity_safe, false);
  assert.equal(row.restart_authorized, false);
  assert.equal(row.automatic_retry_allowed, false);
});

test('verified download mutation blocks continuity readiness', () => {
  const row = buildRestartContinuityEvidenceV2(base({ verifiedDownloadMutationActive: true }));
  assert.equal(row.continuity_safe, false);
});

test('failed state read or missing durable handoff blocks readiness', () => {
  assert.equal(buildRestartContinuityEvidenceV2(base({ stateReadOk: false })).continuity_safe, false);
  assert.equal(buildRestartContinuityEvidenceV2(base({ durableHandoffReady: false })).continuity_safe, false);
});

test('binding and hard-blocker facts must be explicit and typed', () => {
  for (const invalid of [
    { workspaceId: '' },
    { clientId: '' },
    { processIncarnationId: '' },
    { supervisorEpoch: -1 },
    { sourceGitSha: 'not-a-sha' },
    { stateReadOk: null },
    { durableHandoffReady: undefined },
    { activeActuationLease: null },
    { verifiedDownloadMutationActive: undefined },
    { activeModelRequest: 'true' },
    { queuedWakes: -1 },
  ]) {
    assert.throws(() => buildRestartContinuityEvidenceV2(base(invalid)), /restart_continuity_/);
  }
});

test('page/model data is not projected into the trusted evidence envelope', () => {
  const row = buildRestartContinuityEvidenceV2({
    ...base(),
    prompt: 'untrusted prompt',
    pageText: 'untrusted page',
    url: 'https://example.invalid',
  });
  assert.equal(Object.hasOwn(row, 'prompt'), false);
  assert.equal(Object.hasOwn(row, 'pageText'), false);
  assert.equal(Object.hasOwn(row, 'url'), false);
});
