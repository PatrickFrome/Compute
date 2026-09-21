import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

// RSI Operator Steering Wheel — Tier 1 item 3.
//
// The live system exposed 15+ qualified RSI mechanisms as read-only
// observability with no operator control surface: the external confirmation
// flags (external_confirmation_gate / requires_external_promotion_gate)
// existed as contract constants, but nothing let the operator actually
// nominate, pause, or approve. This module is that surface:
//
//   PAUSE    — gate autonomous learning-side flows by scope (v1: credit
//              assignment). Pause never stops observation or execution —
//              commands keep running and episodes keep ingesting; only the
//              learning-side effect (credit → experience case) is held.
//   NOMINATE — operator-authored candidate nomination (the operator IS an
//              external planner; proposeCandidate with a hypothesis).
//   APPROVE  — external confirmation record for a pending decision digest.
//              Approval is an audited operator decision, NOT execution
//              authority: every promotion/admission path still requires its
//              own verified pipeline.
//
// Durable, digest-chained, zero authority. The shell commands (RSI_STATUS /
// RSI_PAUSE / RSI_RESUME / RSI_NOMINATE / RSI_APPROVE) are the operator
// console surface; the state rides the supervisor snapshot for the UI.

export const RSI_OPERATOR_STEERING_STATE_SCHEMA = 'metaengine.rsi.operator-steering-state.v1';

const SHA40_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const SAFE_TOKEN_RE = /^[A-Z0-9][A-Z0-9_.:-]{0,95}$/;
const MAX_DECISIONS = 256;
const SCOPES = Object.freeze(['CREDIT_ASSIGNMENT', 'SKILL_ROUTING', 'LIBRARY_ADMISSION']);
const DECISION_KINDS = Object.freeze(['PROMOTION_NOMINATION', 'SKILL_REVISION', 'LIBRARY_ADMISSION', 'OUTCOME_CREDIT_POLICY']);

