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
import { createRsiBrowserOutcomeEpisode, rsiBrowserOutcomeIngestTrustRootSnapshot } from './rsi-browser-outcome-ingest.mjs';
import { RsiBrowserCommandAttributionRegistry, rsiBrowserCommandAttributionTrustRootSnapshot } from './rsi-browser-command-attribution-registry.mjs';
import {
  createRsiTrustedCreditReceipt,
  createRsiExperienceGraphAdmission,
  applyRsiExperienceGraphAdmission,
  rsiTrustedCreditTrustRootSnapshot,
} from './rsi-trusted-credit-assignment.mjs';
import { createRsiExperienceContextPlan, verifyRsiExperienceContextPlan, rsiExperienceContextTrustRootSnapshot } from './rsi-experience-context-planner.mjs';
import {
  createRsiCandidateSynthesisRequest,
  createRsiCandidateMutationProposal,
  prepareRsiContextAwareCandidateBuild,
  createRsiContextAwareCandidateLedgerPayload,
  rsiContextAwareCandidateTrustRootSnapshot,
} from './rsi-context-aware-candidate-synthesis.mjs';
import { createRsiDevosMaterializationHandoff, admitRsiDevosMaterialization, rsiDevosMaterializationTrustRootSnapshot } from './rsi-devos-materialization-handoff.mjs';
import { createRsiVerifiedCandidateMaterialization, rsiVerifiedCandidateMaterializationTrustRootSnapshot } from './rsi-verified-candidate-materialization.mjs';
import {
  createRsiEpisodePromotionReview,
  verifyRsiEpisodePromotionReview,
  rsiEpisodePromotionReviewTrustRootSnapshot,
} from './rsi-episode-promotion-review.mjs';
import {
  createRsiExternalReleaseHandoffIntent,
  verifyRsiExternalReleaseHandoffIntent,
  rsiExternalReleaseHandoffTrustRootSnapshot,
} from './rsi-external-release-handoff-intent.mjs';
import {
  createRsiPublishedReleaseReconciliation,
  verifyRsiPublishedReleaseReconciliation,
  rsiPublishedReleaseReconciliationTrustRootSnapshot,
} from './rsi-published-release-reconciliation.mjs';
import {
  createRsiReleasePromotionJournalIntent,
  verifyRsiReleasePromotionJournalIntent,
  rsiReleasePromotionJournalTrustRootSnapshot,
} from './rsi-release-promotion-journal.mjs';
import {
  verifyRsiReleaseAuthorityReadback,
  createRsiSelfUpdateEligibilityReview,
  verifyRsiSelfUpdateEligibilityReview,
  rsiSelfUpdateEligibilityReviewTrustRootSnapshot,
} from './rsi-release-promotion-outcome-ingest.mjs';
import {
  createRsiSelfUpdateCheckAdmission,
  verifyRsiSelfUpdateCheckAdmission,
  rsiSelfUpdateCheckAdmissionTrustRootSnapshot,
} from './rsi-self-update-controller-admission.mjs';
import {
  createRsiSelfUpdateDownloadReadiness,
  verifyRsiSelfUpdateDownloadReadiness,
  rsiSelfUpdateDownloadReadinessTrustRootSnapshot,
} from './rsi-self-update-download-readiness.mjs';
import {
  createRsiSelfUpdateRestartGateProbeAdmission,
  verifyRsiSelfUpdateRestartGateProbeAdmission,
  rsiSelfUpdateRestartGateProbeTrustRootSnapshot,
} from './rsi-self-update-restart-gate-probe-admission.mjs';
import {
  createRsiSelfUpdateRestartGateProbeOutcome,
  verifyRsiSelfUpdateRestartGateProbeOutcome,
  rsiSelfUpdateRestartGateProbeOutcomeTrustRootSnapshot,
} from './rsi-self-update-restart-gate-probe-outcome.mjs';
import {
  createRsiSelfUpdateFinalInstallCycleAdmission,
  verifyRsiSelfUpdateFinalInstallCycleAdmission,
  rsiSelfUpdateFinalInstallCycleTrustRootSnapshot,
} from './rsi-self-update-final-install-cycle-admission.mjs';
import {
  createRsiSelfUpdateFinalApplyInvocationReceipt,
  verifyRsiSelfUpdateFinalApplyInvocationReceipt,
  createRsiSelfUpdatePostEffectReadback,
  verifyRsiSelfUpdatePostEffectReadback,
  rsiSelfUpdateFinalApplyReadbackTrustRootSnapshot,
} from './rsi-self-update-final-apply-readback.mjs';

export const RSI_RUNTIME_SERVICE_SCHEMA = 'metaengine.rsi.runtime-service.v1';
export const RSI_RUNTIME_MODE = 'SHADOW_VERIFIED';

