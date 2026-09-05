function finiteNonNegative(value, reason) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) throw new Error(reason);
  return normalized;
}

export function percentile(values, p) {
  const exactP = Number(p);
  if (!Number.isFinite(exactP) || exactP < 0 || exactP > 1) throw new Error('slo_percentile_invalid');
  const sorted = [...values].map((value) => finiteNonNegative(value, 'slo_sample_invalid')).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const rank = Math.max(0, Math.ceil(exactP * sorted.length) - 1);
  return sorted[rank];
}

export function usefulWorkSlo({ ready_to_claim_ms = [], recovery_ms = [], effect_attempts = [], source_live_drift_ms = [], traces = [], branch_age_ms = [] } = {}) {
  const attempted = effect_attempts.filter((row) => row?.attempted === true);
  const ambiguous = attempted.filter((row) => String(row?.outcome || '').toUpperCase() === 'AMBIGUOUS');
  const duplicates = attempted.filter((row) => row?.duplicate_irreversible_effect === true);
  const fullTraces = traces.filter((row) => row?.task && row?.claim && row?.effect && row?.target && row?.release && row?.readback);

  const result = Object.freeze({
    schema: 'metaengine.sovereign-slo.v1',
    ready_to_claim_p50_ms: percentile(ready_to_claim_ms, 0.5),
    ready_to_claim_p95_ms: percentile(ready_to_claim_ms, 0.95),
    recovery_p95_ms: percentile(recovery_ms, 0.95),
    duplicate_irreversible_effects: duplicates.length,
    ambiguity_ratio: attempted.length === 0 ? 0 : ambiguous.length / attempted.length,
    source_live_drift_p95_ms: percentile(source_live_drift_ms, 0.95),
    full_causal_trace_ratio: traces.length === 0 ? 1 : fullTraces.length / traces.length,
    branch_age_p90_ms: percentile(branch_age_ms, 0.9),
  });

  return Object.freeze({
    ...result,
    gates: Object.freeze({
      useful_work_latency: result.ready_to_claim_p95_ms == null || result.ready_to_claim_p95_ms < 30_000,
      verified_recovery: result.recovery_p95_ms == null || result.recovery_p95_ms < 300_000,
      duplicate_effects: result.duplicate_irreversible_effects === 0,
      ambiguity: result.ambiguity_ratio < 0.01,
      source_live_drift: result.source_live_drift_p95_ms == null || result.source_live_drift_p95_ms < 600_000,
      traceability: result.full_causal_trace_ratio === 1,
      branch_health: result.branch_age_p90_ms == null || result.branch_age_p90_ms < 259_200_000,
    }),
  });
}

export const SOVEREIGN_SLO_TARGETS = Object.freeze({
  ready_to_claim_p95_ms: 30_000,
  recovery_verified_lt_ms: 300_000,
  duplicate_irreversible_effects: 0,
  ambiguity_ratio_lt: 0.01,
  source_live_drift_lt_ms: 600_000,
  release_verified_artifact_lt_ms: 1_800_000,
  causal_trace_coverage: 1,
  branch_age_p90_lt_ms: 259_200_000,
  cell_failure_affected_claims_max: 1,
});
