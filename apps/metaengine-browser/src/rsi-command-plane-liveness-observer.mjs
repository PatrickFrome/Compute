import crypto from 'node:crypto';

import { RSI_SHADOW_OPPORTUNITY_SCHEMA } from './rsi-shadow-observer.mjs';

export const RSI_COMMAND_PLANE_LIVENESS_INPUT_SCHEMA = 'metaengine.rsi.command-plane-liveness-input.v1';
export const RSI_COMMAND_PLANE_LIVENESS_OBSERVATION_SCHEMA = 'metaengine.rsi.command-plane-liveness-observation.v1';

const SHA40_RE = /^[0-9a-f]{40}$/i;
const ACTIVE_COMMAND_STATES = new Set(['LEASED', 'RUNNING', 'RESULT_DELIVERY']);

function text(value, max = 240) {
  return value == null ? null : String(value).trim().slice(0, max);
}

function exactSha(value) {
  const normalized = text(value, 40)?.toLowerCase();
  if (!normalized || !SHA40_RE.test(normalized)) throw new Error('rsi_liveness_exact_source_sha_required');
  return normalized;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function sha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex');
}

function boundedMs(value, fallback, name) {
  const normalized = value == null ? fallback : Number(value);
  if (!Number.isFinite(normalized) || normalized < 1_000 || normalized > 3_600_000) {
    throw new Error(`rsi_liveness_${name}_invalid`);
  }
  return Math.trunc(normalized);
}

function timestampMs(value, name) {
  const parsed = Date.parse(String(value || ''));
  if (!Number.isFinite(parsed)) throw new Error(`rsi_liveness_${name}_invalid`);
  return parsed;
}

function ageMs(observedAtMs, value, name) {
  if (value == null) return null;
  const eventMs = timestampMs(value, name);
  if (eventMs > observedAtMs + 1_000) throw new Error(`rsi_liveness_${name}_future_timestamp`);
  return Math.max(0, observedAtMs - eventMs);
}

function nonNegativeInt(value, name) {
  const normalized = Number(value ?? 0);
  if (!Number.isInteger(normalized) || normalized < 0) throw new Error(`rsi_liveness_${name}_invalid`);
  return normalized;
}

function assertZeroAuthority(snapshot) {
  for (const flag of ['execution_authority', 'production_mutation_authority', 'authority_effect']) {
    if (snapshot?.[flag] !== false) throw new Error(`rsi_liveness_${flag}_invalid`);
  }
  if (snapshot?.automatic_retry_allowed !== false) throw new Error('rsi_liveness_automatic_retry_invalid');
}

function assertSanitized(snapshot) {
  const flags = ['command_payload_exposed', 'page_text_exposed', 'input_values_exposed', 'raw_network_exposed'];
  for (const flag of flags) {
    if (snapshot?.[flag] !== false) throw new Error(`rsi_liveness_${flag}_invalid`);
  }
}

