const MAX_REVISION_REQUESTS = 128;
const ZERO_AUTHORITY = Object.freeze({
  scheduler_authority: false,
  dispatch_authority: false,
  lease_authority: false,
  effect_execution_authority: false,
  automatic_retry_allowed: false,
  authority_effect: false,
});

function normalizeRevision(value) {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new TypeError('browser_brain_cursor_cohort_revision_invalid');
  }
  return revision;
}

function assertLedger(ledger) {
  if (!ledger || typeof ledger.resumeChangedSince !== 'function') {
    throw new TypeError('browser_brain_cursor_cohort_ledger_invalid');
  }
}

export function resumeObservationCursorCohorts(ledger, knownRevisionValues = []) {
  assertLedger(ledger);
  if (!Array.isArray(knownRevisionValues) || knownRevisionValues.length > MAX_REVISION_REQUESTS) {
    throw new TypeError('browser_brain_cursor_cohort_batch_invalid');
  }

  const normalized = knownRevisionValues.map((value) => normalizeRevision(value));
  const uniqueRevisions = [...new Set(normalized)].sort((a, b) => a - b);
  const cohorts = uniqueRevisions.map((knownRevision) => {
    const delta = ledger.resumeChangedSince(knownRevision);
    return Object.freeze({
      known_revision: knownRevision,
      revision: delta.revision,
      changed: delta.changed,
      resumes: delta.resumes,
      payload_persisted: false,
      ...ZERO_AUTHORITY,
    });
  });

  return Object.freeze({
    schema: 'metaengine.browser-brain.observation-delta-resume-cohorts.v1',
    request_count: normalized.length,
    cohort_count: cohorts.length,
    cohorts: Object.freeze(cohorts),
    payload_persisted: false,
    ...ZERO_AUTHORITY,
  });
}

export function browserBrainObservationCursorCohortContract() {
  return Object.freeze({
    schema: 'metaengine.browser-brain.observation-delta-resume-cohort-contract.v1',
    max_revision_requests: MAX_REVISION_REQUESTS,
    equal_revision_requests_share_one_materialization: true,
    deterministic_revision_order: true,
    duplicate_revision_idempotent: true,
    provider_neutral: true,
    payload_persisted: false,
    ...ZERO_AUTHORITY,
  });
}
