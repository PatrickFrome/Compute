import crypto from 'node:crypto';

import {
  RsiShadowArchive,
  RSI_HARD_INVARIANTS,
} from './rsi-shadow-core.mjs';
import { RsiShadowObserver } from './rsi-shadow-observer.mjs';
import { RsiVerifiedEvolutionArchive } from './rsi-verified-evolution-archive.mjs';
import { rsiTournamentTrustRootSnapshot } from './rsi-shadow-tournament.mjs';
import { rsiPromotionGateTrustRootSnapshot } from './rsi-promotion-admission-gate.mjs';
import { rsiEvaluatorRootSnapshot } from './rsi-evaluator-mesh.mjs';
import { rsiOpenEndedSearchTrustRootSnapshot } from './rsi-open-ended-search-policy.mjs';
import { rsiAdaptiveRetrievalTrustRootSnapshot } from './rsi-adaptive-experience-retrieval.mjs';
import { rsiAdversarialChallengeTrustRootSnapshot } from './rsi-adversarial-challenge-producer.mjs';
import { rsiAgentArchitectureSearchTrustRootSnapshot } from './rsi-agent-architecture-search.mjs';
import { rsiAsynchronousIslandTrustRootSnapshot } from './rsi-asynchronous-island-portfolio.mjs';
import { rsiBenchmarkProvenanceTrustRootSnapshot } from './rsi-benchmark-provenance-guard.mjs';
import { rsiCladeMetaproductivityTrustRootSnapshot } from './rsi-clade-metaproductivity.mjs';
import { rsiComparativeLineageTrustRootSnapshot } from './rsi-comparative-lineage-operators.mjs';
import { rsiComponentAttributionTrustRootSnapshot } from './rsi-component-attribution.mjs';
import { rsiContrastiveSkillReliabilityTrustRootSnapshot } from './rsi-contrastive-skill-reliability.mjs';
import { rsiDisagreementAcquisitionTrustRootSnapshot } from './rsi-disagreement-acquisition.mjs';
import { rsiExperienceGraphTrustRootSnapshot } from './rsi-experience-graph.mjs';
import { rsiFrontierCoevolutionTrustRootSnapshot } from './rsi-frontier-coevolution.mjs';
import { rsiGroupExperienceTrustRootSnapshot } from './rsi-group-experience-exchange.mjs';
import { rsiHierarchicalEvaluationEconomyTrustRootSnapshot } from './rsi-hierarchical-evaluation-economy.mjs';
import { rsiMetaSkillEvolutionTrustRootSnapshot } from './rsi-meta-skill-evolution.mjs';
import { rsiProxyCalibrationTrustRootSnapshot } from './rsi-proxy-reliability-calibration.mjs';
import { rsiRecursiveDepthTrustRootSnapshot } from './rsi-recursive-depth-controller.mjs';
import { rsiRecursiveRiskTrustRootSnapshot } from './rsi-recursive-risk-budget.mjs';
import { rsiRegressionReplayTrustRootSnapshot } from './rsi-regression-replay.mjs';
import { rsiSkillLibraryGovernanceTrustRootSnapshot } from './rsi-skill-library-governance.mjs';
import { rsiSkillScopeExpansionTrustRootSnapshot } from './rsi-skill-scope-expansion.mjs';
import { rsiTraceGuidedHarnessRepairTrustRootSnapshot } from './rsi-trace-guided-harness-repair.mjs';
import { rsiVerifiedSkillLibraryTrustRootSnapshot } from './rsi-verified-skill-library.mjs';
import { rsiMemoryGovernanceTrustRootSnapshot } from './rsi-memory-governance.mjs';
import { rsiOperationalDistillationTrustRootSnapshot } from './rsi-operational-knowledge-distillation.mjs';
import { rsiFixedSkeletonTrustRootSnapshot } from './rsi-fixed-skeleton-mutation.mjs';
import { rsiSearchModeRouterTrustRootSnapshot } from './rsi-search-mode-router.mjs';
import { rsiEvaluationIntegrityTrustRootSnapshot } from './rsi-evaluation-integrity-guard.mjs';
import { RsiRuntimeLedger } from './rsi-runtime-ledger.mjs';
import { createRsiBrowserOutcomeEpisode, rsiBrowserOutcomeIngestTrustRootSnapshot } from './rsi-browser-outcome-ingest.mjs';