function opportunity({ sourceSha, signal, rationale, evidence }) {
  const material = {
    schema: RSI_SHADOW_OPPORTUNITY_SCHEMA,
    source_sha: sourceSha,
    signal,
    mutation_surface: 'BROWSER_RUNTIME',
    priority: 'P0',
    rationale,
    evidence,
    page_text_exposed: false,
    input_values_exposed: false,
    command_payload_exposed: false,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({
    ...material,
    opportunity_id: `opp:${sha256(material).slice(0, 24)}`,
  });
}

function activeCommandProjection(activeCommand, observedAtMs) {
  if (activeCommand == null) return null;
  const status = text(activeCommand.status, 48)?.toUpperCase();
  if (!status) throw new Error('rsi_liveness_active_command_status_required');
  const commandId = text(activeCommand.command_id, 128);
  if (!commandId) throw new Error('rsi_liveness_active_command_id_required');
  const leasedAgeMs = ageMs(observedAtMs, activeCommand.leased_at, 'leased_at');
  const effectBoundAgeMs = ageMs(observedAtMs, activeCommand.effect_bound_at, 'effect_bound_at');
  const receiptAgeMs = ageMs(observedAtMs, activeCommand.receipt_recorded_at, 'receipt_recorded_at');
  return Object.freeze({
    command_id: commandId,
    action: text(activeCommand.action, 64)?.toUpperCase() || 'UNKNOWN',
    command_lane: text(activeCommand.command_lane, 64)?.toUpperCase() || 'UNKNOWN',
    status,
    leased_age_ms: leasedAgeMs,
    effect_bound_age_ms: effectBoundAgeMs,
    receipt_age_ms: receiptAgeMs,
    effect_bound: effectBoundAgeMs != null,
    receipt_recorded: receiptAgeMs != null,
  });
}

export class RsiCommandPlaneLivenessObserver {
  #sourceSha;
  #clock;
  #heartbeatFreshMs;
  #perceptionFreshMs;
  #commandStallMs;

  constructor({
    source_sha,
    clock = () => Date.now(),
    heartbeat_fresh_ms = 15_000,
    perception_fresh_ms = 15_000,
    command_stall_ms = 120_000,
  } = {}) {
    this.#sourceSha = exactSha(source_sha);
    if (typeof clock !== 'function') throw new Error('rsi_liveness_clock_required');
    this.#clock = clock;
    this.#heartbeatFreshMs = boundedMs(heartbeat_fresh_ms, 15_000, 'heartbeat_fresh_ms');
    this.#perceptionFreshMs = boundedMs(perception_fresh_ms, 15_000, 'perception_fresh_ms');
    this.#commandStallMs = boundedMs(command_stall_ms, 120_000, 'command_stall_ms');
  }

  observe(snapshot = {}) {
    if (snapshot?.schema !== RSI_COMMAND_PLANE_LIVENESS_INPUT_SCHEMA) {
      throw new Error('rsi_liveness_input_schema_invalid');
    }
    assertZeroAuthority(snapshot);
    assertSanitized(snapshot);

    const observedAtIso = snapshot.observed_at || new Date(this.#clock()).toISOString();
    const observedAtMs = timestampMs(observedAtIso, 'observed_at');
    const heartbeatAgeMs = ageMs(observedAtMs, snapshot.heartbeat_at, 'heartbeat_at');
    const perceptionAgeMs = ageMs(observedAtMs, snapshot.perception_at, 'perception_at');
    const commandProgressAgeMs = ageMs(observedAtMs, snapshot.command_progress_at, 'command_progress_at');
    const pendingCommandCount = nonNegativeInt(snapshot.pending_command_count, 'pending_command_count');
    const activeCommand = activeCommandProjection(snapshot.active_command, observedAtMs);

    const heartbeatFresh = heartbeatAgeMs != null && heartbeatAgeMs <= this.#heartbeatFreshMs;
    const perceptionFresh = perceptionAgeMs != null && perceptionAgeMs <= this.#perceptionFreshMs;
    const commandStalled = commandProgressAgeMs != null && commandProgressAgeMs >= this.#commandStallMs;
    const activeCommandRunning = activeCommand != null && ACTIVE_COMMAND_STATES.has(activeCommand.status);
    const resultDeliveryStall = Boolean(
      activeCommandRunning
      && commandStalled
      && activeCommand.effect_bound
      && !activeCommand.receipt_recorded,
    );

    const opportunities = [];
    if (resultDeliveryStall) {
      opportunities.push(opportunity({
        sourceSha: this.#sourceSha,
        signal: 'RESULT_DELIVERY_STALL_AFTER_EFFECT_BINDING',
        rationale: 'Bound result delivery and independent receipt reconciliation after an already-bound effect; never replay the physical effect.',
        evidence: {
          command_id: activeCommand.command_id,
          action: activeCommand.action,
          command_lane: activeCommand.command_lane,
          status: activeCommand.status,
          command_progress_age_ms: commandProgressAgeMs,
          effect_bound_age_ms: activeCommand.effect_bound_age_ms,
          pending_command_count: pendingCommandCount,
          heartbeat_age_ms: heartbeatAgeMs,
          perception_age_ms: perceptionAgeMs,
          receipt_recorded: false,
        },
      }));
    }

    if (heartbeatFresh && perceptionFresh && commandStalled && (activeCommandRunning || pendingCommandCount > 0)) {
      opportunities.push(opportunity({
        sourceSha: this.#sourceSha,
        signal: 'COMMAND_PLANE_STALL_WITH_HEALTHY_HEARTBEAT',
        rationale: 'Make command progress an independent liveness signal so heartbeat/perception health cannot mask a wedged command cycle.',
        evidence: {
          command_progress_age_ms: commandProgressAgeMs,
          heartbeat_age_ms: heartbeatAgeMs,
          perception_age_ms: perceptionAgeMs,
          pending_command_count: pendingCommandCount,
          active_command_status: activeCommand?.status || null,
          active_command_lane: activeCommand?.command_lane || null,
        },
      }));
    }

    const observation = {
      schema: RSI_COMMAND_PLANE_LIVENESS_OBSERVATION_SCHEMA,
      source_sha: this.#sourceSha,
      observed_at: new Date(observedAtMs).toISOString(),
      observation_kind: 'COMMAND_PLANE_LIVENESS',
      heartbeat_age_ms: heartbeatAgeMs,
      perception_age_ms: perceptionAgeMs,
      command_progress_age_ms: commandProgressAgeMs,
      pending_command_count: pendingCommandCount,
      active_command: activeCommand,
      heartbeat_fresh: heartbeatFresh,
      perception_fresh: perceptionFresh,
      command_stalled: commandStalled,
      result_delivery_stalled_after_effect_binding: resultDeliveryStall,
      thresholds: {
        heartbeat_fresh_ms: this.#heartbeatFreshMs,
        perception_fresh_ms: this.#perceptionFreshMs,
        command_stall_ms: this.#commandStallMs,
      },
      opportunities,
      raw_dom_consumed: false,
      raw_network_consumed: false,
      page_text_consumed: false,
      input_values_consumed: false,
      command_payload_consumed: false,
      execution_authority: false,
      production_mutation_authority: false,
      promotion_authority: false,
      self_update_authority: false,
      automatic_retry_allowed: false,
      authority_effect: false,
    };
    observation.observation_digest = sha256(observation);
    return Object.freeze(observation);
  }
}
