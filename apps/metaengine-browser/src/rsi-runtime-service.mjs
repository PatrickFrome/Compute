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
import {
  verifyRsiHarnessComponentRegistry,
  verifyRsiHarnessTraceIr,
  verifyRsiHarnessFlawRecord,
  verifyRsiHarnessRepairSpec,
  verifyRsiHarnessRepairOutcome,
} from './rsi-trace-guided-harness-repair.mjs';
import { rsiVerifiedSkillLibraryTrustRootSnapshot } from './rsi-verified-skill-library.mjs';
import { rsiMemoryGovernanceTrustRootSnapshot } from './rsi-memory-governance.mjs';
import { rsiOperationalDistillationTrustRootSnapshot } from './rsi-operational-knowledge-distillation.mjs';
import { rsiFixedSkeletonTrustRootSnapshot } from './rsi-fixed-skeleton-mutation.mjs';
import { rsiSearchModeRouterTrustRootSnapshot, verifyRsiSearchContext } from './rsi-search-mode-router.mjs';
import { rsiEvaluationIntegrityTrustRootSnapshot } from './rsi-evaluation-integrity-guard.mjs';
import { RsiRuntimeLedger } from './rsi-runtime-ledger.mjs';
import { RsiRuntimeExperienceGate, RSI_RUNTIME_EXPERIENCE_GATE_SCHEMA } from './rsi-runtime-experience-gate.mjs';
import { RsiRuntimeImprovementFrontier, RSI_RUNTIME_IMPROVEMENT_FRONTIER_SCHEMA } from './rsi-runtime-improvement-frontier.mjs';
import { RsiEpisodeOrchestrator, rsiEpisodeOrchestratorTrustRootSnapshot } from './rsi-episode-orchestrator.mjs';
import { createRsiEpisodeDevosCandidateRequest, rsiEpisodeDevosBridgeTrustRootSnapshot } from './rsi-episode-devos-bridge.mjs';
import {
  createRsiEpisodeEvaluationEvidenceBundle,
  verifyRsiEpisodeEvaluationEvidenceBundle,
  rsiEpisodeEvaluationIngestTrustRootSnapshot,
} from './rsi-episode-evaluation-ingest.mjs';
import {
  createRsiAutonomousEpisodePlan,
  verifyRsiAutonomousEpisodePlan,
  rsiAutonomousEpisodeControllerTrustRootSnapshot,
} from './rsi-autonomous-episode-controller.mjs';
import { createRsiDevosAdmissionEnvelopes, rsiDevosAdmissionAdapterTrustRootSnapshot } from './rsi-devos-admission-adapter.mjs';
import {
  createRsiVerifiedSearchFeedback,
  verifyRsiVerifiedSearchFeedback,
  rsiVerifiedSearchFeedbackTrustRootSnapshot,
} from './rsi-verified-search-feedback.mjs';

export const RSI_RUNTIME_SERVICE_SCHEMA = 'metaengine.rsi.runtime-service.v1';
export const RSI_RUNTIME_MODE = 'SHADOW_VERIFIED';

const SHA40 = /^[0-9a-f]{40}$/;
const DIGEST64 = /^[0-9a-f]{64}$/;
const MAX_AUTONOMOUS_PREPARED_REQUESTS = 256;
const MAX_HARNESS_EVIDENCE_DIGESTS = 1024;
const MAX_VERIFIED_SEARCH_FEEDBACK = 512;
const PREFIXED_SHA256 = /^sha256:[0-9a-f]{64}$/;

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

