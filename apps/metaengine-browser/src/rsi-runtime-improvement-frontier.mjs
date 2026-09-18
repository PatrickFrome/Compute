import { buildRsiDevosExperimentPlan } from './rsi-devos-experiment-plan.mjs';
import { buildRsiExperimentHypothesis } from './supervisor-rsi-experiment-hypothesis.mjs';

export const RSI_RUNTIME_IMPROVEMENT_FRONTIER_SCHEMA = 'metaengine.rsi.runtime-improvement-frontier.v1';

const PRIORITY = Object.freeze({ P0: 0, P1: 1, P2: 2, P3: 3 });
const MAX_FRONTIER = 32;
const MAX_PER_OBSERVATION = 8;

function zeroAuthority(value, label) {
  for (const key of [
    'execution_authority',
    'production_mutation_authority',
    'promotion_authority',
    'self_update_authority',
    'authority_effect',
  ]) {
    if (value?.[key] !== false) throw new Error(`rsi_runtime_frontier_${label}_${key}_invalid`);
  }
  if (value?.automatic_retry_allowed !== false) throw new Error(`rsi_runtime_frontier_${label}_retry_invalid`);
}

function sortedOpportunities(observation) {
  return (Array.isArray(observation?.opportunities) ? observation.opportunities : [])
    .slice()
    .sort((a, b) => {
      const pa = PRIORITY[String(a?.priority || '').toUpperCase()] ?? 99;
      const pb = PRIORITY[String(b?.priority || '').toUpperCase()] ?? 99;
      return pa - pb || String(a?.opportunity_id || '').localeCompare(String(b?.opportunity_id || ''));
    })
    .slice(0, MAX_PER_OBSERVATION);
}

function summary(entry) {
  return Object.freeze({
    opportunity_id: entry.opportunity_id,
    signal: entry.signal,
    priority: entry.priority,
    mutation_surface: entry.mutation_surface,
    hypothesis_id: entry.hypothesis.hypothesis_id,
    hypothesis_digest: entry.hypothesis.hypothesis_digest,
    experiment_id: entry.plan.experiment_id,
    plan_digest: entry.plan.plan_digest,
    target_branch: entry.plan.target_branch,
    execution_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

export class RsiRuntimeImprovementFrontier {
  #entries = [];
  #planDigests = new Set();
  #preparedCount = 0;
  #duplicateCount = 0;

  prepare(observation) {
    zeroAuthority(observation, 'observation');
    const prepared = [];
    for (const opportunity of sortedOpportunities(observation)) {
      zeroAuthority(opportunity, 'opportunity');
      const hypothesis = buildRsiExperimentHypothesis({
        observation,
        opportunity_id: opportunity.opportunity_id,
      });
      const plan = buildRsiDevosExperimentPlan({
        observation,
        opportunity_id: opportunity.opportunity_id,
        hypothesis,
      });
      if (this.#planDigests.has(plan.plan_digest)) {
        this.#duplicateCount += 1;
        continue;
      }
      prepared.push(Object.freeze({
        opportunity_id: opportunity.opportunity_id,
        signal: String(opportunity.signal || '').toUpperCase(),
        priority: String(opportunity.priority || '').toUpperCase(),
        mutation_surface: String(opportunity.mutation_surface || '').toUpperCase(),
        observation_digest: observation.observation_digest,
        hypothesis,
        plan,
        execution_authority: false,
        promotion_authority: false,
        self_update_authority: false,
        automatic_retry_allowed: false,
        authority_effect: false,
      }));
    }
    return Object.freeze(prepared);
  }

  commit(prepared) {
    if (!Array.isArray(prepared)) throw new Error('rsi_runtime_frontier_prepared_array_required');
    for (const entry of prepared) {
      zeroAuthority(entry, 'entry');
      if (this.#planDigests.has(entry.plan.plan_digest)) continue;
      this.#planDigests.add(entry.plan.plan_digest);
      this.#entries.push(entry);
      this.#preparedCount += 1;
      if (this.#entries.length > MAX_FRONTIER) {
        const dropped = this.#entries.shift();
        this.#planDigests.delete(dropped.plan.plan_digest);
      }
    }
    return this.snapshot();
  }

  entries({ limit = 16 } = {}) {
    const bounded = Math.max(0, Math.min(MAX_FRONTIER, Number(limit) || 0));
    return Object.freeze(this.#entries.slice(-bounded).map((entry) => structuredClone(entry)));
  }

  snapshot() {
    return Object.freeze({
      schema: RSI_RUNTIME_IMPROVEMENT_FRONTIER_SCHEMA,
      active_count: this.#entries.length,
      prepared_count: this.#preparedCount,
      duplicate_count: this.#duplicateCount,
      max_active: MAX_FRONTIER,
      max_per_observation: MAX_PER_OBSERVATION,
      entries: Object.freeze(this.#entries.map(summary)),
      existing_devos_scheduler_required: true,
      task_lease_created: false,
      workspace_created: false,
      candidate_materialized: false,
      direct_execution_enabled: false,
      direct_promotion_enabled: false,
      direct_self_update_enabled: false,
      execution_authority: false,
      promotion_authority: false,
      self_update_authority: false,
      automatic_retry_allowed: false,
      authority_effect: false,
    });
  }
}
