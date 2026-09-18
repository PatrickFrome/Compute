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
import { RsiRuntimeExperienceGate, RSI_RUNTIME_EXPERIENCE_GATE_SCHEMA } from './rsi-runtime-experience-gate.mjs';
import { RsiRuntimeImprovementFrontier, RSI_RUNTIME_IMPROVEMENT_FRONTIER_SCHEMA } from './rsi-runtime-improvement-frontier.mjs';
import { createRsiBrowserOutcomeEpisode, rsiBrowserOutcomeIngestTrustRootSnapshot } from './rsi-browser-outcome-ingest.mjs';
import { RsiEpisodeOrchestrator, rsiEpisodeOrchestratorTrustRootSnapshot } from './rsi-episode-orchestrator.mjs';
import { RsiBrowserCommandAttributionRegistry, rsiBrowserCommandAttributionTrustRootSnapshot } from './rsi-browser-command-attribution-registry.mjs';
import { createRsiTrustedCreditReceipt, createRsiExperienceGraphAdmission, applyRsiExperienceGraphAdmission, rsiTrustedCreditTrustRootSnapshot } from './rsi-trusted-credit-assignment.mjs';

export const RSI_RUNTIME_SERVICE_SCHEMA = 'metaengine.rsi.runtime-service.v1';
export const RSI_RUNTIME_MODE = 'SHADOW_VERIFIED';