function exactPrefixedDigest(value, field) {
  const v = String(value || '').trim().toLowerCase();
  if (!PREFIXED_SHA256.test(v)) throw new Error(`rsi_runtime_${field}_invalid`);
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
    episode_orchestrator: rsiEpisodeOrchestratorTrustRootSnapshot(),
    episode_devos_bridge: rsiEpisodeDevosBridgeTrustRootSnapshot(),
    episode_evaluation_ingest: rsiEpisodeEvaluationIngestTrustRootSnapshot(),
    autonomous_episode_controller: rsiAutonomousEpisodeControllerTrustRootSnapshot(),
    devos_admission_adapter: rsiDevosAdmissionAdapterTrustRootSnapshot(),
    verified_search_feedback: rsiVerifiedSearchFeedbackTrustRootSnapshot(),
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
  #archive;
  #observer;
  #verifiedArchive;
  #roots;
  #running = false;
  #startedAt = null;
  #lastObservationDigest = null;
  #lastObservationAt = null;
  #promotionNominationCount = 0;
  #preparedRequestDigests = new Set();
  #harnessEvidenceDigests = new Set();
  #verifiedSearchFeedback = [];
  #verifiedSearchFeedbackDigests = new Set();

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
        if (row?.type === 'RSI_AUTONOMOUS_EPISODE_REQUEST_PREPARED' && row?.payload?.request_digest) {
          if (this.#preparedRequestDigests.size >= MAX_AUTONOMOUS_PREPARED_REQUESTS) {
            throw new Error('rsi_runtime_autonomous_request_replay_capacity_exhausted');
          }
          this.#preparedRequestDigests.add(exactDigest(row.payload.request_digest, 'autonomous_request_digest'));
        }
        if (String(row?.type || '').startsWith('RSI_HARNESS_') && row?.payload?.evidence_digest) {
          if (this.#harnessEvidenceDigests.size >= MAX_HARNESS_EVIDENCE_DIGESTS) {
            throw new Error('rsi_runtime_harness_evidence_replay_capacity_exhausted');
          }
          this.#harnessEvidenceDigests.add(exactPrefixedDigest(row.payload.evidence_digest, 'harness_evidence_digest'));
        }
        if (row?.type === 'RSI_VERIFIED_SEARCH_FEEDBACK_RECORDED' && row?.payload?.feedback) {
          const feedback = verifyRsiVerifiedSearchFeedback(row.payload.feedback);
          if (feedback.source_sha !== this.#sourceSha) throw new Error('rsi_runtime_search_feedback_source_mismatch');
          if (!this.#verifiedSearchFeedbackDigests.has(feedback.feedback_digest)) {
            this.#verifiedSearchFeedback.push(feedback);
            this.#verifiedSearchFeedbackDigests.add(feedback.feedback_digest);
            if (this.#verifiedSearchFeedback.length > MAX_VERIFIED_SEARCH_FEEDBACK) {
              const retired = this.#verifiedSearchFeedback.shift();
              this.#verifiedSearchFeedbackDigests.delete(retired.feedback_digest);
            }
          }
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

  async #recordHarnessEvidence(type, evidenceDigest, payload = {}) {
    const digestValue = exactPrefixedDigest(evidenceDigest, 'harness_evidence_digest');
    if (this.#harnessEvidenceDigests.has(digestValue)) {
      return Object.freeze({
        event_type: type,
        evidence_digest: digestValue,
        already_recorded: true,
        authority_effect: false,
      });
    }
    if (this.#harnessEvidenceDigests.size >= MAX_HARNESS_EVIDENCE_DIGESTS) {
      throw new Error('rsi_runtime_harness_evidence_capacity_exhausted');
    }
    await this.#ledger.append(type, {
      ...payload,
      evidence_digest: digestValue,
      raw_trace_persisted: false,
      raw_page_text_persisted: false,
      raw_user_input_persisted: false,
      candidate_authored_evidence_allowed: false,
      scheduler_action_authorized: false,
      authority_effect: false,
    });
    this.#harnessEvidenceDigests.add(digestValue);
    return Object.freeze({
      event_type: type,
      evidence_digest: digestValue,
      already_recorded: false,
      authority_effect: false,
    });
  }

  async recordHarnessTrace({ registry, trace } = {}) {
    this.#assertRunning();
    const checkedRegistry = verifyRsiHarnessComponentRegistry(registry);
    const checkedTrace = verifyRsiHarnessTraceIr(trace, checkedRegistry);
    if (checkedRegistry.source_sha !== this.#sourceSha || checkedTrace.source_sha !== this.#sourceSha) {
      throw new Error('rsi_runtime_harness_trace_source_mismatch');
    }
    return this.#recordHarnessEvidence('RSI_HARNESS_TRACE_RECORDED', checkedTrace.trace_digest, {
      trace_id: checkedTrace.trace_id,
      task_id: checkedTrace.task_id,
      registry_digest: checkedRegistry.registry_digest,
      evaluator_root_digest: checkedTrace.evaluator_root_digest,
      outcome: checkedTrace.outcome,
      step_count: checkedTrace.step_count,
    });
  }

  async recordHarnessFlaw({ flaw_record, registry } = {}) {
    this.#assertRunning();
    const checkedRegistry = verifyRsiHarnessComponentRegistry(registry);
    const flaw = verifyRsiHarnessFlawRecord(flaw_record);
    if (checkedRegistry.source_sha !== this.#sourceSha || flaw.registry_digest !== checkedRegistry.registry_digest) {
      throw new Error('rsi_runtime_harness_flaw_source_or_registry_mismatch');
    }
    return this.#recordHarnessEvidence('RSI_HARNESS_FLAW_RECORDED', flaw.flaw_digest, {
      flaw_id: flaw.flaw_id,
      registry_digest: flaw.registry_digest,
      responsible_component_id: flaw.responsible_component_id,
      responsible_component_path: flaw.responsible_component_path,
      responsible_layer: flaw.responsible_layer,
      failure_code: flaw.failure_code,
      repair_operator: flaw.repair_operator,
      independent_trace_count: flaw.independent_trace_count,
    });
  }

  async recordHarnessRepairSpec({ repair_spec } = {}) {
    this.#assertRunning();
    const spec = verifyRsiHarnessRepairSpec(repair_spec);
    if (spec.source_sha !== this.#sourceSha) throw new Error('rsi_runtime_harness_repair_source_mismatch');
    return this.#recordHarnessEvidence('RSI_HARNESS_REPAIR_SPEC_RECORDED', spec.repair_digest, {
      repair_id: spec.repair_id,
      flaw_id: spec.flaw_id,
      flaw_digest: spec.flaw_digest,
      component_id: spec.component_id,
      component_path: spec.component_path,
      component_layer: spec.component_layer,
      repair_operator: spec.repair_operator,
      heldout_suite_digest: spec.heldout_suite_digest,
      matched_budget_digest: spec.matched_budget_digest,
      falsifiable_prediction_required: true,
    });
  }

  async recordHarnessRepairOutcome({ repair_outcome, repair_spec } = {}) {
    this.#assertRunning();
    const spec = verifyRsiHarnessRepairSpec(repair_spec);
    const outcome = verifyRsiHarnessRepairOutcome(repair_outcome);
    if (spec.source_sha !== this.#sourceSha || outcome.repair_digest !== spec.repair_digest || outcome.repair_id !== spec.repair_id) {
      throw new Error('rsi_runtime_harness_outcome_source_or_repair_mismatch');
    }
    return this.#recordHarnessEvidence('RSI_HARNESS_REPAIR_OUTCOME_RECORDED', outcome.outcome_digest, {
      repair_id: outcome.repair_id,
      repair_digest: outcome.repair_digest,
      component_id: outcome.component_id,
      component_path: outcome.component_path,
      state: outcome.state,
      prediction_verified: outcome.prediction_verified === true,
      target_flaw_reduced: outcome.target_flaw_reduced === true,
      heldout_generalization_checked: outcome.heldout_generalization_checked === true,
      matched_feedback_budget_baseline_checked: outcome.matched_feedback_budget_baseline_checked === true,
      unacceptable_regression_count: outcome.unacceptable_regression_count,
    });
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

  async ingestEpisodeEvaluationBundle(input = {}) {
    this.#assertRunning();
    const episodeId = String(input.episode_id || '').trim();
    const candidateId = String(input.candidate_id || '').trim().toLowerCase();
    const episode = this.#episodes.episode(episodeId);
    const bundle = createRsiEpisodeEvaluationEvidenceBundle({
      ...input,
      episode,
      candidate_id: candidateId,
    });
    verifyRsiEpisodeEvaluationEvidenceBundle(bundle);

    for (const evidence of bundle.evidence) {
      const current = this.#episodes.episode(episodeId).candidates?.[candidateId]?.evidence?.[evidence.evidence_kind] || null;
      if (current) {
        if (current.evidence_digest !== evidence.evidence_digest || current.result !== evidence.result) {
          throw new Error(`rsi_runtime_episode_evaluation_conflict:${evidence.evidence_kind}`);
        }
        continue;
      }
      await this.recordEpisodeEvidence({
        episode_id: episodeId,
        candidate_id: candidateId,
        evidence_id: evidence.evidence_id,
        evidence_kind: evidence.evidence_kind,
        evidence_digest: evidence.evidence_digest,
        result: evidence.result,
        source_sha: bundle.source_sha,
        trust_root_set_digest: bundle.trust_root_set_digest,
        ambiguous_effect: evidence.ambiguous_effect,
      });
    }

    await this.#ledger.append('RSI_EPISODE_EVALUATION_BUNDLE_ACCEPTED', {
      episode_id: bundle.episode_id,
      candidate_id: bundle.candidate_id,
      candidate_sha: bundle.candidate_sha,
      bundle_digest: bundle.bundle_digest,
      evidence: bundle.evidence.map((row) => ({
        evidence_kind: row.evidence_kind,
        evidence_digest: row.evidence_digest,
        source_artifact_digest: row.source_artifact_digest,
        result: row.result,
      })),
      external_promotion_gate_still_required: true,
      authority_effect: false,
    });

    return Object.freeze({
      bundle,
      readiness: this.#episodes.nominationReadiness({ episode_id: episodeId, candidate_id: candidateId }),
      authority_effect: false,
      automatic_retry_allowed: false,
    });
  }

  async prepareAutonomousEpisodeCycle(input = {}) {
    this.#assertRunning();
    let controllerInput = input;
    if (input.search_outcomes == null) {
      const context = verifyRsiSearchContext(input.search_context);
      const searchOutcomes = this.#verifiedSearchFeedback
        .filter((row) => (
          row.source_sha === this.#sourceSha
          && (
            row.routing_outcome?.context_digest === context.context_digest
            || row.routing_outcome?.context_digest === 'sha256:' + context.context_digest
          )
        ))
        .map((row) => row.routing_outcome);
      controllerInput = { ...input, search_outcomes: searchOutcomes };
    }
    const plan = createRsiAutonomousEpisodePlan(controllerInput);
    verifyRsiAutonomousEpisodePlan(plan);

    let episode;
    if (!this.#episodes.hasEpisode(plan.episode_id)) {
      episode = await this.openEpisode(plan.episode_open_spec);
    } else {
      episode = this.#episodes.episode(plan.episode_id);
      if (
        episode.source_sha !== plan.source_sha
        || episode.observation_digest !== plan.observation_digest
        || episode.opportunity_id !== plan.opportunity_id
        || episode.hypothesis_digest !== plan.hypothesis_digest
        || episode.mutation_surface !== plan.mutation_surface
        || episode.search_context_digest !== plan.search_context_digest
        || episode.max_candidates !== plan.max_candidates
      ) {
        throw new Error('rsi_runtime_autonomous_episode_identity_conflict');
      }
    }

    const requests = [];
    let newlyPersisted = 0;
    for (const variantPlan of plan.variant_plans) {
      const request = createRsiEpisodeDevosCandidateRequest({
        episode,
        experiment_plan: variantPlan,
        request_generation: 1,
      });
      const requestDigest = exactDigest(request.request_digest, 'autonomous_request_digest');
      const alreadyPrepared = this.#preparedRequestDigests.has(requestDigest);
      if (!alreadyPrepared) {
        if (this.#preparedRequestDigests.size >= MAX_AUTONOMOUS_PREPARED_REQUESTS) {
          throw new Error('rsi_runtime_autonomous_request_capacity_exhausted');
        }
        await this.#ledger.append('RSI_AUTONOMOUS_EPISODE_REQUEST_PREPARED', {
          episode_id: plan.episode_id,
          controller_plan_digest: plan.controller_plan_digest,
          routing_digest: plan.routing_digest,
          request_id: request.request_id,
          request_digest: request.request_digest,
          experiment_id: request.experiment_id,
          target_branch: request.target_branch,
          variant_id: variantPlan.search_variant.variant_id,
          variant_digest: variantPlan.search_variant.variant_digest,
          search_mode: variantPlan.search_variant.search_mode,
          allocation_role: variantPlan.search_variant.allocation_role,
          proposal_budget_units: variantPlan.search_variant.proposal_budget_units,
          dispatch_authorized: false,
          authority_effect: false,
        });
        this.#preparedRequestDigests.add(requestDigest);
        newlyPersisted += 1;
      }
      requests.push(Object.freeze({
        request,
        search_variant: variantPlan.search_variant,
        already_prepared: alreadyPrepared,
        scheduler_action_authorized: false,
        authority_effect: false,
      }));
    }

    return Object.freeze({
      schema: 'metaengine.rsi.autonomous-episode-runtime-cycle.v1',
      controller_plan: plan,
      episode: this.#episodes.episode(plan.episode_id),
      requests: Object.freeze(requests),
      request_count: requests.length,
      newly_persisted_request_count: newlyPersisted,
      existing_devos_scheduler_required: true,
      scheduler_action_authorized: false,
      task_created: false,
      lease_created: false,
      command_created: false,
      execution_authority: false,
      production_mutation_authority: false,
      promotion_authority: false,
      self_update_authority: false,
      automatic_retry_allowed: false,
      authority_effect: false,
    });
  }

  async recordVerifiedSearchFeedback(input = {}) {
    this.#assertRunning();
    const feedback = createRsiVerifiedSearchFeedback(input);
    verifyRsiVerifiedSearchFeedback(feedback);
    if (feedback.source_sha !== this.#sourceSha) throw new Error('rsi_runtime_search_feedback_source_mismatch');
    if (this.#verifiedSearchFeedbackDigests.has(feedback.feedback_digest)) {
      return Object.freeze({ feedback, already_recorded: true, authority_effect: false });
    }
    await this.#ledger.append('RSI_VERIFIED_SEARCH_FEEDBACK_RECORDED', {
      feedback,
      candidate_authored_feedback_allowed: false,
      scalar_reward_authoritative: false,
      search_feedback_is_scheduler_authority: false,
      search_feedback_is_promotion_authority: false,
      authority_effect: false,
    });
    this.#verifiedSearchFeedback.push(feedback);
    this.#verifiedSearchFeedbackDigests.add(feedback.feedback_digest);
    if (this.#verifiedSearchFeedback.length > MAX_VERIFIED_SEARCH_FEEDBACK) {
      const retired = this.#verifiedSearchFeedback.shift();
      this.#verifiedSearchFeedbackDigests.delete(retired.feedback_digest);
    }
    return Object.freeze({ feedback, already_recorded: false, authority_effect: false });
  }

  async prepareAutonomousDevosAdmissions({ workspace_id, priority = 80, ...cycleInput } = {}) {
    this.#assertRunning();
    const cycle = await this.prepareAutonomousEpisodeCycle(cycleInput);
    const envelopes = createRsiDevosAdmissionEnvelopes({
      runtime_cycle: cycle,
      workspace_id,
      priority,
    });
    return Object.freeze({
      schema: 'metaengine.rsi.autonomous-devos-admission-preparation.v1',
      cycle,
      envelopes,
      envelope_count: envelopes.length,
      rpc_name: 'rsi_devos_admit_prepared_request_v1',
      rpc_invoked: false,
      existing_devos_scheduler_required: true,
      service_role_execution_required: true,
      scheduler_action_authorized: false,
      task_created: false,
      lease_created: false,
      execution_authority: false,
      production_mutation_authority: false,
      promotion_authority: false,
      self_update_authority: false,
      automatic_retry_allowed: false,
      authority_effect: false,
    });
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
      state: this.#running ? 'READY' : 'CREATED',
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
      autonomous_prepared_request_count: this.#preparedRequestDigests.size,
      autonomous_prepared_request_capacity: MAX_AUTONOMOUS_PREPARED_REQUESTS,
      harness_evidence_count: this.#harnessEvidenceDigests.size,
      harness_evidence_capacity: MAX_HARNESS_EVIDENCE_DIGESTS,
      harness_evidence_mode: 'VERIFIED_DIGEST_SUMMARY_ONLY',
      verified_search_feedback_count: this.#verifiedSearchFeedback.length,
      verified_search_feedback_capacity: MAX_VERIFIED_SEARCH_FEEDBACK,
      verified_search_feedback_scalar_reward_authoritative: false,
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
