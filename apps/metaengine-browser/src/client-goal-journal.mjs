import {normalizePreparedActivationInput,normalizePreparedActivationReceipt} from './client-prepared-goal-activation.mjs';
import { clientGoalExecutionProofMatchesProgress } from './client-control-contract.mjs';
import { clientUsefulWorkProofMatchesExecutionProof } from './client-useful-work-proof.mjs';
import { normalizeClientProjectRegistration, normalizeNativeReviewRejection } from './client-project-continuity.mjs';
import {normalizeNativeCodingGoalAdmission,nativeCodingGoalProject,normalizeNativeCodingSeedRejection} from './client-native-coding-goal.mjs';
import {normalizePreparedGoalSelector,normalizePreparedGoalAdmission} from './client-prepared-goal.mjs';
import {isDeepStrictEqual} from 'node:util';

const SCHEMA = 'metaengine.client.goal-journal.v1';
const ENTRY_SCHEMA = 'metaengine.client.goal-journal-entry.v1';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const STATES = new Set([
  'SUBMITTING','ADMITTED','RECONCILE_REQUIRED','PENDING_ACTIVATION','ACTIVATION_READBACK_REQUIRED','ACTIVATED',
  'READY','LEASED','RUNNING','SUSPENDED','RESULT_READY','BLOCKED',
  'COMPLETED','FAILED','AMBIGUOUS','FENCED',
]);

const clone = (value) => value == null ? value : structuredClone(value);
const nowIso = () => new Date().toISOString();

function requestId(value) {
  const out = String(value ?? '').trim().toLowerCase();
  if (!UUID_RE.test(out)) throw new Error('client_goal_journal_request_id_invalid');
  return out;
}

function goalText(value) {
  if (typeof value !== 'string') throw new Error('client_goal_journal_goal_invalid');
  const out = value.trim();
  if (!out || out.length > 480) throw new Error('client_goal_journal_goal_invalid');
  return out;
}

function safeError(value) {
  return String(value?.message || value || '').slice(0, 240) || null;
}