function stable(v) { if (Array.isArray(v)) return v.map(stable); if (!v || typeof v !== 'object') return v; return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])])); }
function digest(v) { return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)), 'utf8').digest('hex')}`; }
function exactSha(v, l) { const o = String(v || '').trim().toLowerCase(); if (!SHA40_RE.test(o)) throw new Error(`rsi_steering_${l}_sha_invalid`); return o; }
function exactDigest(v, l) { const o = String(v || '').trim().toLowerCase(); if (!SHA256_RE.test(o)) throw new Error(`rsi_steering_${l}_digest_invalid`); return o; }
function boundedId(v, l) { const o = String(v || '').trim(); if (!SAFE_ID_RE.test(o)) throw new Error(`rsi_steering_${l}_invalid`); return o; }
function token(v, l) { const o = String(v || '').trim().toUpperCase(); if (!SAFE_TOKEN_RE.test(o)) throw new Error(`rsi_steering_${l}_invalid`); return o; }
function scope(v) { const o = token(v, 'scope'); if (!SCOPES.includes(o)) throw new Error('rsi_steering_scope_invalid'); return o; }
function decisionKind(v) { const o = token(v, 'kind'); if (!DECISION_KINDS.includes(o)) throw new Error('rsi_steering_decision_kind_invalid'); return o; }
function iso(v) { const raw = String(v || '').trim(); if (!raw || Number.isNaN(Date.parse(raw))) throw new Error('rsi_steering_timestamp_invalid'); return new Date(raw).toISOString(); }

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

export class RsiOperatorSteering {
  #path;
  #sourceSha;
  #clock;
  #rsi = null;
  #state = null;
  #initialized = false;

  constructor({ statePath, source_sha, clock = () => Date.now() } = {}) {
    if (!statePath || typeof statePath !== 'string') throw new Error('rsi_steering_state_path_required');
    if (typeof clock !== 'function') throw new Error('rsi_steering_clock_required');
    this.#path = path.resolve(statePath);
    this.#sourceSha = exactSha(source_sha, 'source');
    this.#clock = clock;
  }

  attach(rsi) {
    if (!rsi || typeof rsi.proposeCandidate !== 'function') throw new Error('rsi_steering_runtime_service_required');
    this.#rsi = rsi;
    return this;
  }

  #now() { return new Date(Number(this.#clock())).toISOString(); }

  #blank() {
    return {
      schema: RSI_OPERATOR_STEERING_STATE_SCHEMA,
      version: 1,
      source_sha: this.#sourceSha,
      paused: {},
      decisions: [],
      counters: { pause_count: 0, resume_count: 0, nominate_count: 0, approve_count: 0, credit_skipped_paused: 0 },
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
      if (parsed.schema !== RSI_OPERATOR_STEERING_STATE_SCHEMA || parsed.version !== 1 || parsed.source_sha !== this.#sourceSha) throw new Error('rsi_steering_state_invalid');
      if (parsed.authority_effect !== false) throw new Error('rsi_steering_state_invalid');
      if (stateDigest(parsed) !== exactDigest(parsed.state_digest, 'state')) throw new Error('rsi_steering_state_digest_mismatch');
      this.#state = parsed;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      this.#state = this.#blank();
    }
    this.#initialized = true;
    return this.snapshot();
  }

  async #persist() {
    this.#state.state_digest = stateDigest(this.#state);
    const temp = `${this.#path}.tmp`;
    const handle = await fs.open(temp, 'w', 0o600);
    try { await handle.writeFile(`${JSON.stringify(this.#state)}\n`, 'utf8'); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temp, this.#path);
  }

  #assertReady() { if (!this.#initialized) throw new Error('rsi_steering_not_initialized'); }

  async pause({ scope: rawScope, reason = null } = {}) {
    this.#assertReady();
    const s = scope(rawScope);
    this.#state.paused[s] = { reason: String(reason || 'operator directive').slice(0, 240), paused_at: this.#now() };
    this.#state.counters.pause_count += 1;
    await this.#persist();
    return zero({ paused: true, scope: s });
  }

  async resume({ scope: rawScope } = {}) {
    this.#assertReady();
    const s = scope(rawScope);
    const was = Boolean(this.#state.paused[s]);
    delete this.#state.paused[s];
    this.#state.counters.resume_count += 1;
    await this.#persist();
    return zero({ resumed: true, scope: s, was_paused: was });
  }

  // Gate check for autonomous learning-side flows. Missing steering (older
  // wiring, pre-init) fails OPEN only for the undefined-instance case handled
  // by the caller; an initialized steering with a paused scope fails CLOSED.
  allows(rawScope) {
    if (!this.#state) return true;
    return !Object.prototype.hasOwnProperty.call(this.#state.paused, token(rawScope, 'scope'));
  }

  async recordGateSkip(rawScope) {
    this.#assertReady();
    const s = scope(rawScope);
    if (s === 'CREDIT_ASSIGNMENT') this.#state.counters.credit_skipped_paused += 1;
    await this.#persist();
    return zero({ recorded: true, scope: s });
  }

  async nominate({ candidate_id, hypothesis, mutation_surface = 'AGENT_ORCHESTRATION' } = {}) {
    this.#assertReady();
    if (!this.#rsi) throw new Error('rsi_steering_runtime_service_required');
    const candidate = await this.#rsi.proposeCandidate({
      candidate_id: boundedId(candidate_id, 'candidate_id'),
      parent_sha: this.#sourceSha,
      candidate_sha: crypto.createHash('sha1').update(`${this.#sourceSha}:${candidate_id}`, 'utf8').digest('hex'),
      mutation_surface: token(mutation_surface, 'mutation_surface'),
      hypothesis: String(hypothesis || 'operator nomination (no hypothesis provided)').slice(0, 2000),
    });
    this.#state.decisions.push({
      kind: 'CANDIDATE_NOMINATION',
      decision: 'NOMINATE',
      candidate_id: candidate.candidate_id,
      digest: candidate.candidate_digest ? `sha256:${candidate.candidate_digest}` : null,
      note: String(hypothesis || '').slice(0, 240),
      at: this.#now(),
      external_confirmation_gate: true,
      approval_is_execution_authority: false,
    });
    while (this.#state.decisions.length > MAX_DECISIONS) this.#state.decisions.shift();
    this.#state.counters.nominate_count += 1;
    await this.#persist();
    return zero({ nominated: true, candidate_id: candidate.candidate_id, requires_external_promotion_gate: true });
  }

  async approve({ kind, digest: rawDigest, note = null } = {}) {
    this.#assertReady();
    const k = decisionKind(kind);
    const d = exactDigest(rawDigest, 'decision');
    const record = {
      kind: k,
      decision: 'APPROVE',
      digest: d,
      note: String(note || '').slice(0, 240),
      at: this.#now(),
      external_confirmation_gate: true,
      approval_is_execution_authority: false,
    };
    this.#state.decisions.push(record);
    while (this.#state.decisions.length > MAX_DECISIONS) this.#state.decisions.shift();
    this.#state.counters.approve_count += 1;
    await this.#persist();
    return zero({ approved: true, kind: k, digest: d, approval_is_execution_authority: false });
  }

  snapshot() {
    if (!this.#state) {
      return Object.freeze({ schema: RSI_OPERATOR_STEERING_STATE_SCHEMA, version: 1, state: 'CREATED', source_sha: this.#sourceSha, authority_effect: false });
    }
    return Object.freeze({
      schema: RSI_OPERATOR_STEERING_STATE_SCHEMA,
      version: 1,
      state: this.#initialized ? 'READY' : 'CREATED',
      source_sha: this.#sourceSha,
      scopes: [...SCOPES],
      paused_scopes: Object.freeze(Object.keys(this.#state.paused)),
      paused: Object.freeze(structuredClone(this.#state.paused)),
      decision_count: this.#state.decisions.length,
      recent_decisions: Object.freeze(structuredClone(this.#state.decisions.slice(-8))),
      counters: Object.freeze({ ...this.#state.counters }),
      approval_is_execution_authority: false,
      pause_gates_execution: false,
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

export function rsiOperatorSteeringTrustRootSnapshot() {
  const root = {
    schema: 'metaengine.rsi.operator-steering-root.v1',
    version: 1,
    policy_path: 'apps/metaengine-browser/src/rsi-operator-steering.mjs',
    scopes: [...SCOPES],
    decision_kinds: [...DECISION_KINDS],
    pause_gates_execution: false,
    pause_gates_learning_side_effects_only: true,
    approval_is_execution_authority: false,
    operator_nomination_is_external_planner: true,
    decisions_append_only: true,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...root, steering_root_digest: digest(root) });
}
