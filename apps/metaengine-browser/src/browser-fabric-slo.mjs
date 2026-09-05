import { BROWSER_FABRIC_EXISTING_EFFECT_DOMAINS } from './browser-fabric-effect-domain-policy.mjs';

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

const DOMAIN = /^[A-Z][A-Z0-9_]{1,63}$/;
const KNOWN_EFFECT_DOMAINS = new Set(BROWSER_FABRIC_EXISTING_EFFECT_DOMAINS);
const DOMAIN_COUNTER_KEYS = new Set([
  'attempted', 'ambiguous', 'duplicates', 'ambiguous_with_reconcile_owner',
]);

function finiteArray(value) {
  return Array.isArray(value)
    && value.length > 0
    && value.every((row) => Number.isFinite(row) && row >= 0);
}

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function percentile(values, p) {
  if (!finiteArray(values) || !(p >= 0 && p <= 1)) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(0, Math.ceil(p * sorted.length) - 1);
  return sorted[rank];
}

function metric(name, value, target, pass, extra = {}) {
  return Object.freeze({ name, value, target, pass, ...extra });
}

function average(values) {
  if (!finiteArray(values)) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function domainRow(domain, value) {
  if (!DOMAIN.test(domain)
      || !KNOWN_EFFECT_DOMAINS.has(domain)
      || !value
      || typeof value !== 'object'
      || Array.isArray(value)) {
    return { violation: `EFFECT_DOMAIN_INVALID:${domain}`, row: null };
  }
  const keys = Object.keys(value);
  if (keys.length !== DOMAIN_COUNTER_KEYS.size || !keys.every((key) => DOMAIN_COUNTER_KEYS.has(key))) {
    return { violation: `EFFECT_DOMAIN_COUNTER_SCHEMA_INVALID:${domain}`, row: null };
  }
  const attempted = value.attempted;
  const ambiguous = value.ambiguous;
  const duplicates = value.duplicates;
  const owned = value.ambiguous_with_reconcile_owner;
  if (![attempted, ambiguous, duplicates, owned].every(nonNegativeInteger)) {
    return { violation: `EFFECT_DOMAIN_COUNTER_INVALID:${domain}`, row: null };
  }
  if (ambiguous > attempted || duplicates > attempted || owned > ambiguous) {
    return { violation: `EFFECT_DOMAIN_COUNTER_RELATION_INVALID:${domain}`, row: null };
  }
  return {
    violation: null,
    row: Object.freeze({
      domain,
      attempted,
      ambiguous,
      duplicates,
      ambiguity_rate: attempted === 0 ? 0 : ambiguous / attempted,
      reconcile_owner_coverage: ambiguous === 0 ? 1 : owned / ambiguous,
    }),
  };
}

function evaluateDomains(effectDomains, targets) {
  if (!effectDomains || typeof effectDomains !== 'object' || Array.isArray(effectDomains)) {
    return { rows: [], violations: ['EFFECT_DOMAINS_INVALID'] };
  }
  const entries = Object.entries(effectDomains);
  if (entries.length === 0) return { rows: [], violations: ['EFFECT_DOMAINS_EMPTY'] };
  const evaluated = entries.map(([domain, value]) => domainRow(domain, value));
  return {
    rows: evaluated.filter((item) => item.row != null).map((item) => item.row),
    violations: evaluated.filter((item) => item.violation != null).map((item) => item.violation),
    targets,
  };
}

function causalChainMetric(snapshot, target, violations) {
  const total = snapshot.total_effects;
  const causal = snapshot.effects_with_full_causal_chain;
  const valid = nonNegativeInteger(total)
    && nonNegativeInteger(causal)
    && total > 0
    && causal <= total;
  if (!valid) violations.push('CAUSAL_CHAIN_COUNTERS_INVALID');
  const coverage = valid ? causal / total : null;
  return metric('FULL_CAUSAL_CHAIN_COVERAGE', coverage, target, valid && coverage === target);
}

/**
 * SLO evaluator for useful system outcomes. Counter schemas and relationships
 * are fail-closed so malformed or orphan ambiguity cannot appear healthy.
 * heartbeat_fresh is deliberately ignored.
 */
export function evaluateBrowserFabricSlos(snapshot = {}) {
  const targets = BROWSER_FABRIC_SLO_TARGETS;
  const domainEvaluation = evaluateDomains(snapshot.effect_domains, targets);
  const violations = [...domainEvaluation.violations];
  const domainRows = domainEvaluation.rows;
  const duplicateTotal = domainRows.reduce((sum, row) => sum + row.duplicates, 0);
  const domainsValid = violations.length === 0;
  const ambiguityPass = domainsValid
    && domainRows.every((row) => row.ambiguity_rate < targets.ambiguity_rate_max);
  const reconcileCoveragePass = domainsValid
    && domainRows.every((row) => row.reconcile_owner_coverage === targets.reconcile_owner_coverage);

  const readyP95 = percentile(snapshot.ready_to_claim_latency_ms, 0.95);
  const recoveryMean = average(snapshot.verified_recovery_duration_ms);
  const maxAffected = finiteArray(snapshot.affected_claims_per_cell_failure)
    ? Math.max(...snapshot.affected_claims_per_cell_failure)
    : null;
  const driftP95 = percentile(snapshot.source_live_drift_lag_ms, 0.95);
  const releaseP95 = percentile(snapshot.integration_to_verified_artifact_lag_ms, 0.95);
  const branchP90 = percentile(snapshot.open_pr_age_ms, 0.90);

  const rows = [
    metric('READY_TO_CLAIM_P95_MS', readyP95, targets.ready_to_claim_p95_ms,
      readyP95 != null && readyP95 < targets.ready_to_claim_p95_ms),
    metric('VERIFIED_RECOVERY_MTTR_MS', recoveryMean, targets.verified_recovery_mttr_ms,
      recoveryMean != null && recoveryMean < targets.verified_recovery_mttr_ms, { aggregation: 'ARITHMETIC_MEAN' }),
    metric('DUPLICATE_IRREVERSIBLE_EFFECTS', duplicateTotal, targets.duplicate_irreversible_effects,
      domainsValid && duplicateTotal === targets.duplicate_irreversible_effects),
    metric('AMBIGUITY_RATE_PER_DOMAIN', domainRows, `<${targets.ambiguity_rate_max}`, ambiguityPass),
    metric('AMBIGUOUS_RECONCILE_OWNER_COVERAGE', domainRows, targets.reconcile_owner_coverage, reconcileCoveragePass),
    metric('AFFECTED_CLAIMS_PER_CELL_FAILURE_MAX', maxAffected, targets.affected_claims_per_cell_failure_max,
      maxAffected != null && maxAffected <= targets.affected_claims_per_cell_failure_max),
    metric('SOURCE_LIVE_DRIFT_P95_MS', driftP95, targets.source_live_drift_p95_ms,
      driftP95 != null && driftP95 < targets.source_live_drift_p95_ms),
    metric('INTEGRATION_TO_VERIFIED_ARTIFACT_P95_MS', releaseP95, targets.integration_to_verified_artifact_p95_ms,
      releaseP95 != null && releaseP95 < targets.integration_to_verified_artifact_p95_ms),
    causalChainMetric(snapshot, targets.causal_chain_coverage, violations),
    metric('OPEN_PR_AGE_P90_MS', branchP90, targets.open_pr_age_p90_ms,
      branchP90 != null && branchP90 < targets.open_pr_age_p90_ms),
  ];
  const failed = rows.filter((row) => !row.pass).map((row) => row.name);
  return Object.freeze({
    schema: BROWSER_FABRIC_SLO_SCHEMA,
    healthy: violations.length === 0 && failed.length === 0,
    input_valid: violations.length === 0,
    input_violations: Object.freeze(violations),
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
    metric_inputs_fail_closed: true,
    orphan_ambiguity_forbidden: true,
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
