import crypto from 'node:crypto';

export const RSI_SOURCE_IDENTITY_CONVERGENCE_SCHEMA =
  'metaengine.rsi.source-identity-convergence.v1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stable(value[key])]),
  );
}

function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex')}`;
}

function exactSha(value, label) {
  const out = String(value || '').trim().toLowerCase();
  if (!SHA40_RE.test(out)) throw new Error(`rsi_source_identity_${label}_sha_invalid`);
  return out;
}

function exactDigest(value, label) {
  const out = String(value || '').trim().toLowerCase();
  if (!SHA256_RE.test(out)) throw new Error(`rsi_source_identity_${label}_digest_invalid`);
  return out;
}

function boundedId(value, label) {
  const out = String(value || '').trim();
  if (!SAFE_ID_RE.test(out)) throw new Error(`rsi_source_identity_${label}_invalid`);
  return out;
}

function positiveInt(value, label) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 1) {
    throw new Error(`rsi_source_identity_${label}_invalid`);
  }
  return out;
}

function zero(extra = {}) {
  return Object.freeze({
    ...extra,
    execution_authority: false,
    browser_authority: false,
    task_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    signing_authority: false,
    direct_tool_execution_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

function assertZero(row, label) {
  for (const field of [
    'execution_authority',
    'browser_authority',
    'task_authority',
    'production_mutation_authority',
    'promotion_authority',
    'self_update_authority',
    'scheduler_authority',
    'signing_authority',
    'direct_tool_execution_authority',
    'authority_effect',
  ]) {
    if (row?.[field] !== false) {
      throw new Error(`rsi_source_identity_${label}_${field}_invalid`);
    }
  }
  if (row?.automatic_retry_allowed !== false) {
    throw new Error(`rsi_source_identity_${label}_automatic_retry_invalid`);
  }
}

export function createRsiSourceIdentityConvergenceEvidence({
  evidence_id,
  github_source_sha,
  db_authority_baseline_sha,
  runtime_target_git_sha,
  github_ref,
  db_authority_key,
  runtime_client_id,
  db_alignment_epoch,
  github_readback_digest,
  db_authority_readback_digest,
  runtime_readback_digest,
  observed_at,
  external_github_reader = false,
  external_db_reader = false,
  external_runtime_reader = false,
  authored_by_candidate = true,
} = {}) {
  if (
    external_github_reader !== true
    || external_db_reader !== true
    || external_runtime_reader !== true
    || authored_by_candidate !== false
  ) {
    throw new Error('rsi_source_identity_external_readbacks_required');
  }

  const githubSha = exactSha(github_source_sha, 'github_source');
  const dbSha = exactSha(db_authority_baseline_sha, 'db_authority_baseline');
  const runtimeSha = exactSha(runtime_target_git_sha, 'runtime_target_git');
  const blockers = [];
  if (githubSha !== dbSha) blockers.push('GITHUB_DB_SOURCE_MISMATCH');
  if (githubSha !== runtimeSha) blockers.push('GITHUB_RUNTIME_SOURCE_MISMATCH');
  if (dbSha !== runtimeSha) blockers.push('DB_RUNTIME_SOURCE_MISMATCH');

  const converged = blockers.length === 0;
  const core = zero({
    schema: RSI_SOURCE_IDENTITY_CONVERGENCE_SCHEMA,
    version: 1,
    evidence_id: boundedId(evidence_id, 'evidence_id'),
    github_source_sha: githubSha,
    db_authority_baseline_sha: dbSha,
    runtime_target_git_sha: runtimeSha,
    github_ref: boundedId(github_ref, 'github_ref'),
    db_authority_key: boundedId(db_authority_key, 'db_authority_key'),
    runtime_client_id: boundedId(runtime_client_id, 'runtime_client_id'),
    db_alignment_epoch: positiveInt(db_alignment_epoch, 'db_alignment_epoch'),
    github_readback_digest: exactDigest(github_readback_digest, 'github_readback'),
    db_authority_readback_digest: exactDigest(db_authority_readback_digest, 'db_authority_readback'),
    runtime_readback_digest: exactDigest(runtime_readback_digest, 'runtime_readback'),
    observed_at: String(observed_at || '').trim(),
    blockers: Object.freeze(blockers.sort()),
    state: converged ? 'SOURCE_IDENTITY_CONVERGED' : 'SOURCE_IDENTITY_DRIFT',
    source_identity_converged: converged,
    eligible_for_external_admission_review: converged,
    exact_three_way_sha_equality_required: true,
    ancestry_equivalence_allowed: false,
    semantic_equivalence_allowed: false,
    version_string_equivalence_allowed: false,
    external_github_reader: true,
    external_db_reader: true,
    external_runtime_reader: true,
    authored_by_candidate: false,
  });
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(core.observed_at)) {
    throw new Error('rsi_source_identity_observed_at_invalid');
  }
  return Object.freeze({ ...core, evidence_digest: digest(core) });
}

export function verifyRsiSourceIdentityConvergenceEvidence(evidence) {
  if (
    !evidence
    || typeof evidence !== 'object'
    || Array.isArray(evidence)
    || evidence.schema !== RSI_SOURCE_IDENTITY_CONVERGENCE_SCHEMA
    || evidence.version !== 1
  ) {
    throw new Error('rsi_source_identity_evidence_invalid');
  }
  assertZero(evidence, 'evidence');
  const canonical = createRsiSourceIdentityConvergenceEvidence({
    evidence_id: evidence.evidence_id,
    github_source_sha: evidence.github_source_sha,
    db_authority_baseline_sha: evidence.db_authority_baseline_sha,
    runtime_target_git_sha: evidence.runtime_target_git_sha,
    github_ref: evidence.github_ref,
    db_authority_key: evidence.db_authority_key,
    runtime_client_id: evidence.runtime_client_id,
    db_alignment_epoch: evidence.db_alignment_epoch,
    github_readback_digest: evidence.github_readback_digest,
    db_authority_readback_digest: evidence.db_authority_readback_digest,
    runtime_readback_digest: evidence.runtime_readback_digest,
    observed_at: evidence.observed_at,
    external_github_reader: true,
    external_db_reader: true,
    external_runtime_reader: true,
    authored_by_candidate: false,
  });
  if (canonical.evidence_digest !== exactDigest(evidence.evidence_digest, 'evidence')) {
    throw new Error('rsi_source_identity_evidence_digest_mismatch');
  }
  return canonical;
}

export function rsiSourceIdentityConvergenceTrustRootSnapshot() {
  const root = zero({
    schema: 'metaengine.rsi.source-identity-convergence-root.v1',
    version: 1,
    policy_path: 'apps/metaengine-browser/src/rsi-source-identity-convergence.mjs',
    exact_three_way_sha_equality_required: true,
    independent_readback_digests_required: true,
    ancestry_equivalence_allowed: false,
    semantic_equivalence_allowed: false,
    version_string_equivalence_allowed: false,
    drift_blocks_external_admission_review: true,
    candidate_cannot_author_source_identity: true,
  });
  return Object.freeze({ ...root, trust_root_digest: digest(root) });
}
