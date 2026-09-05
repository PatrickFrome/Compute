import crypto from 'node:crypto';

export const BROWSER_BRAIN_WORKING_MEMORY_SCHEMA = 'metaengine.browser.brain-working-memory.v1';
export const BROWSER_BRAIN_CHECKPOINT_SCHEMA = 'metaengine.browser.brain-working-memory-checkpoint.v1';

const TAB_ID_RE = /^tab_[0-9a-f-]{36}$/i;
const SAFE_STATUS = new Set(['UNKNOWN','READY','WORKING','NEEDS_ATTENTION','DEGRADED','GONE']);
const CRITICAL_TYPES = new Set(['RENDER_PROCESS_GONE','WEB_CONTENTS_DESTROYED','WEB_CONTENTS_UNRESPONSIVE','CHILD_PROCESS_GONE']);

function boundedInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function text(value, max = 240) {
  return value == null ? null : String(value).slice(0, max);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function sha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex');
}

function publicBinding(binding) {
  if (!binding || binding.valid !== true) return null;
  return Object.freeze({
    tab_id: binding.tab_id,
    cell_id: binding.cell_id || null,
    cell_generation: binding.cell_generation || null,
    binding_generation: binding.binding_generation,
    web_contents_id: binding.web_contents_id,
    renderer_pid: binding.renderer_pid,
    renderer_process_key: binding.renderer_process_key,
    target_id: binding.target_id,
    document_generation: binding.document_generation || 0,
    semantic_revision: binding.semantic_revision || 0,
    provider: binding.provider || null,
    role: binding.role || null,
    valid: true,
    authority_effect: false,
  });
}

function eventProjection(event = {}) {
  const tabId = String(event?.tab_id || '').toLowerCase();
  return Object.freeze({
    sequence: Number.isSafeInteger(Number(event?.sequence ?? event?.seq)) ? Number(event.sequence ?? event.seq) : null,
    type: text(event?.type, 96) || 'UNKNOWN',
    priority: text(event?.priority, 8),
    tab_id: TAB_ID_RE.test(tabId) ? tabId : null,
    web_contents_id: Number.isSafeInteger(Number(event?.web_contents_id)) ? Number(event.web_contents_id) : null,
    renderer_pid: Number.isSafeInteger(Number(event?.os_pid ?? event?.renderer_pid)) ? Number(event.os_pid ?? event.renderer_pid) : null,
    renderer_process_key: text(event?.renderer_process_key ?? event?.process_key, 128),
    target_id: text(event?.target_id, 192),
    semantic_method: text(event?.semantic_method ?? event?.method, 160),
    semantic_sequence: Number.isSafeInteger(Number(event?.semantic_sequence)) ? Number(event.semantic_sequence) : null,
    reason: text(event?.reason, 160),
    observed_at: text(event?.observed_at, 64),
    raw_payload_exposed: false,
    page_text_exposed: false,
    input_values_exposed: false,
    authority_effect: false,
  });
}

