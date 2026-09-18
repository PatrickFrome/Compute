import crypto from 'node:crypto';

import { BROWSER_BRAIN_WORKING_MEMORY_SCHEMA } from './browser-brain-working-memory.mjs';

export const RSI_SHADOW_OBSERVATION_SCHEMA = 'metaengine.rsi.shadow-observation.v1';
export const RSI_SHADOW_OPPORTUNITY_SCHEMA = 'metaengine.rsi.shadow-opportunity.v1';

const SHA40_RE = /^[0-9a-f]{40}$/i;
const SAFE_CELL_STATES = new Set(['UNKNOWN', 'READY', 'WORKING', 'NEEDS_ATTENTION', 'DEGRADED', 'GONE']);

function text(value, max = 240) {
  return value == null ? null : String(value).trim().slice(0, max);
}

function exactSha(value) {
  const normalized = text(value, 40)?.toLowerCase();
  if (!normalized || !SHA40_RE.test(normalized)) throw new Error('rsi_observer_exact_source_sha_required');
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

function opportunity({ sourceSha, signal, mutationSurface, priority, rationale, evidence }) {
  const material = {
    schema: RSI_SHADOW_OPPORTUNITY_SCHEMA,
    source_sha: sourceSha,
    signal,
    mutation_surface: mutationSurface,
    priority,
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

export class RsiShadowObserver {
  #sourceSha;
  #clock;

  constructor({ source_sha, clock = () => Date.now() } = {}) {
    this.#sourceSha = exactSha(source_sha);
    if (typeof clock !== 'function') throw new Error('rsi_observer_clock_required');
    this.#clock = clock;
  }

  observeBrainSnapshot(snapshot = {}) {
    if (snapshot?.schema !== BROWSER_BRAIN_WORKING_MEMORY_SCHEMA) {
      throw new Error('rsi_observer_brain_snapshot_schema_invalid');
    }
    if (snapshot?.execution_authority !== false || snapshot?.authority_effect !== false) {
      throw new Error('rsi_observer_brain_snapshot_authority_invalid');
    }
    if (snapshot?.raw_dom_stored !== false || snapshot?.page_text_stored !== false || snapshot?.input_values_stored !== false) {
      throw new Error('rsi_observer_brain_snapshot_privacy_invalid');
    }

    const cells = Array.isArray(snapshot?.cells) ? snapshot.cells : [];
    const counts = {
      UNKNOWN: 0,
      READY: 0,
      WORKING: 0,
      NEEDS_ATTENTION: 0,
      DEGRADED: 0,
      GONE: 0,
    };
    let ambiguousCommandCount = 0;
    let invalidStateCount = 0;

    for (const cell of cells) {
      const state = String(cell?.status || '').toUpperCase();
      if (SAFE_CELL_STATES.has(state)) counts[state] += 1;
      else invalidStateCount += 1;
      const commandStatus = String(cell?.last_command?.status || '').toUpperCase();
      const effectOutcome = String(cell?.last_command?.effect_outcome || '').toUpperCase();
      if (commandStatus === 'AMBIGUOUS' || effectOutcome === 'AMBIGUOUS') ambiguousCommandCount += 1;
    }

    const droppedEvents = Math.max(0, Number(snapshot?.global?.dropped_events) || 0);
    const opportunities = [];

    if (ambiguousCommandCount > 0) {
      opportunities.push(opportunity({
        sourceSha: this.#sourceSha,
        signal: 'AMBIGUOUS_COMMAND_OUTCOMES',
        mutationSurface: 'BROWSER_RUNTIME',
        priority: 'P0',
        rationale: 'Reduce ambiguity frequency or improve independent readback without granting replay authority.',
        evidence: { ambiguous_command_count: ambiguousCommandCount },
      }));
    }

    if (counts.NEEDS_ATTENTION + counts.DEGRADED > 0) {
      opportunities.push(opportunity({
        sourceSha: this.#sourceSha,
        signal: 'CELL_RELIABILITY_PRESSURE',
        mutationSurface: 'AGENT_ORCHESTRATION',
        priority: 'P1',
        rationale: 'Improve routing, recovery planning, or workload placement while preserving cell identity fences.',
        evidence: {
          needs_attention: counts.NEEDS_ATTENTION,
          degraded: counts.DEGRADED,
        },
      }));
    }

    if (counts.GONE > 0) {
      opportunities.push(opportunity({
        sourceSha: this.#sourceSha,
        signal: 'CELL_LIFECYCLE_LOSS',
        mutationSurface: 'BROWSER_RUNTIME',
        priority: 'P1',
        rationale: 'Improve lifecycle resilience or rebinding behavior without weakening exact runtime identity.',
        evidence: { gone: counts.GONE },
      }));
    }

    if (droppedEvents > 0) {
      opportunities.push(opportunity({
        sourceSha: this.#sourceSha,
        signal: 'BOUNDED_MEMORY_PRESSURE',
        mutationSurface: 'AGENT_ORCHESTRATION',
        priority: 'P2',
        rationale: 'Improve event summarization or context selection instead of growing unbounded memory.',
        evidence: { dropped_events: droppedEvents },
      }));
    }

    if (invalidStateCount > 0) {
      opportunities.push(opportunity({
        sourceSha: this.#sourceSha,
        signal: 'OBSERVATION_CONTRACT_DRIFT',
        mutationSurface: 'TOOL_INTERFACE',
        priority: 'P0',
        rationale: 'Reconcile observation schema drift before any candidate generation.',
        evidence: { invalid_state_count: invalidStateCount },
      }));
    }

    const observation = {
      schema: RSI_SHADOW_OBSERVATION_SCHEMA,
      source_sha: this.#sourceSha,
      observed_at: new Date(this.#clock()).toISOString(),
      brain_snapshot_schema: snapshot.schema,
      brain_process_revision: Math.max(0, Number(snapshot?.global?.process_revision) || 0),
      brain_cognitive_sequence: Math.max(0, Number(snapshot?.global?.cognitive_sequence) || 0),
      cell_count: cells.length,
      cell_state_counts: counts,
      ambiguous_command_count: ambiguousCommandCount,
      dropped_events: droppedEvents,
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