export const RSI_RUNTIME_SERVICE_SCHEMA = 'metaengine.rsi.runtime-service.v1';
export const RSI_RUNTIME_MODE = 'SHADOW_VERIFIED';

const SHA40 = /^[0-9a-f]{40}$/;
const DIGEST64 = /^[0-9a-f]{64}$/;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function exactSha(value, field = 'source_sha') {
  const sha = String(value || '').trim().toLowerCase();
  if (!SHA40.test(sha)) throw new Error(`rsi_runtime_${field}_invalid`);
  return sha;
}

function exactDigest(value, field) {
  const v = String(value || '').trim().toLowerCase();
  if (!DIGEST64.test(v)) throw new Error(`rsi_runtime_${field}_invalid`);
  return v;
}

function trustRoots() {
  const roots = {
    evaluator: rsiEvaluatorRootSnapshot(),
    tournament: rsiTournamentTrustRootSnapshot(),
    promotion_gate: rsiPromotionGateTrustRootSnapshot(),
    open_ended_search: rsiOpenEndedSearchTrustRootSnapshot(),
    adaptive_retrieval: rsiAdaptiveRetrievalTrustRootSnapshot(),
    adversarial_curriculum: rsiAdversarialChallengeTrustRootSnapshot(),
    architecture_search: rsiAgentArchitectureSearchTrustRootSnapshot(),
    asynchronous_islands: rsiAsynchronousIslandTrustRootSnapshot(),
    benchmark_provenance: rsiBenchmarkProvenanceTrustRootSnapshot(),
    clade_metaproductivity: rsiCladeMetaproductivityTrustRootSnapshot(),
    comparative_lineage: rsiComparativeLineageTrustRootSnapshot(),
    component_attribution: rsiComponentAttributionTrustRootSnapshot(),
    contrastive_skill_reliability: rsiContrastiveSkillReliabilityTrustRootSnapshot(),
    disagreement_acquisition: rsiDisagreementAcquisitionTrustRootSnapshot(),
    experience_graph: rsiExperienceGraphTrustRootSnapshot(),
    frontier_coevolution: rsiFrontierCoevolutionTrustRootSnapshot(),
    group_experience: rsiGroupExperienceTrustRootSnapshot(),
    evaluation_economy: rsiHierarchicalEvaluationEconomyTrustRootSnapshot(),
    meta_skill_evolution: rsiMetaSkillEvolutionTrustRootSnapshot(),
    proxy_calibration: rsiProxyCalibrationTrustRootSnapshot(),
    recursive_depth: rsiRecursiveDepthTrustRootSnapshot(),
    recursive_risk: rsiRecursiveRiskTrustRootSnapshot(),
    regression_replay: rsiRegressionReplayTrustRootSnapshot(),
    skill_library: rsiVerifiedSkillLibraryTrustRootSnapshot(),
    skill_governance: rsiSkillLibraryGovernanceTrustRootSnapshot(),
    skill_scope_expansion: rsiSkillScopeExpansionTrustRootSnapshot(),
    trace_guided_harness_repair: rsiTraceGuidedHarnessRepairTrustRootSnapshot(),
    memory_governance: rsiMemoryGovernanceTrustRootSnapshot(),
    operational_distillation: rsiOperationalDistillationTrustRootSnapshot(),
    fixed_skeleton_mutation: rsiFixedSkeletonTrustRootSnapshot(),
    search_mode_router: rsiSearchModeRouterTrustRootSnapshot(),
    evaluation_integrity: rsiEvaluationIntegrityTrustRootSnapshot(),
    browser_outcome_ingest: rsiBrowserOutcomeIngestTrustRootSnapshot(),
  };
  return Object.freeze(Object.fromEntries(
    Object.entries(roots).map(([name, root]) => [name, Object.freeze({
      schema: root?.schema || null,
      digest: digest(root),
      authority_effect: false,
    })]),
  ));
}

export class RsiRuntimeService {
  #sourceSha;
  #clock;
  #ledger;
  #archive;
  #observer;
  #verifiedArchive;
  #roots;
  #running = false;
  #startedAt = null;
  #lastObservationDigest = null;
  #lastObservationAt = null;
  #promotionNominationCount = 0;
  #browserOutcomeCount = 0;
  #browserOutcomeLearningEligibleCount = 0;
  #browserOutcomeQuarantinedCount = 0;
  #lastBrowserOutcomeDigest = null;

