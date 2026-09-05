export const BROWSER_FABRIC_GOVERNANCE_SCHEMA = 'metaengine.browser-fabric.governance.v1';
export const DEFAULT_BRANCH_TTL_MS = 3 * 24 * 60 * 60_000;

function safeDate(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : null;
}

function normalizeDomains(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((row) => String(row || '').trim().toUpperCase()).filter(Boolean))].sort();
}

/**
 * Read-only governance census. It recommends status transitions but never
 * closes/deletes a branch, merges a PR, or changes repository settings.
 */
export function evaluateBrowserFabricGovernance({
  pull_requests = [],
  now = new Date(),
  branch_ttl_ms = DEFAULT_BRANCH_TTL_MS,
} = {}) {
  if (!Array.isArray(pull_requests) || !Number.isFinite(branch_ttl_ms) || branch_ttl_ms <= 0) {
    return Object.freeze({ ok: false, reason: 'GOVERNANCE_INPUT_INVALID', authority_effect: false });
  }
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(nowMs)) return Object.freeze({ ok: false, reason: 'GOVERNANCE_NOW_INVALID', authority_effect: false });

  const active = pull_requests.filter((pr) => pr && pr.state === 'open').map((pr) => ({
    number: Number(pr.number),
    title: String(pr.title || ''),
    head: String(pr.head || ''),
    updated_ms: safeDate(pr.updated_at),
    effect_domains: normalizeDomains(pr.effect_domains),
    authority_changing: pr.authority_changing === true,
    patch_id: pr.patch_id ? String(pr.patch_id) : null,
    draft: pr.draft === true,
  }));

  const stale = active.filter((pr) => pr.updated_ms == null || nowMs - pr.updated_ms > branch_ttl_ms)
    .map((pr) => Object.freeze({ number: pr.number, head: pr.head, recommended_status: 'STALE_EVIDENCE_REQUIRED' }));

  const byPatch = new Map();
  for (const pr of active) {
    if (!pr.patch_id) continue;
    const rows = byPatch.get(pr.patch_id) || [];
    rows.push(pr);
    byPatch.set(pr.patch_id, rows);
  }
  const patch_equivalents = [...byPatch.entries()].filter(([, rows]) => rows.length > 1).map(([patchId, rows]) => Object.freeze({
    patch_id: patchId,
    pull_requests: Object.freeze(rows.map((pr) => pr.number).sort((a, b) => a - b)),
    recommended_action: 'SELECT_ONE_CANONICAL_PR_MARK_OTHERS_SUPERSEDED',
  }));

  const domainOwners = new Map();
  for (const pr of active.filter((row) => row.authority_changing)) {
    for (const domain of pr.effect_domains) {
      const rows = domainOwners.get(domain) || [];
      rows.push(pr.number);
      domainOwners.set(domain, rows);
    }
  }
  const authority_domain_conflicts = [...domainOwners.entries()].filter(([, numbers]) => numbers.length > 1)
    .map(([domain, numbers]) => Object.freeze({
      domain,
      pull_requests: Object.freeze([...numbers].sort((a, b) => a - b)),
      reason: 'MORE_THAN_ONE_AUTHORITY_CHANGING_PR_IN_EFFECT_DOMAIN',
    }));

  return Object.freeze({
    ok: true,
    schema: BROWSER_FABRIC_GOVERNANCE_SCHEMA,
    open_pr_count: active.length,
    stale: Object.freeze(stale),
    patch_equivalents: Object.freeze(patch_equivalents),
    authority_domain_conflicts: Object.freeze(authority_domain_conflicts),
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
    merge_queue_required: true,
    patch_equivalence_by_patch_id_or_range_diff: true,
    one_active_authority_pr_per_effect_domain: true,
    immutable_verified_release_is_promotion_unit: true,
    stale_branch_auto_delete: false,
    mass_merge_stale_heads_allowed: false,
    repository_setting_mutation_allowed: false,
    authority_effect: false,
  });
}
