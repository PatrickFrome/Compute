import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

// Outcome River — Tier 1 break repair #2 (action→learning).
//
// The live system executed 1521 DB-queued supervisor commands with terminal
// receipt readbacks, yet the RSI command-attribution registry held
// binding_count=0 and the experience store held case_count=0: the outcome
// ingest pipeline was a passive sidecar with no producer. This module is the
// missing external planner bridge:
//
//   issuer declares task context on a queued command (payload.rsi_task)
//     → river registers the task anchor (durable)
//     → river binds command_id → candidate + trajectory BEFORE execution
//     → command executes; receipt is stored server-side; readback verified
//     → ingest resolves + consumes the binding (candidate-bound episode)
//     → river assigns EXTERNAL step credit against the task anchor
//     → experience case materializes (1 attributed command = 1 case)
//
// Zero-authority contract: the river never gates execution (bind failures are
// recorded, not thrown to the executor), never re-executes, never assigns
// candidate-authored credit, and stores digests/ids only — no raw payloads,
// page text, or user input.

export const RSI_OUTCOME_RIVER_STATE_SCHEMA = 'metaengine.rsi.outcome-river-state.v1';
export const RSI_COMMAND_TASK_CONTEXT_SCHEMA = 'metaengine.rsi.command-task-context.v1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const SAFE_TOKEN_RE = /^[A-Z0-9][A-Z0-9_.:-]{0,95}$/;
const AGENT_ID_RE = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_COMMANDS = 8192;
const MAX_ANCHORS = 4096;
const MAX_ERRORS = 8;
const TRAJECTORY_WINDOW = 15;

