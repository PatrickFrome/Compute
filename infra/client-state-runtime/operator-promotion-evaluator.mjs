// W7/P5: pure, read-only independent critic. Nothing in this module can
// promote a build, dispatch an effect, call a network provider or roll back.
export const CRITIC_SCHEMA = 'metaengine.p5.independent-critic.v1';
const SHA = /^[a-f0-9]{40}$/i;
const HASH = /^[a-f0-9]{64}$/i;
const ID = /^[a-zA-Z0-9_.:-]{1,128}$/;
const MIN_TRIALS = 8;
const MAX_TRIALS = 128;
const finite = (n, min, max) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
const unique = values => new Set(values).size === values.length;
const validBuild = x => x && SHA.test(x.source_sha ?? '') && HASH.test(x.artifact_sha256 ?? '') &&
  ID.test(x.owner_id ?? '') && Number.isSafeInteger(x.generation) && x.generation >= 0;
const percentile = (samples, fraction) => {
  const ordered = [...samples].sort((a, b) => a - b);
  return ordered[Math.ceil(ordered.length * fraction) - 1];
};
const fixed = number => Math.round(number * 1000) / 1000;

// Source-only regression guard: a useful negative gate, NOT network attestation.
// Runtime network denial and installed-file proof remain separate release gates.
export function auditNoHostedFallback({ supervisorSource, bootstrapSource } = {}) {
  const reasons = [];
  if (typeof supervisorSource !== 'string' || typeof bootstrapSource !== 'string') {
    reasons.push('TRANSPORT_SOURCE_MISSING');
  } else {
    const requiredSupervisor = [
      'export const NATIVE_SUPERVISOR_DEFAULT_BASE = null;',
      "selectedProvider !== 'LOCAL_POSTGRES'",
      "parsed.hostname !== '127.0.0.1'",
      "bootState !== 'READY'",
      'native_supervisor_local_provider_unattested',
    ];
    const requiredBootstrap = [
      "failClosed(env, 'NO_OWNER_CONFIG')",
      'delete env.METAENGINE_SUPERVISOR_BASE_URL;',
      'delete env.METAENGINE_FALLBACK_SUPERVISOR_BASE_URL;',
    ];
    if (!requiredSupervisor.every(snippet => supervisorSource.includes(snippet)) ||
        !requiredBootstrap.every(snippet => bootstrapSource.includes(snippet)))
      reasons.push('LOCAL_OWNER_TRANSPORT_CONTRACT_MISSING');
    if (/https?:\/\/|https:\s*['"`]|supabase\.co|process\.env\.SUPABASE_|NATIVE_SUPERVISOR_DEFAULT_BASE\s*=\s*['"`]/i.test(supervisorSource))
      reasons.push('HOSTED_SUPERVISOR_FALLBACK_DETECTED');
    if (/https?:\/\/|supabase\.co|process\.env\.SUPABASE_|METAENGINE_FALLBACK_SUPERVISOR_BASE_URL\s*=/i.test(bootstrapSource))
      reasons.push('HOSTED_BOOTSTRAP_FALLBACK_DETECTED');
  }
  return Object.freeze({ status: reasons.length ? 'BLOCKED' : 'SOURCE_CONTRACT_PASS', reasons, authority_effect: false,
    runtime_network_proven: false });
}

// Adversarial network spy for isolated evaluators. Attempts are evidence even
// if the caller catches the exception. Do not substitute for an OS network fence.
export function createDenyNetworkProbe() {
  const attempts = [];
  return Object.freeze({
    attempts,
    fetch: async (...args) => {
      attempts.push(String(args[0] ?? '').slice(0, 200));
      throw new Error('hermetic_network_denied');
    },
  });
}

export function evaluateIndependentCandidate(input = {}, { nowMs = Date.now() } = {}) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error('critic_clock_invalid');
  const reasons = [];
  const { baseline, candidate, trials, critic, rollback, fixture_set_sha256, transport } = input ?? {};
  const transportGate = auditNoHostedFallback(transport);
  reasons.push(...transportGate.reasons);
  if (!validBuild(baseline) || !validBuild(candidate) ||
      baseline?.owner_id !== candidate?.owner_id ||
      candidate?.source_sha === baseline?.source_sha ||
      candidate?.generation !== baseline?.generation + 1)
    reasons.push('BUILD_PROVENANCE_OR_GENERATION_INVALID');
  if (!HASH.test(fixture_set_sha256 ?? '')) reasons.push('FIXTURE_IDENTITY_MISSING');
  const reviewerFresh = typeof critic?.observed_at === 'string' && Number.isFinite(Date.parse(critic.observed_at)) &&
    Date.parse(critic.observed_at) <= nowMs + 5000 && nowMs - Date.parse(critic.observed_at) <= 3_600_000;
  if (!critic || critic.disposition !== 'PASS' || critic.independent !== true ||
      !ID.test(critic.actor_id ?? '') || !ID.test(critic.implementer_id ?? '') ||
      critic.actor_id === critic.implementer_id ||
      critic.source_sha !== candidate?.source_sha ||
      critic.fixture_set_sha256 !== fixture_set_sha256 ||
      !HASH.test(critic.isolation_receipt_sha256 ?? '') || !reviewerFresh)
    reasons.push('INDEPENDENT_CRITIC_RECEIPT_UNPROVEN');
  if (!rollback || !validBuild(rollback) ||
      rollback.source_sha !== baseline?.source_sha ||
      rollback.artifact_sha256 !== baseline?.artifact_sha256 ||
      rollback.owner_id !== baseline?.owner_id ||
      rollback.generation !== baseline?.generation ||
      rollback.rehearsal !== 'PASS' || rollback.unresolved_effects !== 0)
    reasons.push('ROLLBACK_NOT_FENCED_OR_REHEARSED');

  const validCount = Array.isArray(trials) && trials.length >= MIN_TRIALS && trials.length <= MAX_TRIALS;
  if (!validCount) reasons.push('TRIAL_COUNT_INVALID');
  const ids = validCount ? trials.map(t => t?.fixture_id) : [];
  if (validCount && (!ids.every(x => ID.test(x ?? '')) || !unique(ids)))
    reasons.push('FIXTURE_PAIRING_AMBIGUOUS');
  const validTrial = t => t && [t.baseline, t.candidate].every(x =>
    x && typeof x.correct === 'boolean' && finite(x.latency_ms, 0.01, 120000)) &&
    Array.isArray(t.network_attempts) && Array.isArray(t.effects);
  if (validCount && !trials.every(validTrial)) reasons.push('TRIAL_EVIDENCE_INCOMPLETE');
  if (validCount && trials.some(t => (Array.isArray(t?.network_attempts) && t.network_attempts.length > 0) ||
    (Array.isArray(t?.effects) && t.effects.length > 0)))
    reasons.push('HERMETIC_ISOLATION_VIOLATED');

  let metrics = null;
  if (validCount && ids.every(x => ID.test(x ?? '')) && unique(ids) && trials.every(validTrial)) {
    const correctBaseline = trials.filter(t => t.baseline.correct).length;
    const correctCandidate = trials.filter(t => t.candidate.correct).length;
    const baselineP95 = percentile(trials.map(t => t.baseline.latency_ms), 0.95);
    const candidateP95 = percentile(trials.map(t => t.candidate.latency_ms), 0.95);
    const baselineMedian = percentile(trials.map(t => t.baseline.latency_ms), 0.5);
    const candidateMedian = percentile(trials.map(t => t.candidate.latency_ms), 0.5);
    const qualityDelta = (correctCandidate - correctBaseline) / trials.length;
    metrics = Object.freeze({
      sample_count: trials.length,
      baseline_quality: fixed(correctBaseline / trials.length),
      candidate_quality: fixed(correctCandidate / trials.length),
      quality_delta: fixed(qualityDelta),
      baseline_p95_ms: fixed(baselineP95),
      candidate_p95_ms: fixed(candidateP95),
      baseline_median_ms: fixed(baselineMedian),
      candidate_median_ms: fixed(candidateMedian),
      p95_improvement_fraction: fixed((baselineP95 - candidateP95) / baselineP95),
    });
    if (trials.some(t => t.baseline.correct && !t.candidate.correct) ||
        correctCandidate / trials.length < 0.95 || qualityDelta < 0)
      reasons.push('QUALITY_REGRESSION');
    if (candidateP95 > baselineP95 || candidateMedian > baselineMedian)
      reasons.push('LATENCY_REGRESSION');
    if (qualityDelta <= 0 && (baselineP95 - candidateP95) / baselineP95 < 0.05)
      reasons.push('NO_MEASURED_IMPROVEMENT');
  }
  // A green hermetic evaluation never authorizes rollout, DB writes or rollback:
  // separate attested release/OS gates and an independent owner must decide.
  return Object.freeze({
    schema: CRITIC_SCHEMA,
    state: reasons.length ? 'BLOCKED' : 'REVIEW_REQUIRED',
    reasons: [...new Set(reasons)],
    metrics,
    transport_source_gate: transportGate.status,
    evidence_scope: 'HERMETIC_SOURCE_ONLY',
    deployment_qualified: false,
    installed_rollback_proven: false,
    promotion_executed: false,
    rollback_executed: false,
    authority_effect: false,
    cloud_fallback_allowed: false,
    automatic_retry_allowed: false,
  });
}
