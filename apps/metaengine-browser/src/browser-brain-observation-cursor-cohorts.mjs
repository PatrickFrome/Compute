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
  if (
    !ledger
    || typeof ledger.preflightResumeRevisions !== 'function'
    || typeof ledger.resumeChangedSince !== 'function'
  ) {
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
  ledger.preflightResumeRevisions(uniqueRevisions);

  const cohortIndexByRevision = new Map(
    uniqueRevisions.map((knownRevision, cohortIndex) => [knownRevision, cohortIndex]),
  );
  const requestCohortIndexes = normalized.map((knownRevision) => cohortIndexByRevision.get(knownRevision));
  const requestIndexesByCohort = Array.from({ length: uniqueRevisions.length }, () => []);
  requestCohortIndexes.forEach((cohortIndex, requestIndex) => {
    requestIndexesByCohort[cohortIndex].push(requestIndex);
  });

  const cohorts = uniqueRevisions.map((knownRevision, cohortIndex) => {
    const delta = ledger.resumeChangedSince(knownRevision);
    return Object.freeze({
      cohort_index: cohortIndex,
      request_indexes: Object.freeze(requestIndexesByCohort[cohortIndex]),
      known_revision: knownRevision,
      revision: delta.revision,
      changed: delta.changed,
      resumes: delta.resumes,
      payload_persisted: false,
      ...ZERO_AUTHORITY,
    });
  });
  const changedCohorts = [];
  const changedCohortIndexes = [];
  const changedRequestIndexes = [];
  cohorts.forEach((cohort) => {
    if (!cohort.changed) return;
    changedCohorts.push(cohort);
    changedCohortIndexes.push(cohort.cohort_index);
    changedRequestIndexes.push(...cohort.request_indexes);
  });
  changedRequestIndexes.sort((a, b) => a - b);

  return Object.freeze({
    schema: 'metaengine.browser-brain.observation-delta-resume-cohorts.v1',
    request_count: normalized.length,
    cohort_count: cohorts.length,
    changed_cohort_count: changedCohorts.length,
    changed_cohorts: Object.freeze(changedCohorts),
    changed_cohort_indexes: Object.freeze(changedCohortIndexes),
    changed_request_indexes: Object.freeze(changedRequestIndexes),
    request_cohort_indexes: Object.freeze(requestCohortIndexes),
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
    request_order_cohort_routing: true,
    cohort_request_fanout_indexes: true,
    changed_work_indexes: true,
    direct_changed_cohort_iteration: true,
    all_revision_requests_preflight_before_delta_materialization: true,
    provider_neutral: true,
    payload_persisted: false,
    ...ZERO_AUTHORITY,
  });
}
