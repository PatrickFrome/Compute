import test from 'node:test';
import assert from 'node:assert/strict';
import { browserBrainObservationCursorContract } from '../src/browser-brain-observation-cursors.mjs';
import { browserBrainObservationCursorCohortContract } from '../src/browser-brain-observation-cursor-cohorts.mjs';

test('converged successor retains bounded cursor delta/cohort contracts', () => {
  const cursor = browserBrainObservationCursorContract();
  const cohort = browserBrainObservationCursorCohortContract();
  assert.equal(cursor.revision_gated_delta_resume, true);
  assert.equal(cursor.bounded_resume_revision_preflight, true);
  assert.equal(cohort.equal_revision_requests_share_one_materialization, true);
  assert.equal(cursor.authority_effect, false);
  assert.equal(cohort.authority_effect, false);
});
