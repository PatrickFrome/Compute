import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicJsonWrite, readJson } from './security.mjs';
import { validateActionIntent, validateLeaseEnvelope, ACTION_KINDS } from '../../browser-shared/action-contract.mjs';
import { emitReceipt } from './receipt.mjs';

const ACTIONS_FILE = 'actions.json';
const SEMANTIC_ACTION_ENABLED = process.env.SEMANTIC_ACTION_ENABLED === '1';

export class ActionKernel {
  constructor({ runtime = null, cdpClient = null, profileDir = null, sessionKey = '', receiptsStore = null } = {}) {
    this.runtime = runtime;
    this.cdpClient = cdpClient;
    this.profileDir = profileDir;
    this.sessionKey = String(sessionKey || '');
    this.receiptsStore = receiptsStore;
    this.liveLeases = new Map();
    this._actionsFile = profileDir ? path.join(profileDir, ACTIONS_FILE) : null;
    this._cache = null;
  }

  async _loadActions() {
    if (this._cache) return this._cache;
    if (!this._actionsFile) return { schema: 'metaengine.a2-compute-browser.actions.v1', actions: [], updated_at: new Date().toISOString() };
    const data = await readJson(this._actionsFile, null);
    if (!data || !Array.isArray(data.actions)) {
      this._cache = { schema: 'metaengine.a2-compute-browser.actions.v1', actions: [], updated_at: new Date().toISOString() };
    } else {
      this._cache = data;
    }
    return this._cache;
  }

  async _saveActions(registry) {
    registry.updated_at = new Date().toISOString();
    if (this._actionsFile) {
      await atomicJsonWrite(this._actionsFile, registry);
    }
    this._cache = registry;
  }

  _cdp() {
    if (this.cdpClient) return this.cdpClient;
    if (this.runtime) {
      const entry = this.runtime.running.values().next().value;
      if (entry?.processRef?.cdp) return entry.processRef.cdp;
    }
    throw new Error('cdp_client_unavailable');
  }

  _runningEntry(profileId) {
    if (!this.runtime) throw new Error('runtime_required_for_binding_lookup');
    const entry = this.runtime.running.get(profileId);
    if (!entry?.processRef?.isRunning()) throw new Error('profile_not_running');
    return entry;
  }

  _liveBinding(entry, targetId) {
    const binding = entry.bindings.get(targetId);
    if (!binding) throw new Error('target_not_bound');
    if (!entry.processRef.isRunning() || binding.process_incarnation_id !== entry.processRef.processIncarnationId) {
      entry.bindings.delete(targetId);
      throw new Error('target_binding_stale');
    }
    return binding;
  }

  async _liveRevalidate({ profileId, targetId, semanticId, framePath } = {}) {
    const entry = this._runningEntry(profileId);
    const binding = this._liveBinding(entry, targetId);
    const attached = await this._cdp().call('Target.attachToTarget', { targetId: binding.cdp_target_id, flatten: true });
    const sessionId = attached?.sessionId;
    if (!sessionId) throw new Error('live_revalidation_attach_failed');
    try {
      await this._cdp().call('Page.enable', {}, { sessionId });
      const [axRaw, domRaw] = await Promise.all([
        this._cdp().call('Accessibility.getFullAXTree', {}, { sessionId, timeoutMs: 20000 }),
        this._cdp().call('DOMSnapshot.captureSnapshot', { computedStyles: [], includePaintOrder: false, includeDOMRects: true }, { sessionId, timeoutMs: 20000 })
      ]);
      const axNodes = Array.isArray(axRaw?.nodes) ? axRaw.nodes : [];
      const documents = Array.isArray(domRaw?.documents) ? domRaw.documents : [];
      const domRecords = [];
      for (const document of documents.slice(0, 1)) {
        const nodes = document?.nodes || {};
        const layout = document?.layout || {};
        const nodeIndexes = Array.isArray(layout?.nodeIndex) ? layout.nodeIndex : [];
        for (const layoutIndex of nodeIndexes) {
          domRecords.push({ backend_node_id: nodes.backendNodeId?.[layoutIndex] ?? null, node_index: layoutIndex });
        }
      }
      const byBackend = new Map();
      for (const row of domRecords) {
        if (row?.backend_node_id != null) byBackend.set(String(row.backend_node_id), row);
      }
      const match = axNodes.find((node) => {
        const name = String(node?.name?.value || '').trim().toLowerCase();
        const nodeId = String(node?.nodeId || '');
        return name === semanticId.toLowerCase() || nodeId === semanticId;
      });
      if (!match) throw new Error('live_revalidation_semantic_id_not_found');
      const backendDomNodeId = match.backendDOMNodeId ?? null;
      if (backendDomNodeId == null) throw new Error('live_revalidation_backend_id_missing');
      return { backendDomNodeId, sessionId, axNodeId: match.nodeId };
    } finally {
      await this._cdp().call('Target.detachFromTarget', { sessionId, timeoutMs: 2500 }).catch(() => {});
    }
  }

