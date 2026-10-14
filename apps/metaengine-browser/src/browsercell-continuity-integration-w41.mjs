import { BrowserCellCdpContinuityReadback } from './browsercell-cdp-continuity-readback.mjs';

export const BROWSERCELL_CONTINUITY_INTEGRATION_SCHEMA =
  'metaengine.client.browsercell-continuity-integration-w41.v1';

const TAB_RE = /^tab_[0-9a-f-]{36}$/i;
const SEMANTIC_TERMINALS = new Set([
  'METAENGINE.DebuggerDetached', 'Page.frameNavigated',
  'Page.navigatedWithinDocument', 'DOM.documentUpdated',
  'Runtime.executionContextsCleared',
]);
const NATIVE_TERMINALS = new Set([
  'WEB_CONTENTS_DESTROYED', 'WEB_CONTENTS_REPLACED', 'RENDER_PROCESS_GONE',
]);
const terminalType = (type) => type === 'METAENGINE.DebuggerDetached'
  ? 'CDP_DETACHED' : 'TARGET_DESTROYED';

function safeResult(accepted, reason) {
  return Object.freeze({
    schema: BROWSERCELL_CONTINUITY_INTEGRATION_SCHEMA,
    accepted, reason, authority_effect: false,
    execution_authority: false, send_allowed: false,
    automatic_retry_allowed: false,
  });
}

// Observes the SAME native objects, Brain binding and CDP pool as W33.
// No listener is installed on a page, no CDP ensure/send/attach is performed,
// and nothing here is a target registry or an executor.
export class BrowserCellContinuityIntegrationW41 {
  #views;
  #readback;
  #active = new Map();
  #revoked = new WeakSet();
  #maxCells;

