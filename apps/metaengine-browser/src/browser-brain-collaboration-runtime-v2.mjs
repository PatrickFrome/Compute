import { BrowserBrainCollaborationFabric } from './browser-brain-collaboration-fabric.mjs';
import { BrowserBrainCollaborationJournal } from './browser-brain-collaboration-journal.mjs';
import { BrowserBrainEpisodicMemory } from './browser-brain-episodic-memory.mjs';
import { BrowserBrainRoutingV2, planAdaptiveSparseFanout } from './browser-brain-routing-v2.mjs';
import { BrowserBrainStallDetector } from './browser-brain-stall-detector.mjs';
import { BrowserBrainA2AAdapter } from './browser-brain-a2a-adapter.mjs';

export const BROWSER_BRAIN_COLLABORATION_RUNTIME_V2_SCHEMA = 'metaengine.browser-brain.collaboration-runtime.v2';
const TERMINAL = new Set(['COMPLETED', 'CANCELLED']);

export class BrowserBrainCollaborationRuntimeV2 {
  #clock; #fabric; #journal; #memory; #routing; #stall; #a2a; #loadState; #saveState; #persistChain = Promise.resolve(); #lastPersistError = null;
  constructor({ clock = () => Date.now(), fabric = null, journal = null, memory = null, routing = null, stallDetector = null, a2aAdapter = null, loadState = null, saveState = null } = {}) {
    this.#clock = clock;
    this.#fabric = fabric || new BrowserBrainCollaborationFabric({ clock });
    this.#journal = journal || new BrowserBrainCollaborationJournal({ clock });
    this.#memory = memory || new BrowserBrainEpisodicMemory({ clock });
    this.#routing = routing || new BrowserBrainRoutingV2();
    this.#stall = stallDetector || new BrowserBrainStallDetector();
    this.#a2a = a2aAdapter || new BrowserBrainA2AAdapter();
    this.#loadState = loadState;
    this.#saveState = saveState;
    if (loadState != null && typeof loadState !== 'function') throw new Error('browser_brain_collaboration_runtime_load_invalid');
    if (saveState != null && typeof saveState !== 'function') throw new Error('browser_brain_collaboration_runtime_save_invalid');
  }