  async _writePendingIntent(intent) {
    const actions = await this._loadActions();
    const record = { ...intent, status: 'PENDING', created_at: new Date().toISOString() };
    actions.actions.push(record);
    await this._saveActions(actions);
    return record;
  }

  async _updateActionStatus(actionId, patch) {
    const actions = await this._loadActions();
    const index = actions.actions.findIndex((a) => a.action_id === actionId);
    if (index >= 0) {
      actions.actions[index] = { ...actions.actions[index], ...patch };
      await this._saveActions(actions);
    }
  }

  _checkAmbiguousRetry(targetId) {
    const actions = this._cache?.actions || [];
    const pending = actions.find((a) => a.target_id === targetId && a.status === 'PENDING');
    if (pending) return { blocked: true, reason: 'ambiguous_effect_recovery_required', pending_action_id: pending.action_id };
    const latest = actions.filter((a) => a.target_id === targetId).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
    if (latest && latest.status === 'AMBIGUOUS') return { blocked: true, reason: 'ambiguous_effect_recovery_required', pending_action_id: latest.action_id };
    return { blocked: false };
  }

  async _enforceLeaseConflict(targetId, leaseId) {
    const existing = this.liveLeases.get(targetId);
    if (existing && existing !== leaseId) {
      throw new Error('actuation_lease_conflict');
    }
    this.liveLeases.set(targetId, leaseId);
  }

  _releaseLease(targetId, leaseId) {
    const current = this.liveLeases.get(targetId);
    if (current === leaseId) this.liveLeases.delete(targetId);
  }

  async executeAction({ action, lease, target, perception, context } = {}) {
    if (!(this._semanticActionEnabled ?? SEMANTIC_ACTION_ENABLED)) throw new Error('semantic_action_not_enabled');
    const intent = validateActionIntent({ ...action, lease });
    if (!intent.ok) throw new Error(intent.reason);

    const leaseCheck = validateLeaseEnvelope(lease, this.sessionKey);
    if (!leaseCheck.ok) throw new Error(leaseCheck.reason);

    const resourceId = String(action?.target_id || '');
    const leaseResourceId = String(lease?.resource_id || '');
    if (resourceId !== leaseResourceId) throw new Error('lease_resource_mismatch');

    const ambiguous = this._checkAmbiguousRetry(resourceId);
    if (ambiguous.blocked) throw new Error(ambiguous.reason);

    const actionId = action.action_id || crypto.randomUUID();
    const kind = String(action?.kind || '').toUpperCase();
    if (!ACTION_KINDS.includes(kind)) throw new Error('action_kind_invalid');

    await this._enforceLeaseConflict(resourceId, lease.lease_id);

    const pendingIntent = {
      action_id: actionId,
      target_id: resourceId,
      profile_id: action.profile_id,
      context_id: action.context_id,
      lease: { lease_id: lease.lease_id, resource_id: lease.resource_id, actor_id: lease.actor_id, not_after: lease.not_after, hmac: lease.hmac },
      kind,
      locator: action.locator || null,
      payload: action.payload || null,
      requested_at: action.requested_at || new Date().toISOString(),
      idempotency_key: action.idempotency_key || crypto.randomUUID()
    };

    await this._writePendingIntent(pendingIntent);

    let cdpResult = { status: 'FAILED_NO_EFFECT', effect_evidence: { dispatched: false } };
    try {
      if (kind === 'NAVIGATE') {
        cdpResult = await this._navigate({ intent: pendingIntent, target, lease });
      } else if (kind === 'CLICK') {
        cdpResult = await this._click({ intent: pendingIntent, target, perception, lease });
      } else if (kind === 'TYPE') {
        cdpResult = await this._type({ intent: pendingIntent, target, perception, lease });
      } else if (kind === 'SUBMIT') {
        cdpResult = await this._submit({ intent: pendingIntent, target, perception, lease });
      } else {
        throw new Error('action_kind_unsupported');
      }
    } catch (error) {
      if (['target_not_bound', 'target_binding_stale', 'actuation_lease_conflict', 'ambiguous_effect_recovery_required'].includes(error.message)) throw error;
      cdpResult = { status: 'FAILED_NO_EFFECT', effect_evidence: { dispatched: false, error: String(error?.message || error) } };
    } finally {
      // lease persists until explicit release or kernel cleanup
      await this._updateActionStatus(actionId, { status: cdpResult.status, effect_evidence: cdpResult.effect_evidence });
    }

    const receipt = emitReceipt({
      lease: { lease_id: lease.lease_id, resource_id: lease.resource_id },
      action: { action_id: actionId, target_id: resourceId, profile_id: action.profile_id, context_id: action.context_id, kind },
      result: cdpResult,
      processIncarnationId: target?.process_incarnation_id || (this.runtime?.running.get(action.profile_id)?.processRef?.processIncarnationId || ''),
      sessionKey: this.sessionKey
    });

    if (this.receiptsStore) {
      await this.receiptsStore.append(receipt);
    }

    return receipt;
  }

