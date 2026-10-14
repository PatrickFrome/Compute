// W31 Client-only, read-only source qualification. No scheduler, network URL, or database effect.
// Callbacks must be bound by the trusted native Owner to own PG17 and by the
// GitHub connector to the exact repository. A page/model object is never a callback.
export const CLIENT_AGENT_COMPLETION_SCHEMA = 'metaengine.operator.agent-completion-evidence.v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const AGENT = /^agent_[a-z0-9-]{8,64}$/;
const MAX_AGE_MS = 300_000;
const MAX_READY_MS = 86_400_000;

const obj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const positive = x => Number.isSafeInteger(x) && x > 0;
const iso = x => typeof x === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(x) && Number.isFinite(Date.parse(x)) ? Date.parse(x) : null;
const norm = x => String(x ?? '').toLowerCase();
function verdict(state, reason, extra = {}) {
  return Object.freeze({
    schema: CLIENT_AGENT_COMPLETION_SCHEMA,
    state, reason,
    source_evidence_qualified: state === 'SOURCE_EVIDENCE_READY',
    successful_completion: false, // only an independent native acceptance may promote
    promotion_authorized: false,
    independent_live_attestation_verified: false,
    automatic_retry_allowed: false,
    authority_effect: false,
    ...extra,
  });
}
function expectedBinding(e) {
  if (!obj(e) || !UUID.test(String(e.task_id || '')) || !UUID.test(String(e.run_id || ''))
      || !positive(e.owner_epoch) || !positive(e.lease_generation)
      || !AGENT.test(String(e.agent_id || '')) || !SHA40.test(String(e.source_sha || ''))
      || !REPO.test(String(e.repository || '')) || !positive(e.pr_number)
      || !Array.isArray(e.required_checks) || e.required_checks.length === 0 || e.required_checks.length > 16
      || e.required_checks.some(x => typeof x !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9 _./:()-]{0,119}$/.test(x))
      || new Set(e.required_checks).size !== e.required_checks.length) return null;
  return Object.freeze({
    task_id: norm(e.task_id), run_id: norm(e.run_id), owner_epoch: e.owner_epoch,
    lease_generation: e.lease_generation, agent_id: e.agent_id,
    source_sha: norm(e.source_sha), repository: e.repository, pr_number: e.pr_number,
    required_checks: [...e.required_checks],
  });
}
function sameTask(b, row) {
  return obj(row) && norm(row.task_id) === b.task_id && norm(row.run_id) === b.run_id
    && row.owner_epoch === b.owner_epoch && row.lease_generation === b.lease_generation
    && row.agent_id === b.agent_id && norm(row.source_sha) === b.source_sha;
}

