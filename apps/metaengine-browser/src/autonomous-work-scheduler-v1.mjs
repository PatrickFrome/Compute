import crypto from 'node:crypto';

export const AUTONOMOUS_WORK_SCHEDULER_VERSION = '1.0.0';

const SAFE_EFFECT_CLASSES = new Set(['READ_ONLY','BRANCH_LOCAL']);
const DISALLOWED_EFFECT_CLASSES = new Set(['PRODUCTION','IRREVERSIBLE','SECRET_CHANGE','PROVIDER_SPEND','AMBIGUOUS_RETRY']);
const clone = (value) => value == null ? value : structuredClone(value);

function opaque(value, max = 240) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max || /[\r\n]/.test(text)) throw new Error('autonomous_scheduler_opaque_invalid');
  return text;
}

function scoreOpportunity(row) {
  const urgency = Number(row.urgency || 0);
  const information = Number(row.expected_information_gain || 0);
  const unblock = Number(row.unblock_count || 0);
  const confidence = Number(row.confidence || 0);
  for (const value of [urgency, information, unblock, confidence]) {
    if (!Number.isFinite(value) || value < 0) throw new Error('autonomous_scheduler_score_invalid');
  }
  return urgency * 4 + information * 3 + unblock * 2 + confidence;
}

function branchAllowed(value) {
  const branch = String(value || '').trim();
  return /^(work|analysis|research)\/[a-z0-9._/-]+$/i.test(branch);
}

export class AutonomousWorkScheduler {
  #store;
  #clock;
  #uuid;

  constructor({ store, clock = () => Date.now(), uuid = () => crypto.randomUUID() } = {}) {
    if (!store || typeof store.transact !== 'function' || typeof store.snapshot !== 'function') throw new Error('autonomous_scheduler_store_required');
    this.#store = store;
    this.#clock = clock;
    this.#uuid = uuid;
  }

