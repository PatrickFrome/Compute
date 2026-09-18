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
import { createRsiExperienceContextPlan, rsiExperienceContextTrustRootSnapshot } from './rsi-experience-context-planner.mjs';
import { createRsiCandidateSynthesisRequest, createRsiCandidateMutationProposal, prepareRsiContextAwareCandidateBuild, createRsiContextAwareCandidateLedgerPayload, rsiContextAwareCandidateTrustRootSnapshot } from './rsi-context-aware-candidate-synthesis.mjs';
import { createRsiDevosMaterializationHandoff, admitRsiDevosMaterialization, rsiDevosMaterializationTrustRootSnapshot } from './rsi-devos-materialization-handoff.mjs';
import { createRsiVerifiedCandidateMaterialization, rsiVerifiedCandidateMaterializationTrustRootSnapshot } from './rsi-verified-candidate-materialization.mjs';
import { createRsiExternalEvaluationBundle, verifyRsiExternalEvaluationBundle, rsiExternalEvaluationTrustRootSnapshot } from './rsi-external-evaluation-evidence-adapter.mjs';
import { createRsiExternalPromotionReviewRequest, finalizeRsiExternalPromotionReview, verifyRsiExternalPromotionReviewRequest, verifyRsiExternalPromotionReviewResult, rsiExternalPromotionReviewTrustRootSnapshot } from './rsi-external-promotion-review.mjs';
import { createRsiReleaseAuthorityHandoff, verifyRsiReleaseAuthorityHandoff, rsiReleaseAuthorityHandoffTrustRootSnapshot } from './rsi-release-authority-handoff.mjs';
import { createRsiReleaseExecutorAdmission, verifyRsiReleaseExecutorAdmission, rsiReleaseExecutorAdmissionTrustRootSnapshot } from './rsi-release-executor-admission.mjs';
import { createRsiReleaseEffectReconciliation, verifyRsiReleaseEffectReconciliation, rsiReleaseEffectReconciliationTrustRootSnapshot } from './rsi-release-effect-reconciliation.mjs';

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
    experience_context: rsiExperienceContextTrustRootSnapshot(),
    context_aware_candidate: rsiContextAwareCandidateTrustRootSnapshot(),
    devos_materialization: rsiDevosMaterializationTrustRootSnapshot(),
    verified_candidate_materialization: rsiVerifiedCandidateMaterializationTrustRootSnapshot(),
    external_evaluation: rsiExternalEvaluationTrustRootSnapshot(),
    external_promotion_review: rsiExternalPromotionReviewTrustRootSnapshot(),
    release_authority_handoff: rsiReleaseAuthorityHandoffTrustRootSnapshot(),
    release_executor_admission: rsiReleaseExecutorAdmissionTrustRootSnapshot(),
    release_effect_reconciliation: rsiReleaseEffectReconciliationTrustRootSnapshot(),
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
  #experienceContextPlans = new Map();
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
  #experienceContextPlanCount = 0;
  #lastExperienceContextPlanDigest = null;
  #candidateSynthesisPlanCount = 0;
  #lastContextAwareBuildDigest = null;
  #materializationHandoffCount = 0;
  #materializationAdmissionCount = 0;
  #lastMaterializationHandoffDigest = null;
  #lastMaterializationAdmissionDigest = null;
  #verifiedCandidateMaterializationCount = 0;
  #lastVerifiedCandidateMaterializationDigest = null;
  #externalEvaluationBundleCount = 0;
  #lastExternalEvaluationBundleDigest = null;
  #externalPromotionReviewRequestCount = 0;
  #externalPromotionReviewResultCount = 0;
  #lastExternalPromotionReviewRequestDigest = null;
  #lastExternalPromotionReviewResultDigest = null;
  #releaseAuthorityHandoffCount = 0;
  #lastReleaseAuthorityHandoffDigest = null;
  #lastReleaseAuthorityHandoffState = null;
  #releaseExecutorAdmissionCount = 0;
  #lastReleaseExecutorAdmissionDigest = null;
  #lastReleaseExecutorCommandId = null;
  #releaseEffectReconciliationCount = 0;
  #lastReleaseEffectReconciliationDigest = null;
  #lastReleaseEffectOutcome = null;

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
        if (Array.isArray(row?.payload?.episode_events)) {
          for (const event of row.payload.episode_events) this.#episodes.apply(event);
        }
        if (row?.payload?.command_attribution_event) this.#commandAttributions.apply(row.payload.command_attribution_event);
        if (row?.payload?.learning_episode) this.#rememberLearningOutcome(row.payload.learning_episode);
        if (row?.payload?.observation?.observation_digest && row?.type === 'BRAIN_OBSERVATION') {
          const prepared = this.#improvementFrontier.prepare(row.payload.observation);
          this.#improvementFrontier.commit(prepared);
        }
        if (row?.payload?.credit_admission) {
          this.#experienceGraphSnapshot = applyRsiExperienceGraphAdmission({
            previous_snapshot: this.#experienceGraphSnapshot,
            admission: row.payload.credit_admission,
          });
          this.#creditedOutcomeDigests.add(row.payload.credit_admission.outcome_episode_digest);
          this.#pendingLearningOutcomes.delete(row.payload.credit_admission.outcome_episode_digest);
        }
        if (row?.payload?.experience_context_plan) {
          this.#experienceContextPlanCount += 1;
          this.#lastExperienceContextPlanDigest = row.payload.experience_context_plan.context_plan_digest || null;
          const episodeId = row?.payload?.episode_event?.episode_id;
          if (episodeId) this.#experienceContextPlans.set(episodeId, Object.freeze(structuredClone(row.payload.experience_context_plan)));
        }
        if (row?.payload?.candidate_synthesis?.context_candidate_build) {
          this.#candidateSynthesisPlanCount += 1;
          this.#lastContextAwareBuildDigest = row.payload.candidate_synthesis.context_candidate_build.context_aware_build_digest || null;
        }
        if (row?.payload?.materialization_handoff) {
          this.#materializationHandoffCount += 1;
          this.#lastMaterializationHandoffDigest = row.payload.materialization_handoff.handoff_digest || null;
        }
        if (row?.payload?.materialization_admission) {
          this.#materializationAdmissionCount += 1;
          this.#lastMaterializationAdmissionDigest = row.payload.materialization_admission.admission_digest || null;
        }
        if (row?.payload?.verified_candidate_materialization) {
          this.#verifiedCandidateMaterializationCount += 1;
          this.#lastVerifiedCandidateMaterializationDigest = row.payload.verified_candidate_materialization.verified_materialization_digest || null;
        }
        if (row?.payload?.external_evaluation_bundle) {
          this.#externalEvaluationBundleCount += 1;
          this.#lastExternalEvaluationBundleDigest = row.payload.external_evaluation_bundle.bundle_digest || null;
        }
        if (row?.payload?.external_promotion_review_request) {
          this.#externalPromotionReviewRequestCount += 1;
          this.#lastExternalPromotionReviewRequestDigest = row.payload.external_promotion_review_request.request_digest || null;
        }
        if (row?.payload?.external_promotion_review_result) {
          const request = row.payload.external_promotion_review_request;
          const admission = row.payload.verified_archive_admission;
          if (!request || !admission) throw new Error('rsi_runtime_external_promotion_review_replay_evidence_missing');
          const replayedAdmission = this.#verifiedArchive.admit({
            plan: request.tournament_plan,
            result: request.tournament_result,
            receipts: request.tournament_receipts,
          });
          if (replayedAdmission.admission_digest !== admission.admission_digest) {
            throw new Error('rsi_runtime_verified_archive_replay_mismatch');
          }
          this.#externalPromotionReviewResultCount += 1;
          this.#lastExternalPromotionReviewResultDigest = row.payload.external_promotion_review_result.result_digest || null;
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

  #findPersistedCandidateSynthesis(episodeId) {
    const id = String(episodeId || '').trim();
    let cursor = 0;
    let found = null;
    while (true) {
      const page = this.#ledger.eventsSince({ after_seq: cursor, limit: 256 });
      if (page.length === 0) break;
      for (const row of page) {
        const payload = row?.payload?.candidate_synthesis;
        if (payload?.episode_id === id) found = Object.freeze(structuredClone(payload));
      }
      cursor = page.at(-1).seq;
      if (page.length < 256) break;
    }
    return found;
  }

  #findPersistedMaterializationHandoff(handoffDigest) {
    const wanted = String(handoffDigest || '').trim().toLowerCase();
    let cursor = 0;
    let found = null;
    while (true) {
      const page = this.#ledger.eventsSince({ after_seq: cursor, limit: 256 });
      if (page.length === 0) break;
      for (const row of page) {
        const handoff = row?.payload?.materialization_handoff;
        if (handoff?.handoff_digest === wanted) found = Object.freeze(structuredClone(handoff));
      }
      cursor = page.at(-1).seq;
      if (page.length < 256) break;
    }
    return found;
  }

  #findPersistedMaterializationAdmission(admissionDigest) {
    const wanted = String(admissionDigest || '').trim().toLowerCase();
    let cursor = 0;
    let found = null;
    while (true) {
      const page = this.#ledger.eventsSince({ after_seq: cursor, limit: 256 });
      if (page.length === 0) break;
      for (const row of page) {
        const admission = row?.payload?.materialization_admission;
        if (admission?.admission_digest === wanted) found = Object.freeze(structuredClone(admission));
      }
      cursor = page.at(-1).seq;
      if (page.length < 256) break;
    }
    return found;
  }

  #findVerifiedMaterializationByAdmission(admissionDigest) {
    const wanted = String(admissionDigest || '').trim().toLowerCase();
    let cursor = 0;
    let found = null;
    while (true) {
      const page = this.#ledger.eventsSince({ after_seq: cursor, limit: 256 });
      if (page.length === 0) break;
      for (const row of page) {
        const verified = row?.payload?.verified_candidate_materialization;
        if (verified?.materialization_admission_digest === wanted) found = Object.freeze(structuredClone(verified));
      }
      cursor = page.at(-1).seq;
      if (page.length < 256) break;
    }
    return found;
  }

  #findVerifiedMaterializationByCandidate(candidateId) {
    const wanted = String(candidateId || '').trim().toLowerCase();
    let cursor = 0;
    let found = null;
    while (true) {
      const page = this.#ledger.eventsSince({ after_seq: cursor, limit: 256 });
      if (page.length === 0) break;
      for (const row of page) {
        const verified = row?.payload?.verified_candidate_materialization;
        if (verified?.candidate_id === wanted) found = Object.freeze(structuredClone(verified));
      }
      cursor = page.at(-1).seq;
      if (page.length < 256) break;
    }
    return found;
  }

  #findExternalEvaluationBundleByCandidate(candidateId) {
    const wanted = String(candidateId || '').trim().toLowerCase();
    let cursor = 0;
    let found = null;
    while (true) {
      const page = this.#ledger.eventsSince({ after_seq: cursor, limit: 256 });
      if (page.length === 0) break;
      for (const row of page) {
        const bundle = row?.payload?.external_evaluation_bundle;
        if (bundle?.candidate_id === wanted) found = Object.freeze(structuredClone(bundle));
      }
      cursor = page.at(-1).seq;
      if (page.length < 256) break;
    }
    return found;
  }

  #findExternalPromotionReviewRequest(requestDigest) {
    const wanted = String(requestDigest || '').trim().toLowerCase();
    let cursor = 0;
    let found = null;
    while (true) {
      const page = this.#ledger.eventsSince({ after_seq: cursor, limit: 256 });
      if (page.length === 0) break;
      for (const row of page) {
        const request = row?.payload?.external_promotion_review_request;
        if (request?.request_digest === wanted) found = Object.freeze(structuredClone(request));
      }
      cursor = page.at(-1).seq;
      if (page.length < 256) break;
    }
    return found;
  }

  #findExternalPromotionReviewResultByRequest(requestDigest) {
    const wanted = String(requestDigest || '').trim().toLowerCase();
    let cursor = 0;
    let found = null;
    while (true) {
      const page = this.#ledger.eventsSince({ after_seq: cursor, limit: 256 });
      if (page.length === 0) break;
      for (const row of page) {
        const result = row?.payload?.external_promotion_review_result;
        if (result?.request_digest === wanted) found = Object.freeze(structuredClone(result));
      }
      cursor = page.at(-1).seq;
      if (page.length < 256) break;
    }
    return found;
  }

  #findExternalPromotionReviewByResultDigest(resultDigest) {
    const wanted = String(resultDigest || '').trim().toLowerCase();
    let cursor = 0;
    let found = null;
    while (true) {
      const page = this.#ledger.eventsSince({ after_seq: cursor, limit: 256 });
      if (page.length === 0) break;
      for (const row of page) {
        const result = row?.payload?.external_promotion_review_result;
        const request = row?.payload?.external_promotion_review_request;
        if (result?.result_digest === wanted && request) {
          found = Object.freeze({
            result: Object.freeze(structuredClone(result)),
            request: Object.freeze(structuredClone(request)),
          });
        }
      }
      cursor = page.at(-1).seq;
      if (page.length < 256) break;
    }
    return found;
  }

  #findReleaseAuthorityHandoffByReviewResult(resultDigest) {
    const wanted = String(resultDigest || '').trim().toLowerCase();
    let cursor = 0;
    let found = null;
    while (true) {
      const page = this.#ledger.eventsSince({ after_seq: cursor, limit: 256 });
      if (page.length === 0) break;
      for (const row of page) {
        const handoff = row?.payload?.release_authority_handoff;
        if (handoff?.promotion_review_result_digest === wanted) found = Object.freeze(structuredClone(handoff));
      }
      cursor = page.at(-1).seq;
      if (page.length < 256) break;
    }
    return found;
  }

  #findReleaseAuthorityHandoffByDigest(handoffDigest) {
    const wanted = String(handoffDigest || '').trim().toLowerCase();
    let cursor = 0;
    let found = null;
    while (true) {
      const page = this.#ledger.eventsSince({ after_seq: cursor, limit: 256 });
      if (page.length === 0) break;
      for (const row of page) {
        const handoff = row?.payload?.release_authority_handoff;
        if (handoff?.handoff_digest === wanted) found = Object.freeze(structuredClone(handoff));
      }
      cursor = page.at(-1).seq;
      if (page.length < 256) break;
    }
    return found;
  }

  #findReleaseExecutorAdmissionByHandoff(handoffDigest) {
    const wanted = String(handoffDigest || '').trim().toLowerCase();
    let cursor = 0;
    let found = null;
    while (true) {
      const page = this.#ledger.eventsSince({ after_seq: cursor, limit: 256 });
      if (page.length === 0) break;
      for (const row of page) {
        const admission = row?.payload?.release_executor_admission;
        if (admission?.release_handoff_digest === wanted) found = Object.freeze(structuredClone(admission));
      }
      cursor = page.at(-1).seq;
      if (page.length < 256) break;
    }
    return found;
  }

  #findReleaseExecutorAdmissionByDigest(admissionDigest) {
    const wanted = String(admissionDigest || '').trim().toLowerCase();
    let cursor = 0;
    let found = null;
    while (true) {
      const page = this.#ledger.eventsSince({ after_seq: cursor, limit: 256 });
      if (page.length === 0) break;
      for (const row of page) {
        const admission = row?.payload?.release_executor_admission;
        if (admission?.admission_digest === wanted) found = Object.freeze(structuredClone(admission));
      }
      cursor = page.at(-1).seq;
      if (page.length < 256) break;
    }
    return found;
  }

  #findReleaseEffectReconciliationByAdmission(admissionDigest) {
    const wanted = String(admissionDigest || '').trim().toLowerCase();
    let cursor = 0;
    let found = null;
    while (true) {
      const page = this.#ledger.eventsSince({ after_seq: cursor, limit: 256 });
      if (page.length === 0) break;
      for (const row of page) {
        const reconciliation = row?.payload?.release_effect_reconciliation;
        if (reconciliation?.executor_admission_digest === wanted) found = Object.freeze(structuredClone(reconciliation));
      }
      cursor = page.at(-1).seq;
      if (page.length < 256) break;
    }
    return found;
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

  experienceContextForOpportunity({
    opportunity_id,
    bridge_case_ids = [],
    environment_fingerprint = 'metaengine.browser.runtime',
    model_family = 'METAENGINE_RSI',
  } = {}) {
    this.#assertRunning();
    const id = String(opportunity_id || '').trim();
    const frontierEntry = this.#improvementFrontier.entries({ limit: 32 })
      .find((entry) => entry.opportunity_id === id);
    if (!frontierEntry) throw new Error('rsi_runtime_frontier_opportunity_not_found');
    return createRsiExperienceContextPlan({
      frontier_entry: frontierEntry,
      experience_graph_snapshot: this.#experienceGraphSnapshot,
      environment_fingerprint,
      model_family,
      bridge_case_ids,
    });
  }

  async openLearningEpisodeFromOpportunity({
    opportunity_id,
    bridge_case_ids = [],
    environment_fingerprint = 'metaengine.browser.runtime',
    model_family = 'METAENGINE_RSI',
    max_candidates = 4,
  } = {}) {
    this.#assertRunning();
    const contextPlan = this.experienceContextForOpportunity({
      opportunity_id,
      bridge_case_ids,
      environment_fingerprint,
      model_family,
    });
    const episodeId = `episode:rsi:${contextPlan.search_context_digest.slice(0, 24)}`;
    const event = this.#episodes.prepareOpen({
      episode_id: episodeId,
      observation_digest: contextPlan.observation_digest,
      opportunity_id: contextPlan.opportunity_id,
      hypothesis_digest: contextPlan.hypothesis_digest,
      mutation_surface: contextPlan.mutation_surface,
      search_context_digest: contextPlan.search_context_digest,
      max_candidates,
    });
    await this.#ledger.append('RSI_EXPERIENCE_CONTEXT_EPISODE_OPENED', {
      experience_context_plan: contextPlan,
      episode_event: event,
      retrieval_is_advisory_only: true,
      existing_devos_scheduler_required: true,
      task_lease_created: false,
      workspace_created: false,
      candidate_materialized: false,
      authority_effect: false,
    });
    const episode = this.#episodes.apply(event);
    this.#experienceContextPlans.set(episode.episode_id, Object.freeze(structuredClone(contextPlan)));
    this.#experienceContextPlanCount += 1;
    this.#lastExperienceContextPlanDigest = contextPlan.context_plan_digest;
    return Object.freeze({ context_plan: contextPlan, episode });
  }

  episodeExperienceContext(episodeId) {
    this.#assertRunning();
    const id = String(episodeId || '').trim();
    const plan = this.#experienceContextPlans.get(id);
    return plan ? Object.freeze(structuredClone(plan)) : null;
  }

  candidateSynthesisRequestForEpisode({
    episode_id,
    generation = 1,
    strategy = 'CONTEXT_GUIDED_DIVERSE_PROPOSAL',
  } = {}) {
    this.#assertRunning();
    const episode = this.#episodes.episode(episode_id);
    const contextPlan = this.#experienceContextPlans.get(episode.episode_id);
    if (!contextPlan) throw new Error('rsi_runtime_episode_experience_context_missing');
    if (episode.search_context_digest !== contextPlan.search_context_digest) {
      throw new Error('rsi_runtime_episode_context_digest_mismatch');
    }
    const frontierEntry = this.#improvementFrontier.entries({ limit: 32 })
      .find((entry) => entry.opportunity_id === contextPlan.opportunity_id);
    if (!frontierEntry) throw new Error('rsi_runtime_frontier_opportunity_not_found');
    return createRsiCandidateSynthesisRequest({
      context_plan: contextPlan,
      frontier_entry: frontierEntry,
      generation,
      strategy,
    });
  }

  async planContextAwareCandidateBuild({
    episode_id,
    source_snapshot,
    proposal,
    generation = 1,
    strategy = 'CONTEXT_GUIDED_DIVERSE_PROPOSAL',
    sequence = 1,
    previous_candidate_id = null,
    requested_backend = null,
  } = {}) {
    this.#assertRunning();
    const request = this.candidateSynthesisRequestForEpisode({ episode_id, generation, strategy });
    const mutationProposal = createRsiCandidateMutationProposal({
      synthesis_request: request,
      proposal,
    });
    const contextPlan = this.#experienceContextPlans.get(String(episode_id || '').trim());
    if (!contextPlan) throw new Error('rsi_runtime_episode_experience_context_missing');
    const frontierEntry = this.#improvementFrontier.entries({ limit: 32 })
      .find((entry) => entry.opportunity_id === contextPlan.opportunity_id);
    if (!frontierEntry) throw new Error('rsi_runtime_frontier_opportunity_not_found');
    const build = prepareRsiContextAwareCandidateBuild({
      synthesis_request: request,
      frontier_entry: frontierEntry,
      source_snapshot,
      mutation_proposal: mutationProposal,
      sequence,
      previous_candidate_id,
      requested_backend,
    });
    const ledgerPayload = createRsiContextAwareCandidateLedgerPayload({
      episode_id: String(episode_id || '').trim(),
      synthesis_request: request,
      mutation_proposal: mutationProposal,
      context_candidate_build: build,
    });
    await this.#ledger.append('RSI_CONTEXT_CANDIDATE_BUILD_PLANNED', {
      candidate_synthesis: ledgerPayload,
      authority_effect: false,
    });
    this.#candidateSynthesisPlanCount += 1;
    this.#lastContextAwareBuildDigest = build.context_aware_build_digest;
    return Object.freeze({
      synthesis_request: request,
      mutation_proposal: mutationProposal,
      context_candidate_build: build,
    });
  }

  async prepareDevosMaterializationHandoff({
    episode_id,
    coordination_workspace_id,
    priority = 50,
  } = {}) {
    this.#assertRunning();
    const candidate = this.#findPersistedCandidateSynthesis(episode_id);
    if (!candidate) throw new Error('rsi_runtime_candidate_synthesis_not_persisted');
    const handoff = createRsiDevosMaterializationHandoff({
      coordination_workspace_id,
      episode_id,
      synthesis_request: candidate.synthesis_request,
      mutation_proposal: candidate.mutation_proposal,
      context_candidate_build: candidate.context_candidate_build,
      priority,
    });
    await this.#ledger.append('RSI_DEVOS_MATERIALIZATION_HANDOFF_PREPARED', {
      materialization_handoff: handoff,
      scheduler_rpc_invoked: false,
      task_created: false,
      lease_created: false,
      workspace_created: false,
      candidate_materialized: false,
      authority_effect: false,
    });
    this.#materializationHandoffCount += 1;
    this.#lastMaterializationHandoffDigest = handoff.handoff_digest;
    return handoff;
  }

  async admitDevosMaterializationReadback({
    handoff_digest,
    task,
    claim,
    binding,
  } = {}) {
    this.#assertRunning();
    const handoff = this.#findPersistedMaterializationHandoff(handoff_digest);
    if (!handoff) throw new Error('rsi_runtime_materialization_handoff_not_persisted');
    const admission = admitRsiDevosMaterialization({ handoff, task, claim, binding });
    await this.#ledger.append('RSI_DEVOS_MATERIALIZATION_ADMITTED', {
      materialization_admission: admission,
      repository_mutation_performed: false,
      candidate_materialized: false,
      mutation_executor_still_must_revalidate_lease: true,
      authority_effect: false,
    });
    this.#materializationAdmissionCount += 1;
    this.#lastMaterializationAdmissionDigest = admission.admission_digest;
    return admission;
  }

  async recordVerifiedCandidateMaterialization({
    materialization_admission_digest,
    materialization_receipt,
  } = {}) {
    this.#assertRunning();
    const admissionDigest = String(materialization_admission_digest || '').trim().toLowerCase();
    if (this.#findVerifiedMaterializationByAdmission(admissionDigest)) {
      throw new Error('rsi_runtime_materialization_admission_already_consumed');
    }
    const admission = this.#findPersistedMaterializationAdmission(admissionDigest);
    if (!admission) throw new Error('rsi_runtime_materialization_admission_not_persisted');
    const handoff = this.#findPersistedMaterializationHandoff(admission.handoff_digest);
    if (!handoff) throw new Error('rsi_runtime_materialization_handoff_not_persisted');
    const candidate = this.#findPersistedCandidateSynthesis(handoff.episode_id);
    if (!candidate) throw new Error('rsi_runtime_candidate_synthesis_not_persisted');
    const verified = createRsiVerifiedCandidateMaterialization({
      episode_id: handoff.episode_id,
      materialization_admission: admission,
      synthesis_request: candidate.synthesis_request,
      mutation_proposal: candidate.mutation_proposal,
      context_candidate_build: candidate.context_candidate_build,
      materialization_receipt,
    });
    const episodeEvent = this.#episodes.prepareCandidate(verified.episode_candidate_registration);
    await this.#ledger.append('RSI_CANDIDATE_MATERIALIZATION_VERIFIED', {
      verified_candidate_materialization: verified,
      episode_event: episodeEvent,
      external_evaluation_required: true,
      candidate_registered_after_durable_append: true,
      eligible_for_promotion: false,
      authority_effect: false,
    });
    const episodeCandidate = this.#episodes.apply(episodeEvent);
    this.#verifiedCandidateMaterializationCount += 1;
    this.#lastVerifiedCandidateMaterializationDigest = verified.verified_materialization_digest;
    return Object.freeze({
      verified_materialization: verified,
      episode_candidate: episodeCandidate,
    });
  }

  externalEvaluatorHandoff(candidateId) {
    this.#assertRunning();
    const wanted = String(candidateId || '').trim().toLowerCase();
    let cursor = 0;
    let found = null;
    while (true) {
      const page = this.#ledger.eventsSince({ after_seq: cursor, limit: 256 });
      if (page.length === 0) break;
      for (const row of page) {
        const verified = row?.payload?.verified_candidate_materialization;
        if (verified?.candidate_id === wanted) found = verified.evaluator_handoff || null;
      }
      cursor = page.at(-1).seq;
      if (page.length < 256) break;
    }
    return found ? Object.freeze(structuredClone(found)) : null;
  }

  async recordExternalEvaluationEvidence({
    candidate_id,
    candidate_handoff,
    evaluator_receipts,
    holdout,
    regression,
    integrity,
    tournament,
  } = {}) {
    this.#assertRunning();
    const id = String(candidate_id || '').trim().toLowerCase();
    if (this.#findExternalEvaluationBundleByCandidate(id)) {
      throw new Error('rsi_runtime_external_evaluation_already_recorded');
    }
    const verifiedMaterialization = this.#findVerifiedMaterializationByCandidate(id);
    if (!verifiedMaterialization) throw new Error('rsi_runtime_verified_materialization_not_persisted');
    const bundle = createRsiExternalEvaluationBundle({
      verified_materialization: verifiedMaterialization,
      candidate_handoff,
      evaluator_receipts,
      holdout,
      regression,
      integrity,
      tournament,
    });
    verifyRsiExternalEvaluationBundle(bundle);
    const trustRootSetDigest = digest(this.#roots);
    const events = bundle.evidence_classes.map((row) => this.#episodes.prepareEvidence({
      episode_id: bundle.episode_id,
      candidate_id: bundle.candidate_id,
      evidence_id: row.evidence_id,
      evidence_kind: row.evidence_kind,
      evidence_digest: row.evidence_digest,
      result: row.result,
      source_sha: this.#sourceSha,
      trust_root_set_digest: trustRootSetDigest,
      ambiguous_effect: false,
    }));
    await this.#ledger.append('RSI_EXTERNAL_EVALUATION_EVIDENCE_RECORDED', {
      external_evaluation_bundle: bundle,
      episode_events: events,
      durable_before_episode_apply: true,
      candidate_can_self_certify: false,
      direct_promotion_enabled: false,
      authority_effect: false,
    });
    let episode = null;
    for (const event of events) episode = this.#episodes.apply(event);
    this.#externalEvaluationBundleCount += 1;
    this.#lastExternalEvaluationBundleDigest = bundle.bundle_digest;
    return Object.freeze({
      bundle,
      episode,
      nomination_readiness: this.#episodes.nominationReadiness({
        episode_id: bundle.episode_id,
        candidate_id: bundle.candidate_id,
      }),
    });
  }

  async prepareExternalPromotionReview({
    candidate_id,
    tournament_plan,
    tournament_result,
    tournament_receipts,
    qualification,
  } = {}) {
    this.#assertRunning();
    const id = String(candidate_id || '').trim().toLowerCase();
    const bundle = this.#findExternalEvaluationBundleByCandidate(id);
    if (!bundle) throw new Error('rsi_runtime_external_evaluation_bundle_not_persisted');
    verifyRsiExternalEvaluationBundle(bundle);
    if (bundle.all_classes_pass !== true || bundle.any_class_ambiguous !== false) {
      throw new Error('rsi_runtime_candidate_not_nomination_ready');
    }
    const evaluatorHandoff = this.externalEvaluatorHandoff(id);
    const candidateHandoff = evaluatorHandoff?.candidate_handoff;
    if (!candidateHandoff) throw new Error('rsi_runtime_candidate_handoff_not_persisted');
    const request = createRsiExternalPromotionReviewRequest({
      evaluation_bundle: bundle,
      candidate_handoff: candidateHandoff,
      tournament_plan,
      tournament_result,
      tournament_receipts,
      qualification,
    });
    if (this.#findExternalPromotionReviewRequest(request.request_digest)) {
      throw new Error('rsi_runtime_external_promotion_review_request_duplicate');
    }
    await this.#ledger.append('RSI_EXTERNAL_PROMOTION_REVIEW_PREPARED', {
      external_promotion_review_request: request,
      external_review_required: true,
      direct_install_authorized: false,
      self_update_invocation_authorized: false,
      promotion_token: null,
      authority_effect: false,
    });
    this.#externalPromotionReviewRequestCount += 1;
    this.#lastExternalPromotionReviewRequestDigest = request.request_digest;
    return request;
  }

  async finalizeExternalPromotionReview({ request_digest } = {}) {
    this.#assertRunning();
    const wanted = String(request_digest || '').trim().toLowerCase();
    if (!SHA256_PREFIXED.test(wanted)) throw new Error('rsi_runtime_external_promotion_review_request_digest_invalid');
    if (this.#findExternalPromotionReviewResultByRequest(wanted)) {
      throw new Error('rsi_runtime_external_promotion_review_already_finalized');
    }
    const request = this.#findExternalPromotionReviewRequest(wanted);
    if (!request) throw new Error('rsi_runtime_external_promotion_review_request_not_persisted');
    verifyRsiExternalPromotionReviewRequest(request);
    const evaluatorHandoff = this.externalEvaluatorHandoff(request.candidate_id);
    const candidateHandoff = evaluatorHandoff?.candidate_handoff;
    if (!candidateHandoff) throw new Error('rsi_runtime_candidate_handoff_not_persisted');

    const previewArchive = new RsiVerifiedEvolutionArchive({ clock: this.#clock });
    const archiveAdmission = previewArchive.admit({
      plan: request.tournament_plan,
      result: request.tournament_result,
      receipts: request.tournament_receipts,
    });
    const reviewResult = finalizeRsiExternalPromotionReview({
      request,
      candidate_handoff: candidateHandoff,
      archive_admission: archiveAdmission,
    });
    verifyRsiExternalPromotionReviewResult(reviewResult, request);

    await this.#ledger.append('RSI_EXTERNAL_PROMOTION_REVIEW_FINALIZED', {
      external_promotion_review_request: request,
      verified_archive_admission: archiveAdmission,
      external_promotion_review_result: reviewResult,
      durable_before_archive_apply: true,
      existing_self_update_handoff_authorized: false,
      direct_install_authorized: false,
      self_update_invocation_authorized: false,
      promotion_token: null,
      authority_effect: false,
    });

    const appliedAdmission = this.#verifiedArchive.admit({
      plan: request.tournament_plan,
      result: request.tournament_result,
      receipts: request.tournament_receipts,
    });
    if (appliedAdmission.admission_digest !== archiveAdmission.admission_digest) {
      throw new Error('rsi_runtime_verified_archive_apply_mismatch');
    }
    this.#externalPromotionReviewResultCount += 1;
    this.#lastExternalPromotionReviewResultDigest = reviewResult.result_digest;
    return Object.freeze({
      request,
      archive_admission: appliedAdmission,
      review_result: reviewResult,
    });
  }

  async prepareReleaseAuthorityHandoff({
    promotion_review_result_digest,
    authority_readback,
    trusted_release,
    immutable_release_evidence,
    provenance_evidence,
    source_ancestry_evidence,
    evaluated_at,
  } = {}) {
    this.#assertRunning();
    const reviewDigest = String(promotion_review_result_digest || '').trim().toLowerCase();
    if (!SHA256_PREFIXED.test(reviewDigest)) throw new Error('rsi_runtime_promotion_review_result_digest_invalid');
    if (this.#findReleaseAuthorityHandoffByReviewResult(reviewDigest)) {
      throw new Error('rsi_runtime_release_authority_handoff_already_prepared');
    }
    const review = this.#findExternalPromotionReviewByResultDigest(reviewDigest);
    if (!review) throw new Error('rsi_runtime_external_promotion_review_result_not_persisted');
    verifyRsiExternalPromotionReviewResult(review.result, review.request);
    const handoff = createRsiReleaseAuthorityHandoff({
      promotion_review_result: review.result,
      promotion_review_request: review.request,
      authority_readback,
      trusted_release,
      immutable_release_evidence,
      provenance_evidence,
      source_ancestry_evidence,
      evaluated_at,
    });
    verifyRsiReleaseAuthorityHandoff(handoff, review.result, review.request);
    await this.#ledger.append('RSI_RELEASE_AUTHORITY_HANDOFF_PREPARED', {
      release_authority_handoff: handoff,
      external_release_executor_required: true,
      separate_journaled_promotion_effect_required: true,
      exact_live_readback_required_before_effect: true,
      release_transaction_created: false,
      installer_effect_started: false,
      self_update_check_invoked: false,
      self_update_apply_invoked: false,
      direct_install_authorized: false,
      direct_self_update_authorized: false,
      authority_effect: false,
    });
    this.#releaseAuthorityHandoffCount += 1;
    this.#lastReleaseAuthorityHandoffDigest = handoff.handoff_digest;
    this.#lastReleaseAuthorityHandoffState = handoff.state;
    return handoff;
  }

  async prepareReleaseExecutorAdmission({
    release_handoff_digest,
    executor_readback,
    pre_effect_authority_readback,
    evaluated_at,
  } = {}) {
    this.#assertRunning();
    const handoffDigest = String(release_handoff_digest || '').trim().toLowerCase();
    if (!SHA256_PREFIXED.test(handoffDigest)) throw new Error('rsi_runtime_release_handoff_digest_invalid');
    if (this.#findReleaseExecutorAdmissionByHandoff(handoffDigest)) {
      throw new Error('rsi_runtime_release_executor_admission_already_prepared');
    }
    const releaseHandoff = this.#findReleaseAuthorityHandoffByDigest(handoffDigest);
    if (!releaseHandoff) throw new Error('rsi_runtime_release_authority_handoff_not_persisted');
    const review = this.#findExternalPromotionReviewByResultDigest(releaseHandoff.promotion_review_result_digest);
    if (!review) throw new Error('rsi_runtime_external_promotion_review_result_not_persisted');
    verifyRsiExternalPromotionReviewResult(review.result, review.request);
    verifyRsiReleaseAuthorityHandoff(releaseHandoff, review.result, review.request);
    const admission = createRsiReleaseExecutorAdmission({
      release_handoff: releaseHandoff,
      promotion_review_result: review.result,
      promotion_review_request: review.request,
      executor_readback,
      pre_effect_authority_readback,
      evaluated_at,
    });
    verifyRsiReleaseExecutorAdmission(admission);
    await this.#ledger.append('RSI_RELEASE_EXECUTOR_ADMISSION_PREPARED', {
      release_executor_admission: admission,
      db_lease_is_execution_authority: true,
      admission_is_execution_authority: false,
      command_created_by_rsi: false,
      command_leased_by_rsi: false,
      command_completed_by_rsi: false,
      effect_invoked_by_rsi: false,
      release_transaction_created: false,
      installer_effect_started: false,
      self_update_check_invoked: false,
      self_update_apply_invoked: false,
      ambiguous_effect_replay_allowed: false,
      authority_effect: false,
    });
    this.#releaseExecutorAdmissionCount += 1;
    this.#lastReleaseExecutorAdmissionDigest = admission.admission_digest;
    this.#lastReleaseExecutorCommandId = admission.command_id;
    return admission;
  }

  async reconcileReleaseEffect({
    executor_admission_digest,
    command_readback,
    transaction_readback,
    successor_runtime_readback = null,
    reconciled_at,
  } = {}) {
    this.#assertRunning();
    const admissionDigest = String(executor_admission_digest || '').trim().toLowerCase();
    if (!SHA256_PREFIXED.test(admissionDigest)) throw new Error('rsi_runtime_release_executor_admission_digest_invalid');
    if (this.#findReleaseEffectReconciliationByAdmission(admissionDigest)) {
      throw new Error('rsi_runtime_release_effect_already_reconciled');
    }
    const admission = this.#findReleaseExecutorAdmissionByDigest(admissionDigest);
    if (!admission) throw new Error('rsi_runtime_release_executor_admission_not_persisted');
    verifyRsiReleaseExecutorAdmission(admission);
    const releaseHandoff = this.#findReleaseAuthorityHandoffByDigest(admission.release_handoff_digest);
    if (!releaseHandoff) throw new Error('rsi_runtime_release_authority_handoff_not_persisted');
    const review = this.#findExternalPromotionReviewByResultDigest(releaseHandoff.promotion_review_result_digest);
    if (!review) throw new Error('rsi_runtime_external_promotion_review_result_not_persisted');
    verifyRsiExternalPromotionReviewResult(review.result, review.request);
    verifyRsiReleaseAuthorityHandoff(releaseHandoff, review.result, review.request);
    const reconciliation = createRsiReleaseEffectReconciliation({
      executor_admission: admission,
      release_handoff: releaseHandoff,
      promotion_review_result: review.result,
      promotion_review_request: review.request,
      command_readback,
      transaction_readback,
      successor_runtime_readback,
      reconciled_at,
    });
    verifyRsiReleaseEffectReconciliation(reconciliation);
    await this.#ledger.append('RSI_RELEASE_EFFECT_RECONCILED', {
      release_effect_reconciliation: reconciliation,
      same_command_receipt_required: true,
      effect_reexecution_authorized: false,
      retry_authorized: false,
      ambiguous_effect_replay_allowed: false,
      release_authority_advanced_by_rsi: false,
      self_update_invoked_by_rsi: false,
      authority_effect: false,
    });
    this.#releaseEffectReconciliationCount += 1;
    this.#lastReleaseEffectReconciliationDigest = reconciliation.reconciliation_digest;
    this.#lastReleaseEffectOutcome = reconciliation.result;
    return reconciliation;
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
      release_effect_reconciliation: Object.freeze({
        count: this.#releaseEffectReconciliationCount,
        last_digest: this.#lastReleaseEffectReconciliationDigest,
        last_outcome: this.#lastReleaseEffectOutcome,
        same_command_receipt_required: true,
        db_command_completion_is_not_physical_success_proof: true,
        exact_qualified_successor_required_for_confirmed_success: true,
        effect_reexecution_authorized: false,
        retry_authorized: false,
        ambiguous_effect_replay_allowed: false,
        release_authority_advanced_by_rsi: false,
        self_update_invoked_by_rsi: false,
        execution_authority: false,
        release_authority: false,
        promotion_authority: false,
        self_update_authority: false,
        authority_effect: false,
      }),
      release_executor_admission: Object.freeze({
        count: this.#releaseExecutorAdmissionCount,
        last_digest: this.#lastReleaseExecutorAdmissionDigest,
        last_command_id: this.#lastReleaseExecutorCommandId,
        db_lease_is_execution_authority: true,
        external_scheduler_selection_required: true,
        exact_fresh_readback_required: true,
        command_created_by_rsi: false,
        command_leased_by_rsi: false,
        command_completed_by_rsi: false,
        effect_invoked_by_rsi: false,
        release_transaction_created_by_rsi: false,
        installer_effect_started_by_rsi: false,
        self_update_check_invoked_by_rsi: false,
        self_update_apply_invoked_by_rsi: false,
        ambiguous_effect_replay_allowed: false,
        execution_authority: false,
        release_authority: false,
        promotion_authority: false,
        self_update_authority: false,
        authority_effect: false,
      }),
      release_authority_handoff: Object.freeze({
        count: this.#releaseAuthorityHandoffCount,
        last_digest: this.#lastReleaseAuthorityHandoffDigest,
        last_state: this.#lastReleaseAuthorityHandoffState,
        external_release_executor_required: true,
        separate_journaled_promotion_effect_required: true,
        exact_live_readback_required_before_effect: true,
        release_transaction_created_by_rsi: false,
        installer_effect_started_by_rsi: false,
        self_update_check_invoked_by_rsi: false,
        self_update_apply_invoked_by_rsi: false,
        direct_install_authorized: false,
        direct_self_update_authorized: false,
        ambiguous_effect_replay_allowed: false,
        execution_authority: false,
        release_authority: false,
        promotion_authority: false,
        self_update_authority: false,
        authority_effect: false,
      }),
      external_promotion_review: Object.freeze({
        request_count: this.#externalPromotionReviewRequestCount,
        result_count: this.#externalPromotionReviewResultCount,
        last_request_digest: this.#lastExternalPromotionReviewRequestDigest,
        last_result_digest: this.#lastExternalPromotionReviewResultDigest,
        nomination_ready_required: true,
        verified_archive_admission_required: true,
        signed_artifact_and_slsa_provenance_required: true,
        exact_candidate_head_ci_required: true,
        shadow_canary_required: true,
        rollback_ready_required: true,
        external_human_or_release_authority_still_required: true,
        existing_self_update_handoff_authorized: false,
        direct_install_authorized: false,
        self_update_invocation_authorized: false,
        promotion_token: null,
        execution_authority: false,
        promotion_authority: false,
        self_update_authority: false,
        authority_effect: false,
      }),
      external_evaluation: Object.freeze({
        bundle_count: this.#externalEvaluationBundleCount,
        last_bundle_digest: this.#lastExternalEvaluationBundleDigest,
        required_evidence_kinds: ['HARD_INVARIANTS','OBJECTIVES','HOLDOUT','REGRESSION_REPLAY','EVALUATION_INTEGRITY','TOURNAMENT'],
        durable_before_episode_apply: true,
        candidate_can_self_certify: false,
        direct_promotion_enabled: false,
        execution_authority: false,
        promotion_authority: false,
        self_update_authority: false,
        authority_effect: false,
      }),
      verified_candidate_materialization: Object.freeze({
        count: this.#verifiedCandidateMaterializationCount,
        last_digest: this.#lastVerifiedCandidateMaterializationDigest,
        external_evaluation_required: true,
        candidate_registered_only_after_durable_append: true,
        eligible_for_promotion: false,
        materialization_replay_authorized: false,
        execution_authority: false,
        promotion_authority: false,
        self_update_authority: false,
        authority_effect: false,
      }),
      devos_materialization: Object.freeze({
        handoff_count: this.#materializationHandoffCount,
        admission_count: this.#materializationAdmissionCount,
        last_handoff_digest: this.#lastMaterializationHandoffDigest,
        last_admission_digest: this.#lastMaterializationAdmissionDigest,
        existing_devos_scheduler_required: true,
        existing_workspace_manager_required: true,
        db_lease_is_execution_authority: true,
        scheduler_rpc_invoked_by_rsi: false,
        repository_mutation_performed_by_rsi: false,
        candidate_materialized_by_rsi: false,
        execution_authority: false,
        promotion_authority: false,
        self_update_authority: false,
        authority_effect: false,
      }),
      candidate_synthesis: Object.freeze({
        planned_build_count: this.#candidateSynthesisPlanCount,
        last_context_aware_build_digest: this.#lastContextAwareBuildDigest,
        existing_devos_scheduler_required: true,
        devos_lease_required_before_materialization: true,
        lease_created: false,
        workspace_created: false,
        candidate_materialized: false,
        execution_authority: false,
        promotion_authority: false,
        self_update_authority: false,
        authority_effect: false,
      }),
      experience_context: Object.freeze({
        planned_count: this.#experienceContextPlanCount,
        last_context_plan_digest: this.#lastExperienceContextPlanDigest,
        verified_graph_available: this.#experienceGraphSnapshot != null,
        retrieval_is_advisory_only: true,
        existing_devos_scheduler_required: true,
        task_lease_created: false,
        candidate_materialized: false,
        execution_authority: false,
        promotion_authority: false,
        self_update_authority: false,
        authority_effect: false,
      }),
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