function normalizeEntry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('client_goal_journal_entry_invalid');
  const id = requestId(value.request_id);
  const goal = goalText(value.goal);
  const state = String(value.state || '').toUpperCase();
  const kind=value.kind??'BROWSER';
  if(!['BROWSER','NATIVE_CODING','PREPARED_GOAL'].includes(kind))throw new Error('client_goal_journal_kind_invalid');
  if(['PENDING_ACTIVATION','ACTIVATION_READBACK_REQUIRED','ACTIVATED'].includes(state)&&kind!=='PREPARED_GOAL')throw new Error('client_goal_journal_pending_kind_invalid');
  if (!STATES.has(state)) throw new Error('client_goal_journal_state_invalid');
  if (value.authority_effect !== false || value.automatic_retry_allowed !== false) {
    throw new Error('client_goal_journal_authority_invalid');
  }
  const progress = value.progress && typeof value.progress === 'object' && !Array.isArray(value.progress)
    ? clone(value.progress)
    : null;
  const executionProof = clientGoalExecutionProofMatchesProgress(value.execution_proof, progress)
    ? clone(value.execution_proof)
    : null;
  const usefulWorkProof = executionProof && clientUsefulWorkProofMatchesExecutionProof(value.useful_work_proof, executionProof)
    ? clone(value.useful_work_proof)
    : null;
  const preparedSelector=kind==='PREPARED_GOAL'?normalizePreparedGoalSelector(value.prepared_selector):null;
  if(kind!=='PREPARED_GOAL'&&value.prepared_selector!=null)throw new Error('client_goal_journal_selector_kind_invalid');
  const receipt=kind==='PREPARED_GOAL'&&value.receipt!=null?normalizePreparedGoalAdmission(value.receipt,{request_id:id,goal,prepared_selector:preparedSelector}):kind==='NATIVE_CODING'&&value.receipt!=null
    ?normalizeNativeCodingGoalAdmission(value.receipt,{request_id:id,objective:goal}):value.receipt;
  const activationInput=value.activation_input==null?null:normalizePreparedActivationInput(value.activation_input,{...value,prepared_selector:preparedSelector});
  const activationReceipt=value.activation_receipt==null?null:normalizePreparedActivationReceipt(value.activation_receipt,{...value,receipt,prepared_selector:preparedSelector,activation_input:activationInput});
  if((activationInput||activationReceipt)&&kind!=='PREPARED_GOAL'||activationInput&&!receipt||activationReceipt&&!activationInput)throw Error('client_goal_journal_activation_conflict');
  const nativeRejection=value.native_rejection==null?null:normalizeNativeCodingSeedRejection(value.native_rejection,{request_id:id,objective:goal});
  if(nativeRejection&&(kind!=='NATIVE_CODING'||state!=='FAILED'||receipt||progress||value.admitted_task_id||value.project))
    throw new Error('client_goal_journal_native_rejection_conflict');
  let project;
  if(kind==='PREPARED_GOAL'){
    if(!['SUBMITTING','RECONCILE_REQUIRED','PENDING_ACTIVATION','ACTIVATION_READBACK_REQUIRED','ACTIVATED'].includes(state)||progress||value.execution_proof||value.useful_work_proof||value.project||value.admitted_task_id||nativeRejection
      ||(state==='PENDING_ACTIVATION'&&!receipt))throw new Error('client_goal_journal_pending_conflict');
    if((state==='ACTIVATED')!==!!activationReceipt||state==='ACTIVATION_READBACK_REQUIRED'&&!activationInput||activationInput&&!['ACTIVATION_READBACK_REQUIRED','ACTIVATED'].includes(state))throw Error('client_goal_journal_activation_state_invalid');
    project=null;
  }else if(kind==='NATIVE_CODING'){
    project=receipt?nativeCodingGoalProject(receipt):null;
    if(value.project!=null&&!isDeepStrictEqual(value.project,project))throw new Error('client_goal_journal_native_project_drift');
    if(value.execution_proof!=null||value.useful_work_proof!=null)throw new Error('client_goal_journal_native_legacy_proof_invalid');
    if(progress&&(progress.schema!=='metaengine.client.native-coding-goal-progress.v1'||!receipt
      ||progress.request_id!==id||progress.project_id!==receipt.project_id||progress.task_id!==receipt.root_task_id
      ||progress.found!==true||progress.authority_effect!==false||progress.automatic_retry_allowed!==false
      ||progress.physical_execution_proven!==false||!STATES.has(progress.task_state)))throw new Error('client_goal_journal_native_progress_invalid');
    if(progress?.review_rejection!=null){
      normalizeNativeReviewRejection(progress.review_rejection,receipt.project_id);
      if(progress.blocked_reason!=='NATIVE_REVIEW_REJECTED')throw new Error('client_goal_journal_native_review_invalid');
    }else if(progress?.blocked_reason!=null)throw new Error('client_goal_journal_native_review_invalid');
  }else project=value.project == null ? null : normalizeClientProjectRegistration(value.project, id);
  const knownAdmission = value.admitted_task_id == null ? null : requestId(value.admitted_task_id);
  const admittedTask = (kind==='NATIVE_CODING'?receipt?.root_task_id:receipt?.task_id) || (progress?.found === true ? progress.task_id : null) || knownAdmission;
  if (knownAdmission && admittedTask !== knownAdmission) throw new Error('client_goal_journal_admission_task_drift');
  if (project && (!admittedTask || project.root_task_id !== admittedTask)) {
    throw new Error('client_goal_journal_project_task_drift');
  }
  return Object.freeze({
    schema: ENTRY_SCHEMA,
    request_id: id,
    kind,
    goal,
    state,
    ...(preparedSelector?{prepared_selector:preparedSelector}:{}),
    ...(activationInput?{activation_input:activationInput,activation_receipt:activationReceipt}:{}),
    native_rejection:nativeRejection,
    receipt: receipt && typeof receipt === 'object' && !Array.isArray(receipt)
      ? Object.freeze(clone(receipt))
      : null,
    progress: progress ? Object.freeze(progress) : null,
    execution_proof: executionProof ? Object.freeze(executionProof) : null,
    useful_work_proof: usefulWorkProof ? Object.freeze(usefulWorkProof) : null,
    project,
    admitted_task_id: knownAdmission,
    project_error: value.project_error == null ? null : String(value.project_error).slice(0, 240),
    last_error: value.last_error == null ? null : String(value.last_error).slice(0, 240),
    created_at: String(value.created_at || nowIso()),
    updated_at: String(value.updated_at || nowIso()),
    local_correlation_only: true,
    scheduler_authority: false,
    browser_actuation_authority: false,
    release_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

function emptyState() {
  return Object.freeze({
    schema: SCHEMA,
    entries: Object.freeze([]),
    local_correlation_only: true,
    scheduler_authority: false,
    browser_actuation_authority: false,
    release_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

export class ClientGoalJournal {
  #loadState;
  #saveState;
  #maxEntries;
  #state = emptyState();
  #loaded = false;
  #writeTail = Promise.resolve();
  #persistenceFenced = false;

  constructor({ loadState, saveState, maxEntries = 32 } = {}) {
    if (typeof loadState !== 'function' || typeof saveState !== 'function') {
      throw new Error('client_goal_journal_storage_required');
    }
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 128) {
      throw new Error('client_goal_journal_max_entries_invalid');
    }
    this.#loadState = loadState;
    this.#saveState = saveState;
    this.#maxEntries = maxEntries;
  }

  async load() {
    if (this.#loaded) return this.snapshot();
    let raw = null;
    try { raw = await this.#loadState(); } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    if (raw != null) {
      if (
        !raw || typeof raw !== 'object' || Array.isArray(raw)
        || raw.schema !== SCHEMA
        || raw.authority_effect !== false
        || raw.automatic_retry_allowed !== false
        || !Array.isArray(raw.entries)
        || raw.entries.length > this.#maxEntries
      ) throw new Error('client_goal_journal_snapshot_invalid');
      const seen = new Set();
      const entries = raw.entries.map((row) => {
        const normalized = normalizeEntry(row);
        if (seen.has(normalized.request_id)) throw new Error('client_goal_journal_request_duplicate');
        seen.add(normalized.request_id);
        return normalized;
      });
      this.#state = Object.freeze({ ...emptyState(), entries: Object.freeze(entries) });
    }
    this.#loaded = true;
    return this.snapshot();
  }

  snapshot() {
    return Object.freeze(clone(this.#state));
  }

  latest() {
    return this.#state.entries.at(-1) || null;
  }

  // If a durable write fails after an unknown filesystem effect, the old
  // in-memory view may differ from disk. Never allow another write (including
  // another SUBMITTING) from this incarnation; restart and reconcile by ID.
  persistenceStatus() {
    return Object.freeze({ schema: 'metaengine.client.goal-journal-persistence.v1',
      fenced: this.#persistenceFenced, automatic_retry_allowed: false, authority_effect: false });
  }

  get(rawRequestId) {
    const id = requestId(rawRequestId);
    return this.#state.entries.find((row) => row.request_id === id) || null;
  }

  #replace(id, change) {
    const write = this.#writeTail.then(async () => {
      if (this.#persistenceFenced) throw new Error('client_goal_journal_persistence_reconciliation_required');
      if (!this.#loaded) await this.load();
      const existing = this.get(id);
      const next = change(existing);
      if (next === existing) return existing;
      const normalized = normalizeEntry(next);
      const entries = this.#state.entries.filter(row => row.request_id !== id);
      entries.push(normalized);
      while (entries.length > this.#maxEntries) entries.shift();
      const state = Object.freeze({ ...emptyState(), entries: Object.freeze(entries) });
      // Do not publish an in-memory state that failed to become durable.
      try { await this.#saveState(clone(state)); }
      catch (error) {
        // The rename might have completed even when fsync/readback failed.
        // A rejected write must not be followed by another state transition.
        this.#persistenceFenced = true;
        throw error;
      }
      this.#state = state;
      return normalized;
    });
    this.#writeTail = write.catch(() => {});
    return write;
  }

  async begin({ request_id, goal,kind='BROWSER',prepared_selector=null }) {
    if (!this.#loaded) await this.load();
    const id = requestId(request_id);
    const text = goalText(goal);
    const observed = nowIso();
    return this.#replace(id, existing => {
      if (existing && (existing.goal !== text||existing.kind!==kind||!isDeepStrictEqual(existing.prepared_selector??null,prepared_selector))) throw new Error('client_goal_journal_request_collision');
      if (existing) return existing;
      return {
        schema: ENTRY_SCHEMA,
        request_id: id,
        kind,
        ...(prepared_selector?{prepared_selector}:{}),
        goal: text,
        state: 'SUBMITTING',
        receipt: null,
        progress: null,
        execution_proof: null,
        useful_work_proof: null,
        last_error: null,
        created_at: observed,
        updated_at: observed,
        automatic_retry_allowed: false,
        authority_effect: false,
      };
    });
  }

  async recordSubmission(receipt) {
    const id = requestId(receipt?.request_id);
    if (receipt?.schema !== 'metaengine.client.goal-submission.v1' || receipt?.exact_request_correlation !== true) {
      throw new Error('client_goal_journal_receipt_invalid');
    }
    return this.#replace(id, existing => {
      if (!existing) throw new Error('client_goal_journal_request_missing');
      if(existing.kind!=='BROWSER')throw new Error('client_goal_journal_kind_mismatch');
      return {
        ...existing,
        state: 'ADMITTED',
        receipt: clone(receipt),
        last_error: null,
        updated_at: nowIso(),
        automatic_retry_allowed: false,
        authority_effect: false,
      };
    });
  }

  async recordProgress(progress) {
    const id = requestId(progress?.request_id);
    if (progress?.schema !== 'metaengine.client.goal-progress.v1') throw new Error('client_goal_journal_progress_invalid');
    const state = progress.found === true ? String(progress.task_state || '').toUpperCase() : 'RECONCILE_REQUIRED';
    if (!STATES.has(state)) throw new Error('client_goal_journal_progress_state_invalid');
    return this.#replace(id, existing => {
      if (!existing) throw new Error('client_goal_journal_request_missing');
      if(existing.kind!=='BROWSER')throw new Error('client_goal_journal_kind_mismatch');
      const executionProof = clientGoalExecutionProofMatchesProgress(existing.execution_proof, progress)
        ? existing.execution_proof : null;
      const usefulWorkProof = executionProof && clientUsefulWorkProofMatchesExecutionProof(existing.useful_work_proof, executionProof)
        ? existing.useful_work_proof : null;
      return {
        ...existing,
        state,
        progress: clone(progress),
        execution_proof: executionProof,
        useful_work_proof: usefulWorkProof,
        last_error: progress.found === true ? null : existing.last_error,
        updated_at: nowIso(),
        automatic_retry_allowed: false,
        authority_effect: false,
      };
    });
  }

  async recordPreparedAdmission(receipt){
    const id=requestId(receipt?.request_id);
    return this.#replace(id,existing=>{
      if(existing?.kind!=='PREPARED_GOAL')throw new Error('client_goal_journal_pending_request_missing');
      const verified=normalizePreparedGoalAdmission(receipt,existing);
      if(existing.receipt&&!isDeepStrictEqual(existing.receipt,verified))throw new Error('client_goal_journal_pending_admission_drift');
      return {...existing,receipt:verified,state:existing.activation_input?existing.state:'PENDING_ACTIVATION',last_error:null,project_error:null,updated_at:nowIso()};
    });
  }

  async beginPreparedActivation(input){
    return this.#replace(requestId(input?.request_id),existing=>{
      if(existing?.kind!=='PREPARED_GOAL'||existing.state!=='PENDING_ACTIVATION'||existing.activation_input||!existing.receipt)throw Error('client_goal_journal_activation_already_attempted');
      return {...existing,activation_input:normalizePreparedActivationInput(input,existing),activation_receipt:null,state:'ACTIVATION_READBACK_REQUIRED',updated_at:nowIso()};
    });
  }
  async recordPreparedActivation(receipt){
    return this.#replace(requestId(receipt?.input?.request_id),existing=>{
      if(existing?.kind!=='PREPARED_GOAL'||!existing.activation_input)throw Error('client_goal_journal_activation_missing');
      const verified=normalizePreparedActivationReceipt(receipt,existing);
      if(existing.activation_receipt&&!isDeepStrictEqual(existing.activation_receipt,verified))throw Error('client_goal_journal_activation_receipt_drift');
      return {...existing,activation_receipt:verified,state:'ACTIVATED',last_error:null,updated_at:nowIso()};
    });
  }

  async recordPreparedActivationMountStatus(id,reason){
    return this.#replace(requestId(id),existing=>{
      if(!existing?.activation_receipt||existing.state!=='ACTIVATED'||![null,'ACTIVATION_RUNTIME_MOUNT_UNAVAILABLE'].includes(reason))throw Error('client_goal_journal_activation_mount_invalid');
      if(existing.project_error===reason)return existing;
      return {...existing,project_error:reason,updated_at:nowIso()};
    });
  }

  async recordNativeAdmission(receipt){
    const id=requestId(receipt?.request_id);
    return this.#replace(id,existing=>{
      if(!existing||existing.kind!=='NATIVE_CODING')throw new Error('client_goal_journal_native_request_missing');
      if(existing.native_rejection)throw new Error('client_goal_journal_native_rejection_conflict');
      const verified=normalizeNativeCodingGoalAdmission(receipt,{request_id:id,objective:existing.goal});
      if(existing.receipt&&!isDeepStrictEqual(existing.receipt,verified))throw new Error('client_goal_journal_native_admission_drift');
      return {...existing,receipt:verified,project:nativeCodingGoalProject(verified),admitted_task_id:verified.root_task_id,
        state:existing.progress?.task_state||'ADMITTED',last_error:null,project_error:null,updated_at:nowIso()};
    });
  }

  async recordNativeRejection(rejection){
    const id=requestId(rejection?.request_id);
    return this.#replace(id,existing=>{
      if(!existing||existing.kind!=='NATIVE_CODING'||existing.receipt||existing.progress||existing.project||existing.admitted_task_id)
        throw new Error('client_goal_journal_native_rejection_conflict');
      const verified=normalizeNativeCodingSeedRejection(rejection,{request_id:id,objective:existing.goal});
      if(existing.native_rejection&&!isDeepStrictEqual(existing.native_rejection,verified))throw new Error('client_goal_journal_native_rejection_conflict');
      return {...existing,native_rejection:verified,state:'FAILED',last_error:'native_goal_rejected_before_dispatch',
        project_error:null,updated_at:nowIso()};
    });
  }

  async recordNativeProgress(progress){
    const id=requestId(progress?.request_id);
    return this.#replace(id,existing=>{
      if(!existing||existing.kind!=='NATIVE_CODING'||!existing.receipt)throw new Error('client_goal_journal_native_request_missing');
      return {...existing,progress:clone(progress),state:progress.task_state,last_error:null,project_error:null,updated_at:nowIso()};
    });
  }

  async recordProject(registration) {
    const id = requestId(registration?.request_id);
    const project = normalizeClientProjectRegistration(registration, id);
    return this.#replace(id, existing => {
      if (!existing) throw new Error('client_goal_journal_request_missing');
      const task = existing.receipt?.task_id || (existing.progress?.found === true ? existing.progress.task_id : null);
      if (!task || project.root_task_id !== task) throw new Error('client_goal_journal_project_task_drift');
      if (existing.project && (existing.project.project_id !== project.project_id || existing.project.root_task_id !== project.root_task_id)) {
        throw new Error('client_goal_journal_project_collision');
      }
      return { ...existing, project: existing.project || project, admitted_task_id: task, project_error: null, updated_at: nowIso() };
    });
  }

  async recordProjectError(rawRequestId, error) {
    const id = requestId(rawRequestId);
    return this.#replace(id, existing => {
      if (!existing) throw new Error('client_goal_journal_request_missing');
      return { ...existing, project_error: safeError(error), updated_at: nowIso() };
    });
  }

  async recordExecutionProof(proof) {
    const id = requestId(proof?.request_id);
    if (
      proof?.schema !== 'metaengine.client.goal-execution-proof.v1'
      || proof?.authority_effect !== false
      || proof?.automatic_retry_allowed !== false
    ) throw new Error('client_goal_journal_execution_proof_invalid');
    return this.#replace(id, existing => {
      if (!existing) throw new Error('client_goal_journal_request_missing');
      if (!clientGoalExecutionProofMatchesProgress(proof, existing.progress)) {
        throw new Error('client_goal_journal_execution_proof_progress_drift');
      }
      return {
        ...existing,
        execution_proof: clone(proof),
        useful_work_proof: clientUsefulWorkProofMatchesExecutionProof(existing.useful_work_proof, proof)
          ? existing.useful_work_proof : null,
        updated_at: nowIso(),
        automatic_retry_allowed: false,
        authority_effect: false,
      };
    });
  }

  async recordUsefulWorkProof(proof) {
    const id = requestId(proof?.request_id);
    if (
      proof?.schema !== 'metaengine.client-v1.useful-work-proof.v1'
      || proof?.authority_effect !== false
      || proof?.automatic_retry_allowed !== false
      || proof?.canonical_c2_promotion_authorized !== false
    ) throw new Error('client_goal_journal_useful_work_proof_invalid');
    return this.#replace(id, existing => {
      if (!existing) throw new Error('client_goal_journal_request_missing');
      if (!clientUsefulWorkProofMatchesExecutionProof(proof, existing.execution_proof)) {
        throw new Error('client_goal_journal_useful_work_proof_execution_drift');
      }
      return {
        ...existing,
        useful_work_proof: clone(proof),
        updated_at: nowIso(),
        automatic_retry_allowed: false,
        authority_effect: false,
      };
    });
  }

  async markReconcileRequired(rawRequestId, error = null) {
    const id = requestId(rawRequestId);
    return this.#replace(id, existing => {
      if (!existing) throw new Error('client_goal_journal_request_missing');
      if(existing.native_rejection)return existing;
      return {
        ...existing,
        state: 'RECONCILE_REQUIRED',
        last_error: safeError(error),
        updated_at: nowIso(),
        automatic_retry_allowed: false,
        authority_effect: false,
      };
    });
  }
}

export const CLIENT_GOAL_JOURNAL_SCHEMA = SCHEMA;
