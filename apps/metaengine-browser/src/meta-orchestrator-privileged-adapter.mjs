import {
  assertZeroAuthorityMetaOutput,
  reconcileMetaOrchestrator,
} from './meta-orchestrator-core.mjs';
import {
  buildMetaAuthoritativeSnapshot,
  projectMetaRoadmapAuthority,
} from './meta-orchestrator-authoritative-snapshot.mjs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA40_RE = /^[a-f0-9]{40}$/;
const HASH_RE = /^[a-f0-9]{64}$/;

function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`meta_privileged_${name}_invalid`);
  return value;
}

function workspaceId(value) {
  const out = String(value || '').toLowerCase();
  if (!UUID_RE.test(out)) throw new Error('meta_privileged_workspace_id_invalid');
  return out;
}

function positiveInt(value, name) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 1) throw new Error(`meta_privileged_${name}_invalid`);
  return out;
}

function nonNegativeInt(value, name) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 0) throw new Error(`meta_privileged_${name}_invalid`);
  return out;
}

function exactPlanState(planState, authority) {
  object(planState, 'plan_state');
  if (planState.schema !== 'metaengine.meta-orchestrator.plan-state.v1' || planState.found !== true || planState.state !== 'ACTIVE') {
    throw new Error('meta_privileged_active_plan_missing');
  }
  const plan = object(planState.plan_spec, 'plan_spec');
  if (plan.schema !== 'metaengine.meta-orchestrator.plan.v1') throw new Error('meta_privileged_plan_schema_invalid');
  const generation = positiveInt(planState.plan_generation, 'plan_generation');
  if (Number(plan.plan_generation) !== generation) throw new Error('meta_privileged_plan_generation_drift');
  if (String(planState.roadmap_id || '') !== authority.roadmap_id || String(plan.roadmap_id || '') !== authority.roadmap_id) {
    throw new Error('meta_privileged_plan_roadmap_drift');
  }
  if (Number(planState.alignment_epoch) !== authority.alignment_epoch || Number(plan.alignment_epoch) !== authority.alignment_epoch) {
    throw new Error('meta_privileged_plan_alignment_drift');
  }
  if (String(planState.baseline_sha || '').toLowerCase() !== authority.baseline_sha
      || String(plan.baseline_sha || '').toLowerCase() !== authority.baseline_sha) {
    throw new Error('meta_privileged_plan_baseline_drift');
  }
  if (!HASH_RE.test(String(planState.plan_sha256 || '').toLowerCase())) throw new Error('meta_privileged_plan_digest_invalid');
  if (planState.authority_effect !== false || planState.scheduler_authority !== false
      || planState.browser_authority !== false || planState.release_authority !== false
      || planState.task_content_authority === true) {
    throw new Error('meta_privileged_plan_state_authority_invalid');
  }
  assertZeroAuthorityMetaOutput(plan);
  return Object.freeze({ plan, generation });
}

function safeCapacity(value) {
  const row = object(value || {}, 'capacity');
  const source = String(row.source || '').toUpperCase();
  if (!['DEVOS_SCHEDULER_SNAPSHOT', 'SIGNED_BROWSER_FLEET'].includes(source)) {
    return Object.freeze({ source: 'UNSPECIFIED_FAIL_CLOSED', available_slots: 0, authority_effect: false });
  }
  return Object.freeze({
    source,
    available_slots: nonNegativeInt(row.available_slots ?? 0, 'available_slots'),
    authority_effect: false,
  });
}

