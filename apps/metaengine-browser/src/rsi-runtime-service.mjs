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
import { createRsiBrowserOutcomeEpisode, rsiBrowserOutcomeIngestTrustRootSnapshot } from './rsi-browser-outcome-ingest.mjs';
import { RsiCommandAttributionRegistry, RSI_COMMAND_ATTRIBUTION_REGISTRY_SCHEMA, rsiCommandAttributionTrustRootSnapshot } from './rsi-command-attribution-registry.mjs';
import { createRsiStepCreditReceipt, rsiStepCreditTrustRootSnapshot } from './rsi-runtime-credit-assignment.mjs';
import { RsiRuntimeExperienceStore, materializeRsiExperienceCaseFromCredit, rsiRuntimeExperienceStoreTrustRootSnapshot } from './rsi-runtime-experience-store.mjs';
import { RsiRuntimeSkillLifecycle, rsiRuntimeSkillLifecycleTrustRootSnapshot } from './rsi-runtime-skill-lifecycle.mjs';
import { RsiRuntimeSkillRouter, createRsiSkillRouteContext, rsiRuntimeSkillRouterTrustRootSnapshot } from './rsi-runtime-skill-router.mjs';
import { RsiRuntimeSkillCurationQueue, createRsiSkillCurationRequest, rsiRuntimeSkillCurationTrustRootSnapshot } from './rsi-runtime-skill-curation.mjs';
import { RsiSkillRevisionFrontier, createRsiSkillRevisionFrontierCandidate, rsiSkillRevisionFrontierTrustRootSnapshot } from './rsi-skill-revision-frontier.mjs';
import { RsiSkillRevisionIntegrityLedger, createRsiSkillRevisionIntegrityAdmission, rsiSkillRevisionIntegrityAdmissionTrustRootSnapshot } from './rsi-skill-revision-integrity-admission.mjs';
import { RsiIntegrityBoundSkillReliabilityLedger, createRsiIntegrityBoundSkillReliability, rsiIntegrityBoundSkillReliabilityTrustRootSnapshot } from './rsi-integrity-bound-skill-reliability.mjs';
import { RsiRevisionScopeLedger, createRsiRevisionScopeAdmission, rsiRevisionScopeAdmissionTrustRootSnapshot } from './rsi-revision-scope-admission.mjs';
import { createRsiRevisionLibraryAdmission, rsiRevisionLibraryAdmissionTrustRootSnapshot } from './rsi-revision-library-admission.mjs';
import { RsiSkillCoalitionAuditStore, createRsiSkillCoalitionObservation, rsiSkillCoalitionAuditTrustRootSnapshot } from './rsi-skill-coalition-audit.mjs';
import { RsiSkillRelationStore, createRsiSkillRelationEdge, rsiSkillRelationGraphTrustRootSnapshot } from './rsi-skill-relation-graph.mjs';
import { RsiRuntimeMetaSkillArchive, createRsiRuntimeMetaSkillRecord, rsiRuntimeMetaSkillArchiveTrustRootSnapshot } from './rsi-runtime-meta-skill-archive.mjs';
import { RsiMetaProfileQualificationLedger, createRsiMetaProfileQualification, createRsiMetaProfileShadowPlan, rsiMetaProfileQualificationTrustRootSnapshot } from './rsi-meta-profile-qualification.mjs';
import { RsiMetaProfileShadowRegistry, createRsiMetaProfileShadowSelection, createRsiMetaProfileShadowProjection, rsiMetaProfileShadowSelectionTrustRootSnapshot } from './rsi-meta-profile-shadow-selection.mjs';
import { createRsiShadowComparisonBinding, rsiShadowComparisonBindingTrustRootSnapshot } from './rsi-shadow-comparison-binding.mjs';
import { rsiSourceIdentityConvergenceTrustRootSnapshot } from './rsi-source-identity-convergence.mjs';
import { rsiSourceIdentityFreshnessTrustRootSnapshot } from './rsi-source-identity-freshness.mjs';

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
    command_attribution: rsiCommandAttributionTrustRootSnapshot(),
    step_credit: rsiStepCreditTrustRootSnapshot(),
    runtime_experience_store: rsiRuntimeExperienceStoreTrustRootSnapshot(),
    runtime_skill_lifecycle: rsiRuntimeSkillLifecycleTrustRootSnapshot(),
    runtime_skill_router: rsiRuntimeSkillRouterTrustRootSnapshot(),
    runtime_skill_curation: rsiRuntimeSkillCurationTrustRootSnapshot(),
    skill_revision_frontier: rsiSkillRevisionFrontierTrustRootSnapshot(),
    skill_revision_integrity: rsiSkillRevisionIntegrityAdmissionTrustRootSnapshot(),
    integrity_bound_skill_reliability: rsiIntegrityBoundSkillReliabilityTrustRootSnapshot(),
    revision_scope_admission: rsiRevisionScopeAdmissionTrustRootSnapshot(),
    revision_library_admission: rsiRevisionLibraryAdmissionTrustRootSnapshot(),
    skill_coalition_audit: rsiSkillCoalitionAuditTrustRootSnapshot(),
    skill_relation_graph: rsiSkillRelationGraphTrustRootSnapshot(),
    runtime_meta_skill_archive: rsiRuntimeMetaSkillArchiveTrustRootSnapshot(),
    meta_profile_qualification: rsiMetaProfileQualificationTrustRootSnapshot(),
    meta_profile_shadow_selection: rsiMetaProfileShadowSelectionTrustRootSnapshot(),
    shadow_comparison_binding: rsiShadowComparisonBindingTrustRootSnapshot(),
    source_identity_convergence: rsiSourceIdentityConvergenceTrustRootSnapshot(),
    source_identity_freshness: rsiSourceIdentityFreshnessTrustRootSnapshot(),
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
  #commandAttribution;
  #experienceStore;
  #skillLifecycle;
  #skillRouter;
  #skillCuration;
  #skillRevisionFrontier;
  #skillRevisionIntegrity;
  #skillReliabilityLedger;
  #revisionScopeLedger;
  #skillCoalitionAudit;
  #skillRelationStore;
  #metaSkillArchive;
  #metaProfileQualification;
  #metaProfileShadowRegistry;
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
  #skillReliabilityEvaluationCount = 0;
  #skillReliabilityPassCount = 0;
  #lastSkillReliabilityBindingDigest = null;

  constructor({ source_sha, ledgerPath, attributionPath = null, experiencePath = null, skillLifecyclePath = null, skillRouterPath = null, skillCurationPath = null, skillRevisionFrontierPath = null, skillRevisionIntegrityPath = null, skillReliabilityPath = null, revisionScopePath = null, skillCoalitionPath = null, skillRelationPath = null, metaSkillArchivePath = null, metaProfileQualificationPath = null, metaProfileShadowPath = null, clock = () => Date.now() } = {}) {
    this.#sourceSha = exactSha(source_sha);
    if (typeof clock !== 'function') throw new Error('rsi_runtime_clock_required');
    this.#clock = clock;
    this.#ledger = new RsiRuntimeLedger({ ledgerPath, source_sha: this.#sourceSha, clock });
    const commandAttributionPath = attributionPath || (ledgerPath ? `${ledgerPath}.command-attribution.json` : null);
    this.#commandAttribution = new RsiCommandAttributionRegistry({
      statePath: commandAttributionPath,
      source_sha: this.#sourceSha,
      clock,
    });
    const runtimeExperiencePath = experiencePath || (ledgerPath ? `${ledgerPath}.experience.json` : null);
    this.#experienceStore = new RsiRuntimeExperienceStore({
      statePath: runtimeExperiencePath,
      source_sha: this.#sourceSha,
    });
    const runtimeSkillLifecyclePath = skillLifecyclePath || (ledgerPath ? `${ledgerPath}.skill-lifecycle.json` : null);
    this.#skillLifecycle = new RsiRuntimeSkillLifecycle({
      statePath: runtimeSkillLifecyclePath,
      source_sha: this.#sourceSha,
      clock,
    });
    const runtimeSkillRouterPath = skillRouterPath || (ledgerPath ? `${ledgerPath}.skill-router.json` : null);
    this.#skillRouter = new RsiRuntimeSkillRouter({
      statePath: runtimeSkillRouterPath,
      source_sha: this.#sourceSha,
    });
    const runtimeSkillCurationPath = skillCurationPath || (ledgerPath ? `${ledgerPath}.skill-curation.json` : null);
    this.#skillCuration = new RsiRuntimeSkillCurationQueue({
      statePath: runtimeSkillCurationPath,
      source_sha: this.#sourceSha,
    });
    const runtimeSkillRevisionFrontierPath = skillRevisionFrontierPath || (ledgerPath ? `${ledgerPath}.skill-revision-frontier.json` : null);
    this.#skillRevisionFrontier = new RsiSkillRevisionFrontier({
      statePath: runtimeSkillRevisionFrontierPath,
      source_sha: this.#sourceSha,
    });
    const runtimeSkillRevisionIntegrityPath = skillRevisionIntegrityPath || (ledgerPath ? `${ledgerPath}.skill-revision-integrity.json` : null);
    this.#skillRevisionIntegrity = new RsiSkillRevisionIntegrityLedger({
      statePath: runtimeSkillRevisionIntegrityPath,
      source_sha: this.#sourceSha,
    });
    const runtimeSkillReliabilityPath = skillReliabilityPath || (ledgerPath ? `${ledgerPath}.skill-reliability.json` : null);
    this.#skillReliabilityLedger = new RsiIntegrityBoundSkillReliabilityLedger({
      statePath: runtimeSkillReliabilityPath,
      source_sha: this.#sourceSha,
    });
    const runtimeRevisionScopePath = revisionScopePath || (ledgerPath ? `${ledgerPath}.revision-scope.json` : null);
    this.#revisionScopeLedger = new RsiRevisionScopeLedger({
      statePath: runtimeRevisionScopePath,
      source_sha: this.#sourceSha,
    });
    const runtimeSkillCoalitionPath = skillCoalitionPath || (ledgerPath ? `${ledgerPath}.skill-coalition.json` : null);
    this.#skillCoalitionAudit = new RsiSkillCoalitionAuditStore({
      statePath: runtimeSkillCoalitionPath,
      source_sha: this.#sourceSha,
    });
    const runtimeSkillRelationPath = skillRelationPath || (ledgerPath ? `${ledgerPath}.skill-relations.json` : null);
    this.#skillRelationStore = new RsiSkillRelationStore({
      statePath: runtimeSkillRelationPath,
      source_sha: this.#sourceSha,
    });
    const runtimeMetaSkillArchivePath = metaSkillArchivePath || (ledgerPath ? `${ledgerPath}.meta-skill-archive.json` : null);
    this.#metaSkillArchive = new RsiRuntimeMetaSkillArchive({
      statePath: runtimeMetaSkillArchivePath,
      source_sha: this.#sourceSha,
    });
    const runtimeMetaProfileQualificationPath = metaProfileQualificationPath || (ledgerPath ? `${ledgerPath}.meta-profile-qualification.json` : null);
    this.#metaProfileQualification = new RsiMetaProfileQualificationLedger({
      statePath: runtimeMetaProfileQualificationPath,
      source_sha: this.#sourceSha,
    });
    const runtimeMetaProfileShadowPath = metaProfileShadowPath || (ledgerPath ? `${ledgerPath}.meta-profile-shadow.json` : null);
    this.#metaProfileShadowRegistry = new RsiMetaProfileShadowRegistry({
      statePath: runtimeMetaProfileShadowPath,
      source_sha: this.#sourceSha,
    });
    this.#experienceGate = new RsiRuntimeExperienceGate({ source_sha: this.#sourceSha, clock });
    this.#archive = new RsiShadowArchive({ clock });
    this.#observer = new RsiShadowObserver({ source_sha: this.#sourceSha, clock });
    this.#verifiedArchive = new RsiVerifiedEvolutionArchive({ clock });
    this.#roots = trustRoots();
  }

  async start() {
    if (this.#running) return this.snapshot();
    await this.#commandAttribution.init();
    await this.#experienceStore.init();
    await this.#skillLifecycle.init();
    await this.#skillRouter.init();
    await this.#skillCuration.init();
    await this.#skillRevisionFrontier.init();
    await this.#skillRevisionIntegrity.init();
    await this.#skillReliabilityLedger.init();
    await this.#revisionScopeLedger.init();
    await this.#skillCoalitionAudit.init();
    await this.#skillRelationStore.init();
    await this.#metaSkillArchive.init();
    await this.#metaProfileQualification.init();
    await this.#metaProfileShadowRegistry.init();
    await this.#ledger.init();
    this.#startedAt = new Date(this.#clock()).toISOString();
    await this.#ledger.append('RUNTIME_BOUND', {
      runtime_schema: RSI_RUNTIME_SERVICE_SCHEMA,
      runtime_mode: RSI_RUNTIME_MODE,
      source_sha: this.#sourceSha,
      trust_root_set_digest: digest(this.#roots),
      experience_gate_schema: RSI_RUNTIME_EXPERIENCE_GATE_SCHEMA,
      command_attribution_registry: RSI_COMMAND_ATTRIBUTION_REGISTRY_SCHEMA,
      runtime_experience_store_schema: this.#experienceStore.snapshot().schema,
      runtime_skill_lifecycle_schema: this.#skillLifecycle.snapshot().schema,
      runtime_skill_router_schema: this.#skillRouter.snapshot().schema,
      runtime_skill_curation_schema: this.#skillCuration.snapshot().schema,
      skill_revision_frontier_schema: this.#skillRevisionFrontier.snapshot().schema,
      skill_revision_integrity_schema: this.#skillRevisionIntegrity.snapshot().schema,
      skill_revision_reliability_ledger_schema: this.#skillReliabilityLedger.snapshot().schema,
      revision_scope_admission_schema: this.#revisionScopeLedger.snapshot().schema,
      skill_coalition_audit_schema: this.#skillCoalitionAudit.snapshot().schema,
      skill_relation_store_schema: this.#skillRelationStore.snapshot().schema,
      runtime_meta_skill_archive_schema: this.#metaSkillArchive.snapshot().schema,
      meta_profile_qualification_schema: this.#metaProfileQualification.snapshot().schema,
      meta_profile_shadow_registry_schema: this.#metaProfileShadowRegistry.snapshot().schema,
      observation_persistence_mode: 'BOUNDED_COALESCED_FSYNC',
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
    await this.#ledger.append('BRAIN_OBSERVATION', {
      observation_schema: observation?.schema || null,
      observation_digest: observation.observation_digest,
      experience_signature_digest: admission.signature_digest,
      admission_reason: admission.reason,
      critical: admission.critical === true,
      opportunity_count: Array.isArray(observation?.opportunities) ? observation.opportunities.length : 0,
      authority_effect: false,
    });
    this.#experienceGate.commitPersist(admission);
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

  async bindBrowserCommandAttribution({
    command_id, action, platform = null, effect_key = null,
    task_id, task_signature_digest, environment_fingerprint, model_family,
    candidate_id, proposal_digest, skill_digests = [],
    trajectory_id = null, step_index = null, step_count = null, predecessor_episode_digest = null,
    external_planner = false, authored_by_candidate = true,
  } = {}) {
    this.#assertRunning();
    const candidate = this.#archive.get(candidate_id);
    if (['REJECTED', 'BLOCKED'].includes(String(candidate.state || '').toUpperCase())) {
      throw new Error('rsi_runtime_candidate_not_attribution_eligible');
    }
    const binding = await this.#commandAttribution.bind({
      command_id, action, platform, effect_key,
      task_id, task_signature_digest, environment_fingerprint, model_family,
      runtime_candidate_id: candidate.candidate_id,
      candidate_digest: candidate.candidate_digest,
      candidate_sha: candidate.candidate_sha,
      proposal_digest,
      skill_digests,
      trajectory_id, step_index, step_count, predecessor_episode_digest,
      external_planner,
      authored_by_candidate,
    });
    await this.#ledger.append('COMMAND_ATTRIBUTION_BOUND', {
      command_id: binding.command_id,
      binding_digest: binding.binding_digest,
      runtime_candidate_id: binding.runtime_candidate_id,
      candidate_id: binding.candidate_id,
      candidate_sha: binding.candidate_sha,
      proposal_digest: binding.proposal_digest,
      skill_digests: binding.skill_digests,
      task_signature_digest: binding.task_signature_digest,
      trajectory_id: binding.trajectory_id,
      step_index: binding.step_index,
      step_count: binding.step_count,
      predecessor_episode_digest: binding.predecessor_episode_digest,
      binding_is_effect_authority: false,
      authority_effect: false,
    });
    return binding;
  }

  async ingestBrowserOutcome({ readback, attribution = null } = {}) {
    this.#assertRunning();
    const receipt = readback?.receipt;
    let trustedAttribution = attribution;
    let commandBinding = null;
    if (trustedAttribution == null && receipt && typeof receipt === 'object') {
      commandBinding = this.#commandAttribution.resolve({
        command_id: receipt.command_id,
        action: receipt.action,
        platform: receipt.platform ?? null,
        effect_key: receipt.effect_key ?? null,
      });
      if (commandBinding) {
        trustedAttribution = {
          task_id: commandBinding.task_id,
          task_signature_digest: commandBinding.task_signature_digest,
          environment_fingerprint: commandBinding.environment_fingerprint,
          model_family: commandBinding.model_family,
          candidate_id: commandBinding.candidate_id,
          candidate_sha: commandBinding.candidate_sha,
          proposal_digest: commandBinding.proposal_digest,
          skill_digests: commandBinding.skill_digests,
          trajectory_id: commandBinding.trajectory_id,
          step_index: commandBinding.step_index,
          step_count: commandBinding.step_count,
          predecessor_episode_digest: commandBinding.predecessor_episode_digest,
          external_attribution: true,
          authored_by_candidate: false,
        };
      }
    }
    const episode = createRsiBrowserOutcomeEpisode({
      source_sha: this.#sourceSha,
      readback,
      attribution: trustedAttribution,
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
      trajectory_id: episode.trajectory_id,
      step_index: episode.step_index,
      step_count: episode.step_count,
      predecessor_episode_digest: episode.predecessor_episode_digest,
      command_attribution_binding_digest: commandBinding?.binding_digest || null,
      eligible_for_experience_graph: episode.eligible_for_experience_graph,
      eligible_for_skill_evidence: episode.eligible_for_skill_evidence,
      quarantined: episode.quarantined,
      raw_result_stored: false,
      raw_error_stored: false,
      physical_effect_replay_allowed: false,
      authority_effect: false,
    });
    if (commandBinding) {
      await this.#commandAttribution.consume({
        command_id: episode.command_id,
        episode_digest: episode.episode_digest,
      });
      await this.#ledger.append('COMMAND_ATTRIBUTION_CONSUMED', {
        command_id: episode.command_id,
        binding_digest: commandBinding.binding_digest,
        episode_digest: episode.episode_digest,
        authority_effect: false,
      });
    }
    this.#browserOutcomeCount += 1;
    if (episode.eligible_for_experience_graph) this.#browserOutcomeLearningEligibleCount += 1;
    if (episode.quarantined) this.#browserOutcomeQuarantinedCount += 1;
    this.#lastBrowserOutcomeDigest = episode.episode_digest;
    return episode;
  }

  async routeVerifiedSkills({
    context_id,
    task_signature_digest,
    environment_fingerprint,
    model_family,
    challenge_family,
    required_role = null,
    required_capabilities = [],
    input_schema_digest = null,
    output_schema_digest = null,
    max_selected = 4,
    exploration_slots = 1,
    external_planner = false,
    authored_by_candidate = true,
  } = {}) {
    this.#assertRunning();
    const library = this.#skillLifecycle.verifiedLibrarySnapshot();
    const governance = this.#skillLifecycle.governance();
    if (!library || !governance) throw new Error('rsi_runtime_verified_skill_library_unavailable');
    const context = createRsiSkillRouteContext({
      source_sha: this.#sourceSha,
      context_id,
      task_signature_digest,
      environment_fingerprint,
      model_family,
      challenge_family,
      required_role,
      required_capabilities,
      input_schema_digest,
      output_schema_digest,
      external_planner,
      authored_by_candidate,
    });
    const coalitionAudit = this.#skillCoalitionAudit.auditIfAvailable(context.context_digest);
    const coalitionMask = coalitionAudit?.masked_skill_digests || [];
    const relationGraph = this.#skillRelationStore.graph(library);
    const plan = await this.#skillRouter.route({
      library,
      governance,
      context,
      coalition_masked_skill_digests: coalitionMask,
      relation_graph: relationGraph,
      max_selected,
      exploration_slots,
      external_planner: true,
      authored_by_candidate: false,
    });
    await this.#ledger.append('SKILL_ROUTING_PLAN_CREATED', {
      plan_digest: plan.plan_digest,
      context_digest: plan.context_digest,
      selected_skill_digests: plan.selected.map((row) => row.skill_digest),
      vetoed_skill_digests: plan.vetoed_negative_transfer.map((row) => row.skill_digest),
      coalition_masked_skill_digests: plan.coalition_masked_skill_digests,
      coalition_audit_digest: coalitionAudit?.audit_digest || null,
      relation_graph_digest: plan.relation_graph_digest,
      relation_suppressed: plan.relation_suppressed,
      relation_ordering_applied: plan.relation_ordering_applied,
      exploration_used: plan.exploration_used,
      routing_is_execution_authority: false,
      authority_effect: false,
    });
    return plan;
  }

  async requestSkillCuration({
    request_id,
    parent_skill_digest,
    reason,
    trigger_evidence_digests,
    training_context_digest,
    validation_holdout_digest,
    meta_holdout_digest,
    optimizer_model_family,
    allowed_edit_ops = ['ADD','DELETE','REPLACE'],
    edit_budget = 4,
    external_curator = false,
    authored_by_candidate = true,
  } = {}) {
    this.#assertRunning();
    const library = this.#skillLifecycle.verifiedLibrarySnapshot();
    const governance = this.#skillLifecycle.governance();
    if (!library || !governance) throw new Error('rsi_runtime_verified_skill_library_unavailable');
    const request = createRsiSkillCurationRequest({
      source_sha: this.#sourceSha,
      request_id,
      library,
      governance,
      parent_skill_digest,
      reason,
      trigger_evidence_digests,
      training_context_digest,
      validation_holdout_digest,
      meta_holdout_digest,
      optimizer_model_family,
      allowed_edit_ops,
      edit_budget,
      external_curator,
      authored_by_candidate,
    });
    const queued = await this.#skillCuration.enqueue({ request, library, governance });
    await this.#ledger.append('SKILL_CURATION_REQUESTED', {
      request_id: request.request_id,
      request_digest: request.request_digest,
      parent_skill_digest: request.parent_skill_digest,
      reason: request.reason,
      edit_budget: request.edit_budget,
      validation_holdout_digest: request.validation_holdout_digest,
      meta_holdout_digest: request.meta_holdout_digest,
      state: queued.state,
      request_is_execution_authority: false,
      direct_library_replacement_allowed: false,
      authority_effect: false,
    });
    return Object.freeze({ request, queued });
  }

  async evaluateSkillRevision({
    request_id,
    successor_skill,
    baseline_validation_score,
    candidate_validation_score,
    baseline_meta_score,
    candidate_meta_score,
    hard_invariants_pass,
    evaluator_digest,
    evaluation_digest,
    evidence_refs,
    external_evaluator = false,
    authored_by_candidate = true,
  } = {}) {
    this.#assertRunning();
    const library = this.#skillLifecycle.verifiedLibrarySnapshot();
    const governance = this.#skillLifecycle.governance();
    if (!library || !governance) throw new Error('rsi_runtime_verified_skill_library_unavailable');
    const outcome = await this.#skillCuration.evaluateRevision({
      request_id,
      library,
      governance,
      successor_skill,
      baseline_validation_score,
      candidate_validation_score,
      baseline_meta_score,
      candidate_meta_score,
      hard_invariants_pass,
      evaluator_digest,
      evaluation_digest,
      evidence_refs,
      external_evaluator,
      authored_by_candidate,
    });
    let frontier = null;
    if (outcome.evaluation.accepted_for_existing_reliability_gate === true) {
      const request = this.#skillCuration.request(request_id);
      const candidate = createRsiSkillRevisionFrontierCandidate({
        source_sha: this.#sourceSha,
        request,
        evaluation: outcome.evaluation,
        library,
        governance,
        external_frontier_owner: true,
        authored_by_candidate: false,
      });
      frontier = await this.#skillRevisionFrontier.add({ candidate });
    }
    await this.#ledger.append('SKILL_REVISION_EVALUATED', {
      request_id,
      evaluation_digest: outcome.evaluation.result_digest,
      successor_skill_digest: outcome.evaluation.successor_skill_digest,
      state: outcome.evaluation.state,
      accepted_for_existing_reliability_gate: outcome.evaluation.accepted_for_existing_reliability_gate,
      direct_library_replacement_allowed: false,
      existing_reliability_gate_required: true,
      existing_scope_preservation_gate_required: true,
      revision_frontier_state: frontier?.state || null,
      revision_frontier_candidate_digest: frontier?.frontier_candidate_digest || null,
      authority_effect: false,
    });
    return Object.freeze({ ...outcome, frontier });
  }

  async recordSkillCoalitionObservation({
    observation_id,
    context_digest,
    trial_group,
    skill_digests,
    utility,
    evaluator_digest,
    evidence_refs,
    external_evaluator = false,
    authored_by_candidate = true,
  } = {}) {
    this.#assertRunning();
    const observation = createRsiSkillCoalitionObservation({
      observation_id,
      context_digest,
      trial_group,
      skill_digests,
      utility,
      evaluator_digest,
      evidence_refs,
      external_evaluator,
      authored_by_candidate,
    });
    const stored = await this.#skillCoalitionAudit.add(observation);
    await this.#ledger.append('SKILL_COALITION_OBSERVED', {
      observation_digest: observation.observation_digest,
      context_digest: observation.context_digest,
      trial_group: observation.trial_group,
      skill_digests: observation.skill_digests,
      utility: observation.utility,
      state: stored.state,
      authority_effect: false,
    });
    return Object.freeze({ observation, stored });
  }

  async recordSkillRelation({
    relation_id,
    from_skill_digest,
    to_skill_digest,
    relation_type,
    scope = 'GLOBAL_VERIFIED',
    context_digest = null,
    evidence_digest,
    evidence_refs,
    external_evaluator = false,
    authored_by_candidate = true,
  } = {}) {
    this.#assertRunning();
    const library = this.#skillLifecycle.verifiedLibrarySnapshot();
    if (!library) throw new Error('rsi_runtime_verified_skill_library_unavailable');
    const edge = createRsiSkillRelationEdge({
      relation_id,
      library,
      from_skill_digest,
      to_skill_digest,
      relation_type,
      scope,
      context_digest,
      evidence_digest,
      evidence_refs,
      external_evaluator,
      authored_by_candidate,
    });
    const stored = await this.#skillRelationStore.add(edge, library);
    await this.#ledger.append('SKILL_RELATION_RECORDED', {
      relation_id: edge.relation_id,
      relation_digest: edge.relation_digest,
      relation_type: edge.relation_type,
      scope: edge.scope,
      context_digest: edge.context_digest,
      from_skill_digest: edge.from_skill_digest,
      to_skill_digest: edge.to_skill_digest,
      state: stored.state,
      relation_is_execution_authority: false,
      authority_effect: false,
    });
    return Object.freeze({ edge, stored });
  }

  async recordMetaSkillEvolution({
    record_id,
    parent_profile,
    successor_profile,
    fast_loop_summary,
    plan,
    evaluation,
    result,
    external_archive_owner = false,
    authored_by_candidate = true,
  } = {}) {
    this.#assertRunning();
    const library = this.#skillLifecycle.verifiedLibrarySnapshot();
    if (!library) throw new Error('rsi_runtime_verified_skill_library_unavailable');
    const record = createRsiRuntimeMetaSkillRecord({
      source_sha: this.#sourceSha,
      record_id,
      library,
      parent_profile,
      successor_profile,
      fast_loop_summary,
      plan,
      evaluation,
      result,
      external_archive_owner,
      authored_by_candidate,
    });
    const stored = await this.#metaSkillArchive.add(record);
    await this.#ledger.append('META_SKILL_EVOLUTION_ARCHIVED', {
      record_id: record.record_id,
      record_digest: record.record_digest,
      parent_profile_digest: record.parent_profile_digest,
      successor_profile_digest: record.successor_profile_digest,
      relation: record.relation,
      state: record.state,
      eligible_for_meta_archive: record.eligible_for_meta_archive,
      fixed_meta_operation_digest: record.fixed_meta_operation_digest,
      successor_profile_activation_authorized: false,
      authority_effect: false,
    });
    return Object.freeze({ record, stored });
  }

  metaSkillEvolutionArchive() {
    this.#assertRunning();
    return this.#metaSkillArchive.eligible();
  }

  createMetaProfileShadowPlan({
    meta_record_digest,
    plan_id,
    activation_holdout_digest,
    evaluator_root_digest,
    external_plan_owner = false,
    authored_by_candidate = true,
  } = {}) {
    this.#assertRunning();
    const record = this.#metaSkillArchive.recordByDigest(meta_record_digest);
    if (!record || record.eligible_for_meta_archive !== true) throw new Error('rsi_runtime_meta_profile_archive_record_required');
    return createRsiMetaProfileShadowPlan({
      plan_id,
      meta_record: record,
      activation_holdout_digest,
      evaluator_root_digest,
      external_plan_owner,
      authored_by_candidate,
    });
  }

  async recordMetaProfileQualification({
    meta_record_digest,
    qualification_id,
    shadow_plan,
    receipts,
    shadow_result,
    risk_budget,
    statistical_certificate,
    confirmation_index,
  } = {}) {
    this.#assertRunning();
    const record = this.#metaSkillArchive.recordByDigest(meta_record_digest);
    if (!record || record.eligible_for_meta_archive !== true) throw new Error('rsi_runtime_meta_profile_archive_record_required');
    const qualification = createRsiMetaProfileQualification({
      qualification_id,
      meta_record: record,
      shadow_plan,
      shadow_result,
      receipts,
      budget: risk_budget,
      certificate: statistical_certificate,
      confirmation_index,
    });
    const stored = await this.#metaProfileQualification.add(qualification);
    await this.#ledger.append('META_PROFILE_QUALIFIED', {
      qualification_id: qualification.qualification_id,
      qualification_digest: qualification.qualification_digest,
      meta_record_digest: qualification.meta_record_digest,
      successor_profile_digest: qualification.successor_profile_digest,
      state: qualification.state,
      qualified_for_shadow_profile_selection: qualification.qualified_for_shadow_profile_selection,
      live_profile_activation_authorized: false,
      authority_effect: false,
    });
    return Object.freeze({ qualification, stored });
  }

  qualifiedMetaProfiles() {
    this.#assertRunning();
    return this.#metaProfileQualification.qualified();
  }

  async selectShadowMetaProfile({
    selection_id,
    qualification_digest,
    external_selector = false,
    authored_by_candidate = true,
  } = {}) {
    this.#assertRunning();
    const qualification = this.#metaProfileQualification.qualificationByDigest(qualification_digest);
    if (!qualification || qualification.qualified_for_shadow_profile_selection !== true) {
      throw new Error('rsi_runtime_shadow_profile_qualification_required');
    }
    const record = this.#metaSkillArchive.recordByDigest(qualification.meta_record_digest);
    if (!record || record.eligible_for_meta_archive !== true) throw new Error('rsi_runtime_shadow_profile_meta_record_required');
    const library = this.#skillLifecycle.verifiedLibrarySnapshot();
    if (!library) throw new Error('rsi_runtime_verified_skill_library_unavailable');
    const selection = createRsiMetaProfileShadowSelection({
      selection_id,
      qualification,
      meta_record: record,
      current_library: library,
      external_selector,
      authored_by_candidate,
    });
    const stored = await this.#metaProfileShadowRegistry.select(selection);
    await this.#ledger.append('META_PROFILE_SHADOW_SELECTED', {
      selection_id: selection.selection_id,
      selection_digest: selection.selection_digest,
      qualification_digest: selection.qualification_digest,
      meta_record_digest: selection.meta_record_digest,
      incumbent_profile_digest: selection.incumbent_profile_digest,
      challenger_profile_digest: selection.challenger_profile_digest,
      mode: selection.mode,
      baseline_execution_path_unchanged: true,
      authority_effect: false,
    });
    return Object.freeze({ selection, stored });
  }

  async compareShadowMetaProfileRoute({
    comparator_root_digest,
    external_comparator_owner = false,
    ...routeArgs
  } = {}) {
    this.#assertRunning();
    const selection = this.#metaProfileShadowRegistry.current();
    if (!selection) throw new Error('rsi_runtime_shadow_profile_not_selected');
    const qualification = this.#metaProfileQualification.qualificationByDigest(selection.qualification_digest);
    if (!qualification) throw new Error('rsi_runtime_shadow_profile_qualification_missing');
    const record = this.#metaSkillArchive.recordByDigest(selection.meta_record_digest);
    if (!record) throw new Error('rsi_runtime_shadow_profile_meta_record_missing');
    const baselinePlan = await this.routeVerifiedSkills(routeArgs);
    const comparisonBinding = createRsiShadowComparisonBinding({
      selection,
      qualification,
      context_digest: baselinePlan.context_digest,
      baseline_plan_digest: baselinePlan.plan_digest,
      comparator_root_digest,
      external_comparator_owner,
      authored_by_candidate: routeArgs.authored_by_candidate ?? true,
    });
    const library = this.#skillLifecycle.verifiedLibrarySnapshot();
    const governance = this.#skillLifecycle.governance();
    if (!library || !governance) throw new Error('rsi_runtime_verified_skill_library_unavailable');
    const projection = createRsiMetaProfileShadowProjection({
      selection,
      qualification,
      meta_record: record,
      current_library: library,
      governance,
      context_digest: baselinePlan.context_digest,
      required_role: routeArgs.required_role ?? null,
      baseline_plan_digest: baselinePlan.plan_digest,
      baseline_selected_skill_digests: baselinePlan.selected.map((row) => row.skill_digest),
    });
    await this.#ledger.append('META_PROFILE_SHADOW_ROUTE_COMPARED', {
      selection_digest: selection.selection_digest,
      comparison_binding_digest: comparisonBinding.binding_digest,
      comparator_root_digest: comparisonBinding.comparator_root_digest,
      projection_digest: projection.projection_digest,
      context_digest: projection.context_digest,
      baseline_plan_digest: projection.baseline_plan_digest,
      required_role: projection.required_role,
      challenger_skill_digest: projection.challenger_skill_digest,
      status: projection.status,
      matches_baseline: projection.matches_baseline,
      baseline_execution_path_unchanged: true,
      comparison_can_activate_profile: false,
      comparison_can_authorize_canary: false,
      authority_effect: false,
    });
    return Object.freeze({ baseline_plan: baselinePlan, comparison_binding: comparisonBinding, shadow_projection: projection });
  }

  currentShadowMetaProfile() {
    this.#assertRunning();
    return this.#metaProfileShadowRegistry.current();
  }

  async adoptVerifiedSkillLibrary({
    library,
    expected_current_library_digest = null,
    trusted_migration = false,
    external_library_owner = false,
    authored_by_candidate = true,
  } = {}) {
    this.#assertRunning();
    const current = this.#skillLifecycle.verifiedLibrarySnapshot();
    if (current && trusted_migration !== true) {
      throw new Error('rsi_runtime_direct_library_adopt_phase34b_required');
    }
    if (current && expected_current_library_digest == null) {
      throw new Error('rsi_runtime_trusted_migration_expected_library_digest_required');
    }
    const result = await this.#skillLifecycle.adoptVerifiedLibrary({
      library,
      expected_current_library_digest: current ? expected_current_library_digest : null,
      external_library_owner,
      authored_by_candidate,
    });
    await this.#ledger.append('VERIFIED_SKILL_LIBRARY_ADOPTED', {
      state: result.state,
      library_digest: result.library_digest,
      entry_count: result.entry_count,
      reconciled_pending: result.reconciled_pending,
      append_only_library_required: true,
      direct_adopt_scope: current ? 'TRUSTED_MIGRATION' : 'TRUSTED_BOOTSTRAP',
      phase34b_required_for_non_migration_updates: true,
      authority_effect: false,
    });
    return result;
  }

  verifiedSkillStateReadback() {
    this.#assertRunning();
    const library = this.#skillLifecycle.verifiedLibrarySnapshot();
    const governance = this.#skillLifecycle.governance();
    if (!library || !governance) throw new Error('rsi_runtime_verified_skill_library_unavailable');
    return Object.freeze({
      library,
      governance,
      library_digest: library.library_digest,
      governance_digest: governance.governance_digest,
      readback_is_execution_authority: false,
      browser_authority: false,
      task_authority: false,
      scheduler_authority: false,
      promotion_authority: false,
      self_update_authority: false,
      authority_effect: false,
    });
  }

  async prepareAnytimeLibraryAdmissionAttempt({
    attempt_id,
    admission_certificate,
    admission_certificate_args,
    successor_library,
    effect_id_digest,
    idempotency_key_digest,
    effect_executor_identity_digest,
    external_library_owner = false,
    external_effect_executor = false,
    authored_by_candidate = true,
  } = {}) {
    this.#assertRunning();
    const result = await this.#skillLifecycle.prepareLibraryAdmissionAttempt({
      attempt_id,
      admission_certificate,
      admission_certificate_args,
      successor_library,
      effect_id_digest,
      idempotency_key_digest,
      effect_executor_identity_digest,
      external_library_owner,
      external_effect_executor,
      authored_by_candidate,
    });
    await this.#ledger.append('ANYTIME_LIBRARY_ADMISSION_PREPARED', {
      attempt_id: result.attempt_id,
      attempt_digest: result.attempt_digest,
      predecessor_library_digest: result.predecessor_library_digest,
      successor_library_digest: result.successor_library_digest,
      effect_performed: false,
      retrieval_exposure_changed: false,
      skill_activation_performed: false,
      automatic_retry_allowed: false,
      authority_effect: false,
    });
    return result;
  }

  async executeAnytimeLibraryAdmissionAttempt({
    attempt_id,
    effect_executor_identity_digest,
    external_effect_executor = false,
    authored_by_candidate = true,
  } = {}) {
    this.#assertRunning();
    const result = await this.#skillLifecycle.executePreparedLibraryAdmissionAttempt({
      attempt_id,
      effect_executor_identity_digest,
      external_effect_executor,
      authored_by_candidate,
    });
    const effectConfirmed = result.state === 'CONFIRMED_APPLIED_STORAGE_ONLY';
    await this.#ledger.append(
      effectConfirmed ? 'ANYTIME_LIBRARY_ADMISSION_EFFECT_CONFIRMED' : 'ANYTIME_LIBRARY_ADMISSION_PRE_EFFECT_DRIFT',
      {
        attempt_id: result.attempt_id,
        attempt_digest: result.attempt_digest,
        state: result.state,
        library_digest: result.library_digest || result.observed_library_digest || null,
        governance_digest: result.observed_governance_digest || null,
        entry_count: result.entry_count || null,
        effect_attempt_count: result.effect_attempt_count,
        effect_performed: effectConfirmed,
        effect_started: effectConfirmed,
        storage_only: effectConfirmed && result.storage_only === true,
        reconciliation_required: result.reconciliation_required === true,
        pre_effect_readback_passed: result.pre_effect_readback_passed === true,
        retrieval_exposure_changed: false,
        skill_activation_performed: false,
        automatic_retry_allowed: false,
        authority_effect: false,
      },
    );
    return result;
  }

  async reconcileAnytimeLibraryAdmissionAttempt({
    attempt_id,
    readback_owner_identity_digest,
    external_readback_owner = false,
    authored_by_candidate = true,
  } = {}) {
    this.#assertRunning();
    const result = await this.#skillLifecycle.reconcileLibraryAdmissionAttempt({
      attempt_id,
      readback_owner_identity_digest,
      external_readback_owner,
      authored_by_candidate,
    });
    await this.#ledger.append('ANYTIME_LIBRARY_ADMISSION_RECONCILED', {
      attempt_id: result.attempt_id,
      attempt_digest: result.attempt_digest,
      state: result.state,
      observed_library_digest: result.observed_library_digest,
      effect_attempt_count: result.effect_attempt_count,
      additional_effect_attempt_performed: false,
      same_effect_id_retry_allowed: false,
      authority_effect: false,
    });
    return result;
  }

  anytimeLibraryAdmissionAttemptSnapshot(attempt_id) {
    this.#assertRunning();
    return this.#skillLifecycle.admissionAttemptSnapshot(attempt_id);
  }

  createSkillActivationView(requested_skill_digests) {
    this.#assertRunning();
    return this.#skillLifecycle.activationView(requested_skill_digests);
  }

  async recordBrowserStepCredit({
    episode,
    task_anchor,
    credit_id,
    credit_sign,
    credit_score,
    method,
    evaluator_digest,
    evaluation_digest,
    failure_codes = [],
    lesson_digests = [],
    evidence_refs,
    skill_generation = null,
    skill_authoring_prior = 'LEGACY_IMPORTED',
    skill_authoring_provenance_digest = null,
    skill_false_positive_injection = false,
    skill_hard_invariant_violation = false,
    external_credit_assigner = false,
    authored_by_candidate = true,
  } = {}) {
    this.#assertRunning();
    const creditReceipt = createRsiStepCreditReceipt({
      credit_id,
      episode,
      credit_sign,
      credit_score,
      method,
      evaluator_digest,
      evaluation_digest,
      failure_codes,
      lesson_digests,
      evidence_refs,
      external_credit_assigner,
      authored_by_candidate,
    });
    const materialization = materializeRsiExperienceCaseFromCredit({
      episode,
      credit_receipt: creditReceipt,
      task_anchor,
    });
    const stored = await this.#experienceStore.appendMaterialization(materialization);
    let skillLifecycle = null;
    let skillRouterEvidence = null;
    if (Array.isArray(episode.skill_digests) && episode.skill_digests.length > 0) {
      skillLifecycle = await this.#skillLifecycle.recordCreditedOutcome({
        episode,
        credit_receipt: creditReceipt,
        generation: skill_generation || episode.step_index || 1,
        router_engaged: true,
        false_positive_injection: skill_false_positive_injection === true,
        hard_invariant_violation: skill_hard_invariant_violation === true,
        authoring_prior: skill_authoring_prior,
        authoring_provenance_digest: skill_authoring_provenance_digest || creditReceipt.evaluator_digest,
        external_evaluator: true,
        authored_by_candidate: false,
      });
      skillRouterEvidence = await this.#skillRouter.recordCreditedOutcome({
        episode,
        credit_receipt: creditReceipt,
        external_evaluator: true,
        authored_by_candidate: false,
      });
    }
    await this.#ledger.append('STEP_CREDIT_RECORDED', {
      episode_digest: episode.episode_digest,
      credit_receipt_digest: creditReceipt.receipt_digest,
      credit_sign: creditReceipt.credit_sign,
      credit_score: creditReceipt.credit_score,
      credit_method: creditReceipt.method,
      trajectory_id: creditReceipt.trajectory_id,
      step_index: creditReceipt.step_index,
      case_digest: materialization.case_row?.case_digest || null,
      experience_snapshot_digest: stored.snapshot_digest,
      materialization_state: materialization.state,
      skill_lifecycle_state: skillLifecycle?.state || null,
      skill_lifecycle_credit_digest: skillLifecycle?.credit_receipt_digest || null,
      skill_router_evidence_state: skillRouterEvidence?.state || null,
      skill_router_evidence_digests: skillRouterEvidence?.evidence_digests || [],
      final_task_reward_broadcast_to_all_steps: false,
      authority_effect: false,
    });
    return Object.freeze({ credit_receipt: creditReceipt, materialization, stored, skill_lifecycle: skillLifecycle, skill_router_evidence: skillRouterEvidence });
  }

  skillRevisionFrontier({ parent_skill_digest = null, max_candidates = 8 } = {}) {
    this.#assertRunning();
    return this.#skillRevisionFrontier.frontier({ parent_skill_digest, max_candidates });
  }

  async recordSkillRevisionIntegrity({
    request_id,
    admission_id,
    integrity_policy,
    integrity_receipt,
    integrity_assessment,
    external_admission_owner = false,
    authored_by_candidate = true,
  } = {}) {
    this.#assertRunning();
    const record = this.#skillCuration.record(request_id);
    if (!record?.request || !record?.evaluation) throw new Error('rsi_runtime_skill_curation_evaluation_unavailable');
    const frontierCandidate = this.#skillRevisionFrontier.candidateByRequest(request_id);
    if (!frontierCandidate) throw new Error('rsi_runtime_skill_revision_frontier_candidate_unavailable');
    const library = this.#skillLifecycle.verifiedLibrarySnapshot();
    const governance = this.#skillLifecycle.governance();
    if (!library || !governance) throw new Error('rsi_runtime_verified_skill_library_unavailable');
    const admission = createRsiSkillRevisionIntegrityAdmission({
      source_sha: this.#sourceSha,
      admission_id,
      frontier_candidate: frontierCandidate,
      request: record.request,
      evaluation: record.evaluation,
      library,
      governance,
      integrity_policy,
      integrity_receipt,
      integrity_assessment,
      external_admission_owner,
      authored_by_candidate,
    });
    const stored = await this.#skillRevisionIntegrity.append(admission);
    await this.#ledger.append('SKILL_REVISION_INTEGRITY_ASSESSED', {
      admission_id: admission.admission_id,
      admission_digest: admission.admission_digest,
      request_id: admission.request_id,
      frontier_candidate_digest: admission.frontier_candidate_digest,
      successor_skill_digest: admission.successor_skill_digest,
      integrity_state: admission.integrity_state,
      state: admission.state,
      eligible_for_existing_reliability_gate: admission.eligible_for_existing_reliability_gate,
      self_authored_verification_sufficient: false,
      direct_library_replacement_allowed: false,
      authority_effect: false,
    });
    return Object.freeze({ admission, stored });
  }

  integrityAdmittedSkillRevisions({ parent_skill_digest = null } = {}) {
    this.#assertRunning();
    return this.#skillRevisionIntegrity.admitted({ parent_skill_digest });
  }

  async recordSkillRevisionReliability({
    request_id,
    binding_id,
    baseline_dataset,
    baseline_trajectory_receipts,
    successor_skill_evidence,
    successor_dataset,
    successor_trajectory_receipts,
    contrast_codes,
    contrast_evidence_digest,
    revision_evidence_refs,
    reliability_evidence_refs,
    hard_invariants_pass,
    max_potential_regression = 0,
    external_curator = false,
    external_evaluator = false,
    authored_by_candidate = true,
  } = {}) {
    this.#assertRunning();
    const admission = this.#skillRevisionIntegrity.admissionByRequest(request_id);
    if (!admission || admission.state !== 'INTEGRITY_ADMITTED') {
      throw new Error('rsi_runtime_skill_revision_integrity_admission_required');
    }
    const record = this.#skillCuration.record(request_id);
    if (!record?.request || !record?.evaluation) throw new Error('rsi_runtime_skill_curation_evaluation_unavailable');
    const library = this.#skillLifecycle.verifiedLibrarySnapshot();
    if (!library) throw new Error('rsi_runtime_verified_skill_library_unavailable');
    const parentEntry = library.entries.find((entry) => entry.skill_digest === record.request.parent_skill_digest);
    if (!parentEntry) throw new Error('rsi_runtime_parent_skill_not_in_verified_library');
    const successorSkill = record.evaluation.successor_skill;
    const binding = createRsiIntegrityBoundSkillReliability({
      source_sha: this.#sourceSha,
      binding_id,
      integrity_admission: admission,
      parent_skill: parentEntry.capsule,
      parent_skill_evidence: parentEntry.evidence,
      baseline_dataset,
      baseline_trajectory_receipts,
      successor_skill: successorSkill,
      successor_skill_evidence,
      successor_dataset,
      successor_trajectory_receipts,
      contrast_codes,
      contrast_evidence_digest,
      revision_evidence_refs,
      reliability_evidence_refs,
      hard_invariants_pass,
      max_potential_regression,
      external_curator,
      external_evaluator,
      authored_by_candidate,
    });
    const reliabilityStored = await this.#skillReliabilityLedger.append(binding);
    await this.#ledger.append('SKILL_REVISION_RELIABILITY_EVALUATED', {
      request_id,
      binding_id: binding.binding_id,
      binding_digest: binding.binding_digest,
      integrity_admission_digest: binding.integrity_admission_digest,
      successor_skill_digest: binding.successor_skill_digest,
      reliability_result_digest: binding.reliability_result.result_digest,
      state: binding.state,
      durable_reliability_state: reliabilityStored.state,
      eligible_for_existing_scope_preservation_gate: binding.eligible_for_existing_scope_preservation_gate,
      direct_library_replacement_allowed: false,
      authority_effect: false,
    });
    this.#skillReliabilityEvaluationCount += 1;
    if (binding.eligible_for_existing_scope_preservation_gate) this.#skillReliabilityPassCount += 1;
    this.#lastSkillReliabilityBindingDigest = binding.binding_digest;
    return binding;
  }

  async recordSkillRevisionScopeAdmission({
    reliability_binding_digest,
    admission_id,
    units,
    compatibility_receipt,
    scope_candidate,
    preservation_receipt,
    scope_result,
    external_scope_owner = false,
    authored_by_candidate = true,
  } = {}) {
    this.#assertRunning();
    const reliabilityBinding = this.#skillReliabilityLedger.bindingByDigest(reliability_binding_digest);
    if (!reliabilityBinding || reliabilityBinding.eligible_for_existing_scope_preservation_gate !== true) {
      throw new Error('rsi_runtime_reliability_passed_revision_required');
    }
    const admission = createRsiRevisionScopeAdmission({
      source_sha: this.#sourceSha,
      admission_id,
      reliability_binding: reliabilityBinding,
      units,
      compatibility_receipt,
      scope_candidate,
      preservation_receipt,
      scope_result,
      external_scope_owner,
      authored_by_candidate,
    });
    const stored = await this.#revisionScopeLedger.append(admission);
    await this.#ledger.append('SKILL_REVISION_SCOPE_PRESERVATION_ASSESSED', {
      admission_id: admission.admission_id,
      admission_digest: admission.admission_digest,
      reliability_binding_digest: admission.reliability_binding_digest,
      successor_skill_digest: admission.successor_skill_digest,
      scope_result_digest: admission.scope_result_digest,
      state: admission.state,
      eligible_for_external_library_evidence: admission.eligible_for_external_library_evidence,
      direct_library_replacement_allowed: false,
      authority_effect: false,
    });
    return Object.freeze({ admission, stored });
  }

  scopeEligibleSkillRevisions() {
    this.#assertRunning();
    return this.#revisionScopeLedger.eligible();
  }

  async admitScopeQualifiedSkillRevisionToLibrary({
    scope_admission_digest,
    admission_id,
    successor_skill,
    successor_evidence,
    sealed_library_holdout = false,
    phase34_admission_attempt_id,
    phase34_admission_certificate,
    phase34_admission_certificate_args,
    effect_id_digest,
    idempotency_key_digest,
    effect_executor_identity_digest,
    external_library_owner = false,
    external_effect_executor = false,
    authored_by_candidate = true,
  } = {}) {
    this.#assertRunning();
    const scopeAdmission = this.#revisionScopeLedger.admissionByDigest(scope_admission_digest);
    if (!scopeAdmission || scopeAdmission.state !== 'ELIGIBLE_FOR_EXTERNAL_LIBRARY_EVIDENCE') {
      throw new Error('rsi_runtime_scope_eligible_revision_required');
    }
    if (!phase34_admission_certificate) {
      throw new Error('rsi_runtime_scope_revision_phase34_certificate_required');
    }
    if (!phase34_admission_attempt_id || !effect_id_digest || !idempotency_key_digest || !effect_executor_identity_digest) {
      throw new Error('rsi_runtime_scope_revision_phase34_effect_identity_required');
    }
    const currentLibrary = this.#skillLifecycle.verifiedLibrarySnapshot();
    if (!currentLibrary) throw new Error('rsi_runtime_verified_skill_library_unavailable');
    const admission = createRsiRevisionLibraryAdmission({
      source_sha: this.#sourceSha,
      admission_id,
      scope_admission: scopeAdmission,
      current_library: currentLibrary,
      successor_skill,
      successor_evidence,
      sealed_library_holdout,
      external_library_owner,
      authored_by_candidate,
    });
    const prepared = await this.prepareAnytimeLibraryAdmissionAttempt({
      attempt_id: phase34_admission_attempt_id,
      admission_certificate: phase34_admission_certificate,
      admission_certificate_args: phase34_admission_certificate_args,
      successor_library: admission.proposed_library,
      effect_id_digest,
      idempotency_key_digest,
      effect_executor_identity_digest,
      external_library_owner,
      external_effect_executor,
      authored_by_candidate,
    });
    const adoption = await this.executeAnytimeLibraryAdmissionAttempt({
      attempt_id: phase34_admission_attempt_id,
      effect_executor_identity_digest,
      external_effect_executor,
      authored_by_candidate,
    });
    await this.#ledger.append('SKILL_REVISION_LIBRARY_ADMITTED', {
      admission_id: admission.admission_id,
      admission_digest: admission.admission_digest,
      scope_admission_digest: admission.scope_admission_digest,
      parent_skill_digest: admission.parent_skill_digest,
      successor_skill_digest: admission.successor_skill_digest,
      successor_evidence_digest: admission.successor_evidence_digest,
      previous_library_digest: admission.current_library_digest,
      adopted_library_digest: admission.proposed_library_digest,
      phase34_admission_attempt_id: prepared.attempt_id,
      phase34_admission_attempt_digest: adoption.attempt_digest,
      append_only_library_update: true,
      phase34_certificate_and_durable_attempt_required: true,
      parent_retained: true,
      direct_browser_execution_authority: false,
      authority_effect: false,
    });
    return Object.freeze({ admission, prepared, adoption });
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
      observation_persistence_mode: 'BOUNDED_COALESCED_FSYNC',
      experience_gate: this.#experienceGate.snapshot(),
      command_attribution: this.#commandAttribution.snapshot(),
      runtime_experience_store: this.#experienceStore.snapshot(),
      runtime_skill_lifecycle: this.#skillLifecycle.snapshot(),
      runtime_skill_router: this.#skillRouter.snapshot(),
      runtime_skill_curation: this.#skillCuration.snapshot(),
      skill_revision_frontier: this.#skillRevisionFrontier.snapshot(),
      skill_revision_integrity: this.#skillRevisionIntegrity.snapshot(),
      skill_revision_reliability_ledger: this.#skillReliabilityLedger.snapshot(),
      revision_scope_admission: this.#revisionScopeLedger.snapshot(),
      skill_coalition_audit: this.#skillCoalitionAudit.snapshot(),
      skill_relation_store: this.#skillRelationStore.snapshot(),
      runtime_meta_skill_archive: this.#metaSkillArchive.snapshot(),
      meta_profile_qualification: this.#metaProfileQualification.snapshot(),
      meta_profile_shadow_registry: this.#metaProfileShadowRegistry.snapshot(),
      promotion_nomination_count: this.#promotionNominationCount,
      skill_revision_reliability: Object.freeze({
        evaluation_count: this.#skillReliabilityEvaluationCount,
        pass_count: this.#skillReliabilityPassCount,
        last_binding_digest: this.#lastSkillReliabilityBindingDigest,
        prior_integrity_admission_required: true,
        existing_contrastive_reliability_gate_reused: true,
        existing_scope_preservation_gate_required: true,
        direct_library_replacement_allowed: false,
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
