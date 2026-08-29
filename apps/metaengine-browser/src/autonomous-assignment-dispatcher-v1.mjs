import crypto from 'node:crypto';

export const AUTONOMOUS_ASSIGNMENT_DISPATCHER_VERSION = '1.0.0';

const SAFE_EFFECT_CLASSES = new Set(['READ_ONLY','BRANCH_LOCAL']);
const PROCESS_AUTHORITY_MAP = Object.freeze({
  GITHUB: 'GITHUB',
  SUPABASE: 'SUPABASE',
  NATIVE_CONTROL_PLANE: 'NATIVE_CONTROL_PLANE',
  CI: 'GITHUB',
});

function opaque(value, max = 240) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max || /[\r\n]/.test(text)) throw new Error('autonomous_dispatcher_opaque_invalid');
  return text;
}

export class AutonomousAssignmentDispatcher {
  #store;
  #fleetRuntime;
  #clock;
  #uuid;

  constructor({ store, fleetRuntime, clock = () => Date.now(), uuid = () => crypto.randomUUID() } = {}) {
    if (!store || typeof store.snapshot !== 'function') throw new Error('autonomous_dispatcher_store_required');
    if (!fleetRuntime || typeof fleetRuntime.createAssignment !== 'function') throw new Error('autonomous_dispatcher_fleet_runtime_required');
    this.#store = store;
    this.#fleetRuntime = fleetRuntime;
    this.#clock = clock;
    this.#uuid = uuid;
  }

  async dispatchProposal(proposal, { authority } = {}) {
    if (String(authority || '').toUpperCase() !== 'TRUSTED_NATIVE_CONTROL_PLANE') throw new Error('autonomous_dispatcher_authority_invalid');
    if (!proposal || proposal.schema !== 'metaengine.browser.autonomous-work-proposal.v1') throw new Error('autonomous_dispatcher_proposal_invalid');
    if (proposal.automatic_execution_authority !== false || proposal.mainline_promotion_authority !== false) throw new Error('autonomous_dispatcher_proposal_authority_invalid');
    const effectClass = String(proposal.effect_class || '').toUpperCase();
    if (!SAFE_EFFECT_CLASSES.has(effectClass)) throw new Error('autonomous_dispatcher_effect_class_invalid');
    const branch = opaque(proposal.work_branch, 300);
    if (!/^(work|analysis|research)\/[a-z0-9._/-]+$/i.test(branch)) throw new Error('autonomous_dispatcher_branch_scope_invalid');

    const state = this.#store.snapshot();
    const now = this.#clock();
    const binding = state.worker_bindings.find((row) => row.agent_id === String(proposal.worker_id || '').toLowerCase());
    if (!binding) throw new Error('autonomous_dispatcher_worker_binding_required');
    if (binding.lifecycle_state !== 'BOUND_UNVERIFIED') throw new Error('autonomous_dispatcher_worker_binding_state_invalid');
    const proposedIncarnation = opaque(proposal.worker_incarnation_id, 500);
    if (binding.worker_incarnation_id !== proposedIncarnation) throw new Error('autonomous_dispatcher_worker_incarnation_mismatch');

    const refs = [];
    for (const processRef of proposal.process_refs || []) {
      const row = state.process_observations.find((item) => item.process_key === String(processRef));
      if (!row) throw new Error('autonomous_dispatcher_process_ref_missing');
      if (now > new Date(row.stale_after_at).getTime()) throw new Error('autonomous_dispatcher_process_ref_stale');
      const system = PROCESS_AUTHORITY_MAP[row.source_system];
      if (!system) throw new Error('autonomous_dispatcher_process_source_not_assignment_authority');
      refs.push({ system, ref: `${row.process_key}@${row.source_cursor}`.slice(0, 500) });
    }
    if (refs.length === 0) throw new Error('autonomous_dispatcher_process_refs_required');

    const existingDecision = state.scheduler_decisions.find((decision) =>
      Array.isArray(decision.proposals) && decision.proposals.some((row) => row.proposal_id === proposal.proposal_id));
    if (!existingDecision) throw new Error('autonomous_dispatcher_proposal_not_durable');
    const duplicateAssignment = state.assignments.find((row) => row.cycle_id === proposal.proposal_id && !['FAILED','LOST'].includes(row.state));
    if (duplicateAssignment) return { assignment: structuredClone(duplicateAssignment), duplicate: true, authority_effect: false };

    const assignment = await this.#fleetRuntime.createAssignment({
      assignment_id: `assign_${this.#uuid()}`,
      attempt_id: `attempt_${this.#uuid()}`,
      worker_id: proposal.worker_id,
      cycle_id: proposal.proposal_id,
      task_kind: proposal.task_kind,
      authority_refs: refs,
    });
    if (assignment.worker_incarnation_id !== proposedIncarnation) throw new Error('autonomous_dispatcher_assignment_incarnation_mismatch');
    return {
      schema: 'metaengine.browser.autonomous-dispatch-receipt.v1',
      proposal_id: proposal.proposal_id,
      objective_key: proposal.objective_key,
      work_branch: branch,
      effect_class: effectClass,
      worker_incarnation_id: proposedIncarnation,
      assignment: structuredClone(assignment),
      dispatched_at: new Date(this.#clock()).toISOString(),
      worker_browser_authority: false,
      mainline_promotion_authority: false,
      automatic_start_authority: false,
      authority_effect: false,
    };
  }
}