function exactAuthoritativeInputs(raw, { workspace, roadmapId }) {
  const bundle = object(raw, 'authoritative_inputs');
  if (bundle.schema !== 'metaengine.meta-orchestrator.authoritative-inputs.v1') throw new Error('meta_privileged_authoritative_inputs_schema_invalid');
  if (String(bundle.workspace_id || '').toLowerCase() !== workspace) throw new Error('meta_privileged_authoritative_inputs_workspace_drift');
  if (String(bundle.roadmap_id || '').toLowerCase() !== roadmapId) throw new Error('meta_privileged_authoritative_inputs_roadmap_drift');
  if (bundle.task_meta_projection_only !== true || bundle.task_payload_exposed !== false
      || bundle.result_summary_exposed !== false || bundle.scheduler_identity_exposed !== false
      || bundle.receipt_summary_exposed !== false || bundle.receipt_evidence_exposed !== false
      || bundle.automatic_retry_allowed !== false || bundle.task_content_authority !== false
      || bundle.scheduler_authority !== false || bundle.browser_authority !== false
      || bundle.release_authority !== false || bundle.authority_effect !== false) {
    throw new Error('meta_privileged_authoritative_inputs_membrane_invalid');
  }
  if (!Array.isArray(bundle.tasks)) throw new Error('meta_privileged_tasks_invalid');
  if (!Array.isArray(bundle.roadmap_receipts)) throw new Error('meta_privileged_receipts_invalid');
  return bundle;
}

export class MetaOrchestratorPrivilegedAdapter {
  #readAuthoritativeInputs;
  #readRoadmapAuthority;
  #readPlanState;
  #readDevosTasks;
  #readRoadmapReceipts;
  #readCapacity;
  #activatePlan;

  constructor({
    readAuthoritativeInputs = null,
    readRoadmapAuthority,
    readPlanState,
    readDevosTasks,
    readRoadmapReceipts,
    readCapacity,
    activatePlan,
  } = {}) {
    if (typeof activatePlan !== 'function') throw new Error('meta_privileged_activatePlan_required');
    if (readAuthoritativeInputs != null) {
      if (typeof readAuthoritativeInputs !== 'function') throw new Error('meta_privileged_readAuthoritativeInputs_required');
      this.#readAuthoritativeInputs = readAuthoritativeInputs;
    } else {
      for (const [name, fn] of Object.entries({
        readRoadmapAuthority,
        readPlanState,
        readDevosTasks,
        readRoadmapReceipts,
        readCapacity,
      })) {
        if (typeof fn !== 'function') throw new Error(`meta_privileged_${name}_required`);
      }
      this.#readRoadmapAuthority = readRoadmapAuthority;
      this.#readPlanState = readPlanState;
      this.#readDevosTasks = readDevosTasks;
      this.#readRoadmapReceipts = readRoadmapReceipts;
      this.#readCapacity = readCapacity;
    }
    this.#activatePlan = activatePlan;
  }