  constructor({ source_sha, ledgerPath, clock = () => Date.now() } = {}) {
    this.#sourceSha = exactSha(source_sha);
    if (typeof clock !== 'function') throw new Error('rsi_runtime_clock_required');
    this.#clock = clock;
    this.#ledger = new RsiRuntimeLedger({ ledgerPath, source_sha: this.#sourceSha, clock });
    this.#archive = new RsiShadowArchive({ clock });
    this.#observer = new RsiShadowObserver({ source_sha: this.#sourceSha, clock });
    this.#verifiedArchive = new RsiVerifiedEvolutionArchive({ clock });
    this.#roots = trustRoots();
  }

  async start() {
    if (this.#running) return this.snapshot();
    await this.#ledger.init();
    this.#startedAt = new Date(this.#clock()).toISOString();
    await this.#ledger.append('RUNTIME_BOUND', {
      runtime_schema: RSI_RUNTIME_SERVICE_SCHEMA,
      runtime_mode: RSI_RUNTIME_MODE,
      source_sha: this.#sourceSha,
      trust_root_set_digest: digest(this.#roots),
      candidate_effect_executor_exposed: false,
      direct_promotion_enabled: false,
      self_update_authority: false,
      authority_effect: false,
    });
    this.#running = true;
    return this.snapshot();
  }

  #assertRunning() {
    if (!this.#running) throw new Error('rsi_runtime_not_started');
  }

