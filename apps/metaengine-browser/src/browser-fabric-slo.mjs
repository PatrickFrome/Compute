export const BROWSER_FABRIC_SLO_SCHEMA = 'metaengine.browser-fabric.slo-evaluation.v1';

export const BROWSER_FABRIC_SLO_TARGETS = Object.freeze({
  ready_to_claim_p95_ms: 30_000,
  verified_recovery_mttr_ms: 5 * 60_000,
  duplicate_irreversible_effects: 0,
  ambiguity_rate_max: 0.01,
  reconcile_owner_coverage: 1,
  affected_claims_per_cell_failure_max: 1,
  source_live_drift_p95_ms: 10 * 60_000,
  integration_to_verified_artifact_p95_ms: 30 * 60_000,
  causal_chain_coverage: 1,
  open_pr_age_p90_ms: 3 * 24 * 60 * 60_000,
});

function finiteArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every((row) => Number.isFinite(row) && row >= 0);
}

export function percentile(values, p) {
  if (!finiteArray(values) || !(p >= 0 && p <= 1)) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(0, Math.ceil(p * sorted.length) - 1);
  return sorted[rank];
}

function metric(name, value, target, pass, extra = {}) {
  return Object.freeze({ name, value, target, pass, ...extra });
}

/**
 * SLO evaluator for system outcomes. heartbeat_fresh is deliberately ignored:
 * process liveness is not useful-work liveness.
 */
export function evaluateBrowserFabricSlos(snapshot = {}) {
  const targets = BROWSER_FABRIC_SLO_TARGETS;
  const rows = [];

  const readyP95 = percentile(snapshot.ready_to_claim_latency_ms, 0.95);
  rows.push(metric('READY_TO_CLAIM_P95_MS', readyP95, targets.ready_to_claim_p95_ms,
    readyP95 != null && readyP95 < targets.ready_to_claim_p95_ms));

  const recovery = finiteArray(snapshot.verified_recovery_duration_ms)
    ? snapshot.verified_recovery_duration_ms.reduce((a, b) => a + b, 0) / snapshot.verified_recovery_duration_ms.length
    : null;
  rows.push(metric('VERIFIED_RECOVERY_MTTR_MS', recovery, targets.verified_recovery_mttr_ms,
    recovery != null && recovery < targets.verified_recovery_mttr_ms));

  const domains = snapshot.effect_domains && typeof snapshot.effect_domains === 'object'
    ? Object.entries(snapshot.effect_domains) : [];
  let duplicateTotal = 0;
  let ambiguityPass = domains.length > 0;
  let reconcileCoveragePass = domains.length > 0;
  const domainRows = [];
  for (const [domain, value] of domains) {
    const attempted = Number(value?.attempted || 0);
    const ambiguous = Number(value?.ambiguous || 0);
    const duplicates = Number(value?.duplicates || 0);
    const ambiguousWithOwner = Number(value?.ambiguous_with_reconcile_owner || 0);
    duplicateTotal += duplicates;
    const ambiguityRate = attempted > 0 ? ambiguous / attempted : 0;
    const coverage = ambiguous > 0 ? ambiguousWithOwner / ambiguous : 1;
    if (ambiguityRate >= targets.ambiguity_rate_max) ambiguityPass = false;
    if (coverage !== targets.reconcile_owner_coverage) reconcileCoveragePass = false;
    domainRows.push(Object.freeze({ domain, attempted, ambiguous, duplicates, ambiguity_rate: ambiguityRate, reconcile_owner_coverage: coverage }));
  }
  rows.push(metric('DUPLICATE_IRREVERSIBLE_EFFECTS', duplicateTotal, targets.duplicate_irreversible_effects,
    domains.length > 0 && duplicateTotal === targets.duplicate_irreversible_effects));
  rows.push(metric('AMBIGUITY_RATE_PER_DOMAIN', domainRows, `<${targets.ambiguity_rate_max}`, ambiguityPass));
  rows.push(metric('AMBIGUOUS_RECONCILE_OWNER_COVERAGE', domainRows, targets.reconcile_owner_coverage, reconcileCoveragePass));

  const maxAffected = finiteArray(snapshot.affected_claims_per_cell_failure)
    ? Math.max(...snapshot.affected_claims_per_cell_failure) : null;
  rows.push(metric('AFFECTED_CLAIMS_PER_CELL_FAILURE_MAX', maxAffected, targets.affected_claims_per_cell_failure_max,
    maxAffected != null && maxAffected <= targets.affected_claims_per_cell_failure_max));

  const driftP95 = percentile(snapshot.source_live_drift_lag_ms, 0.95);
  rows.push(metric('SOURCE_LIVE_DRIFT_P95_MS', driftP95, targets.source_live_drift_p95_ms,
    driftP95 != null && driftP95 < targets.source_live_drift_p95_ms));

  const releaseP95 = percentile(snapshot.integration_to_verified_artifact_lag_ms, 0.95);
  rows.push(metric('INTEGRATION_TO_VERIFIED_ARTIFACT_P95_MS', releaseP95, targets.integration_to_verified_artifact_p95_ms,
    releaseP95 != null && releaseP95 < targets.integration_to_verified_artifact_p95_ms));

  const totalEffects = Number(snapshot.total_effects || 0);
  const causalEffects = Number(snapshot.effects_with_full_causal_chain || 0);
  const causalCoverage = totalEffects > 0 ? causalEffects / totalEffects : null;
  rows.push(metric('FULL_CAUSAL_CHAIN_COVERAGE', causalCoverage, targets.causal_chain_coverage,
    causalCoverage === targets.causal_chain_coverage));

  const branchP90 = percentile(snapshot.open_pr_age_ms, 0.90);
  rows.push(metric('OPEN_PR_AGE_P90_MS', branchP90, targets.open_pr_age_p90_ms,
    branchP90 != null && branchP90 < targets.open_pr_age_p90_ms));

  const failed = rows.filter((row) => !row.pass).map((row) => row.name);
  return Object.freeze({
    schema: BROWSER_FABRIC_SLO_SCHEMA,
    healthy: failed.length === 0,
    heartbeat_fresh_is_health_proof: false,
    metrics: Object.freeze(rows),
    failed_metrics: Object.freeze(failed),
    authority_effect: false,
  });
}

export function browserFabricSloContract() {
  return Object.freeze({
    schema: BROWSER_FABRIC_SLO_SCHEMA,
    targets: BROWSER_FABRIC_SLO_TARGETS,
    heartbeat_is_useful_work_sli: false,
    ready_to_claim_measured: true,
    verified_recovery_mttr_measured: true,
    duplicate_effects_measured: true,
    ambiguity_per_domain_measured: true,
    isolation_blast_radius_measured: true,
    source_live_drift_measured: true,
    release_lag_measured: true,
    causal_chain_coverage_measured: true,
    branch_age_measured: true,
    authority_effect: false,
  });
}
