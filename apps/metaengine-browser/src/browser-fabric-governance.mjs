import { BROWSER_FABRIC_EXISTING_EFFECT_DOMAINS } from './browser-fabric-effect-domain-policy.mjs';

export const BROWSER_FABRIC_GOVERNANCE_SCHEMA = 'metaengine.browser-fabric.governance.v1';
export const DEFAULT_BRANCH_TTL_MS = 3 * 24 * 60 * 60_000;

const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/;
const DOMAIN = /^[A-Z][A-Z0-9_]{1,63}$/;
const PATCH_ID = /^[0-9a-f]{40}$/;
const KNOWN_EFFECT_DOMAINS = new Set(BROWSER_FABRIC_EXISTING_EFFECT_DOMAINS);

function safeDate(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : null;
}

function normalizeDomains(value) {
  if (!Array.isArray(value)) return null;
  const normalized = [...new Set(value.map((row) => String(row || '').trim().toUpperCase()))];
  if (normalized.some((row) => !DOMAIN.test(row) || !KNOWN_EFFECT_DOMAINS.has(row))) return null;
  return normalized.sort((left, right) => left.localeCompare(right));
}

function normalizePullRequest(pr, nowMs) {
  if (!pr || pr.state !== 'open') return { active: false, row: null, violation: null };
  const number = Number(pr.number);
  const head = String(pr.head || '');
  const updatedMs = safeDate(pr.updated_at);
  const domains = normalizeDomains(pr.effect_domains);
  if (!Number.isSafeInteger(number) || number <= 0 || !BRANCH.test(head)) {
    return { active: true, row: null, violation: `PR_IDENTITY_INVALID:${number || 'unknown'}` };
  }
  if (updatedMs == null || updatedMs > nowMs) {
    return { active: true, row: null, violation: `PR_UPDATED_AT_INVALID:${number}` };
  }
  if (domains == null || pr.effect_domains_verified !== true) {
    return { active: true, row: null, violation: `PR_EFFECT_DOMAIN_EVIDENCE_INVALID:${number}` };
  }
  const patchId = pr.patch_id == null ? null : String(pr.patch_id).toLowerCase();
  if (patchId != null && (!PATCH_ID.test(patchId) || pr.patch_id_verified !== true)) {
    return { active: true, row: null, violation: `PR_PATCH_ID_EVIDENCE_INVALID:${number}` };
  }
  return {
    active: true,
    violation: null,
    row: {
      number,
      title: String(pr.title || ''),
      head,
      updated_ms: updatedMs,
      effect_domains: domains,
      authority_changing: pr.authority_changing === true,
      physical_effect_changing: pr.physical_effect_changing === true,
      patch_id: patchId,
      draft: pr.draft === true,
    },
  };
}

function patchEquivalentGroups(active) {
  const byPatch = new Map();
  for (const pr of active) {
    if (pr.patch_id == null) continue;
    const rows = byPatch.get(pr.patch_id) || [];
    rows.push(pr);
    byPatch.set(pr.patch_id, rows);
  }
  return [...byPatch.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([patchId, rows]) => Object.freeze({
      patch_id: patchId,
      pull_requests: Object.freeze(rows.map((pr) => pr.number).sort((left, right) => left - right)),
      recommended_action: 'SELECT_ONE_CANONICAL_PR_MARK_OTHERS_SUPERSEDED',
    }));
}

function domainConflicts(active, predicate, reason) {
  const owners = new Map();
  for (const pr of active.filter(predicate)) {
    for (const domain of pr.effect_domains) {
      const numbers = owners.get(domain) || [];
      numbers.push(pr.number);
      owners.set(domain, numbers);
    }
  }
  return [...owners.entries()]
    .filter(([, numbers]) => numbers.length > 1)
    .map(([domain, numbers]) => Object.freeze({
      domain,
      pull_requests: Object.freeze([...numbers].sort((left, right) => left - right)),
      reason,
    }));
}

