export const DEVOS_BASE_COMPATIBILITY_SCHEMA = 'metaengine.devos.base-compatibility.v2';
export const DEVOS_BASE_POLICIES = Object.freeze(['EXACT','ANCESTOR_OK','SCOPED_REVALIDATE','LATEST']);

const POLICY_SET = new Set(DEVOS_BASE_POLICIES);
const HASH_RE = /^[0-9a-f]{40}$/;
const plain = (value) => value && typeof value === 'object' && !Array.isArray(value);

function normalizeSet(value, name) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 256) throw new Error(`devos_base_${name}_invalid`);
  const out = value.map((item) => String(item || '').replaceAll('\\', '/').trim()).filter(Boolean);
  if (out.some((item) => item.length > 400 || item.startsWith('/') || item.includes('/../') || item.startsWith('../'))) throw new Error(`devos_base_${name}_invalid`);
  return [...new Set(out)].sort();
}

function intersects(a, b) {
  const right = new Set(b);
  for (const value of a) if (right.has(value)) return value;
  return null;
}

export function normalizeBaseCompatibilityTask(task) {
  if (!plain(task)) throw new Error('devos_base_task_invalid');
  const createdFromSha = String(task.created_from_sha || '').toLowerCase();
  const policy = String(task.base_policy || 'EXACT').toUpperCase();
  if (!HASH_RE.test(createdFromSha)) throw new Error('devos_base_created_sha_invalid');
  if (!POLICY_SET.has(policy)) throw new Error('devos_base_policy_invalid');
  return Object.freeze({
    created_from_sha: createdFromSha,
    base_policy: policy,
    read_set: Object.freeze(normalizeSet(task.read_set, 'read_set')),
    write_set: Object.freeze(normalizeSet(task.write_set, 'write_set')),
    contract_set: Object.freeze(normalizeSet(task.contract_set, 'contract_set')),
    authority_effect: false,
  });
}

export function evaluateBaseCompatibility(taskInput, transitionInput) {
  const task = normalizeBaseCompatibilityTask(taskInput);
  if (!plain(transitionInput)) throw new Error('devos_base_transition_invalid');
  const nextSha = String(transitionInput.next_sha || '').toLowerCase();
  if (!HASH_RE.test(nextSha)) throw new Error('devos_base_next_sha_invalid');
  const changedPaths = normalizeSet(transitionInput.changed_paths, 'changed_paths');
  const changedContracts = normalizeSet(transitionInput.changed_contracts, 'changed_contracts');
  const isAncestor = transitionInput.is_ancestor === true;

  const receipt = (state, reason, conflict = null) => Object.freeze({
    schema: DEVOS_BASE_COMPATIBILITY_SCHEMA,
    state,
    reason,
    from_sha: task.created_from_sha,
    next_sha: nextSha,
    base_policy: task.base_policy,
    conflict,
    rebind_allowed: state === 'REVALIDATED' || state === 'UNCHANGED',
    automatic_effect_retry_allowed: false,
    authority_effect: false,
  });

  if (nextSha === task.created_from_sha) return receipt('UNCHANGED', 'SAME_SHA');
  if (task.base_policy === 'LATEST') return receipt('REVALIDATED', 'LATEST_ACCEPTS_NEW_BASE');
  if (task.base_policy === 'EXACT') return receipt('FENCED', 'EXACT_SHA_REQUIRED');
  if (task.base_policy === 'ANCESTOR_OK') return isAncestor ? receipt('REVALIDATED', 'ANCESTOR_PRESERVED') : receipt('FENCED', 'ANCESTRY_NOT_PROVEN');

  if (!isAncestor) return receipt('FENCED', 'ANCESTRY_NOT_PROVEN');
  const pathConflict = intersects([...task.read_set, ...task.write_set], changedPaths);
  if (pathConflict) return receipt('FENCED', 'SCOPED_PATH_CONFLICT', pathConflict);
  const contractConflict = intersects(task.contract_set, changedContracts);
  if (contractConflict) return receipt('FENCED', 'SCOPED_CONTRACT_CONFLICT', contractConflict);
  return receipt('REVALIDATED', 'SCOPED_DEPENDENCIES_UNCHANGED');
}