  async init() {
    if (this.#loadState) {
      const checkpoint = await this.#loadState();
      if (checkpoint) {
        this.#journal.restore(checkpoint);
        this.#fabric = new BrowserBrainCollaborationFabric({ clock: this.#clock });
        this.#journal.replayInto(this.#fabric);
        this.#rebuildEpisodesFromJournal();
      }
    }
    return this.snapshot();
  }
  #persistSoon() {
    if (!this.#saveState) return;
    const checkpoint = this.#journal.checkpoint();
    this.#persistChain = this.#persistChain.then(() => this.#saveState(checkpoint)).then(() => { this.#lastPersistError = null; }).catch((error) => { this.#lastPersistError = String(error?.message || error).slice(0, 240); });
  }
  async flush() { await this.#persistChain; return Object.freeze({ ok: this.#lastPersistError == null, error: this.#lastPersistError, authority_effect: false }); }
  checkpoint() { return this.#journal.checkpoint(); }
  restore(checkpoint) {
    this.#journal.restore(checkpoint);
    this.#fabric = new BrowserBrainCollaborationFabric({ clock: this.#clock });
    const replay = this.#journal.replayInto(this.#fabric);
    this.#rebuildEpisodesFromJournal();
    return Object.freeze({ ...replay, checkpoint_restored: true, episodic_memory_rebuilt: true, authority_effect: false });
  }

  recordTask(payload) { const result = this.#fabric.recordTask(payload); this.#journal.append('TASK_RECORDED', payload); this.#persistSoon(); return result; }
  advanceTask(payload) {
    const result = this.#fabric.advanceTask(payload);
    this.#journal.append('TASK_ADVANCED', payload);
    if (TERMINAL.has(result.status)) this.#recordTerminalEpisode(result);
    this.#persistSoon();
    return result;
  }
  #rebuildEpisodesFromJournal() {
    const terminal = this.#journal.entries({ kinds: ['TASK_ADVANCED'] }).filter((row) => TERMINAL.has(String(row.payload?.status || '').toUpperCase()));
    for (const row of terminal) {
      const taskCreate = this.#journal.entries({ task_id: row.payload.task_id, kinds: ['TASK_RECORDED'] })[0];
      if (!taskCreate?.payload?.context_id) continue;
      const task = this.#fabric.taskLedger(taskCreate.payload.context_id).tasks.find((candidate) => candidate.task_id === row.payload.task_id);
      if (task) this.#recordTerminalEpisode(task);
    }
  }
  #recordTerminalEpisode(task) {
    const ledger = this.#fabric.taskLedger(task.context_id);
    const row = ledger.tasks.find((candidate) => candidate.task_id === task.task_id);
    if (!row) return null;
    const provenance = this.#journal.provenanceForTask(task.task_id);
    return this.#memory.recordEpisode({
      episode_id: `episode:${task.task_id}:${task.progress_revision}`,
      context_id: task.context_id,
      task_id: task.task_id,
      objective: task.objective,
      outcome: task.status,
      required_capabilities: row.required_capabilities,
      artifact_refs: provenance.artifact_refs,
      evidence_refs: provenance.evidence_refs,
      verified_facts: provenance.verified_facts,
      rejected_paths: provenance.rejected_paths,
      next_actions: provenance.next_actions,
      base_sha: provenance.base_sha,
      branch: provenance.branch,
    });
  }
  recordMessage(payload) { const result = this.#fabric.recordMessage(payload); if (result.duplicate !== true) { this.#journal.append('MESSAGE_RECORDED', payload); this.#persistSoon(); } return result; }
  recordArtifact(payload) { const result = this.#fabric.recordArtifact(payload); if (result.duplicate !== true) { this.#journal.append('ARTIFACT_RECORDED', payload); this.#persistSoon(); } return result; }
  claimWork(payload) { const result = this.#fabric.claimWork(payload); if (result.claimed === true && result.duplicate !== true) { this.#journal.append('CLAIM_RECORDED', payload); this.#persistSoon(); } return result; }
  releaseClaim(claimId, reason) { const result = this.#fabric.releaseClaim(claimId, reason); if (result.released === true) { this.#journal.append('CLAIM_RELEASED', { claim_id: claimId, reason }); this.#persistSoon(); } return result; }
  recordHandoff(payload) { const result = this.#fabric.recordHandoff(payload); if (result.duplicate !== true) { this.#journal.append('HANDOFF_RECORDED', payload); this.#persistSoon(); } return result; }
  taskLedger(contextId) { return this.#fabric.taskLedger(contextId); }
  progressLedger(contextId) { return this.#fabric.progressLedger(contextId); }
  decideAutonomousContinuation(query) {
    const base = this.#fabric.decideAutonomousContinuation(query);
    const taskLedger = this.#fabric.taskLedger(query.context_id);
    const progressLedger = this.#fabric.progressLedger(query.context_id);
    const stall = this.#stall.observe({ context_id: query.context_id, task_ledger: taskLedger, progress_ledger: progressLedger });
    if (stall.stalled && !['DISCOVER_NEXT_OBJECTIVE', 'DISCOVER_USEFUL_WORK'].includes(base.action)) {
      return Object.freeze({ ...base, action: 'REPLAN_STALLED_CONTEXT', reason: 'NO_MEANINGFUL_PROGRESS_DELTA', stall, continue_autonomously: true, user_confirmation_required: false, external_prompt_required: false, idle_wait_allowed: false, automatic_destructive_retry_allowed: false, authority_effect: false });
    }
    return Object.freeze({ ...base, stall });
  }

  observeRoutingAgent(profile) { return this.#routing.observeAgent(profile); }
  routeAgentsV2(query) { return this.#routing.route(query); }
  planFanout(query) { return planAdaptiveSparseFanout(query); }
  retrieveMemory(query) { return this.#memory.retrieve(query); }
  semanticFacts() { return this.#memory.semanticFacts(); }
  playbooks() { return this.#memory.playbooks(); }
  recordEpisode(episode) { return this.#memory.recordEpisode(episode); }
  a2aTask(input) { return this.#a2a.toA2ATask(input); }
  a2aIngressMessage(message, options) { return this.#a2a.fromA2AMessage(message, options); }
  a2aIngressTask(task) { return this.#a2a.fromA2ATask(task); }

  snapshot() {
    const base = this.#fabric.snapshot();
    return Object.freeze({
      ...base,
      schema: BROWSER_BRAIN_COLLABORATION_RUNTIME_V2_SCHEMA,
      collaboration_fabric_schema: base.schema,
      journal: this.#journal.snapshot(),
      episodic_memory: this.#memory.snapshot(),
      routing_v2: this.#routing.snapshot(),
      stall_detector: this.#stall.snapshot(),
      a2a_adapter: this.#a2a.snapshot(),
      durable_persistence_bound: this.#loadState != null || this.#saveState != null,
      last_persist_error: this.#lastPersistError,
      terminal_task_to_episode: true,
      hybrid_retrieval: true,
      semantic_procedural_consolidation: true,
      routing_v2_enabled: true,
      adaptive_sparse_fanout: true,
      a2a_boundary_only: true,
      continuous_autonomous_work: true,
      external_confirmation_gate: false,
      idle_wait_allowed: false,
      work_cycle_limit: null,
      second_scheduler: false,
      hidden_queue: false,
      command_leasing: false,
      scheduler_authority: false,
      execution_authority: false,
      authority_effect: false,
    });
  }
}
