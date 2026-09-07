const CONSUMER_RE = /^[a-z][a-z0-9_.:-]{0,95}$/i;
const ZERO_AUTHORITY = Object.freeze({
  scheduler_authority: false,
  dispatch_authority: false,
  lease_authority: false,
  effect_execution_authority: false,
  automatic_retry_allowed: false,
  authority_effect: false,
});

function epoch(value, code) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) throw new TypeError(code);
  return normalized;
}

function consumer(value) {
  const normalized = String(value || '').trim();
  if (!CONSUMER_RE.test(normalized)) throw new TypeError('browser_brain_resume_consumer_invalid');
  return normalized;
}

export function buildBrowserBrainObservationResumeCohorts({ oldest_epoch, latest_epoch, cursors } = {}) {
  const oldest = epoch(oldest_epoch, 'browser_brain_resume_oldest_epoch_invalid');
  const latest = epoch(latest_epoch, 'browser_brain_resume_latest_epoch_invalid');
  if (oldest > latest) throw new RangeError('browser_brain_resume_window_invalid');
  if (!Array.isArray(cursors) || cursors.length > 256) {
    throw new TypeError('browser_brain_resume_cursors_invalid');
  }

  const seen = new Set();
  const cohorts = new Map();
  const resync = [];

  for (const row of cursors) {
    if (!row || typeof row !== 'object') throw new TypeError('browser_brain_resume_cursor_invalid');
    const name = consumer(row.consumer);
    if (seen.has(name)) throw new Error('browser_brain_resume_consumer_duplicate');
    seen.add(name);

    const from = epoch(row.from_epoch, 'browser_brain_resume_from_epoch_invalid');
    if (from > latest) throw new RangeError('browser_brain_resume_future_epoch');
    if (from < Math.max(0, oldest - 1)) {
      resync.push(Object.freeze({ consumer: name, from_epoch: from, canonical_resync_required: true }));
      continue;
    }

    const members = cohorts.get(from) || [];
    members.push(name);
    cohorts.set(from, members);
  }

  const replayCohorts = [...cohorts.entries()]
    .sort(([a], [b]) => a - b)
    .map(([from, members]) => Object.freeze({
      from_epoch: from,
      consumers: Object.freeze([...members].sort()),
      consumer_count: members.length,
      replay_required: from < latest,
    }));

  return Object.freeze({
    schema: 'metaengine.browser-brain.observation-resume-cohorts.v1',
    oldest_epoch: oldest,
    latest_epoch: latest,
    consumer_count: cursors.length,
    cohort_count: replayCohorts.length,
    cohorts: Object.freeze(replayCohorts),
    canonical_resync: Object.freeze(resync.sort((a, b) => a.consumer.localeCompare(b.consumer))),
    canonical_resync_count: resync.length,
    shared_window_read: true,
    payload_persisted: false,
    provider_neutral: true,
    ...ZERO_AUTHORITY,
  });
}

export function browserBrainObservationResumeCohortContract() {
  return Object.freeze({
    schema: 'metaengine.browser-brain.observation-resume-cohort-contract.v1',
    max_consumers: 256,
    groups_equal_epochs: true,
    deterministic_order: true,
    stale_cursor_requires_canonical_resync: true,
    shared_window_read: true,
    payload_persisted: false,
    provider_neutral: true,
    ...ZERO_AUTHORITY,
  });
}