export function qualifyClientAgentCompletion({ expected, task, pull_request, checks, observed_at_ms = Date.now(), max_age_ms = MAX_AGE_MS } = {}) {
  const b = expectedBinding(expected);
  if (!b) return verdict('UNKNOWN', 'EXPECTED_BINDING_INVALID');
  if (!Number.isSafeInteger(observed_at_ms) || observed_at_ms < 0
      || !Number.isSafeInteger(max_age_ms) || max_age_ms < 1 || max_age_ms > MAX_AGE_MS) return verdict('UNKNOWN', 'CLOCK_OR_FRESHNESS_INVALID');
  if (!sameTask(b, task) || task.schema !== 'metaengine.operator.task-readback.v1'
      || task.readback_source !== 'OWN_POSTGRES' || task.authority_effect !== false) return verdict('UNKNOWN', 'OWN_PG_TASK_READBACK_INVALID');
  const observed = iso(task.observed_at);
  if (observed === null || observed > observed_at_ms || observed_at_ms - observed > max_age_ms) return verdict('STALE', 'OWN_PG_TASK_READBACK_STALE');
  if (task.state === 'AMBIGUOUS') return verdict('AMBIGUOUS', 'TASK_EFFECT_AMBIGUOUS');
  if (task.state === 'BLOCKED' || task.state === 'FAILED' || task.state === 'CANCELLED') return verdict('BLOCKED', 'TASK_NOT_SUCCESSFUL');
  const ready = iso(task.result_ready_at);
  const expiry = iso(task.result_ready_expires_at);
  if (ready === null || expiry === null || expiry <= ready || expiry - ready > MAX_READY_MS || ready > observed_at_ms) return verdict('UNKNOWN', 'RESULT_READY_WINDOW_INVALID');
  if (observed_at_ms >= expiry) return verdict('EXPIRED', 'RESULT_READY_EXPIRED');
  if (task.state !== 'COMPLETED') return verdict('PENDING', task.state === 'RESULT_READY' ? 'INDEPENDENT_ACCEPTANCE_PENDING' : 'TASK_NOT_COMPLETED');
  const completed = iso(task.completed_at);
  const digest = norm(task.result_sha256);
  if (!SHA256.test(digest) || completed === null || completed < ready || completed >= expiry || completed > observed_at_ms)
    return verdict('UNKNOWN', 'COMPLETION_RECEIPT_INVALID');
  const v = task.verifier;
  if (!obj(v) || v.schema !== 'metaengine.operator.independent-verifier.v1'
      || v.readback_source !== 'OWN_POSTGRES' || v.authority_effect !== false
      || v.verdict !== 'ACCEPT' || !['CRITIC', 'FALSIFIER'].includes(v.role)
      || !AGENT.test(String(v.agent_id || '')) || v.agent_id === b.agent_id
      || norm(v.task_id) !== b.task_id || norm(v.subject_result_sha256) !== digest
      || norm(v.run_id) !== b.run_id || v.owner_epoch !== b.owner_epoch
      || v.lease_generation !== b.lease_generation
      || iso(v.verified_at) === null || iso(v.verified_at) < ready
      || iso(v.verified_at) > completed || iso(v.verified_at) >= expiry) return verdict('PENDING', 'INDEPENDENT_VERIFIER_NOT_PROVEN');
  if (!obj(pull_request) || pull_request.source !== 'GITHUB_API'
      || pull_request.number !== b.pr_number || pull_request.state !== 'open'
      || norm(pull_request.head?.sha) !== b.source_sha
      || pull_request.head?.repo?.full_name !== b.repository
      || pull_request.base?.repo?.full_name !== b.repository) return verdict('PENDING', 'GITHUB_PR_IDENTITY_UNPROVEN');
  if (!obj(checks) || checks.source !== 'GITHUB_API'
      || norm(checks.head_sha) !== b.source_sha || !Array.isArray(checks.check_runs)
      || checks.check_runs.length > 128 || checks.check_runs.length < b.required_checks.length
      || checks.total_count !== checks.check_runs.length) return verdict('PENDING', 'GITHUB_CHECK_READBACK_INVALID');
  for (const name of b.required_checks) {
    const matches = checks.check_runs.filter(c => c?.name === name);
    if (matches.length !== 1) return verdict('PENDING', 'GITHUB_CHECK_MISSING_OR_DUPLICATE');
    const c = matches[0];
    const completedAt = iso(c.completed_at);
    if (!positive(c.id) || norm(c.head_sha) !== b.source_sha
        || c.status !== 'completed' || c.conclusion !== 'success'
        || completedAt === null || completedAt > observed_at_ms)
      return verdict('PENDING', 'GITHUB_CHECK_NOT_EXACT_GREEN');
  }
  return verdict('SOURCE_EVIDENCE_READY', 'AWAIT_INDEPENDENT_NATIVE_ACCEPTANCE', {
    task_id: b.task_id, run_id: b.run_id, lease_generation: b.lease_generation,
    owner_epoch: b.owner_epoch, source_sha: b.source_sha, repository: b.repository,
    pr_number: b.pr_number, result_sha256: digest,
    github_check_count: b.required_checks.length,
    result_ready_expires_at: task.result_ready_expires_at,
    // No raw agent output, URLs, prompt, tokens or SQL leave this projection.
  });
}

export async function readClientAgentCompletion({ expected, readOwnTask, readGitHubPull, readGitHubChecks, observed_at_ms = Date.now() } = {}) {
  const b = expectedBinding(expected);
  if (!b) return verdict('UNKNOWN', 'EXPECTED_BINDING_INVALID');
  if (![readOwnTask, readGitHubPull, readGitHubChecks].every(f => typeof f === 'function'))
    return verdict('UNKNOWN', 'TRUSTED_READERS_NOT_BOUND');
  try {
    // Exact typed reader arguments; no user-supplied URL, SQL, shell or tokens.
    const task = await readOwnTask({ task_id: b.task_id, run_id: b.run_id, owner_epoch: b.owner_epoch, lease_generation: b.lease_generation });
    const preliminary = qualifyClientAgentCompletion({
      expected: b, task, observed_at_ms,
      pull_request: null, checks: null,
    });
    if (preliminary.reason !== 'GITHUB_PR_IDENTITY_UNPROVEN') return preliminary;
    const pull_request = await readGitHubPull({ repository: b.repository, pr_number: b.pr_number });
    if (!obj(pull_request) || pull_request.source !== 'GITHUB_API' || pull_request.number !== b.pr_number
        || norm(pull_request.head?.sha) !== b.source_sha) return verdict('PENDING', 'GITHUB_PR_IDENTITY_UNPROVEN');
    const checks = await readGitHubChecks({ repository: b.repository, sha: b.source_sha });
    return qualifyClientAgentCompletion({ expected: b, task, pull_request, checks, observed_at_ms });
  } catch {
    return verdict('UNKNOWN', 'SOURCE_READBACK_FAILED');
  }
}