/**
 * Read-only governance census. Effect domains and patch identities must arrive
 * with independently derived evidence; caller labels alone cannot suppress or
 * manufacture conflicts. The function never mutates GitHub.
 */
export function evaluateBrowserFabricGovernance({
  pull_requests = [],
  now = new Date(),
  branch_ttl_ms = DEFAULT_BRANCH_TTL_MS,
} = {}) {
  if (!Array.isArray(pull_requests)
      || !Number.isSafeInteger(branch_ttl_ms)
      || branch_ttl_ms <= 0
      || branch_ttl_ms > DEFAULT_BRANCH_TTL_MS) {
    return Object.freeze({ ok: false, reason: 'GOVERNANCE_INPUT_INVALID', authority_effect: false });
  }
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(nowMs)) return Object.freeze({ ok: false, reason: 'GOVERNANCE_NOW_INVALID', authority_effect: false });

  const normalized = pull_requests.map((pr) => normalizePullRequest(pr, nowMs));
  const violations = normalized.filter((item) => item.violation != null).map((item) => item.violation);
  const active = normalized.filter((item) => item.row != null).map((item) => item.row);
  const numbers = active.map((pr) => pr.number);
  if (new Set(numbers).size !== numbers.length) violations.push('DUPLICATE_PULL_REQUEST_NUMBER');

  const stale = active
    .filter((pr) => nowMs - pr.updated_ms > branch_ttl_ms)
    .map((pr) => Object.freeze({
      number: pr.number,
      head: pr.head,
      recommended_status: 'STALE_EVIDENCE_REQUIRED',
    }));
  const patchEquivalents = patchEquivalentGroups(active);
  const authorityConflicts = domainConflicts(
    active,
    (row) => row.authority_changing,
    'MORE_THAN_ONE_AUTHORITY_CHANGING_PR_IN_EFFECT_DOMAIN',
  );
  const physicalConflicts = domainConflicts(
    active,
    (row) => row.physical_effect_changing,
    'MORE_THAN_ONE_PHYSICAL_EFFECT_PR_IN_EFFECT_DOMAIN',
  );

  return Object.freeze({
    ok: violations.length === 0,
    schema: BROWSER_FABRIC_GOVERNANCE_SCHEMA,
    reason: violations.length === 0 ? 'GOVERNANCE_EVIDENCE_VALID' : 'GOVERNANCE_EVIDENCE_INVALID',
    input_violations: Object.freeze(violations),
    open_pr_count: active.length,
    stale: Object.freeze(stale),
    patch_equivalents: Object.freeze(patchEquivalents),
    authority_domain_conflicts: Object.freeze(authorityConflicts),
    physical_effect_domain_conflicts: Object.freeze(physicalConflicts),
    merge_queue_required: true,
    latest_base_verification_required: true,
    immutable_verified_release_is_promotion_unit: true,
    branch_deletion_automatic: false,
    mass_merge_stale_heads_allowed: false,
    repository_setting_mutation_allowed: false,
    authority_effect: false,
  });
}

export function browserFabricGovernanceContract() {
  return Object.freeze({
    schema: BROWSER_FABRIC_GOVERNANCE_SCHEMA,
    branch_ttl_ms: DEFAULT_BRANCH_TTL_MS,
    caller_cannot_expand_branch_ttl: true,
    future_dated_branch_evidence_forbidden: true,
    patch_equivalence_requires_verified_patch_id: true,
    effect_domains_require_verified_diff_evidence: true,
    merge_queue_required: true,
    one_active_authority_pr_per_effect_domain: true,
    one_active_physical_effect_pr_per_effect_domain: true,
    immutable_verified_release_is_promotion_unit: true,
    stale_branch_auto_delete: false,
    mass_merge_stale_heads_allowed: false,
    repository_setting_mutation_allowed: false,
    authority_effect: false,
  });
}