  constructor({ views, cells, processPlane, cdpPool,
    maxCells = 128, ...readbackOptions } = {}) {
    if (!views || typeof views.get !== 'function'
        || !Number.isSafeInteger(maxCells) || maxCells < 1 || maxCells > 512) {
      throw new TypeError('browsercell_w41_trusted_views_or_capacity_invalid');
    }
    this.#views = views;
    this.#maxCells = maxCells;
    this.#readback = new BrowserCellCdpContinuityReadback({
      views, cells, processPlane, cdpPool, maxCells, ...readbackOptions,
    });
  }

  #revoke(tabId) {
    const prior = this.#active.get(tabId);
    if (!prior) return false;
    this.#revoked.add(prior.witness);
    this.#active.delete(tabId);
    return true;
  }

  read(tabIdRaw) {
    const witness = this.#readback.read(tabIdRaw);
    const tabId = witness.tab_id;
    if (!TAB_RE.test(String(tabId || ''))) return witness;
    if (witness.state !== 'BOUND_READ_ONLY') {
      this.#revoke(tabId);
      return witness;
    }
    const wc = this.#views.get(tabId)?.webContents;
    if (!wc || typeof wc !== 'object') {
      this.#revoke(tabId);
      return Object.freeze({
        ...witness, state: 'UNKNOWN', reason: 'NATIVE_OBJECT_UNAVAILABLE',
        healthy: false, authority_effect: false,
      });
    }
    const prior = this.#active.get(tabId);
    if (prior && (prior.witness !== witness
        && (prior.witness.runtime_binding_generation !== witness.runtime_binding_generation
          || prior.witness.cdp_binding_generation !== witness.cdp_binding_generation
          || prior.witness.cdp_attachment_generation !== witness.cdp_attachment_generation
          || prior.witness.document_generation !== witness.document_generation
          || prior.witness.renderer_process_key !== witness.renderer_process_key
          || prior.witness.tab_binding_generation !== witness.tab_binding_generation
          || prior.webContents !== wc))) this.#revoke(tabId);
    this.#active.delete(tabId);
    this.#active.set(tabId, { witness, webContents: wc });
    while (this.#active.size > this.#maxCells) {
      const oldest = this.#active.keys().next().value;
      this.#revoke(oldest);
    }
    return witness;
  }

  isCurrent(witness) {
    return Boolean(witness && !this.#revoked.has(witness)
      && this.#active.get(witness.tab_id)?.witness === witness
      && this.#readback.isCurrent(witness));
  }

  // Called only from the existing native process/semantic observation callback.
  // Source WebContents is an in-process object (never serialized or returned).
  // A late event from an old tab must not invalidate its successor, even when
  // Chromium recycles WebContents ID or renderer PID.
  observe(event = {}, sourceWebContents = null) {
    const type = String(event?.type || '').toUpperCase();
    if (type === 'METRICS_SAMPLE' || type === 'PROCESS_CENSUS_REFRESHED') {
      let revoked = 0;
      for (const [tabId, row] of [...this.#active]) {
        if (!this.#readback.isCurrent(row.witness)) {
          if (this.#revoke(tabId)) revoked += 1;
        }
      }
      return safeResult(true, revoked ? 'STALE_WITNESSES_REVOKED' : 'CENSUS_RECHECKED');
    }

    const tabId = String(event?.tab_id || '').toLowerCase();
    const row = this.#active.get(tabId);
    if (!row || !sourceWebContents
        || sourceWebContents !== row.webContents
        || this.#views.get(tabId)?.webContents !== row.webContents
        || event?.web_contents_id !== row.witness.web_contents_id) {
      return safeResult(false, 'NATIVE_SOURCE_UNBOUND_OR_STALE');
    }
    const w = row.witness;
    let terminal = null;
    if (type === 'SEMANTIC_EVENT') {
      const method = event.semantic_method;
      const replacedDocument = ['Page.frameNavigated', 'DOM.documentUpdated',
        'Page.navigatedWithinDocument'].includes(method);
      const replacedBinding = ['METAENGINE.DebuggerDetached',
        'Page.frameNavigated', 'DOM.documentUpdated'].includes(method);
      if (!SEMANTIC_TERMINALS.has(method)
          || event.target_id !== w.target_id || event.root_session !== true
          || event.cdp_attachment_generation !== w.cdp_attachment_generation
          || event.cdp_binding_generation !== w.cdp_binding_generation + Number(replacedBinding)
          || event.cdp_document_generation !== w.document_generation + Number(replacedDocument)) {
        return safeResult(false, 'CDP_ROOT_GENERATION_UNPROVEN');
      }
      terminal = terminalType(event.semantic_method);
    } else if (NATIVE_TERMINALS.has(type)) {
      // WebContents destruction proves the old object can never be a successor.
      // Renderer death on a surviving object requires independently captured
      // old process birth AND Brain generation, not getOSProcessId() alone.
      if (type !== 'WEB_CONTENTS_DESTROYED'
          && (event.renderer_process_key !== w.renderer_process_key
            || event.binding_generation !== w.runtime_binding_generation
            || event.target_id !== w.target_id)) {
        return safeResult(false, 'OLD_RENDERER_BIRTH_UNPROVEN');
      }
      terminal = type;
    } else {
      return safeResult(false, 'NONTERMINAL_EVENT');
    }

    const fenced = this.#readback.invalidateFromLifecycle({
      type: terminal,
      tab_id: tabId,
      web_contents_id: w.web_contents_id,
      renderer_process_key: w.renderer_process_key,
      binding_generation: w.runtime_binding_generation,
      target_id: w.target_id,
    });
    if (!fenced) return safeResult(false, 'OLD_BINDING_NOT_FENCED');
    this.#revoke(tabId);
    return safeResult(true, 'EXACT_OLD_LIFETIME_INVALIDATED');
  }

  snapshot() {
    return Object.freeze({
      schema: BROWSERCELL_CONTINUITY_INTEGRATION_SCHEMA,
      tracked_cell_count: this.#active.size,
      max_cells: this.#maxCells,
      trusted_in_process_only: true,
      existing_brain_and_process_census: true,
      existing_cdp_pool_only: true,
      new_registry: false,
      page_authority: false,
      send_allowed: false,
      automatic_retry_allowed: false,
      authority_effect: false,
    });
  }
}