  async _navigate({ intent, target, lease } = {}) {
    const url = String(intent?.payload?.url || '').trim();
    if (!url) throw new Error('navigate_url_required');
    const entry = this._runningEntry(intent.profile_id);
    const binding = this._liveBinding(entry, intent.target_id);
    const result = await this._cdp().call('Page.navigate', { url, targetId: binding.cdp_target_id });
    if (result?.errorText) throw new Error(`cdp_navigate_failed:${result.errorText}`);
    await new Promise((r) => setTimeout(r, 200));
    const frameTree = await this._cdp().call('Page.getFrameTree', {}, { sessionId: binding.cdp_target_id }).catch(async () => {
      const attached = await this._cdp().call('Target.attachToTarget', { targetId: binding.cdp_target_id, flatten: true });
      return this._cdp().call('Page.getFrameTree', {}, { sessionId: attached?.sessionId }).catch(() => ({}));
    });
    const mainFrame = frameTree?.frameTree?.frame || frameTree?.frame || null;
    const documentEpochAfter = mainFrame?.id ? `${mainFrame.id}:${mainFrame.loaderId || 'loader-unavailable'}` : 'unknown';
    return { status: 'EFFECTED', effect_evidence: { dispatched: true, document_epoch_after: documentEpochAfter } };
  }

  async _click({ intent, target, perception, lease } = {}) {
    if (!intent?.locator?.semantic_id) throw new Error('semantic_id_required');
    const revalidation = await this._liveRevalidate({ profileId: intent.profile_id, targetId: intent.target_id, semanticId: intent.locator.semantic_id, framePath: intent.locator.frame_path });
    const entry = this._runningEntry(intent.profile_id);
    const binding = this._liveBinding(entry, intent.target_id);
    const layout = await this._cdp().call('Page.getLayoutMetrics', {}, { sessionId: revalidation.sessionId });
    const viewport = layout?.cssVisualViewport || layout?.cssLayoutViewport || { width: 1280, height: 720 };
    const bounds = [Math.round(viewport.width / 2), Math.round(viewport.height / 2), 10, 10];
    await this._cdp().call('Input.dispatchMouseEvent', { type: 'mousePressed', x: bounds[0], y: bounds[1], button: 'left', clickCount: 1 }, { sessionId: revalidation.sessionId });
    await this._cdp().call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: bounds[0], y: bounds[1], button: 'left', clickCount: 1 }, { sessionId: revalidation.sessionId });
    return { status: 'EFFECTED', effect_evidence: { dispatched: true, bound_backend_dom_node_id: revalidation.backendDomNodeId } };
  }

  async _type({ intent, target, perception, lease } = {}) {
    if (!intent?.locator?.semantic_id) throw new Error('semantic_id_required');
    const text = String(intent?.payload?.text || '');
    if (!text) throw new Error('type_text_required');
    const revalidation = await this._liveRevalidate({ profileId: intent.profile_id, targetId: intent.target_id, semanticId: intent.locator.semantic_id, framePath: intent.locator.frame_path });
    await this._cdp().call('Input.insertText', { text }, { sessionId: revalidation.sessionId });
    const inputSha256 = crypto.createHash('sha256').update(text).digest('hex');
    return { status: 'EFFECTED', effect_evidence: { dispatched: true, bound_backend_dom_node_id: revalidation.backendDomNodeId, input_sha256: inputSha256 } };
  }

  async _submit({ intent, target, perception, lease } = {}) {
    if (!intent?.locator?.semantic_id) throw new Error('semantic_id_required');
    const revalidation = await this._liveRevalidate({ profileId: intent.profile_id, targetId: intent.target_id, semanticId: intent.locator.semantic_id, framePath: intent.locator.frame_path });
    await this._cdp().call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, { sessionId: revalidation.sessionId });
    await this._cdp().call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, { sessionId: revalidation.sessionId });
    return { status: 'EFFECTED', effect_evidence: { dispatched: true, bound_backend_dom_node_id: revalidation.backendDomNodeId } };
  }

  async close() {
    this._cache = null;
    this.liveLeases.clear();
  }
}

export function createActionKernel({ runtime, cdpClient, profileDir, sessionKey, receiptsStore } = {}) {
  return new ActionKernel({ runtime, cdpClient, profileDir, sessionKey, receiptsStore });
}