  async observeBrainSnapshot(snapshot) {
    this.#assertRunning();
    const observation = this.#observer.observeBrainSnapshot(snapshot);
    this.#lastObservationDigest = digest(observation);
    this.#lastObservationAt = new Date(this.#clock()).toISOString();
    await this.#ledger.append('BRAIN_OBSERVATION', {
      observation_schema: observation?.schema || null,
      observation_digest: this.#lastObservationDigest,
      opportunity_count: Array.isArray(observation?.opportunities) ? observation.opportunities.length : 0,
      authority_effect: false,
    });
    return observation;
  }

  async proposeCandidate(input = {}) {
    this.#assertRunning();
    const parentSha = exactSha(input.parent_sha || this.#sourceSha, 'parent_sha');
    if (parentSha !== this.#sourceSha) throw new Error('rsi_runtime_candidate_parent_not_bound_source');
    const candidate = this.#archive.propose({ ...input, parent_sha: parentSha });
    await this.#ledger.append('CANDIDATE_PROPOSED', {
      candidate_id: candidate.candidate_id,
      parent_sha: candidate.parent_sha,
      candidate_sha: candidate.candidate_sha,
      mutation_surface: candidate.mutation_surface,
      candidate_digest: candidate.candidate_digest,
      shadow_only: true,
      authority_effect: false,
    });
    return candidate;
  }

  async beginEvaluation(candidateId) {
    this.#assertRunning();
    const candidate = this.#archive.beginEvaluation(candidateId);
    await this.#ledger.append('EVALUATION_STARTED', {
      candidate_id: candidate.candidate_id,
      candidate_sha: candidate.candidate_sha,
      authority_effect: false,
    });
    return candidate;
  }

  async recordInvariant(candidateId, evidence) {
    this.#assertRunning();
    const row = this.#archive.recordInvariant(candidateId, evidence);
    await this.#ledger.append('INVARIANT_RECORDED', {
      candidate_id: candidateId,
      invariant: row.invariant,
      result: row.result,
      evidence_digest: row.evidence_digest,
      authority_effect: false,
    });
    return row;
  }

  async recordObjective(candidateId, evidence) {
    this.#assertRunning();
    const row = this.#archive.recordObjective(candidateId, evidence);
    await this.#ledger.append('OBJECTIVE_RECORDED', {
      candidate_id: candidateId,
      objective: row.objective?.name || null,
      improved: row.improved === true,
      evidence_digest: row.evidence_digest,
      authority_effect: false,
    });
    return row;
  }

  async finalizeCandidate(candidateId) {
    this.#assertRunning();
    const candidate = this.#archive.finalize(candidateId);
    await this.#ledger.append('CANDIDATE_FINALIZED', {
      candidate_id: candidate.candidate_id,
      candidate_sha: candidate.candidate_sha,
      state: candidate.state,
      final_digest: candidate.final_digest,
      authority_effect: false,
    });
    return candidate;
  }

  async ingestBrowserOutcome({ readback, attribution } = {}) {
    this.#assertRunning();
    const episode = createRsiBrowserOutcomeEpisode({
      source_sha: this.#sourceSha,
      readback,
      attribution,
    });
    await this.#ledger.append('BROWSER_OUTCOME_INGESTED', {
      episode_digest: episode.episode_digest,
      receipt_digest: episode.receipt_digest,
      context_digest: episode.context_digest,
      command_id: episode.command_id,
      terminal_status: episode.terminal_status,
      action: episode.action,
      effect_outcome: episode.effect_outcome,
      outcome_state: episode.outcome_state,
      candidate_id: episode.candidate_id,
      candidate_sha: episode.candidate_sha,
      proposal_digest: episode.proposal_digest,
      skill_digests: episode.skill_digests,
      eligible_for_experience_graph: episode.eligible_for_experience_graph,
      eligible_for_skill_evidence: episode.eligible_for_skill_evidence,
      quarantined: episode.quarantined,
      raw_result_stored: false,
      raw_error_stored: false,
      physical_effect_replay_allowed: false,
      authority_effect: false,
    });
    this.#browserOutcomeCount += 1;
    if (episode.eligible_for_experience_graph) this.#browserOutcomeLearningEligibleCount += 1;
    if (episode.quarantined) this.#browserOutcomeQuarantinedCount += 1;
    this.#lastBrowserOutcomeDigest = episode.episode_digest;
    return episode;
  }

  async nominatePromotion({ candidate_id, qualification_digest } = {}) {
    this.#assertRunning();
    const candidate = this.#archive.get(candidate_id);
    if (candidate.state !== 'SHADOW_QUALIFIED') throw new Error('rsi_runtime_candidate_not_shadow_qualified');
    const qualificationDigest = exactDigest(qualification_digest, 'qualification_digest');
    const nomination = Object.freeze({
      schema: 'metaengine.rsi.promotion-nomination.v1',
      candidate_id: candidate.candidate_id,
      candidate_sha: candidate.candidate_sha,
      parent_sha: candidate.parent_sha,
      candidate_final_digest: candidate.final_digest,
      qualification_digest: qualificationDigest,
      source_sha: this.#sourceSha,
      requires_external_promotion_gate: true,
      direct_promotion_enabled: false,
      self_update_authority: false,
      execution_authority: false,
      authority_effect: false,
    });
    await this.#ledger.append('PROMOTION_NOMINATED', nomination);
    this.#promotionNominationCount += 1;
    return nomination;
  }

  verifiedArchive() {
    return this.#verifiedArchive;
  }

  snapshot() {
    const shadow = this.#archive.snapshot();
    return Object.freeze({
      schema: RSI_RUNTIME_SERVICE_SCHEMA,
      version: 1,
      state: this.#running ? 'READY' : 'CREATED',
      mode: RSI_RUNTIME_MODE,
      source_sha: this.#sourceSha,
      started_at: this.#startedAt,
      trust_roots: this.#roots,
      trust_root_count: Object.keys(this.#roots).length,
      trust_root_set_digest: digest(this.#roots),
      hard_invariants: [...RSI_HARD_INVARIANTS],
      candidate_count: shadow.candidate_count,
      candidate_state_counts: shadow.candidates.reduce((acc, row) => {
        acc[row.state] = (acc[row.state] || 0) + 1;
        return acc;
      }, {}),
      last_observation_digest: this.#lastObservationDigest,
      last_observation_at: this.#lastObservationAt,
      promotion_nomination_count: this.#promotionNominationCount,
      browser_outcome_ingest: Object.freeze({
        terminal_receipt_readback_required: true,
        outcome_count: this.#browserOutcomeCount,
        learning_eligible_count: this.#browserOutcomeLearningEligibleCount,
        quarantined_count: this.#browserOutcomeQuarantinedCount,
        last_episode_digest: this.#lastBrowserOutcomeDigest,
        ambiguous_outcome_learning_allowed: false,
        raw_result_stored: false,
        authority_effect: false,
      }),
      ledger: this.#ledger.snapshot(),
      shadow_only: true,
      candidate_effect_executor_exposed: false,
      physical_effect_replay_allowed: false,
      direct_promotion_enabled: false,
      direct_self_update_enabled: false,
      page_model_text_authority: false,
      browser_authority: false,
      scheduler_authority: false,
      task_authority: false,
      execution_authority: false,
      production_mutation_authority: false,
      promotion_authority: false,
      self_update_authority: false,
      automatic_retry_allowed: false,
      authority_effect: false,
    });
  }
}