const SHA40 = /^[0-9a-f]{40}$/;
const DIGEST64 = /^[0-9a-f]{64}$/;
const SHA256_PREFIXED = /^sha256:[0-9a-f]{64}$/;
const MAX_PENDING_LEARNING_OUTCOMES = 4096;

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
    episode_orchestrator: rsiEpisodeOrchestratorTrustRootSnapshot(),
    browser_command_attribution: rsiBrowserCommandAttributionTrustRootSnapshot(),
    trusted_credit: rsiTrustedCreditTrustRootSnapshot(),
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
  #experienceGate;
  #improvementFrontier;
  #episodes;
  #commandAttributions;
  #pendingLearningOutcomes = new Map();
  #creditedOutcomeDigests = new Set();
  #experienceGraphSnapshot = null;
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
    this.#experienceGate = new RsiRuntimeExperienceGate({ source_sha: this.#sourceSha, clock });
    this.#improvementFrontier = new RsiRuntimeImprovementFrontier();
    this.#archive = new RsiShadowArchive({ clock });
    this.#observer = new RsiShadowObserver({ source_sha: this.#sourceSha, clock });
    this.#verifiedArchive = new RsiVerifiedEvolutionArchive({ clock });
    this.#roots = trustRoots();
    this.#episodes = new RsiEpisodeOrchestrator({
      source_sha: this.#sourceSha,
      trust_root_set_digest: digest(this.#roots),
    });
    this.#commandAttributions = new RsiBrowserCommandAttributionRegistry({ source_sha: this.#sourceSha });
  }

  async start() {
    if (this.#running) return this.snapshot();
    await this.#ledger.init();
    let replayCursor = 0;
    while (true) {
      const page = this.#ledger.eventsSince({ after_seq: replayCursor, limit: 256 });
      if (page.length === 0) break;
      for (const row of page) {
        if (row?.payload?.episode_event) this.#episodes.apply(row.payload.episode_event);
        if (row?.payload?.command_attribution_event) this.#commandAttributions.apply(row.payload.command_attribution_event);
        if (row?.payload?.learning_episode) this.#rememberLearningOutcome(row.payload.learning_episode);
        if (row?.payload?.credit_admission) {
          this.#experienceGraphSnapshot = applyRsiExperienceGraphAdmission({
            previous_snapshot: this.#experienceGraphSnapshot,
            admission: row.payload.credit_admission,
          });
          this.#creditedOutcomeDigests.add(row.payload.credit_admission.outcome_episode_digest);
          this.#pendingLearningOutcomes.delete(row.payload.credit_admission.outcome_episode_digest);
        }
      }
      replayCursor = page.at(-1).seq;
      if (page.length < 256) break;
    }
    this.#startedAt = new Date(this.#clock()).toISOString();
    await this.#ledger.append('RUNTIME_BOUND', {
      runtime_schema: RSI_RUNTIME_SERVICE_SCHEMA,
      runtime_mode: RSI_RUNTIME_MODE,
      source_sha: this.#sourceSha,
      trust_root_set_digest: digest(this.#roots),
      experience_gate_schema: RSI_RUNTIME_EXPERIENCE_GATE_SCHEMA,
      improvement_frontier_schema: RSI_RUNTIME_IMPROVEMENT_FRONTIER_SCHEMA,
      observation_persistence_mode: 'BOUNDED_COALESCED_FSYNC',
      episode_orchestration_mode: 'DURABLE_EVENT_SOURCED_ZERO_AUTHORITY',
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

  #rememberLearningOutcome(episode) {
    if (!episode || episode.eligible_for_experience_graph !== true || typeof episode.episode_digest !== 'string') return;
    if (this.#creditedOutcomeDigests.has(episode.episode_digest)) return;
    if (!this.#pendingLearningOutcomes.has(episode.episode_digest) && this.#pendingLearningOutcomes.size >= MAX_PENDING_LEARNING_OUTCOMES) {
      const oldest = this.#pendingLearningOutcomes.keys().next().value;
      if (oldest) this.#pendingLearningOutcomes.delete(oldest);
    }
    this.#pendingLearningOutcomes.set(episode.episode_digest, Object.freeze(structuredClone(episode)));
  }

  #findPersistedLearningOutcome(episodeDigest) {
    const cached = this.#pendingLearningOutcomes.get(episodeDigest);
    if (cached) return Object.freeze(structuredClone(cached));
    let cursor = 0;
    while (true) {
      const page = this.#ledger.eventsSince({ after_seq: cursor, limit: 256 });
      if (page.length === 0) break;
      for (const row of page) {
        const candidate = row?.payload?.learning_episode;
        if (candidate?.episode_digest === episodeDigest && candidate?.eligible_for_experience_graph === true) {
          return Object.freeze(structuredClone(candidate));
        }
      }
      cursor = page.at(-1).seq;
      if (page.length < 256) break;
    }
    return null;
  }

  async #persistObservationAdmission(admission) {
    if (admission?.action !== 'PERSIST' || !admission?.observation) {
      throw new Error('rsi_runtime_observation_admission_invalid');
    }
    const observation = admission.observation;
    const prepared = this.#improvementFrontier.prepare(observation);
    await this.#ledger.append('BRAIN_OBSERVATION', {
      observation_schema: observation?.schema || null,
      observation_digest: observation.observation_digest,
      experience_signature_digest: admission.signature_digest,
      admission_reason: admission.reason,
      critical: admission.critical === true,
      opportunity_count: Array.isArray(observation?.opportunities) ? observation.opportunities.length : 0,
      observation,
      prepared_experiments: prepared.map((entry) => ({
        opportunity_id: entry.opportunity_id,
        signal: entry.signal,
        priority: entry.priority,
        mutation_surface: entry.mutation_surface,
        hypothesis_id: entry.hypothesis.hypothesis_id,
        hypothesis_digest: entry.hypothesis.hypothesis_digest,
        experiment_id: entry.plan.experiment_id,
        plan_digest: entry.plan.plan_digest,
        target_branch: entry.plan.target_branch,
        authority_effect: false,
      })),
      authority_effect: false,
    });
    this.#experienceGate.commitPersist(admission);
    this.#improvementFrontier.commit(prepared);
    return observation;
  }

  async observeBrainSnapshot(snapshot) {
    this.#assertRunning();
    const observation = this.#observer.observeBrainSnapshot(snapshot);
    this.#lastObservationDigest = digest(observation);
    this.#lastObservationAt = new Date(this.#clock()).toISOString();
    const admission = this.#experienceGate.offer(observation);
    if (admission.action === 'PERSIST') await this.#persistObservationAdmission(admission);
    return observation;
  }

  async flushObservations() {
    this.#assertRunning();
    const admission = this.#experienceGate.flush();
    if (!admission) return false;
    await this.#persistObservationAdmission(admission);
    return true;
  }

  async openEpisode(input = {}) {
    this.#assertRunning();
    const event = this.#episodes.prepareOpen(input);
    await this.#ledger.append('RSI_EPISODE_OPENED', { episode_event: event });
    return this.#episodes.apply(event);
  }

  async registerEpisodeCandidate(input = {}) {
    this.#assertRunning();
    const event = this.#episodes.prepareCandidate(input);
    await this.#ledger.append('RSI_EPISODE_CANDIDATE_REGISTERED', { episode_event: event });
    return this.#episodes.apply(event);
  }

  async recordEpisodeEvidence(input = {}) {
    this.#assertRunning();
    const event = this.#episodes.prepareEvidence(input);
    await this.#ledger.append('RSI_EPISODE_EVIDENCE_RECORDED', { episode_event: event });
    return this.#episodes.apply(event);
  }

  episodeNominationReadiness(input = {}) {
    this.#assertRunning();
    return this.#episodes.nominationReadiness(input);
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

  async registerBrowserCommandAttribution(input = {}) {
    this.#assertRunning();
    const event = this.#commandAttributions.prepareRegister(input);
    await this.#ledger.append('BROWSER_COMMAND_ATTRIBUTION_REGISTERED', {
      command_attribution_event: event,
      command_id: event.attribution.command_id,
      attribution_digest: event.attribution.attribution_digest,
      candidate_id: event.attribution.candidate_id,
      candidate_sha: event.attribution.candidate_sha,
      proposal_digest: event.attribution.proposal_digest,
      producer: event.attribution.producer,
      db_lease_is_execution_authority: true,
      registry_is_execution_authority: false,
      authority_effect: false,
    });
    return this.#commandAttributions.apply(event);
  }

  browserCommandAttribution(commandId) {
    this.#assertRunning();
    return this.#commandAttributions.lookup(commandId);
  }

  async ingestBrowserOutcome({ readback, attribution } = {}) {
    this.#assertRunning();
    const commandId = String(readback?.command_id || '').trim().toLowerCase();
    const registered = commandId ? this.#commandAttributions.lookup(commandId) : null;
    const candidateRequested = attribution?.candidate_id != null
      || attribution?.candidate_sha != null
      || attribution?.proposal_digest != null
      || (Array.isArray(attribution?.skill_digests) && attribution.skill_digests.length > 0);
    if (!registered && candidateRequested) {
      throw new Error('rsi_runtime_candidate_attribution_requires_trusted_registry');
    }
    const effectiveAttribution = registered || attribution;
    const episode = createRsiBrowserOutcomeEpisode({
      source_sha: this.#sourceSha,
      readback,
      attribution: effectiveAttribution,
    });
    const consumeEvent = registered
      ? this.#commandAttributions.prepareConsume({
        command_id: episode.command_id,
        outcome_episode_digest: episode.episode_digest,
      })
      : null;
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
      trusted_command_attribution_digest: registered?.attribution_digest || null,
      trusted_command_attribution_producer: registered?.producer || null,
      command_attribution_event: consumeEvent,
      learning_episode: episode.eligible_for_experience_graph ? episode : null,
      eligible_for_experience_graph: episode.eligible_for_experience_graph,
      eligible_for_skill_evidence: episode.eligible_for_skill_evidence,
      quarantined: episode.quarantined,
      raw_result_stored: false,
      raw_error_stored: false,
      physical_effect_replay_allowed: false,
      authority_effect: false,
    });
    if (consumeEvent) this.#commandAttributions.apply(consumeEvent);
    if (episode.eligible_for_experience_graph) this.#rememberLearningOutcome(episode);
    this.#browserOutcomeCount += 1;
    if (episode.eligible_for_experience_graph) this.#browserOutcomeLearningEligibleCount += 1;
    if (episode.quarantined) this.#browserOutcomeQuarantinedCount += 1;
    this.#lastBrowserOutcomeDigest = episode.episode_digest;
    return episode;
  }

  async recordTrustedCredit({ outcome_episode_digest, assignment } = {}) {
    this.#assertRunning();
    const episodeDigest = String(outcome_episode_digest || '').trim().toLowerCase();
    if (!SHA256_PREFIXED.test(episodeDigest)) throw new Error('rsi_runtime_outcome_episode_digest_invalid');
    if (this.#creditedOutcomeDigests.has(episodeDigest)) throw new Error('rsi_runtime_outcome_credit_already_recorded');
    const episode = this.#findPersistedLearningOutcome(episodeDigest);
    if (!episode) throw new Error('rsi_runtime_persisted_learning_outcome_required');
    const receipt = createRsiTrustedCreditReceipt({ outcome_episode: episode, assignment });
    const admission = createRsiExperienceGraphAdmission({ outcome_episode: episode, credit_receipt: receipt });
    const nextGraph = applyRsiExperienceGraphAdmission({
      previous_snapshot: this.#experienceGraphSnapshot,
      admission,
    });
    await this.#ledger.append('TRUSTED_CREDIT_ASSIGNED', {
      outcome_episode_digest: episodeDigest,
      credit_receipt_digest: receipt.credit_receipt_digest,
      experience_case_digest: admission.experience_case.case_digest,
      credit_admission: admission,
      terminal_task_reward_is_step_credit: false,
      candidate_can_write_graph: false,
      authority_effect: false,
    });
    this.#experienceGraphSnapshot = nextGraph;
    this.#creditedOutcomeDigests.add(episodeDigest);
    this.#pendingLearningOutcomes.delete(episodeDigest);
    return admission;
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

  improvementFrontier(options = {}) {
    return this.#improvementFrontier.entries(options);
  }

  controlPlaneProjection({ limit = 4 } = {}) {
    const bounded = Math.max(0, Math.min(8, Number(limit) || 0));
    const entries = this.#improvementFrontier.entries({ limit: bounded });
    return Object.freeze({
      schema: 'metaengine.rsi.runtime-control-projection.v1',
      state: this.#state,
      source_sha: this.#sourceSha,
      last_observation_digest: this.#lastObservationDigest,
      last_observation_at: this.#lastObservationAt,
      frontier_count: entries.length,
      frontier: Object.freeze(entries.map((entry) => Object.freeze({
        opportunity_id: entry.opportunity_id,
        signal: entry.signal,
        priority: entry.priority,
        mutation_surface: entry.mutation_surface,
        observation_digest: entry.observation_digest,
        hypothesis: structuredClone(entry.hypothesis),
        experiment_plan: structuredClone(entry.plan),
        execution_authority: false,
        promotion_authority: false,
        self_update_authority: false,
        automatic_retry_allowed: false,
        authority_effect: false,
      }))),
      source_binding_exact: true,
      existing_devos_scheduler_required: true,
      browser_can_enqueue_devos_tasks: false,
      direct_execution_enabled: false,
      direct_promotion_enabled: false,
      direct_self_update_enabled: false,
      execution_authority: false,
      production_mutation_authority: false,
      promotion_authority: false,
      self_update_authority: false,
      automatic_retry_allowed: false,
      authority_effect: false,
    });
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
      observation_persistence_mode: 'BOUNDED_COALESCED_FSYNC',
      experience_gate: this.#experienceGate.snapshot(),
      improvement_frontier: this.#improvementFrontier.snapshot(),
      promotion_nomination_count: this.#promotionNominationCount,
      command_attribution_registry: this.#commandAttributions.snapshot(),
      trusted_credit: Object.freeze({
        pending_learning_outcome_count: this.#pendingLearningOutcomes.size,
        credited_outcome_count: this.#creditedOutcomeDigests.size,
        experience_graph_snapshot_digest: this.#experienceGraphSnapshot?.snapshot_digest || null,
        experience_graph_case_count: this.#experienceGraphSnapshot?.case_count || 0,
        terminal_task_reward_is_step_credit: false,
        candidate_can_write_graph: false,
        execution_authority: false,
        promotion_authority: false,
        self_update_authority: false,
        authority_effect: false,
      }),
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
      episodes: this.#episodes.snapshot(),
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