  async readAuthoritativeBundle({ workspace_id, roadmap_id = 'metaengine-development-os-v1', worker_observer = null } = {}) {
    const workspace = workspaceId(workspace_id);
    const roadmapId = String(roadmap_id || '').trim().toLowerCase();
    if (!roadmapId) throw new Error('meta_privileged_roadmap_id_invalid');

    let roadmapAuthorityRaw;
    let planState;
    let tasks;
    let roadmapReceipts;
    let capacityRaw;

    if (this.#readAuthoritativeInputs) {
      const inputs = exactAuthoritativeInputs(await this.#readAuthoritativeInputs({
        workspace_id: workspace,
        roadmap_id: roadmapId,
      }), { workspace, roadmapId });
      roadmapAuthorityRaw = inputs.roadmap_authority;
      planState = inputs.plan_state;
      tasks = inputs.tasks;
      roadmapReceipts = inputs.roadmap_receipts;
      capacityRaw = inputs.capacity;
    } else {
      roadmapAuthorityRaw = await this.#readRoadmapAuthority({ roadmap_id: roadmapId });
      planState = await this.#readPlanState({ workspace_id: workspace, roadmap_id: roadmapId });
    }

    const authority = projectMetaRoadmapAuthority(roadmapAuthorityRaw);
    if (authority.roadmap_id !== roadmapId) throw new Error('meta_privileged_roadmap_authority_mismatch');
    const { plan, generation } = exactPlanState(planState, authority);

    if (!this.#readAuthoritativeInputs) {
      [tasks, roadmapReceipts, capacityRaw] = await Promise.all([
        this.#readDevosTasks({ workspace_id: workspace, roadmap_id: roadmapId, plan_generation: generation }),
        this.#readRoadmapReceipts({ roadmap_id: roadmapId }),
        this.#readCapacity({ workspace_id: workspace }),
      ]);
    }
    if (!Array.isArray(tasks)) throw new Error('meta_privileged_tasks_invalid');
    if (!Array.isArray(roadmapReceipts)) throw new Error('meta_privileged_receipts_invalid');
    const capacity = safeCapacity(capacityRaw);

    const snapshot = buildMetaAuthoritativeSnapshot({
      roadmapAuthority: roadmapAuthorityRaw,
      plan,
      observedPlanGeneration: generation,
      tasks,
      roadmapReceipts,
      capacity,
      workerObserver: worker_observer,
    });

    return Object.freeze({
      schema: 'metaengine.meta-orchestrator.authoritative-bundle.v1',
      workspace_id: workspace,
      plan,
      snapshot,
      scheduler_authority: false,
      browser_authority: false,
      release_authority: false,
      authority_effect: false,
    });
  }

  async reconcile({ workspace_id, roadmap_id, leader = {}, policy = {}, worker_observer = null } = {}) {
    const bundle = await this.readAuthoritativeBundle({ workspace_id, roadmap_id, worker_observer });
    return reconcileMetaOrchestrator({
      plan: bundle.plan,
      observed_alignment_epoch: bundle.snapshot.observed_alignment_epoch,
      observed_plan_generation: bundle.snapshot.observed_plan_generation,
      leader,
      tasks: bundle.snapshot.tasks,
      evidence: bundle.snapshot.evidence,
      capacity: bundle.snapshot.capacity,
      policy,
    });
  }

  async activateCompiledPlan({ workspace_id, compiled_plan, expected_current_generation } = {}) {
    const workspace = workspaceId(workspace_id);
    const plan = object(compiled_plan, 'compiled_plan');
    if (plan.schema !== 'metaengine.meta-orchestrator.plan.v1') throw new Error('meta_privileged_plan_schema_invalid');
    assertZeroAuthorityMetaOutput(plan);
    const expected = nonNegativeInt(expected_current_generation, 'expected_current_generation');
    const generation = positiveInt(plan.plan_generation, 'plan_generation');
    if (generation !== expected + 1) throw new Error('meta_privileged_next_generation_mismatch');
    if (!SHA40_RE.test(String(plan.baseline_sha || '').toLowerCase())) throw new Error('meta_privileged_plan_baseline_invalid');

    const response = object(await this.#activatePlan({
      p_workspace_id: workspace,
      p_roadmap_id: String(plan.roadmap_id || '').toLowerCase(),
      p_expected_current_generation: expected,
      p_plan: structuredClone(plan),
    }), 'activation_response');

    if (response.schema !== 'metaengine.meta-orchestrator.plan-state.v1'
        || Number(response.plan_generation) !== generation
        || String(response.roadmap_id || '') !== String(plan.roadmap_id || '')
        || Number(response.alignment_epoch) !== Number(plan.alignment_epoch)
        || String(response.baseline_sha || '').toLowerCase() !== String(plan.baseline_sha || '').toLowerCase()
        || !HASH_RE.test(String(response.plan_sha256 || '').toLowerCase())
        || response.state !== 'ACTIVE'
        || response.task_content_authority === true
        || response.authority_effect !== false
        || response.scheduler_authority !== false
        || response.browser_authority !== false
        || response.release_authority !== false) {
      throw new Error('meta_privileged_activation_readback_invalid');
    }

    return Object.freeze({
      schema: 'metaengine.meta-orchestrator.plan-activation-readback.v1',
      workspace_id: workspace,
      roadmap_id: response.roadmap_id,
      plan_generation: generation,
      alignment_epoch: Number(response.alignment_epoch),
      baseline_sha: String(response.baseline_sha).toLowerCase(),
      plan_sha256: String(response.plan_sha256).toLowerCase(),
      state: 'ACTIVE',
      automatic_retry_allowed: false,
      task_content_authority: false,
      scheduler_authority: false,
      browser_authority: false,
      release_authority: false,
      authority_effect: false,
    });
  }
}