function stable(v) { if (Array.isArray(v)) return v.map(stable); if (!v || typeof v !== 'object') return v; return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])])); }
function digest(v) { return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)), 'utf8').digest('hex')}`; }
function sha1(v) { return crypto.createHash('sha1').update(String(v), 'utf8').digest('hex'); }
function exactSha(v, l) { const o = String(v || '').trim().toLowerCase(); if (!SHA40_RE.test(o)) throw new Error(`rsi_outcome_river_${l}_sha_invalid`); return o; }
function exactDigest(v, l) { const o = String(v || '').trim().toLowerCase(); if (!SHA256_RE.test(o)) throw new Error(`rsi_outcome_river_${l}_digest_invalid`); return o; }
function boundedId(v, l) { const o = String(v || '').trim(); if (!SAFE_ID_RE.test(o)) throw new Error(`rsi_outcome_river_${l}_invalid`); return o; }
function token(v, l) { const o = String(v || '').trim().toUpperCase(); if (!SAFE_TOKEN_RE.test(o)) throw new Error(`rsi_outcome_river_${l}_invalid`); return o; }
function agentId(v, l) { const o = String(v || '').trim().toLowerCase(); if (!AGENT_ID_RE.test(o)) throw new Error(`rsi_outcome_river_${l}_invalid`); return o; }
function iso(v, l) { const raw = String(v || '').trim(); if (!raw || Number.isNaN(Date.parse(raw))) throw new Error(`rsi_outcome_river_${l}_invalid`); return new Date(raw).toISOString(); }

// Issuer contract: any queued-command issuer (brain, daemon, agent toolbelt)
// declares that a command executes on behalf of a task trajectory by embedding
// this object in the command payload. Everything except task_id is optional;
// missing digests are derived deterministically so the same context always
// produces the same anchor (idempotent rebind across restarts).
export function extractRsiCommandTaskContext(command) {
  const raw = command?.payload?.rsi_task;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (String(raw.schema || '') !== RSI_COMMAND_TASK_CONTEXT_SCHEMA) return null;
  let taskId;
  try { taskId = boundedId(raw.task_id, 'task_id'); } catch { return null; }
  if (!taskId) return null;
  let signature = null;
  if (raw.task_signature_digest != null) {
    try { signature = exactDigest(raw.task_signature_digest, 'task_signature'); } catch { return null; }
  }
  let hidden = null;
  if (raw.hidden_manifest_digest != null) {
    try { hidden = exactDigest(raw.hidden_manifest_digest, 'hidden_manifest'); } catch { return null; }
  }
  let challenge = null;
  if (raw.challenge_family != null) {
    try { challenge = token(raw.challenge_family, 'challenge_family'); } catch { return null; }
  }
  let agent = null;
  if (raw.agent_id != null && raw.agent_id !== '') {
    try { agent = agentId(raw.agent_id, 'agent_id'); } catch { return null; }
  }
  return Object.freeze({
    task_id: taskId,
    task_signature_digest: signature || digest({ rsi_task: taskId, agent_id: agent || null }),
    challenge_family: challenge || 'DEVOS_FLEET_TASK',
    hidden_manifest_digest: hidden || digest({ rsi_hidden_manifest: taskId }),
    agent_id: agent,
  });
}

function anchorFromContext(ctx, registeredAt) {
  return Object.freeze({
    task_id: ctx.task_id,
    task_signature_digest: ctx.task_signature_digest,
    challenge_family: ctx.challenge_family,
    hidden_manifest_digest: ctx.hidden_manifest_digest,
    registered_at: registeredAt,
    external_writer: true,
    authored_by_candidate: false,
  });
}

function anchorsEqual(a, b) {
  return a.task_id === b.task_id
    && a.task_signature_digest === b.task_signature_digest
    && a.challenge_family === b.challenge_family
    && a.hidden_manifest_digest === b.hidden_manifest_digest;
}

function zero(extra = {}) {
  return Object.freeze({
    ...extra,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

function stateDigest(state) {
  const clone = structuredClone(state);
  delete clone.state_digest;
  return digest(clone);
}

export class RsiOutcomeRiver {
  #path;
  #sourceSha;
  #clock;
  #rsi = null;
  #state = null;
  #initialized = false;
  #proposedCandidates = new Set();

  constructor({ statePath, source_sha, clock = () => Date.now() } = {}) {
    if (!statePath || typeof statePath !== 'string') throw new Error('rsi_outcome_river_state_path_required');
    if (typeof clock !== 'function') throw new Error('rsi_outcome_river_clock_required');
    this.#path = path.resolve(statePath);
    this.#sourceSha = exactSha(source_sha, 'source');
    this.#clock = clock;
  }

  attach(rsi) {
    if (!rsi || typeof rsi.bindBrowserCommandAttribution !== 'function' || typeof rsi.recordBrowserStepCredit !== 'function' || typeof rsi.proposeCandidate !== 'function') {
      throw new Error('rsi_outcome_river_runtime_service_required');
    }
    this.#rsi = rsi;
    return this;
  }

  #now() { return new Date(Number(this.#clock())).toISOString(); }

  #blank() {
    return {
      schema: RSI_OUTCOME_RIVER_STATE_SCHEMA,
      version: 1,
      source_sha: this.#sourceSha,
      anchors: {},
      trajectories: {},
      commands: {},
      counters: { bound_count: 0, duplicate_bind_count: 0, bind_error_count: 0, credit_attempt_count: 0, credit_success_count: 0, case_materialized_count: 0, credit_error_count: 0 },
      last_errors: [],
      execution_authority: false,
      production_mutation_authority: false,
      promotion_authority: false,
      self_update_authority: false,
      scheduler_authority: false,
      automatic_retry_allowed: false,
      authority_effect: false,
    };
  }

  async init() {
    if (this.#initialized) return this.snapshot();
    await fs.mkdir(path.dirname(this.#path), { recursive: true });
    try {
      const parsed = JSON.parse(await fs.readFile(this.#path, 'utf8'));
      if (parsed.schema !== RSI_OUTCOME_RIVER_STATE_SCHEMA || parsed.version !== 1 || parsed.source_sha !== this.#sourceSha) throw new Error('rsi_outcome_river_state_invalid');
      if (parsed.authority_effect !== false) throw new Error('rsi_outcome_river_state_invalid');
      if (stateDigest(parsed) !== exactDigest(parsed.state_digest, 'state')) throw new Error('rsi_outcome_river_state_digest_mismatch');
      if (Object.keys(parsed.commands || {}).length > MAX_COMMANDS) throw new Error('rsi_outcome_river_state_capacity_exceeded');
      this.#state = parsed;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      this.#state = this.#blank();
    }
    this.#initialized = true;
    return this.snapshot();
  }

  #assertReady() {
    if (!this.#initialized) throw new Error('rsi_outcome_river_not_initialized');
  }

  async #persist() {
    this.#state.state_digest = stateDigest(this.#state);
    const temp = `${this.#path}.tmp`;
    const handle = await fs.open(temp, 'w', 0o600);
    try { await handle.writeFile(`${JSON.stringify(this.#state)}\n`, 'utf8'); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temp, this.#path);
  }

  #recordError(op, error) {
    this.#state.last_errors.push({ at: this.#now(), op, reason: String(error?.message || error).slice(0, 240) });
    while (this.#state.last_errors.length > MAX_ERRORS) this.#state.last_errors.shift();
  }

  async #registerAnchor(ctx) {
    const anchor = anchorFromContext(ctx, this.#now());
    const existing = this.#state.anchors[anchor.task_id];
    if (existing) {
      const prior = { task_id: existing.task_id, task_signature_digest: existing.task_signature_digest, challenge_family: existing.challenge_family, hidden_manifest_digest: existing.hidden_manifest_digest };
      if (!anchorsEqual(prior, anchor)) throw new Error('rsi_outcome_river_task_anchor_conflict');
      return existing;
    }
    if (Object.keys(this.#state.anchors).length >= MAX_ANCHORS) throw new Error('rsi_outcome_river_anchor_capacity_exceeded');
    this.#state.anchors[anchor.task_id] = { ...anchor, command_count: 0, case_count: 0 };
    return this.#state.anchors[anchor.task_id];
  }

  async #ensureCandidate(ctx) {
    if (!this.#rsi) throw new Error('rsi_outcome_river_runtime_service_required');
    const candidateId = ctx.agent_id ? `agent.${ctx.agent_id}` : 'supervisor.policy';
    if (!this.#proposedCandidates.has(candidateId)) {
      const candidateSha = sha1(`${this.#sourceSha}:${candidateId}`);
      try {
        await this.#rsi.proposeCandidate({
          candidate_id: candidateId,
          parent_sha: this.#sourceSha,
          candidate_sha: candidateSha,
          mutation_surface: 'AGENT_ORCHESTRATION',
          hypothesis: ctx.agent_id
            ? `Fleet agent policy under outcome-credit evaluation: ${ctx.agent_id} executing task trajectories in the browser supervisor plane.`
            : 'Supervisor command policy under outcome-credit evaluation for task-attributed queued commands.',
        });
      } catch (error) {
        // Same-process re-propose is the only benign duplicate; anything else
        // must surface (candidate store is per-process, so cross-restart
        // re-proposal is the expected path and always succeeds here).
        if (String(error?.message || '') !== 'rsi_candidate_already_exists') throw error;
      }
      this.#proposedCandidates.add(candidateId);
    }
    return candidateId;
  }

  // Pre-execution binding of a DB-queued command that carries task context.
  // NEVER throws to the caller: a bind failure is recorded and the command
  // executes unattributed (learning must never gate execution).
  async bindLeasedCommand(command, { environment_fingerprint = 'metaengine-browser', default_model_family = 'NATIVE_SUPERVISOR' } = {}) {
    try {
      this.#assertReady();
      const commandId = String(command?.command_id || '').trim().toLowerCase();
      if (!commandId || !UUID_RE.test(commandId)) return zero({ bound: false, reason: 'NOT_QUEUED_COMMAND' });
      const prior = this.#state.commands[commandId];
      if (prior) { this.#state.counters.duplicate_bind_count += 1; return zero({ bound: true, duplicate: true, task_id: prior.task_id, step_index: prior.step_index }); }
      const ctx = extractRsiCommandTaskContext(command);
      if (!ctx) return zero({ bound: false, reason: 'NO_TASK_CONTEXT' });
      await this.#registerAnchor(ctx);
      const candidateId = await this.#ensureCandidate(ctx);
      const trajectory = this.#state.trajectories[ctx.task_id] || { last_step_index: 0, bound_command_count: 0, last_bound_at: null };
      const stepIndex = Math.min(trajectory.last_step_index + 1, 10000);
      const stepCount = Math.min(stepIndex + TRAJECTORY_WINDOW, 10000);
      const proposalDigest = digest({ rsi_proposal: ctx.task_id, task_signature: ctx.task_signature_digest, candidate_id: candidateId, environment_fingerprint });
      const binding = await this.#rsi.bindBrowserCommandAttribution({
        command_id: commandId,
        action: String(command?.action || '').trim().toUpperCase(),
        platform: command?.platform == null ? null : String(command.platform).trim().toUpperCase(),
        effect_key: command?.effect_key == null ? null : String(command.effect_key).trim(),
        task_id: ctx.task_id,
        task_signature_digest: ctx.task_signature_digest,
        environment_fingerprint,
        model_family: ctx.agent_id ? 'GLM_ZAI' : default_model_family,
        candidate_id: candidateId,
        proposal_digest: proposalDigest,
        skill_digests: [],
        trajectory_id: `trajectory.${ctx.task_id}`,
        step_index: stepIndex,
        step_count: stepCount,
        predecessor_episode_digest: trajectory.last_episode_digest || null,
        external_planner: true,
        authored_by_candidate: false,
      });
      trajectory.last_step_index = stepIndex;
      trajectory.bound_command_count += 1;
      trajectory.last_bound_at = this.#now();
      this.#state.trajectories[ctx.task_id] = trajectory;
      this.#state.commands[commandId] = {
        task_id: ctx.task_id,
        step_index: stepIndex,
        action: binding.action,
        agent_id: ctx.agent_id,
        bound_at: this.#now(),
        credited: false,
        credit_state: null,
      };
      this.#state.anchors[ctx.task_id].command_count += 1;
      if (Object.keys(this.#state.commands).length > MAX_COMMANDS) {
        // Bounded retention: drop the oldest credited entries first.
        const credited = Object.entries(this.#state.commands).filter(([, row]) => row.credited === true).sort((a, b) => String(a[1].bound_at).localeCompare(String(b[1].bound_at)));
        for (let i = 0; i < credited.length && Object.keys(this.#state.commands).length > MAX_COMMANDS; i += 1) delete this.#state.commands[credited[i][0]];
        if (Object.keys(this.#state.commands).length > MAX_COMMANDS) throw new Error('rsi_outcome_river_command_capacity_exceeded');
      }
      this.#state.counters.bound_count += 1;
      await this.#persist();
      return zero({ bound: true, duplicate: false, task_id: ctx.task_id, step_index: stepIndex, candidate_id: binding.candidate_id });
    } catch (error) {
      this.#state.counters.bind_error_count += 1;
      this.#recordError('bind', error);
      try { await this.#persist(); } catch {}
      return zero({ bound: false, reason: String(error?.message || error).slice(0, 240) });
    }
  }

  // Post-ingest credit assignment for a candidate-bound episode whose command
  // the river bound. NEVER throws to the caller.
  async creditIngestedEpisode(episode, { environment_fingerprint = 'metaengine-browser' } = {}) {
    try {
      this.#assertReady();
      if (!episode || typeof episode !== 'object' || episode.eligible_for_credit_assignment !== true) return zero({ credited: false, reason: 'EPISODE_NOT_CREDIT_ELIGIBLE' });
      const entry = this.#state.commands[String(episode.command_id || '').toLowerCase()];
      if (!entry) return zero({ credited: false, reason: 'COMMAND_NOT_RIVER_BOUND' });
      if (entry.credited) return zero({ credited: true, duplicate: true, credit_state: entry.credit_state });
      const anchor = this.#state.anchors[episode.task_id];
      if (!anchor) return zero({ credited: false, reason: 'TASK_ANCHOR_MISSING' });
      const failed = String(episode.terminal_status || '').toUpperCase() === 'FAILED';
      const creditSign = failed ? 'NEGATIVE' : 'POSITIVE';
      const failureCode = token(episode.effect_outcome || 'COMMAND_FAILED', 'failure_code');
      const evaluatorDigest = digest({ rsi_outcome_river_evaluator: this.#sourceSha, policy: 'DEVOS_TASK_OUTCOME_V1' });
      const evaluationDigest = digest({
        episode_digest: episode.episode_digest,
        outcome_state: episode.outcome_state,
        task_id: episode.task_id,
        step_index: entry.step_index,
        environment_fingerprint,
      });
      this.#state.counters.credit_attempt_count += 1;
      const credited = await this.#rsi.recordBrowserStepCredit({
        episode,
        task_anchor: {
          task_id: anchor.task_id,
          task_signature_digest: anchor.task_signature_digest,
          challenge_family: anchor.challenge_family,
          hidden_manifest_digest: anchor.hidden_manifest_digest,
          external_writer: true,
          authored_by_candidate: false,
        },
        credit_id: `credit.${episode.command_id}`,
        credit_sign: creditSign,
        credit_score: failed ? -0.5 : 0.5,
        method: 'EXTERNAL_STEP_EVALUATOR',
        evaluator_digest: evaluatorDigest,
        evaluation_digest: evaluationDigest,
        failure_codes: failed ? [failureCode] : [],
        lesson_digests: [],
        evidence_refs: [
          `episode:${episode.episode_digest}`,
          `receipt:${episode.receipt_digest}`,
          `task:${episode.task_id}`,
        ],
        external_credit_assigner: true,
        authored_by_candidate: false,
      });
      entry.credited = true;
      entry.credit_state = credited.stored?.state || 'UNKNOWN';
      const trajectory = this.#state.trajectories[episode.task_id];
      if (trajectory) trajectory.last_episode_digest = episode.episode_digest;
      if (credited.stored?.appended === true) {
        this.#state.counters.case_materialized_count += 1;
        anchor.case_count += 1;
      }
      this.#state.counters.credit_success_count += 1;
      await this.#persist();
      return zero({ credited: true, duplicate: false, credit_state: entry.credit_state, case_appended: credited.stored?.appended === true, outcome: credited.materialization?.case_row?.outcome || null });
    } catch (error) {
      this.#state.counters.credit_error_count += 1;
      this.#recordError('credit', error);
      try { await this.#persist(); } catch {}
      return zero({ credited: false, reason: String(error?.message || error).slice(0, 240) });
    }
  }

  // Register a task anchor from an out-of-band planner (e.g. the DevOS cycle
  // registering every leased task so later task-attributed commands anchor).
  async registerTaskAnchor(input = {}) {
    this.#assertReady();
    const ctx = {
      task_id: boundedId(input.task_id, 'task_id'),
      task_signature_digest: input.task_signature_digest == null ? digest({ rsi_task: input.task_id, agent_id: null }) : exactDigest(input.task_signature_digest, 'task_signature'),
      challenge_family: input.challenge_family == null ? 'DEVOS_FLEET_TASK' : token(input.challenge_family, 'challenge_family'),
      hidden_manifest_digest: input.hidden_manifest_digest == null ? digest({ rsi_hidden_manifest: input.task_id }) : exactDigest(input.hidden_manifest_digest, 'hidden_manifest'),
      agent_id: null,
    };
    await this.#registerAnchor(ctx);
    await this.#persist();
    return zero({ registered: true, task_id: ctx.task_id });
  }

  hasCommand(commandId) {
    return Object.prototype.hasOwnProperty.call(this.#state?.commands || {}, String(commandId || '').toLowerCase());
  }

  snapshot() {
    if (!this.#state) {
      return Object.freeze({ schema: RSI_OUTCOME_RIVER_STATE_SCHEMA, version: 1, state: 'CREATED', source_sha: this.#sourceSha, authority_effect: false });
    }
    const anchors = Object.values(this.#state.anchors);
    const commands = Object.values(this.#state.commands);
    return Object.freeze({
      schema: RSI_OUTCOME_RIVER_STATE_SCHEMA,
      version: 1,
      state: this.#initialized ? 'READY' : 'CREATED',
      source_sha: this.#sourceSha,
      task_anchor_count: anchors.length,
      trajectory_count: Object.keys(this.#state.trajectories).length,
      bound_command_count: commands.length,
      credited_command_count: commands.filter((row) => row.credited === true).length,
      case_materialized_count: this.#state.counters.case_materialized_count,
      counters: Object.freeze({ ...this.#state.counters }),
      last_errors: Object.freeze([...this.#state.last_errors]),
      task_ids: Object.freeze(anchors.slice(0, 32).map((row) => row.task_id)),
      issuer_contract: RSI_COMMAND_TASK_CONTEXT_SCHEMA,
      bind_gates_execution: false,
      execution_authority: false,
      production_mutation_authority: false,
      promotion_authority: false,
      self_update_authority: false,
      scheduler_authority: false,
      automatic_retry_allowed: false,
      authority_effect: false,
    });
  }
}

export function rsiOutcomeRiverTrustRootSnapshot() {
  const root = {
    schema: 'metaengine.rsi.outcome-river-root.v1',
    version: 1,
    policy_path: 'apps/metaengine-browser/src/rsi-outcome-river.mjs',
    issuer_task_context_required: true,
    bind_before_execution_required: true,
    bind_failure_never_gates_execution: true,
    external_planner_only: true,
    candidate_authored_credit_forbidden: true,
    one_attributed_command_one_experience_case: true,
    digests_and_ids_only: true,
    raw_command_payload_stored: false,
    raw_page_text_stored: false,
    raw_user_input_stored: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...root, outcome_river_root_digest: digest(root) });
}