function commandProjection(outcome = {}) {
  const tabId = String(outcome?.tab_id || outcome?.payload?.tab_id || '').toLowerCase();
  const status = String(outcome?.status || '').toUpperCase();
  return Object.freeze({
    command_id: text(outcome?.command_id, 128),
    action: text(outcome?.action, 96),
    tab_id: TAB_ID_RE.test(tabId) ? tabId : null,
    status: text(status || 'UNKNOWN', 32),
    effect_outcome: text(String(outcome?.effect_outcome || '').toUpperCase(), 40),
    recorded_at: text(outcome?.recorded_at, 64) || new Date().toISOString(),
    result_payload_exposed: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

function defaultCell(tabId, now) {
  return {
    tab_id: tabId,
    status: 'UNKNOWN',
    binding: null,
    last_event: null,
    last_command: null,
    last_semantic_sequence: null,
    last_observed_at: now,
    attention_reason: null,
  };
}

export class BrowserBrainWorkingMemory {
  #clock;
  #maxCells;
  #maxEvents;
  #cells = new Map();
  #events = [];
  #global = {
    process_revision: 0,
    cognitive_sequence: 0,
    last_event_at: null,
    last_command_at: null,
    dropped_events: 0,
  };

  constructor({ clock = () => Date.now(), maxCells = 128, maxEvents = 4096 } = {}) {
    if (typeof clock !== 'function') throw new Error('browser_brain_memory_clock_required');
    this.#clock = clock;
    this.#maxCells = boundedInt(maxCells, 128, 1, 512);
    this.#maxEvents = boundedInt(maxEvents, 4096, 64, 16384);
  }

  #now() { return new Date(this.#clock()).toISOString(); }

  #ensureCell(tabId) {
    if (!this.#cells.has(tabId)) {
      if (this.#cells.size >= this.#maxCells) {
        const evictable = [...this.#cells.values()]
          .filter((row) => row.status === 'GONE' || row.binding == null)
          .sort((a, b) => String(a.last_observed_at).localeCompare(String(b.last_observed_at)));
        const drop = evictable[0];
        if (!drop) throw new Error('browser_brain_memory_cell_capacity_exceeded');
        this.#cells.delete(drop.tab_id);
      }
      this.#cells.set(tabId, defaultCell(tabId, this.#now()));
    }
    return this.#cells.get(tabId);
  }

  rememberBinding(binding) {
    const projected = publicBinding(binding);
    if (!projected || !TAB_ID_RE.test(String(projected.tab_id || ''))) return null;
    const cell = this.#ensureCell(projected.tab_id);
    cell.binding = projected;
    cell.status = cell.status === 'NEEDS_ATTENTION' ? cell.status : 'READY';
    cell.attention_reason = cell.status === 'NEEDS_ATTENTION' ? cell.attention_reason : null;
    cell.last_observed_at = this.#now();
    this.#global.process_revision += 1;
    return this.context(projected.tab_id);
  }

  forgetBinding(tabIdRaw, reason = 'BINDING_INVALIDATED') {
    const tabId = String(tabIdRaw || '').toLowerCase();
    if (!TAB_ID_RE.test(tabId)) return null;
    const cell = this.#ensureCell(tabId);
    cell.binding = null;
    cell.status = 'GONE';
    cell.attention_reason = text(reason, 160);
    cell.last_observed_at = this.#now();
    this.#global.process_revision += 1;
    return this.context(tabId);
  }

  ingestEvent(event = {}) {
    const projected = eventProjection(event);
    this.#events.push(projected);
    if (this.#events.length > this.#maxEvents) {
      const drop = this.#events.length - this.#maxEvents;
      this.#events.splice(0, drop);
      this.#global.dropped_events += drop;
    }
    if (projected.sequence != null) this.#global.cognitive_sequence = Math.max(this.#global.cognitive_sequence, projected.sequence);
    this.#global.last_event_at = projected.observed_at || this.#now();

    if (projected.tab_id) {
      const cell = this.#ensureCell(projected.tab_id);
      cell.last_event = projected;
      cell.last_observed_at = projected.observed_at || this.#now();
      if (projected.semantic_sequence != null) cell.last_semantic_sequence = projected.semantic_sequence;
      if (CRITICAL_TYPES.has(projected.type)) {
        cell.status = projected.type === 'WEB_CONTENTS_DESTROYED' || projected.type === 'RENDER_PROCESS_GONE' ? 'GONE' : 'NEEDS_ATTENTION';
        cell.attention_reason = projected.reason || projected.type;
        if (cell.status === 'GONE') cell.binding = null;
      } else if (projected.type === 'WEB_CONTENTS_RESPONSIVE') {
        cell.status = cell.binding ? 'READY' : 'UNKNOWN';
        cell.attention_reason = null;
      } else if (projected.type === 'WEB_CONTENTS_LOADING_STARTED') {
        cell.status = 'WORKING';
      } else if (projected.type === 'WEB_CONTENTS_LOADING_STOPPED' && cell.status !== 'NEEDS_ATTENTION') {
        cell.status = cell.binding ? 'READY' : 'UNKNOWN';
      }
    }
    return projected;
  }

  rememberCommandOutcome(outcome = {}) {
    const projected = commandProjection(outcome);
    this.#global.last_command_at = projected.recorded_at;
    if (!projected.tab_id) return projected;
    const cell = this.#ensureCell(projected.tab_id);
    cell.last_command = projected;
    cell.last_observed_at = projected.recorded_at;
    if (projected.status === 'AMBIGUOUS' || projected.effect_outcome === 'AMBIGUOUS') {
      cell.status = 'NEEDS_ATTENTION';
      cell.attention_reason = 'COMMAND_OUTCOME_AMBIGUOUS';
    } else if (projected.status === 'FAILED') {
      cell.status = 'DEGRADED';
      cell.attention_reason = 'COMMAND_FAILED';
    } else if (projected.status === 'COMPLETED' && cell.binding) {
      cell.status = 'READY';
      cell.attention_reason = null;
    }
    return projected;
  }

  reconcileBindings(bindingSnapshot = {}) {
    const live = new Set();
    for (const binding of Array.isArray(bindingSnapshot?.bindings) ? bindingSnapshot.bindings : []) {
      if (binding?.valid !== true) continue;
      const remembered = this.rememberBinding(binding);
      if (remembered) live.add(binding.tab_id);
    }
    for (const cell of this.#cells.values()) {
      if (cell.binding && !live.has(cell.tab_id)) this.forgetBinding(cell.tab_id, 'BINDING_INDEX_RECONCILE_MISS');
    }
    return this.snapshot();
  }

  context(tabIdRaw) {
    const tabId = String(tabIdRaw || '').toLowerCase();
    const cell = this.#cells.get(tabId);
    if (!cell) return null;
    return Object.freeze({
      schema: 'metaengine.browser.brain-working-context.v1',
      tab_id: cell.tab_id,
      status: SAFE_STATUS.has(cell.status) ? cell.status : 'UNKNOWN',
      binding: cell.binding ? { ...cell.binding } : null,
      last_event: cell.last_event ? { ...cell.last_event } : null,
      last_command: cell.last_command ? { ...cell.last_command } : null,
      last_semantic_sequence: cell.last_semantic_sequence,
      last_observed_at: cell.last_observed_at,
      attention_reason: cell.attention_reason,
      page_text_exposed: false,
      input_values_exposed: false,
      command_payload_exposed: false,
      execution_authority: false,
      authority_effect: false,
    });
  }

  checkpoint() {
    const material = {
      schema: BROWSER_BRAIN_CHECKPOINT_SCHEMA,
      version: 1,
      created_at: this.#now(),
      global: { ...this.#global },
      cells: [...this.#cells.values()].map((row) => ({
        tab_id: row.tab_id,
        status: row.status,
        binding: row.binding ? { ...row.binding } : null,
        last_event: row.last_event ? { ...row.last_event } : null,
        last_command: row.last_command ? { ...row.last_command } : null,
        last_semantic_sequence: row.last_semantic_sequence,
        last_observed_at: row.last_observed_at,
        attention_reason: row.attention_reason,
      })),
      page_text_exposed: false,
      input_values_exposed: false,
      command_payload_exposed: false,
      execution_authority: false,
      authority_effect: false,
    };
    return Object.freeze({ ...material, checkpoint_sha256: sha256(material) });
  }

  restore(checkpoint) {
    if (!checkpoint || checkpoint.schema !== BROWSER_BRAIN_CHECKPOINT_SCHEMA || checkpoint.version !== 1) {
      throw new Error('browser_brain_memory_checkpoint_schema_invalid');
    }
    const expected = String(checkpoint.checkpoint_sha256 || '');
    const material = { ...checkpoint };
    delete material.checkpoint_sha256;
    if (!/^[a-f0-9]{64}$/.test(expected) || sha256(material) !== expected) {
      throw new Error('browser_brain_memory_checkpoint_hash_mismatch');
    }
    if (checkpoint.page_text_exposed !== false || checkpoint.input_values_exposed !== false || checkpoint.command_payload_exposed !== false) {
      throw new Error('browser_brain_memory_checkpoint_privacy_invalid');
    }
    const rows = Array.isArray(checkpoint.cells) ? checkpoint.cells : [];
    if (rows.length > this.#maxCells) throw new Error('browser_brain_memory_checkpoint_too_large');
    this.#cells.clear();
    for (const row of rows) {
      const tabId = String(row?.tab_id || '').toLowerCase();
      if (!TAB_ID_RE.test(tabId)) throw new Error('browser_brain_memory_checkpoint_tab_invalid');
      const status = SAFE_STATUS.has(String(row?.status || '').toUpperCase()) ? String(row.status).toUpperCase() : 'UNKNOWN';
      this.#cells.set(tabId, {
        tab_id: tabId,
        status,
        binding: row.binding ? publicBinding(row.binding) : null,
        last_event: row.last_event ? eventProjection(row.last_event) : null,
        last_command: row.last_command ? commandProjection(row.last_command) : null,
        last_semantic_sequence: Number.isSafeInteger(Number(row.last_semantic_sequence)) ? Number(row.last_semantic_sequence) : null,
        last_observed_at: text(row.last_observed_at, 64) || this.#now(),
        attention_reason: text(row.attention_reason, 160),
      });
    }
    this.#global = {
      process_revision: Math.max(0, Number(checkpoint?.global?.process_revision) || 0),
      cognitive_sequence: Math.max(0, Number(checkpoint?.global?.cognitive_sequence) || 0),
      last_event_at: text(checkpoint?.global?.last_event_at, 64),
      last_command_at: text(checkpoint?.global?.last_command_at, 64),
      dropped_events: Math.max(0, Number(checkpoint?.global?.dropped_events) || 0),
    };
    this.#events = [];
    return this.snapshot();
  }

  snapshot() {
    const contexts = [...this.#cells.keys()].map((tabId) => this.context(tabId));
    return Object.freeze({
      schema: BROWSER_BRAIN_WORKING_MEMORY_SCHEMA,
      global: Object.freeze({ ...this.#global }),
      cell_count: contexts.length,
      cells: Object.freeze(contexts),
      recent_event_count: this.#events.length,
      hot_memory_model: 'BOUNDED_IN_MEMORY_CAUSAL_FACTS',
      durable_checkpoint_available: true,
      raw_dom_stored: false,
      raw_network_stored: false,
      page_text_stored: false,
      input_values_stored: false,
      command_payload_stored: false,
      poll_timer_required: false,
      execution_authority: false,
      command_leasing: false,
      automatic_effect_retry_allowed: false,
      authority_effect: false,
    });
  }
}
