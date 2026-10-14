import {
  resolveExactWebContentsTabBinding,
  resolveTabIdForWebContents,
} from './browser-webcontents-tab-index.mjs';

// W33: an observational join over existing trusted Browser/Brain/CDP sources.
// Never calls CDP.ensure/send, creates targets, or grants lease/effect authority.
export const BROWSERCELL_CDP_CONTINUITY_SCHEMA = 'metaengine.client.browsercell-cdp-continuity.v1';

const TAB_RE = /^tab_[0-9a-f-]{36}$/i;
const CELL_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/;
const TARGET_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/;
const PROCESS_RE = /^([1-9][0-9]*):([0-9]+(?:\.[0-9]+)?)$/;
const TERMINAL_EVENTS = new Set([
  'RENDER_PROCESS_GONE', 'WEB_CONTENTS_DESTROYED',
  'CDP_DETACHED', 'TARGET_DESTROYED', 'WEB_CONTENTS_REPLACED',
]);
const isPositive = (n) => Number.isSafeInteger(n) && n > 0;
const isNonnegative = (n) => Number.isSafeInteger(n) && n >= 0;

function result(tabId, state, reason, fields = {}) {
  return Object.freeze({
    schema: BROWSERCELL_CDP_CONTINUITY_SCHEMA,
    tab_id: tabId,
    state,
    reason,
    ...fields,
    source: 'TRUSTED_IN_PROCESS_READBACK_ONLY',
    healthy: false, // BOUND != installed/runtime HEALTHY
    execution_authority: false,
    lease_authority: false,
    send_allowed: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

function stamp(row) {
  return [
    row.tab_id, row.cell_id, row.cell_generation,
    row.web_contents_id, row.tab_binding_generation,
    row.renderer_pid, row.renderer_process_key,
    row.target_id, row.runtime_binding_generation,
    row.cdp_attachment_generation, row.cdp_binding_generation,
    row.document_generation,
  ].join('|');
}

function fresh(timestamp, now, maxAgeMs) {
  if (typeof timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(timestamp)) return false;
  const time = Date.parse(timestamp);
  return Number.isFinite(time) && time <= now && now - time <= maxAgeMs;
}

export class BrowserCellCdpContinuityReadback {
  #views;
  #cells;
  #plane;
  #cdp;
  #resolveIndexedBinding;
  #resolveIndexedTab;
  #clock;
  #maxAgeMs;
  #maxCells;
  #last = new Map();
  #fenced = new Map();

  constructor({
    views, cells, processPlane, cdpPool,
    resolveIndexedBinding = resolveExactWebContentsTabBinding,
    resolveIndexedTab = resolveTabIdForWebContents,
    clock = () => Date.now(), maxAgeMs = 2_000, maxCells = 128,
  } = {}) {
    if (!views || typeof views.get !== 'function'
        || !cells || typeof cells.get !== 'function'
        || !processPlane || typeof processPlane.snapshot !== 'function'
        || typeof processPlane.runtimeBinding !== 'function'
        || !cdpPool || typeof cdpPool.identity !== 'function'
        || typeof resolveIndexedBinding !== 'function'
        || typeof resolveIndexedTab !== 'function'
        || typeof clock !== 'function') {
      throw new TypeError('browsercell_cdp_readback_trusted_dependencies_required');
    }
    if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 1 || maxAgeMs > 30_000
        || !Number.isSafeInteger(maxCells) || maxCells < 1 || maxCells > 512) {
      throw new RangeError('browsercell_cdp_readback_bounds_invalid');
    }
    this.#views = views;
    this.#cells = cells;
    this.#plane = processPlane;
    this.#cdp = cdpPool;
    this.#resolveIndexedBinding = resolveIndexedBinding;
    this.#resolveIndexedTab = resolveIndexedTab;
    this.#clock = clock;
    this.#maxAgeMs = maxAgeMs;
    this.#maxCells = maxCells;
  }

  #remember(tabId, witness) {
    // Strictly bounded observational cache, never an independent target registry.
    this.#last.delete(tabId);
    this.#last.set(tabId, witness);
    while (this.#last.size > this.#maxCells) {
      const oldest = this.#last.keys().next().value;
      this.#last.delete(oldest);
      this.#fenced.delete(oldest);
    }
  }

  read(tabIdRaw) {
    const tabId = String(tabIdRaw || '').toLowerCase();
    if (!TAB_RE.test(tabId)) return result(null, 'UNKNOWN', 'TAB_ID_INVALID');
    const unknown = (reason) => result(tabId, 'UNKNOWN', reason);
    try {
      const now = this.#clock();
      if (!Number.isFinite(now)) return unknown('CLOCK_UNAVAILABLE');
      const cell = this.#cells.get(tabId);
      if (!cell || !CELL_RE.test(cell.cell_id) || !isPositive(cell.cell_generation)) {
        return unknown('BROWSERCELL_IDENTITY_UNAVAILABLE');
      }
      const view = this.#views.get(tabId);
      const wc = view?.webContents;
      if (!wc || typeof wc.isDestroyed !== 'function' || wc.isDestroyed()
          || (typeof wc.isCrashed === 'function' && wc.isCrashed())) {
        return unknown('WEBCONTENTS_UNAVAILABLE');
      }
      const wcId = wc.id;
      const pid = wc.getOSProcessId?.();
      const tabIndex = this.#resolveIndexedBinding(tabId);
      if (!isPositive(wcId) || !isPositive(pid)
          || !isPositive(tabIndex?.binding_generation)
          || tabIndex?.web_contents_id !== wcId
          || tabIndex?.tab_id !== tabId
          || this.#resolveIndexedTab(wc) !== tabId) {
        return unknown('WEBCONTENTS_TAB_BINDING_MISMATCH');
      }

      // The process plane is the existing native census. Never interpret PID
      // alone as process identity; demand one exact creation-time metric.
      const census = this.#plane.snapshot({ eventLimit: 0 });
      if (!fresh(census?.observed_at, now, this.#maxAgeMs)) {
        return unknown('PROCESS_CENSUS_MISSING_OR_STALE');
      }
      const metricRows = Array.isArray(census.processes)
        ? census.processes.filter((item) => item?.pid === pid) : [];
      const wcRows = Array.isArray(census.web_contents)
        ? census.web_contents.filter((item) => item?.web_contents_id === wcId) : [];
      if (metricRows.length !== 1 || wcRows.length !== 1) {
        return unknown('PROCESS_CENSUS_AMBIGUOUS');
      }
      const metric = metricRows[0], observedWc = wcRows[0];
      const processKey = metric?.process_key;
      const parsed = typeof processKey === 'string' ? PROCESS_RE.exec(processKey) : null;
      if (!parsed || Number(parsed[1]) !== pid
          || !Number.isFinite(metric.creation_time_ms)
          || Number(parsed[2]) !== metric.creation_time_ms
          || metric.process_identity_complete !== true
          || observedWc.tab_id !== tabId
          || observedWc.os_pid !== pid
          || observedWc.destroyed === true) {
        return unknown('RENDERER_PROCESS_INCARNATION_UNPROVEN');
      }

      // This resolves from the already-running Brain index, not a second
      // registry and not URL/title/provider heuristics.
      const binding = this.#plane.runtimeBinding(tabId, {
        require_complete_process_identity: true,
      });
      if (!binding || binding.valid !== true
          || binding.renderer_process_identity_complete !== true
          || binding.tab_id !== tabId
          || binding.cell_id !== cell.cell_id
          || binding.cell_generation !== cell.cell_generation
          || binding.web_contents_id !== wcId
          || binding.renderer_pid !== pid
          || binding.renderer_process_key !== processKey
          || !isPositive(binding.binding_generation)) {
        return unknown('BRAIN_RUNTIME_BINDING_MISMATCH');
      }

      // identity() is a *read* on an existing pool row. No ensure/attach/send.
      const cdp = this.#cdp.identity(wc, { require_ready: true, require_event_stream: true });
      if (!cdp || cdp.web_contents_id !== wcId || cdp.os_pid !== pid
          || cdp.ready !== true || cdp.attached !== true
          || cdp.event_stream_capable !== true
          || !TARGET_RE.test(String(cdp.target_id || ''))
          || cdp.target_id.startsWith('webcontents:')
          || cdp.target_id !== binding.target_id
          || !isPositive(cdp.attachment_generation)
          || !isPositive(cdp.binding_generation)
          || !isNonnegative(cdp.document_generation)
          || cdp.document_generation !== binding.document_generation) {
        return unknown('CDP_ROOT_TARGET_UNVERIFIED');
      }

      const fields = {
        cell_id: cell.cell_id,
        cell_generation: cell.cell_generation,
        web_contents_id: wcId,
        tab_binding_generation: tabIndex.binding_generation,
        renderer_pid: pid,
        renderer_process_key: processKey,
        target_id: cdp.target_id,
        runtime_binding_generation: binding.binding_generation,
        cdp_attachment_generation: cdp.attachment_generation,
        cdp_binding_generation: cdp.binding_generation,
        document_generation: cdp.document_generation,
        observed_at: census.observed_at,
      };
      const witness = result(tabId, 'BOUND_READ_ONLY', 'EXACT_NATIVE_AND_CDP_READBACK', fields);
      const key = stamp(witness);
      if (this.#fenced.get(tabId) === key) {
        return result(tabId, 'INVALIDATED', 'NATIVE_LIFECYCLE_TERMINATED_BINDING');
      }
      if (this.#fenced.has(tabId)) this.#fenced.delete(tabId);
      this.#remember(tabId, witness);
      return witness;
    } catch {
      // No callback error/URL/page content crosses this projection boundary.
      return unknown('TRUSTED_READBACK_UNAVAILABLE');
    }
  }

  // Native event adapter: fenced only when *all* old lifetime coordinates
  // match the previously observed binding. A delayed old event cannot poison
  // a new WebContents/process/target incarnation.
  invalidateFromLifecycle(event = {}) {
    if (!TERMINAL_EVENTS.has(event?.type)) return false;
    const tabId = String(event?.tab_id || '').toLowerCase();
    const last = this.#last.get(tabId);
    if (!last
        || event.web_contents_id !== last.web_contents_id
        || event.renderer_process_key !== last.renderer_process_key
        || event.binding_generation !== last.runtime_binding_generation
        || event.target_id !== last.target_id) return false;
    this.#fenced.set(tabId, stamp(last));
    return true;
  }

  // A caller-supplied witness is never authority: it can only be disproved.
  // Re-read the native sources so old identity cannot survive reincarnation.
  isCurrent(witness) {
    if (witness?.schema !== BROWSERCELL_CDP_CONTINUITY_SCHEMA
        || witness?.state !== 'BOUND_READ_ONLY') return false;
    const current = this.read(witness.tab_id);
    return current.state === 'BOUND_READ_ONLY' && stamp(current) === stamp(witness);
  }

  snapshot() {
    return Object.freeze({
      schema: BROWSERCELL_CDP_CONTINUITY_SCHEMA,
      observed_cell_count: this.#last.size,
      fenced_cell_count: this.#fenced.size,
      max_cells: this.#maxCells,
      source: 'TRUSTED_IN_PROCESS_READBACK_ONLY',
      second_scheduler: false,
      cdp_attach_on_read: false,
      page_content_exposed: false,
      input_values_exposed: false,
      authority_effect: false,
    });
  }
}