  plan({ opportunities = [], workers = [], max_parallel = 6, supervisor_busy = false } = {}) {
    if (!Array.isArray(opportunities) || !Array.isArray(workers)) throw new Error('autonomous_scheduler_inputs_invalid');
    const capacity = Math.max(0, Math.min(32, Number(max_parallel) || 0));
    const runtime = this.#store.snapshot();
    const running = runtime.assignments.filter((row) => ['BOUND_UNVERIFIED','READY','RUNNING'].includes(row.state));
    const freeSlots = Math.max(0, capacity - running.length);
    if (freeSlots === 0) return { proposals: [], suppressed: ['NO_CAPACITY'], authority_effect: false };

    const now = this.#clock();
    const freshProcessKeys = new Set(runtime.process_observations
      .filter((row) => now <= new Date(row.stale_after_at).getTime())
      .map((row) => row.process_key));
    const bindingsByWorker = new Map(runtime.worker_bindings.map((row) => [String(row.agent_id || '').toLowerCase(), row]));
    const activeWorkers = workers
      .filter((row) => row && row.ready === true && row.lost !== true)
      .map((row) => {
        const workerId = opaque(row.worker_id, 100).toLowerCase();
        const binding = bindingsByWorker.get(workerId);
        if (!binding || binding.lifecycle_state !== 'BOUND_UNVERIFIED') return null;
        const durableIncarnation = opaque(binding.worker_incarnation_id, 500);
        if (row.worker_incarnation_id != null && String(row.worker_incarnation_id).trim() !== '') {
          const suppliedIncarnation = opaque(row.worker_incarnation_id, 500);
          if (suppliedIncarnation !== durableIncarnation) return null;
        }
        return {
          worker_id: workerId,
          worker_incarnation_id: durableIncarnation,
          role: String(row.role || binding.role || 'WORKER').toUpperCase(),
        };
      })
      .filter(Boolean);
    const assignedWorkers = new Set(running.map((row) => row.worker_id));
    const availableWorkers = activeWorkers.filter((row) => !assignedWorkers.has(row.worker_id));
    const runningObjectives = new Set(running.map((row) => String(row.objective_key || row.assignment_id)));
    const runningBranches = new Set(running.map((row) => row.work_branch).filter(Boolean));

    const eligible = [];
    const suppressed = [];
    for (const raw of opportunities) {
      const row = clone(raw || {});
      const objectiveKey = opaque(row.objective_key, 200);
      const effectClass = String(row.effect_class || '').toUpperCase();
      if (DISALLOWED_EFFECT_CLASSES.has(effectClass) || !SAFE_EFFECT_CLASSES.has(effectClass)) {
        suppressed.push(`${objectiveKey}:EFFECT_CLASS`);
        continue;
      }
      if (!branchAllowed(row.work_branch)) {
        suppressed.push(`${objectiveKey}:BRANCH_SCOPE`);
        continue;
      }
      if (runningObjectives.has(objectiveKey) || runningBranches.has(row.work_branch)) {
        suppressed.push(`${objectiveKey}:DUPLICATE_OR_BRANCH_COLLISION`);
        continue;
      }
      if (row.ambiguous_effect_barrier === true) {
        suppressed.push(`${objectiveKey}:AMBIGUOUS_EFFECT_BARRIER`);
        continue;
      }
      if (row.dependencies_satisfied !== true) {
        suppressed.push(`${objectiveKey}:DEPENDENCIES`);
        continue;
      }
      if (supervisor_busy === true && row.requires_supervisor_exclusive === true) {
        suppressed.push(`${objectiveKey}:SUPERVISOR_EXCLUSIVE`);
        continue;
      }
      const refs = Array.isArray(row.process_refs) ? row.process_refs.map(String) : [];
      if (refs.length === 0 || refs.some((ref) => !freshProcessKeys.has(ref))) {
        suppressed.push(`${objectiveKey}:STALE_PROCESS_STATE`);
        continue;
      }
      eligible.push({ ...row, objective_key: objectiveKey, effect_class: effectClass, score: scoreOpportunity(row) });
    }

    eligible.sort((a, b) => b.score - a.score || a.objective_key.localeCompare(b.objective_key));
    const proposals = [];
    const count = Math.min(freeSlots, availableWorkers.length, eligible.length);
    for (let i = 0; i < count; i += 1) {
      const row = eligible[i];
      const worker = availableWorkers[i];
      proposals.push({
        schema: 'metaengine.browser.autonomous-work-proposal.v1',
        proposal_id: `proposal_${this.#uuid()}`,
        objective_key: row.objective_key,
        task_kind: opaque(row.task_kind || 'AUTONOMOUS_WORK', 100).toUpperCase(),
        worker_id: worker.worker_id,
        worker_incarnation_id: worker.worker_incarnation_id,
        worker_role: worker.role,
        work_branch: String(row.work_branch),
        process_refs: row.process_refs.map(String),
        effect_class: row.effect_class,
        score: row.score,
        supervisor_busy_at_plan: supervisor_busy === true,
        requires_supervisor_exclusive: row.requires_supervisor_exclusive === true,
        created_at: new Date(this.#clock()).toISOString(),
        automatic_execution_authority: false,
        mainline_promotion_authority: false,
        authority_effect: false,
      });
    }
    return { proposals, suppressed, authority_effect: false };
  }

  async recordDecision(planResult) {
    if (!planResult || !Array.isArray(planResult.proposals) || !Array.isArray(planResult.suppressed)) throw new Error('autonomous_scheduler_plan_result_invalid');
    const decision = {
      schema: 'metaengine.browser.scheduler-decision.v1',
      decision_id: `decision_${this.#uuid()}`,
      proposals: clone(planResult.proposals),
      suppressed: clone(planResult.suppressed),
      created_at: new Date(this.#clock()).toISOString(),
      automatic_execution_authority: false,
      authority_effect: false,
    };
    return this.#store.transact((runtime) => {
      runtime.scheduler_decisions.push(decision);
      runtime.scheduler_decisions = runtime.scheduler_decisions.slice(-2048);
      return clone(decision);
    });
  }
}
