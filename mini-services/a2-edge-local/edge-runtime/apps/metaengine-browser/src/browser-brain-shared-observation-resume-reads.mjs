const ZERO_AUTHORITY = Object.freeze({
  scheduler_authority: false,
  dispatch_authority: false,
  lease_authority: false,
  effect_execution_authority: false,
  automatic_retry_allowed: false,
  authority_effect: false,
});

function assertPlan(plan) {
  if (!plan || plan.schema !== 'metaengine.browser-brain.observation-resume-cohorts.v1') {
    throw new TypeError('browser_brain_shared_resume_plan_invalid');
  }
  if (!Array.isArray(plan.cohorts) || !Array.isArray(plan.canonical_resync)) {
    throw new TypeError('browser_brain_shared_resume_plan_invalid');
  }
}

function assertWindow(window) {
  if (!window || typeof window.snapshot !== 'function' || typeof window.changesSince !== 'function') {
    throw new TypeError('browser_brain_shared_resume_window_invalid');
  }
}

export function readBrowserBrainObservationResumeCohorts({ window, plan } = {}) {
  assertWindow(window);
  assertPlan(plan);

  const snapshot = window.snapshot();
  if (snapshot.max_epoch !== plan.latest_epoch) {
    throw new Error('browser_brain_shared_resume_plan_stale');
  }

  const sharedReads = [];
  const canonicalResync = [...plan.canonical_resync];
  let physicalReadCount = 0;

  for (const cohort of plan.cohorts) {
    if (!cohort.replay_required) {
      sharedReads.push(Object.freeze({
        from_epoch: cohort.from_epoch,
        to_epoch: snapshot.max_epoch,
        consumers: cohort.consumers,
        consumer_count: cohort.consumer_count,
        replay_required: false,
        events: Object.freeze([]),
      }));
      continue;
    }

    const delta = window.changesSince(cohort.from_epoch);
    physicalReadCount += 1;
    if (delta.resync_required) {
      for (const consumer of cohort.consumers) {
        canonicalResync.push(Object.freeze({
          consumer,
          from_epoch: cohort.from_epoch,
          canonical_resync_required: true,
        }));
      }
      continue;
    }

    sharedReads.push(Object.freeze({
      from_epoch: cohort.from_epoch,
      to_epoch: delta.to_epoch,
      consumers: cohort.consumers,
      consumer_count: cohort.consumer_count,
      replay_required: true,
      events: delta.events,
    }));
  }

  canonicalResync.sort((a, b) => a.consumer.localeCompare(b.consumer));
  return Object.freeze({
    schema: 'metaengine.browser-brain.shared-observation-resume-reads.v1',
    plan_latest_epoch: plan.latest_epoch,
    physical_read_count: physicalReadCount,
    delivery_count: sharedReads.reduce((count, read) => count + read.consumer_count, 0),
    shared_reads: Object.freeze(sharedReads),
    canonical_resync: Object.freeze(canonicalResync),
    canonical_resync_count: canonicalResync.length,
    payload_persisted: false,
    provider_neutral: true,
    ...ZERO_AUTHORITY,
  });
}

export function browserBrainSharedObservationResumeReadContract() {
  return Object.freeze({
    schema: 'metaengine.browser-brain.shared-observation-resume-read-contract.v1',
    one_window_read_per_replay_cohort: true,
    current_cohort_zero_read: true,
    stale_plan_fail_closed: true,
    truncation_requires_canonical_resync: true,
    payload_persisted: false,
    provider_neutral: true,
    ...ZERO_AUTHORITY,
  });
}
