export const DEVOS_BASE_COMPATIBILITY_SCHEMA = 'metaengine.devos.base-compatibility.v2';
export const DEVOS_BASE_POLICIES = Object.freeze(['EXACT', 'LATEST', 'ANCESTOR_OK', 'SCOPED_REVALIDATE']);

const POLICIES = new Set(DEVOS_BASE_POLICIES);
const SHA_RE = /^[0-9a-f]{40}$/;

function normalizeSha(value, name) {
  const sha = String(value || '').trim().toLowerCase();
  if (!SHA_RE.test(sha)) throw new Error(`devos_base_${name}_invalid`);
  return sha;
}

function normalizePath(value) {
  const path = String(value || '').trim().replaceAll('\\', '/').replace(/^\.\//, '');
  if (!path || path.startsWith('/') || path.startsWith('../') || path.includes('/../') || path.includes('\u0000')) return null;
  return path.slice(0, 500);
}

function normalizePathSet(value) {
  if (!Array.isArray(value)) return null;
  const out = new Set();
  for (const raw of value) {
    const path = normalizePath(raw);
    if (!path) return null;
    out.add(path);
    if (out.size > 512) return null;
  }
  return out;
}

function pathOverlaps(a, b) {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function scopedDependencies(taskSpec) {
  const read = normalizePathSet(taskSpec?.read_set);
  const write = normalizePathSet(taskSpec?.write_set);
  const contracts = normalizePathSet(taskSpec?.contract_set);
  if (read == null || write == null || contracts == null) return null;
  return new Set([...read, ...write, ...contracts]);
}

function result({ state, reason, policy, oldBase, newBase, dependencyConflict = null, evidence = null }) {
  return Object.freeze({
    schema: DEVOS_BASE_COMPATIBILITY_SCHEMA,
    state,
    reason,
    policy,
    prior_base_sha: oldBase,
    next_base_sha: state === 'REVALIDATE' || state === 'UNCHANGED' ? newBase : oldBase,
    dependency_conflict: dependencyConflict,
    evidence: evidence == null ? null : structuredClone(evidence),
    physical_effect_attempted: false,
    automatic_retry_allowed: false,
    scheduler_authority: false,
    browser_authority: false,
    authority_effect: false,
  });
}

/**
 * Decides whether a READY DevOS task may be rebound to a newer baseline.
 * This is a planning/read-model primitive only; it never mutates a task.
 * Null/unknown policy is intentionally EXACT to preserve current behavior.
 */
export function evaluateDevosBaseCompatibility({
  task,
  authoritative_base_sha,
  changed_paths = null,
  ancestor_proof = null,
} = {}) {
  if (!task || typeof task !== 'object' || Array.isArray(task)) throw new Error('devos_base_task_invalid');
  const oldBase = normalizeSha(task.base_sha, 'task_sha');
  const newBase = normalizeSha(authoritative_base_sha, 'authority_sha');
  const taskSpec = task.task_spec && typeof task.task_spec === 'object' && !Array.isArray(task.task_spec) ? task.task_spec : {};
  const requested = String(taskSpec.base_policy || 'EXACT').trim().toUpperCase();
  const policy = POLICIES.has(requested) ? requested : 'EXACT';
  const claimClass = String(task.claim_class || '').trim().toUpperCase();

  if (oldBase === newBase) return result({ state: 'UNCHANGED', reason: 'BASE_ALREADY_CURRENT', policy, oldBase, newBase });

  if (policy === 'EXACT') return result({ state: 'FENCE', reason: 'EXACT_BASE_REQUIRED', policy, oldBase, newBase });

  // P0 rollout deliberately permits automatic baseline rebinding only for
  // advisory work. Mutating tasks remain exact until path/contract evidence is
  // proven end-to-end at the database authority layer.
  if (claimClass !== 'ADVISORY') {
    return result({ state: 'FENCE', reason: 'MUTATING_BASE_REVALIDATION_NOT_ENABLED', policy, oldBase, newBase });
  }

  if (policy === 'LATEST') {
    return result({ state: 'REVALIDATE', reason: 'ADVISORY_LATEST_BASE', policy, oldBase, newBase });
  }

  if (policy === 'ANCESTOR_OK') {
    const proof = ancestor_proof && typeof ancestor_proof === 'object' && !Array.isArray(ancestor_proof) ? ancestor_proof : null;
    const verified = proof?.verified === true
      && String(proof.ancestor_sha || '').toLowerCase() === oldBase
      && String(proof.descendant_sha || '').toLowerCase() === newBase;
    return verified
      ? result({ state: 'REVALIDATE', reason: 'VERIFIED_ANCESTOR_RELATION', policy, oldBase, newBase, evidence: proof })
      : result({ state: 'FENCE', reason: 'ANCESTOR_PROOF_REQUIRED', policy, oldBase, newBase });
  }

  const dependencies = scopedDependencies(taskSpec);
  const changed = normalizePathSet(changed_paths);
  if (dependencies == null || dependencies.size === 0) {
    return result({ state: 'FENCE', reason: 'SCOPED_DEPENDENCY_SET_REQUIRED', policy, oldBase, newBase });
  }
  if (changed == null) return result({ state: 'FENCE', reason: 'SCOPED_CHANGED_PATHS_REQUIRED', policy, oldBase, newBase });
  const conflict = [...dependencies].find((dep) => [...changed].some((path) => pathOverlaps(dep, path))) || null;
  if (conflict) {
    return result({ state: 'FENCE', reason: 'SCOPED_DEPENDENCY_CHANGED', policy, oldBase, newBase, dependencyConflict: conflict });
  }
  return result({
    state: 'REVALIDATE',
    reason: 'SCOPED_DEPENDENCIES_UNCHANGED',
    policy,
    oldBase,
    newBase,
    evidence: { changed_path_count: changed.size, dependency_path_count: dependencies.size },
  });
}