const SHA40 = /^[0-9a-f]{40}$/;
const DIGEST64 = /^[0-9a-f]{64}$/;
const MAX_AUTONOMOUS_PREPARED_REQUESTS = 256;
const MAX_HARNESS_EVIDENCE_DIGESTS = 1024;
const MAX_VERIFIED_SEARCH_FEEDBACK = 512;
const PREFIXED_SHA256 = /^sha256:[0-9a-f]{64}$/;
const MAX_PENDING_LEARNING_OUTCOMES = 4096;
const MAX_EPISODE_PROMOTION_REVIEWS = 256;
const MAX_EXTERNAL_RELEASE_HANDOFF_INTENTS = 128;
const MAX_PUBLISHED_RELEASE_RECONCILIATIONS = 128;
const MAX_RELEASE_PROMOTION_JOURNAL_INTENTS = 128;
const MAX_SELF_UPDATE_ELIGIBILITY_REVIEWS = 128;
const MAX_SELF_UPDATE_CHECK_ADMISSIONS = 128;
const MAX_SELF_UPDATE_DOWNLOAD_READINESS = 128;
const MAX_SELF_UPDATE_RESTART_GATE_PROBE_ADMISSIONS = 128;
const MAX_SELF_UPDATE_RESTART_GATE_PROBE_OUTCOMES = 256;
const MAX_SELF_UPDATE_FINAL_INSTALL_ADMISSIONS = 128;
const MAX_SELF_UPDATE_FINAL_APPLY_INVOCATIONS = 128;
const MAX_SELF_UPDATE_POST_EFFECT_READBACKS = 256;

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
    browser_outcome_ingest: rsiBrowserOutcomeIngestTrustRootSnapshot(),
    browser_command_attribution: rsiBrowserCommandAttributionTrustRootSnapshot(),
    trusted_credit: rsiTrustedCreditTrustRootSnapshot(),
    experience_context: rsiExperienceContextTrustRootSnapshot(),
    context_aware_candidate: rsiContextAwareCandidateTrustRootSnapshot(),
    devos_materialization: rsiDevosMaterializationTrustRootSnapshot(),
    verified_candidate_materialization: rsiVerifiedCandidateMaterializationTrustRootSnapshot(),
    episode_promotion_review: rsiEpisodePromotionReviewTrustRootSnapshot(),
    external_release_handoff: rsiExternalReleaseHandoffTrustRootSnapshot(),
    published_release_reconciliation: rsiPublishedReleaseReconciliationTrustRootSnapshot(),
    release_promotion_journal: rsiReleasePromotionJournalTrustRootSnapshot(),
    self_update_eligibility_review: rsiSelfUpdateEligibilityReviewTrustRootSnapshot(),
    self_update_check_admission: rsiSelfUpdateCheckAdmissionTrustRootSnapshot(),
    self_update_download_readiness: rsiSelfUpdateDownloadReadinessTrustRootSnapshot(),
    self_update_restart_gate_probe: rsiSelfUpdateRestartGateProbeTrustRootSnapshot(),
    self_update_restart_gate_probe_outcome: rsiSelfUpdateRestartGateProbeOutcomeTrustRootSnapshot(),
    self_update_final_install_cycle: rsiSelfUpdateFinalInstallCycleTrustRootSnapshot(),
    self_update_final_apply_readback: rsiSelfUpdateFinalApplyReadbackTrustRootSnapshot(),
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
  #commandAttributions;
  #pendingLearningOutcomes = new Map();
  #creditedOutcomeDigests = new Set();
  #experienceGraphSnapshot = null;
  #browserOutcomeCount = 0;
  #browserOutcomeLearningEligibleCount = 0;
  #browserOutcomeQuarantinedCount = 0;
  #lastBrowserOutcomeDigest = null;
  #experienceContextPlans = new Map();
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
  #episodePromotionReviewDigests = new Set();
  #lastEpisodePromotionReviewDigest = null;
  #externalReleaseHandoffDigests = new Set();
  #lastExternalReleaseHandoffDigest = null;
  #publishedReleaseReconciliationDigests = new Set();
  #lastPublishedReleaseReconciliationDigest = null;
  #releasePromotionJournalIntentDigests = new Set();
  #lastReleasePromotionJournalIntentDigest = null;
  #selfUpdateEligibilityReviewDigests = new Set();
  #lastSelfUpdateEligibilityReviewDigest = null;
  #selfUpdateCheckAdmissionDigests = new Set();
  #lastSelfUpdateCheckAdmissionDigest = null;
  #selfUpdateDownloadReadinessDigests = new Set();
  #lastSelfUpdateDownloadReadinessDigest = null;
  #selfUpdateRestartGateProbeDigests = new Set();
  #lastSelfUpdateRestartGateProbeDigest = null;
  #selfUpdateRestartGateProbeOutcomeDigests = new Set();
  #lastSelfUpdateRestartGateProbeOutcomeDigest = null;
  #selfUpdateFinalInstallAdmissionDigests = new Set();
  #lastSelfUpdateFinalInstallAdmissionDigest = null;
  #selfUpdateFinalApplyInvocationDigests = new Set();
  #lastSelfUpdateFinalApplyInvocationDigest = null;
  #selfUpdatePostEffectReadbackDigests = new Set();
  #lastSelfUpdatePostEffectReadbackDigest = null;

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
        if (row?.type === 'BRAIN_OBSERVATION' && row?.payload?.observation?.observation_digest) {
          const prepared = this.#improvementFrontier.prepare(row.payload.observation);
          this.#improvementFrontier.commit(prepared);
        }
        if (row?.payload?.experience_context_plan) {
          const plan = verifyRsiExperienceContextPlan(row.payload.experience_context_plan);
          const episodeId = row?.payload?.episode_event?.episode_id || null;
          if (episodeId) this.#experienceContextPlans.set(episodeId, Object.freeze(structuredClone(plan)));
          this.#experienceContextPlanCount += 1;
          this.#lastExperienceContextPlanDigest = plan.context_plan_digest;
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
        if (row?.type === 'RSI_EPISODE_PROMOTION_REVIEW_READY' && row?.payload?.review_digest) {
          if (this.#episodePromotionReviewDigests.size >= MAX_EPISODE_PROMOTION_REVIEWS) {
            throw new Error('rsi_runtime_episode_promotion_review_replay_capacity_exhausted');
          }
          const reviewDigest = exactPrefixedDigest(row.payload.review_digest, 'episode_promotion_review_digest');
          this.#episodePromotionReviewDigests.add(reviewDigest);
          this.#lastEpisodePromotionReviewDigest = reviewDigest;
        }
        if (row?.type === 'RSI_EXTERNAL_RELEASE_HANDOFF_INTENT_READY' && row?.payload?.release_handoff_intent) {
          const intent = verifyRsiExternalReleaseHandoffIntent(row.payload.release_handoff_intent);
          if (this.#externalReleaseHandoffDigests.size >= MAX_EXTERNAL_RELEASE_HANDOFF_INTENTS) {
            throw new Error('rsi_runtime_external_release_handoff_replay_capacity_exhausted');
          }
          this.#externalReleaseHandoffDigests.add(intent.handoff_intent_digest);
          this.#lastExternalReleaseHandoffDigest = intent.handoff_intent_digest;
        }
        if (row?.type === 'RSI_PUBLISHED_RELEASE_RECONCILIATION_READY' && row?.payload?.published_release_reconciliation) {
          const reconciliation = verifyRsiPublishedReleaseReconciliation(row.payload.published_release_reconciliation);
          if (this.#publishedReleaseReconciliationDigests.size >= MAX_PUBLISHED_RELEASE_RECONCILIATIONS) {
            throw new Error('rsi_runtime_published_release_reconciliation_replay_capacity_exhausted');
          }
          this.#publishedReleaseReconciliationDigests.add(reconciliation.reconciliation_digest);
          this.#lastPublishedReleaseReconciliationDigest = reconciliation.reconciliation_digest;
        }
        if (row?.type === 'RSI_RELEASE_PROMOTION_JOURNAL_INTENT_READY' && row?.payload?.release_promotion_journal_intent) {
          const intent = verifyRsiReleasePromotionJournalIntent(row.payload.release_promotion_journal_intent);
          if (this.#releasePromotionJournalIntentDigests.size >= MAX_RELEASE_PROMOTION_JOURNAL_INTENTS) {
            throw new Error('rsi_runtime_release_promotion_journal_intent_replay_capacity_exhausted');
          }
          this.#releasePromotionJournalIntentDigests.add(intent.journal_intent_digest);
          this.#lastReleasePromotionJournalIntentDigest = intent.journal_intent_digest;
        }
        if (row?.type === 'RSI_SELF_UPDATE_ELIGIBILITY_REVIEW_READY' && row?.payload?.self_update_eligibility_review) {
          const review = verifyRsiSelfUpdateEligibilityReview(row.payload.self_update_eligibility_review);
          if (this.#selfUpdateEligibilityReviewDigests.size >= MAX_SELF_UPDATE_ELIGIBILITY_REVIEWS) {
            throw new Error('rsi_runtime_self_update_eligibility_review_replay_capacity_exhausted');
          }
          this.#selfUpdateEligibilityReviewDigests.add(review.eligibility_review_digest);
          this.#lastSelfUpdateEligibilityReviewDigest = review.eligibility_review_digest;
        }
        if (row?.type === 'RSI_SELF_UPDATE_CHECK_ADMISSION_READY' && row?.payload?.self_update_check_admission) {
          const admission = verifyRsiSelfUpdateCheckAdmission(row.payload.self_update_check_admission);
          if (this.#selfUpdateCheckAdmissionDigests.size >= MAX_SELF_UPDATE_CHECK_ADMISSIONS) {
            throw new Error('rsi_runtime_self_update_check_admission_replay_capacity_exhausted');
          }
          this.#selfUpdateCheckAdmissionDigests.add(admission.admission_digest);
          this.#lastSelfUpdateCheckAdmissionDigest = admission.admission_digest;
        }
        if (row?.type === 'RSI_SELF_UPDATE_DOWNLOAD_READINESS_READY' && row?.payload?.self_update_download_readiness) {
          const readiness = verifyRsiSelfUpdateDownloadReadiness(row.payload.self_update_download_readiness);
          if (this.#selfUpdateDownloadReadinessDigests.size >= MAX_SELF_UPDATE_DOWNLOAD_READINESS) {
            throw new Error('rsi_runtime_self_update_download_readiness_replay_capacity_exhausted');
          }
          this.#selfUpdateDownloadReadinessDigests.add(readiness.readiness_digest);
          this.#lastSelfUpdateDownloadReadinessDigest = readiness.readiness_digest;
        }
        if (row?.type === 'RSI_SELF_UPDATE_RESTART_GATE_PROBE_ADMISSION_READY' && row?.payload?.restart_gate_probe_admission) {
          const admission = verifyRsiSelfUpdateRestartGateProbeAdmission(row.payload.restart_gate_probe_admission);
          if (this.#selfUpdateRestartGateProbeDigests.size >= MAX_SELF_UPDATE_RESTART_GATE_PROBE_ADMISSIONS) {
            throw new Error('rsi_runtime_restart_gate_probe_admission_replay_capacity_exhausted');
          }
          this.#selfUpdateRestartGateProbeDigests.add(admission.probe_admission_digest);
          this.#lastSelfUpdateRestartGateProbeDigest = admission.probe_admission_digest;
        }
        if (row?.type === 'RSI_SELF_UPDATE_RESTART_GATE_PROBE_OUTCOME_RECORDED' && row?.payload?.restart_gate_probe_outcome) {
          const outcome = verifyRsiSelfUpdateRestartGateProbeOutcome(row.payload.restart_gate_probe_outcome);
          if (this.#selfUpdateRestartGateProbeOutcomeDigests.size >= MAX_SELF_UPDATE_RESTART_GATE_PROBE_OUTCOMES) {
            throw new Error('rsi_runtime_restart_gate_probe_outcome_replay_capacity_exhausted');
          }
          this.#selfUpdateRestartGateProbeOutcomeDigests.add(outcome.outcome_digest);
          this.#lastSelfUpdateRestartGateProbeOutcomeDigest = outcome.outcome_digest;
        }
        if (row?.type === 'RSI_SELF_UPDATE_FINAL_INSTALL_ADMISSION_READY' && row?.payload?.final_install_admission) {
          const admission = verifyRsiSelfUpdateFinalInstallCycleAdmission(row.payload.final_install_admission);
          if (this.#selfUpdateFinalInstallAdmissionDigests.size >= MAX_SELF_UPDATE_FINAL_INSTALL_ADMISSIONS) {
            throw new Error('rsi_runtime_final_install_admission_replay_capacity_exhausted');
          }
          this.#selfUpdateFinalInstallAdmissionDigests.add(admission.final_install_admission_digest);
          this.#lastSelfUpdateFinalInstallAdmissionDigest = admission.final_install_admission_digest;
        }
        if (row?.type === 'RSI_SELF_UPDATE_FINAL_APPLY_INVOCATION_RECORDED' && row?.payload?.final_apply_invocation_receipt) {
          const receipt = row.payload.final_apply_invocation_receipt;
          if (this.#selfUpdateFinalApplyInvocationDigests.size >= MAX_SELF_UPDATE_FINAL_APPLY_INVOCATIONS) {
            throw new Error('rsi_runtime_final_apply_invocation_replay_capacity_exhausted');
          }
          this.#selfUpdateFinalApplyInvocationDigests.add(exactPrefixedDigest(receipt.invocation_receipt_digest, 'final_apply_invocation_digest'));
          this.#lastSelfUpdateFinalApplyInvocationDigest = receipt.invocation_receipt_digest;
        }
        if (row?.type === 'RSI_SELF_UPDATE_POST_EFFECT_READBACK_RECORDED' && row?.payload?.post_effect_readback) {
          const readback = verifyRsiSelfUpdatePostEffectReadback(row.payload.post_effect_readback);
          if (this.#selfUpdatePostEffectReadbackDigests.size >= MAX_SELF_UPDATE_POST_EFFECT_READBACKS) {
            throw new Error('rsi_runtime_post_effect_readback_replay_capacity_exhausted');
          }
          this.#selfUpdatePostEffectReadbackDigests.add(readback.post_effect_readback_digest);
          this.#lastSelfUpdatePostEffectReadbackDigest = readback.post_effect_readback_digest;
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

    if (this.#episodes.hasEpisode(episodeId)) {
      const existing = this.#episodes.episode(episodeId);
      if (
        existing.source_sha !== contextPlan.source_sha
        || existing.observation_digest !== contextPlan.observation_digest
        || existing.opportunity_id !== contextPlan.opportunity_id
        || existing.hypothesis_digest !== contextPlan.hypothesis_digest
        || existing.mutation_surface !== contextPlan.mutation_surface
        || existing.search_context_digest !== contextPlan.search_context_digest
      ) throw new Error('rsi_runtime_experience_context_episode_identity_conflict');
      const stored = this.#experienceContextPlans.get(episodeId);
      if (stored && stored.context_plan_digest !== contextPlan.context_plan_digest) {
        throw new Error('rsi_runtime_experience_context_plan_conflict');
      }
      if (!stored) this.#experienceContextPlans.set(episodeId, Object.freeze(structuredClone(contextPlan)));
      return Object.freeze({ context_plan: contextPlan, episode: existing, already_open: true });
    }

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
    this.#experienceContextPlans.set(episodeId, Object.freeze(structuredClone(contextPlan)));
    this.#experienceContextPlanCount += 1;
    this.#lastExperienceContextPlanDigest = contextPlan.context_plan_digest;
    return Object.freeze({ context_plan: contextPlan, episode, already_open: false });
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
      existing_devos_scheduler_required: true,
      lease_created: false,
      workspace_created: false,
      candidate_materialized: false,
      authority_effect: false,
    });
    this.#candidateSynthesisPlanCount += 1;
    this.#lastContextAwareBuildDigest = build.context_aware_build_digest;
    return Object.freeze({
      synthesis_request: request,
      mutation_proposal: mutationProposal,
      context_candidate_build: build,
      existing_devos_scheduler_required: true,
      scheduler_action_authorized: false,
      authority_effect: false,
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
    const existing = this.#findPersistedMaterializationHandoff(handoff.handoff_digest);
    if (existing) return existing;
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
    const existing = this.#findPersistedMaterializationAdmission(admission.admission_digest);
    if (existing) return existing;
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
      materialization_replay_authorized: false,
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
    if (!PREFIXED_SHA256.test(episodeDigest)) throw new Error('rsi_runtime_outcome_episode_digest_invalid');
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

  async prepareEpisodePromotionReview({
    episode_id,
    candidate_id,
    evaluation_bundle,
    candidate_handoff,
    tournament_plan,
    tournament_result,
    archive_admission,
    qualification,
    risk_confirmation,
  } = {}) {
    this.#assertRunning();
    const readiness = this.#episodes.nominationReadiness({ episode_id, candidate_id });
    const review = createRsiEpisodePromotionReview({
      episode_readiness: readiness,
      evaluation_bundle,
      candidate_handoff,
      tournament_plan,
      tournament_result,
      archive_admission,
      qualification,
      risk_confirmation,
    });
    verifyRsiEpisodePromotionReview(review);
    const reviewDigest = exactPrefixedDigest(review.review_digest, 'episode_promotion_review_digest');
    if (this.#episodePromotionReviewDigests.has(reviewDigest)) return review;
    if (this.#episodePromotionReviewDigests.size >= MAX_EPISODE_PROMOTION_REVIEWS) {
      throw new Error('rsi_runtime_episode_promotion_review_capacity_exhausted');
    }
    await this.#ledger.append('RSI_EPISODE_PROMOTION_REVIEW_READY', {
      episode_id: review.episode_id,
      candidate_id: review.candidate_id,
      candidate_sha: review.candidate_sha,
      parent_sha: review.parent_sha,
      review_digest: review.review_digest,
      evaluation_bundle_digest: review.evaluation_bundle_digest,
      promotion_gate_digest: review.promotion_gate_digest,
      risk_review_digest: review.risk_review_digest,
      risk_confirmation_digest: review.risk_confirmation_digest,
      artifact_digest: review.artifact_digest,
      provenance_digest: review.provenance_digest,
      rollback: review.rollback,
      external_release_handoff_review_required: true,
      release_handoff_authorized: false,
      direct_install_authorized: false,
      direct_promotion_authorized: false,
      existing_self_update_handoff_authorized: false,
      promotion_token: null,
      physical_effect_replay_allowed: false,
      authority_effect: false,
    });
    this.#episodePromotionReviewDigests.add(reviewDigest);
    this.#lastEpisodePromotionReviewDigest = reviewDigest;
    return review;
  }

  async prepareExternalReleaseHandoffIntent({
    episode_promotion_review,
    promotion_attestation_verification,
  } = {}) {
    this.#assertRunning();
    const review = verifyRsiEpisodePromotionReview(episode_promotion_review);
    if (!this.#episodePromotionReviewDigests.has(review.review_digest)) {
      throw new Error('rsi_runtime_episode_promotion_review_not_persisted');
    }
    const intent = createRsiExternalReleaseHandoffIntent({
      episode_promotion_review: review,
      promotion_attestation_verification,
    });
    verifyRsiExternalReleaseHandoffIntent(intent);
    if (this.#externalReleaseHandoffDigests.has(intent.handoff_intent_digest)) {
      return Object.freeze({ intent, already_recorded: true, authority_effect: false });
    }
    if (this.#externalReleaseHandoffDigests.size >= MAX_EXTERNAL_RELEASE_HANDOFF_INTENTS) {
      throw new Error('rsi_runtime_external_release_handoff_capacity_exhausted');
    }
    await this.#ledger.append('RSI_EXTERNAL_RELEASE_HANDOFF_INTENT_READY', {
      release_handoff_intent: intent,
      external_release_coordinator_review_required: true,
      publisher_action_authorized: false,
      release_publication_authorized: false,
      release_authority: false,
      self_update_handoff_authorized: false,
      direct_install_authorized: false,
      promotion_token: null,
      physical_effect_replay_allowed: false,
      authority_effect: false,
    });
    this.#externalReleaseHandoffDigests.add(intent.handoff_intent_digest);
    this.#lastExternalReleaseHandoffDigest = intent.handoff_intent_digest;
    return Object.freeze({ intent, already_recorded: false, authority_effect: false });
  }

  async preparePublishedReleaseReconciliation({
    release_handoff_intent,
    current_authority_sha,
    trusted_release,
    immutable_release_evidence,
    provenance_evidence,
    source_ancestry_evidence,
    now = new Date(),
  } = {}) {
    this.#assertRunning();
    const intent = verifyRsiExternalReleaseHandoffIntent(release_handoff_intent);
    if (!this.#externalReleaseHandoffDigests.has(intent.handoff_intent_digest)) {
      throw new Error('rsi_runtime_external_release_handoff_not_persisted');
    }
    const reconciliation = createRsiPublishedReleaseReconciliation({
      release_handoff_intent: intent,
      current_authority_sha,
      trusted_release,
      immutable_release_evidence,
      provenance_evidence,
      source_ancestry_evidence,
      now,
    });
    verifyRsiPublishedReleaseReconciliation(reconciliation);
    if (this.#publishedReleaseReconciliationDigests.has(reconciliation.reconciliation_digest)) {
      return Object.freeze({ reconciliation, already_recorded: true, authority_effect: false });
    }
    if (this.#publishedReleaseReconciliationDigests.size >= MAX_PUBLISHED_RELEASE_RECONCILIATIONS) {
      throw new Error('rsi_runtime_published_release_reconciliation_capacity_exhausted');
    }
    await this.#ledger.append('RSI_PUBLISHED_RELEASE_RECONCILIATION_READY', {
      published_release_reconciliation: reconciliation,
      authority_advance_authorized: false,
      release_authority_mutation_performed: false,
      separate_journaled_promotion_effect_required: true,
      self_update_handoff_authorized: false,
      direct_install_authorized: false,
      physical_effect_replay_allowed: false,
      authority_effect: false,
    });
    this.#publishedReleaseReconciliationDigests.add(reconciliation.reconciliation_digest);
    this.#lastPublishedReleaseReconciliationDigest = reconciliation.reconciliation_digest;
    return Object.freeze({ reconciliation, already_recorded: false, authority_effect: false });
  }

  async prepareReleasePromotionJournalIntent({
    published_release_reconciliation,
    generation = 1,
    occurred_at = new Date(this.#clock()).toISOString(),
  } = {}) {
    this.#assertRunning();
    const reconciliation = verifyRsiPublishedReleaseReconciliation(published_release_reconciliation);
    if (!this.#publishedReleaseReconciliationDigests.has(reconciliation.reconciliation_digest)) {
      throw new Error('rsi_runtime_published_release_reconciliation_not_persisted');
    }
    const intent = createRsiReleasePromotionJournalIntent({
      published_release_reconciliation: reconciliation,
      generation,
      occurred_at,
    });
    verifyRsiReleasePromotionJournalIntent(intent);
    if (this.#releasePromotionJournalIntentDigests.has(intent.journal_intent_digest)) {
      return Object.freeze({ intent, already_recorded: true, authority_effect: false });
    }
    if (this.#releasePromotionJournalIntentDigests.size >= MAX_RELEASE_PROMOTION_JOURNAL_INTENTS) {
      throw new Error('rsi_runtime_release_promotion_journal_intent_capacity_exhausted');
    }
    await this.#ledger.append('RSI_RELEASE_PROMOTION_JOURNAL_INTENT_READY', {
      release_promotion_journal_intent: intent,
      external_signed_capability_required: true,
      candidate_can_mint_capability: false,
      rsi_can_mint_capability: false,
      rsi_can_invoke_release_publisher: false,
      release_publisher_invocation_authorized: false,
      attempt_recorded: false,
      authority_advance_authorized: false,
      physical_effect_replay_allowed: false,
      authority_effect: false,
    });
    this.#releasePromotionJournalIntentDigests.add(intent.journal_intent_digest);
    this.#lastReleasePromotionJournalIntentDigest = intent.journal_intent_digest;
    return Object.freeze({ intent, already_recorded: false, authority_effect: false });
  }

  async recordSelfUpdateEligibilityReview({
    journal_intent,
    journal_events,
    authority_readback,
    trusted_release,
  } = {}) {
    this.#assertRunning();
    const intent = verifyRsiReleasePromotionJournalIntent(journal_intent);
    if (!this.#releasePromotionJournalIntentDigests.has(intent.journal_intent_digest)) {
      throw new Error('rsi_runtime_release_promotion_journal_intent_not_persisted');
    }
    const readback = verifyRsiReleaseAuthorityReadback(authority_readback, {
      journal_intent: intent,
      journal_events,
    });
    const review = createRsiSelfUpdateEligibilityReview({
      journal_intent: intent,
      journal_events,
      authority_readback: readback,
      trusted_release,
    });
    verifyRsiSelfUpdateEligibilityReview(review);
    if (this.#selfUpdateEligibilityReviewDigests.has(review.eligibility_review_digest)) {
      return Object.freeze({ review, already_recorded: true, authority_effect: false });
    }
    if (this.#selfUpdateEligibilityReviewDigests.size >= MAX_SELF_UPDATE_ELIGIBILITY_REVIEWS) {
      throw new Error('rsi_runtime_self_update_eligibility_review_capacity_exhausted');
    }
    await this.#ledger.append('RSI_SELF_UPDATE_ELIGIBILITY_REVIEW_READY', {
      authority_readback: readback,
      self_update_eligibility_review: review,
      raw_release_promotion_events_persisted: false,
      external_self_update_controller_required: true,
      self_update_check_authorized: false,
      self_update_apply_authorized: false,
      installer_launch_authorized: false,
      physical_effect_replay_allowed: false,
      authority_effect: false,
    });
    this.#selfUpdateEligibilityReviewDigests.add(review.eligibility_review_digest);
    this.#lastSelfUpdateEligibilityReviewDigest = review.eligibility_review_digest;
    return Object.freeze({ review, already_recorded: false, authority_effect: false });
  }

  async recordSelfUpdateCheckAdmission({
    eligibility_review,
    self_update_runtime_snapshot,
    prior_transaction = null,
    observed_at,
    observer_id,
  } = {}) {
    this.#assertRunning();
    const review = verifyRsiSelfUpdateEligibilityReview(eligibility_review);
    if (!this.#selfUpdateEligibilityReviewDigests.has(review.eligibility_review_digest)) {
      throw new Error('rsi_runtime_self_update_eligibility_review_not_persisted');
    }
    const admission = createRsiSelfUpdateCheckAdmission({
      eligibility_review: review,
      self_update_runtime_snapshot,
      prior_transaction,
      observed_at,
      observer_id,
    });
    verifyRsiSelfUpdateCheckAdmission(admission);
    if (this.#selfUpdateCheckAdmissionDigests.has(admission.admission_digest)) {
      return Object.freeze({ admission, already_recorded: true, authority_effect: false });
    }
    if (this.#selfUpdateCheckAdmissionDigests.size >= MAX_SELF_UPDATE_CHECK_ADMISSIONS) {
      throw new Error('rsi_runtime_self_update_check_admission_capacity_exhausted');
    }
    await this.#ledger.append('RSI_SELF_UPDATE_CHECK_ADMISSION_READY', {
      self_update_check_admission: admission,
      external_self_update_controller_required: true,
      self_update_check_invoked: false,
      self_update_check_authorized_by_rsi: false,
      self_update_apply_authorized: false,
      installer_launch_authorized: false,
      physical_effect_replay_allowed: false,
      authority_effect: false,
    });
    this.#selfUpdateCheckAdmissionDigests.add(admission.admission_digest);
    this.#lastSelfUpdateCheckAdmissionDigest = admission.admission_digest;
    return Object.freeze({ admission, already_recorded: false, authority_effect: false });
  }

  async recordSelfUpdateDownloadReadiness({
    check_admission,
    post_check_runtime_snapshot,
    prior_transaction = null,
    trusted_release,
    observed_at,
    observer_id,
  } = {}) {
    this.#assertRunning();
    const admission = verifyRsiSelfUpdateCheckAdmission(check_admission);
    if (!this.#selfUpdateCheckAdmissionDigests.has(admission.admission_digest)) {
      throw new Error('rsi_runtime_self_update_check_admission_not_persisted');
    }
    const readiness = createRsiSelfUpdateDownloadReadiness({
      check_admission: admission,
      post_check_runtime_snapshot,
      prior_transaction,
      trusted_release,
      observed_at,
      observer_id,
    });
    verifyRsiSelfUpdateDownloadReadiness(readiness);
    if (this.#selfUpdateDownloadReadinessDigests.has(readiness.readiness_digest)) {
      return Object.freeze({ readiness, already_recorded: true, authority_effect: false });
    }
    if (this.#selfUpdateDownloadReadinessDigests.size >= MAX_SELF_UPDATE_DOWNLOAD_READINESS) {
      throw new Error('rsi_runtime_self_update_download_readiness_capacity_exhausted');
    }
    await this.#ledger.append('RSI_SELF_UPDATE_DOWNLOAD_READINESS_READY', {
      self_update_download_readiness: readiness,
      external_apply_controller_required: true,
      apply_cycle_invoked: false,
      apply_cycle_authorized_by_rsi: false,
      restart_authorized: false,
      pre_install_receipt_authorized: false,
      installer_handoff_authorized: false,
      installer_launch_authorized: false,
      physical_effect_replay_allowed: false,
      authority_effect: false,
    });
    this.#selfUpdateDownloadReadinessDigests.add(readiness.readiness_digest);
    this.#lastSelfUpdateDownloadReadinessDigest = readiness.readiness_digest;
    return Object.freeze({ readiness, already_recorded: false, authority_effect: false });
  }

  async recordSelfUpdateRestartGateProbeAdmission({
    download_readiness,
    fresh_runtime_snapshot,
    prior_transaction = null,
    observed_at,
    observer_id,
  } = {}) {
    this.#assertRunning();
    const readiness = verifyRsiSelfUpdateDownloadReadiness(download_readiness);
    if (!this.#selfUpdateDownloadReadinessDigests.has(readiness.readiness_digest)) {
      throw new Error('rsi_runtime_self_update_download_readiness_not_persisted');
    }
    const admission = createRsiSelfUpdateRestartGateProbeAdmission({
      download_readiness: readiness,
      fresh_runtime_snapshot,
      prior_transaction,
      observed_at,
      observer_id,
    });
    verifyRsiSelfUpdateRestartGateProbeAdmission(admission);
    if (this.#selfUpdateRestartGateProbeDigests.has(admission.probe_admission_digest)) {
      return Object.freeze({ admission, already_recorded: true, authority_effect: false });
    }
    if (this.#selfUpdateRestartGateProbeDigests.size >= MAX_SELF_UPDATE_RESTART_GATE_PROBE_ADMISSIONS) {
      throw new Error('rsi_runtime_restart_gate_probe_admission_capacity_exhausted');
    }
    await this.#ledger.append('RSI_SELF_UPDATE_RESTART_GATE_PROBE_ADMISSION_READY', {
      restart_gate_probe_admission: admission,
      external_self_update_controller_required: true,
      probe_cycle_invoked: false,
      probe_cycle_authorized_by_rsi: false,
      second_cycle_authorized: false,
      installer_launch_authorized: false,
      physical_effect_replay_allowed: false,
      authority_effect: false,
    });
    this.#selfUpdateRestartGateProbeDigests.add(admission.probe_admission_digest);
    this.#lastSelfUpdateRestartGateProbeDigest = admission.probe_admission_digest;
    return Object.freeze({ admission, already_recorded: false, authority_effect: false });
  }

  async recordSelfUpdateRestartGateProbeOutcome({
    probe_admission,
    invocation_receipt,
    post_probe_runtime_snapshot,
    prior_transaction = null,
    observed_at,
    observer_id,
  } = {}) {
    this.#assertRunning();
    const admission = verifyRsiSelfUpdateRestartGateProbeAdmission(probe_admission);
    if (!this.#selfUpdateRestartGateProbeDigests.has(admission.probe_admission_digest)) {
      throw new Error('rsi_runtime_restart_gate_probe_admission_not_persisted');
    }
    const outcome = createRsiSelfUpdateRestartGateProbeOutcome({
      probe_admission: admission,
      invocation_receipt,
      post_probe_runtime_snapshot,
      prior_transaction,
      observed_at,
      observer_id,
    });
    verifyRsiSelfUpdateRestartGateProbeOutcome(outcome);
    if (this.#selfUpdateRestartGateProbeOutcomeDigests.has(outcome.outcome_digest)) {
      return Object.freeze({ outcome, already_recorded: true, authority_effect: false });
    }
    if (this.#selfUpdateRestartGateProbeOutcomeDigests.size >= MAX_SELF_UPDATE_RESTART_GATE_PROBE_OUTCOMES) {
      throw new Error('rsi_runtime_restart_gate_probe_outcome_capacity_exhausted');
    }
    await this.#ledger.append('RSI_SELF_UPDATE_RESTART_GATE_PROBE_OUTCOME_RECORDED', {
      restart_gate_probe_outcome: outcome,
      external_self_update_controller_required: true,
      ready_for_external_install_cycle_review: outcome.ready_for_external_install_cycle_review,
      install_cycle_invoked: false,
      install_cycle_authorized_by_rsi: false,
      installer_launch_authorized: false,
      physical_effect_replay_allowed: false,
      authority_effect: false,
    });
    this.#selfUpdateRestartGateProbeOutcomeDigests.add(outcome.outcome_digest);
    this.#lastSelfUpdateRestartGateProbeOutcomeDigest = outcome.outcome_digest;
    return Object.freeze({ outcome, already_recorded: false, authority_effect: false });
  }

  async recordSelfUpdateFinalInstallCycleAdmission({
    probe_outcome,
    probe_admission,
    download_readiness,
    fresh_runtime_snapshot,
    prior_transaction = null,
    trusted_release,
    observed_at,
    observer_id,
  } = {}) {
    this.#assertRunning();
    const outcome = verifyRsiSelfUpdateRestartGateProbeOutcome(probe_outcome);
    if (!this.#selfUpdateRestartGateProbeOutcomeDigests.has(outcome.outcome_digest)) {
      throw new Error('rsi_runtime_restart_gate_probe_outcome_not_persisted');
    }
    const admission = createRsiSelfUpdateFinalInstallCycleAdmission({
      probe_outcome: outcome,
      probe_admission,
      download_readiness,
      fresh_runtime_snapshot,
      prior_transaction,
      trusted_release,
      observed_at,
      observer_id,
    });
    verifyRsiSelfUpdateFinalInstallCycleAdmission(admission);
    if (this.#selfUpdateFinalInstallAdmissionDigests.has(admission.final_install_admission_digest)) {
      return Object.freeze({ admission, already_recorded: true, authority_effect: false });
    }
    if (this.#selfUpdateFinalInstallAdmissionDigests.size >= MAX_SELF_UPDATE_FINAL_INSTALL_ADMISSIONS) {
      throw new Error('rsi_runtime_final_install_admission_capacity_exhausted');
    }
    await this.#ledger.append('RSI_SELF_UPDATE_FINAL_INSTALL_ADMISSION_READY', {
      final_install_admission: admission,
      external_self_update_controller_required: true,
      final_apply_invoked: false,
      final_apply_authorized_by_rsi: false,
      installer_launch_authorized_by_rsi: false,
      one_attempt_physical_effect_required: true,
      post_effect_transaction_readback_required: true,
      successor_startup_readback_required: true,
      physical_effect_replay_allowed: false,
      authority_effect: false,
    });
    this.#selfUpdateFinalInstallAdmissionDigests.add(admission.final_install_admission_digest);
    this.#lastSelfUpdateFinalInstallAdmissionDigest = admission.final_install_admission_digest;
    return Object.freeze({ admission, already_recorded: false, authority_effect: false });
  }

  async recordSelfUpdateFinalApplyInvocationReceipt({
    final_install_admission,
    invocation_id,
    invoked_at,
    controller_id,
    external_controller_verified = false,
    authored_by_candidate = true,
    invocation_count = 1,
  } = {}) {
    this.#assertRunning();
    const admission = verifyRsiSelfUpdateFinalInstallCycleAdmission(final_install_admission);
    if (!this.#selfUpdateFinalInstallAdmissionDigests.has(admission.final_install_admission_digest)) {
      throw new Error('rsi_runtime_final_install_admission_not_persisted');
    }
    const receipt = createRsiSelfUpdateFinalApplyInvocationReceipt({
      final_install_admission: admission,
      invocation_id,
      invoked_at,
      controller_id,
      external_controller_verified,
      authored_by_candidate,
      invocation_count,
    });
    verifyRsiSelfUpdateFinalApplyInvocationReceipt(receipt, { final_install_admission: admission });
    if (this.#selfUpdateFinalApplyInvocationDigests.has(receipt.invocation_receipt_digest)) {
      return Object.freeze({ receipt, already_recorded: true, authority_effect: false });
    }
    if (this.#selfUpdateFinalApplyInvocationDigests.size >= MAX_SELF_UPDATE_FINAL_APPLY_INVOCATIONS) {
      throw new Error('rsi_runtime_final_apply_invocation_capacity_exhausted');
    }
    await this.#ledger.append('RSI_SELF_UPDATE_FINAL_APPLY_INVOCATION_RECORDED', {
      final_apply_invocation_receipt: receipt,
      external_controller_verified: true,
      physical_effect_outcome_asserted: false,
      transaction_readback_required: true,
      successor_startup_readback_required: true,
      same_invocation_retry_allowed: false,
      physical_effect_replay_allowed: false,
      authority_effect: false,
    });
    this.#selfUpdateFinalApplyInvocationDigests.add(receipt.invocation_receipt_digest);
    this.#lastSelfUpdateFinalApplyInvocationDigest = receipt.invocation_receipt_digest;
    return Object.freeze({ receipt, already_recorded: false, authority_effect: false });
  }

  async recordSelfUpdatePostEffectReadback({
    final_install_admission,
    invocation_receipt,
    transaction_readback = null,
    observed_at,
    observer_id,
    external_transaction_reader = false,
    authored_by_candidate = true,
  } = {}) {
    this.#assertRunning();
    const admission = verifyRsiSelfUpdateFinalInstallCycleAdmission(final_install_admission);
    if (!this.#selfUpdateFinalInstallAdmissionDigests.has(admission.final_install_admission_digest)) {
      throw new Error('rsi_runtime_final_install_admission_not_persisted');
    }
    const receipt = verifyRsiSelfUpdateFinalApplyInvocationReceipt(invocation_receipt, {
      final_install_admission: admission,
    });
    if (!this.#selfUpdateFinalApplyInvocationDigests.has(receipt.invocation_receipt_digest)) {
      throw new Error('rsi_runtime_final_apply_invocation_not_persisted');
    }
    const readback = createRsiSelfUpdatePostEffectReadback({
      final_install_admission: admission,
      invocation_receipt: receipt,
      transaction_readback,
      observed_at,
      observer_id,
      external_transaction_reader,
      authored_by_candidate,
    });
    verifyRsiSelfUpdatePostEffectReadback(readback);
    if (this.#selfUpdatePostEffectReadbackDigests.has(readback.post_effect_readback_digest)) {
      return Object.freeze({ readback, already_recorded: true, authority_effect: false });
    }
    if (this.#selfUpdatePostEffectReadbackDigests.size >= MAX_SELF_UPDATE_POST_EFFECT_READBACKS) {
      throw new Error('rsi_runtime_post_effect_readback_capacity_exhausted');
    }
    await this.#ledger.append('RSI_SELF_UPDATE_POST_EFFECT_READBACK_RECORDED', {
      post_effect_readback: readback,
      same_invocation_retry_allowed: false,
      fresh_physical_effect_retry_allowed: false,
      automatic_install_retry_allowed: false,
      successor_qualification_uses_existing_pipeline: true,
      ambiguous_install_uses_existing_recovery_pipeline: true,
      physical_effect_replay_allowed: false,
      authority_effect: false,
    });
    this.#selfUpdatePostEffectReadbackDigests.add(readback.post_effect_readback_digest);
    this.#lastSelfUpdatePostEffectReadbackDigest = readback.post_effect_readback_digest;
    return Object.freeze({ readback, already_recorded: false, authority_effect: false });
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
      experience_context: Object.freeze({
        planned_count: this.#experienceContextPlanCount,
        last_context_plan_digest: this.#lastExperienceContextPlanDigest,
        verified_graph_available: this.#experienceGraphSnapshot != null,
        retrieval_is_advisory_only: true,
        existing_devos_scheduler_required: true,
        task_lease_created: false,
        candidate_materialized: false,
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
      episode_promotion_review: Object.freeze({
        count: this.#episodePromotionReviewDigests.size,
        capacity: MAX_EPISODE_PROMOTION_REVIEWS,
        last_digest: this.#lastEpisodePromotionReviewDigest,
        external_release_handoff_review_required: true,
        release_handoff_authorized: false,
        direct_install_authorized: false,
        direct_promotion_authorized: false,
        self_update_authority: false,
        promotion_token_minted: false,
        physical_effect_replay_allowed: false,
        authority_effect: false,
      }),
      external_release_handoff: Object.freeze({
        count: this.#externalReleaseHandoffDigests.size,
        capacity: MAX_EXTERNAL_RELEASE_HANDOFF_INTENTS,
        last_digest: this.#lastExternalReleaseHandoffDigest,
        cryptographic_promotion_attestation_required: true,
        external_release_coordinator_review_required: true,
        publisher_action_authorized: false,
        release_publication_authorized: false,
        existing_browser_fabric_release_gate_required: true,
        existing_self_update_transaction_journal_required: true,
        release_authority: false,
        self_update_handoff_authorized: false,
        direct_install_authorized: false,
        promotion_token_minted: false,
        physical_effect_replay_allowed: false,
        authority_effect: false,
      }),
      published_release_reconciliation: Object.freeze({
        count: this.#publishedReleaseReconciliationDigests.size,
        capacity: MAX_PUBLISHED_RELEASE_RECONCILIATIONS,
        last_digest: this.#lastPublishedReleaseReconciliationDigest,
        immutable_release_required: true,
        source_ancestry_proof_required: true,
        installed_executable_binding_required: true,
        authority_advance_candidate_only: true,
        authority_advance_authorized: false,
        release_authority_mutation_performed: false,
        separate_journaled_promotion_effect_required: true,
        self_update_handoff_authorized: false,
        direct_install_authorized: false,
        physical_effect_replay_allowed: false,
        authority_effect: false,
      }),
      release_promotion_journal: Object.freeze({
        intent_count: this.#releasePromotionJournalIntentDigests.size,
        intent_capacity: MAX_RELEASE_PROMOTION_JOURNAL_INTENTS,
        last_intent_digest: this.#lastReleasePromotionJournalIntentDigest,
        existing_effect_domain: 'RELEASE_PROMOTION',
        external_signed_capability_required: true,
        candidate_can_mint_capability: false,
        rsi_can_mint_capability: false,
        rsi_can_invoke_release_publisher: false,
        release_publisher_invocation_authorized: false,
        attempt_recorded_by_rsi: false,
        authority_advance_authorized: false,
        independent_readback_required: true,
        ambiguous_reconciliation_only: true,
        physical_effect_replay_allowed: false,
        authority_effect: false,
      }),
      self_update_eligibility_review: Object.freeze({
        count: this.#selfUpdateEligibilityReviewDigests.size,
        capacity: MAX_SELF_UPDATE_ELIGIBILITY_REVIEWS,
        last_digest: this.#lastSelfUpdateEligibilityReviewDigest,
        confirmed_release_authority_required: true,
        trusted_release_reverification_required: true,
        existing_self_update_runtime_required: true,
        prior_self_update_transaction_readback_required: true,
        restart_gate_revalidation_required: true,
        host_resilience_revalidation_required: true,
        self_update_check_authorized: false,
        self_update_apply_authorized: false,
        installer_launch_authorized: false,
        raw_release_promotion_events_persisted: false,
        physical_effect_replay_allowed: false,
        authority_effect: false,
      }),
      self_update_check_admission: Object.freeze({
        count: this.#selfUpdateCheckAdmissionDigests.size,
        capacity: MAX_SELF_UPDATE_CHECK_ADMISSIONS,
        last_digest: this.#lastSelfUpdateCheckAdmissionDigest,
        external_self_update_controller_required: true,
        existing_self_update_runtime_method: 'checkNow',
        unresolved_prior_transaction_forbidden: true,
        host_resilience_active_required: true,
        sentinel_worker_ready_required: true,
        ci_test_feed_forbidden: true,
        developer_emergency_bypass_forbidden: true,
        fresh_release_reverification_inside_runtime_required: true,
        self_update_check_invoked: false,
        self_update_check_authorized_by_rsi: false,
        self_update_apply_authorized: false,
        installer_launch_authorized: false,
        physical_effect_replay_allowed: false,
        authority_effect: false,
      }),
      self_update_download_readiness: Object.freeze({
        count: this.#selfUpdateDownloadReadinessDigests.size,
        capacity: MAX_SELF_UPDATE_DOWNLOAD_READINESS,
        last_digest: this.#lastSelfUpdateDownloadReadinessDigest,
        exact_downloaded_candidate_required: true,
        publisher_and_metadata_verification_required: true,
        no_install_effect_before_readiness: true,
        external_apply_controller_required: true,
        existing_self_update_runtime_method: 'applyWhenSafe',
        restart_gate_owned_by_existing_runtime: true,
        restart_grace_required: true,
        prior_transaction_recheck_required: true,
        host_resilience_recheck_required: true,
        apply_cycle_invoked: false,
        apply_cycle_authorized_by_rsi: false,
        installer_launch_authorized: false,
        physical_effect_replay_allowed: false,
        authority_effect: false,
      }),
      self_update_restart_gate_probe: Object.freeze({
        count: this.#selfUpdateRestartGateProbeDigests.size,
        capacity: MAX_SELF_UPDATE_RESTART_GATE_PROBE_ADMISSIONS,
        last_digest: this.#lastSelfUpdateRestartGateProbeDigest,
        precondition_ready_restart: true,
        precondition_restart_gate_clear: true,
        single_probe_cycle_only: true,
        first_cycle_must_not_launch_installer: true,
        post_probe_readback_required: true,
        external_self_update_controller_required: true,
        probe_cycle_invoked: false,
        probe_cycle_authorized_by_rsi: false,
        second_cycle_authorized: false,
        installer_launch_authorized: false,
        physical_effect_replay_allowed: false,
        authority_effect: false,
      }),
      self_update_restart_gate_probe_outcome: Object.freeze({
        count: this.#selfUpdateRestartGateProbeOutcomeDigests.size,
        capacity: MAX_SELF_UPDATE_RESTART_GATE_PROBE_OUTCOMES,
        last_digest: this.#lastSelfUpdateRestartGateProbeOutcomeDigest,
        external_probe_invocation_receipt_required: true,
        single_probe_cycle_required: true,
        no_physical_effect_during_probe_required: true,
        restart_grace_elapsed_required_before_install_review: true,
        final_revalidation_required: true,
        transaction_write_ahead_barrier_required: true,
        install_cycle_invoked: false,
        install_cycle_authorized_by_rsi: false,
        installer_launch_authorized: false,
        physical_effect_replay_allowed: false,
        authority_effect: false,
      }),
      self_update_final_install_cycle: Object.freeze({
        count: this.#selfUpdateFinalInstallAdmissionDigests.size,
        capacity: MAX_SELF_UPDATE_FINAL_INSTALL_ADMISSIONS,
        last_digest: this.#lastSelfUpdateFinalInstallAdmissionDigest,
        exact_candidate_chain_required: true,
        restart_gate_and_elapsed_grace_reverification_required: true,
        fresh_prior_transaction_and_host_readback_required: true,
        external_self_update_controller_required: true,
        single_final_apply_cycle_only: true,
        write_ahead_install_effect_barrier_required: true,
        one_attempt_physical_effect_required: true,
        post_effect_transaction_readback_required: true,
        successor_startup_readback_required: true,
        ambiguous_install_reconciliation_only: true,
        final_apply_invoked: false,
        final_apply_authorized_by_rsi: false,
        installer_launch_authorized_by_rsi: false,
        physical_effect_replay_allowed: false,
        authority_effect: false,
      }),
      self_update_final_apply_readback: Object.freeze({
        invocation_count: this.#selfUpdateFinalApplyInvocationDigests.size,
        invocation_capacity: MAX_SELF_UPDATE_FINAL_APPLY_INVOCATIONS,
        last_invocation_digest: this.#lastSelfUpdateFinalApplyInvocationDigest,
        readback_count: this.#selfUpdatePostEffectReadbackDigests.size,
        readback_capacity: MAX_SELF_UPDATE_POST_EFFECT_READBACKS,
        last_readback_digest: this.#lastSelfUpdatePostEffectReadbackDigest,
        external_one_shot_invocation_receipt_required: true,
        invocation_receipt_cannot_claim_effect_success: true,
        durable_transaction_readback_is_effect_truth: true,
        write_ahead_barrier_evidence_required_for_attempted_effect: true,
        successor_qualification_uses_existing_pipeline: true,
        ambiguous_install_uses_existing_recovery_pipeline: true,
        same_invocation_retry_allowed: false,
        fresh_physical_effect_retry_allowed: false,
        automatic_install_retry_allowed: false,
        physical_effect_replay_allowed: false,
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
        devos_lease_required_before_materialization: true,
        lease_created: false,
        workspace_created: false,
        candidate_materialized: false,
        raw_patch_persisted: false,
        raw_source_persisted: false,
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
