import crypto from 'node:crypto';
import { chatGptControlMatches } from './chatgpt-ui-controls.mjs';
import { openCdpOutcomeLatch } from './browser-cdp-outcome-latch.mjs';
import {
  nativeBrowserCdpPool,
  recoverNativeExecutionContextBinding,
  releasePersistentBrowserDebugger,
  withPersistentBrowserDebugger,
} from './browser-persistent-cdp-session.mjs';
import {
  assertNativeEffectBindingMatches,
  nativeActionRequiresEffectBinding,
} from './native-effect-binding.mjs';
import {
  assertNativeEffectRuntimeBindingCurrent,
  latestNativeEffectRuntimeObservationForTarget,
  projectNativeRuntimeStateRevision,
  recordNativeEffectRuntimeObservation,
} from './native-effect-runtime-observation.mjs';
import {
  assertNativeSemanticRefCurrent,
  buildNativeSemanticRef,
} from './native-semantic-ref.mjs';
import { resolveExactWebContentsView } from './browser-webcontents-tab-index.mjs';
import { withTemporaryDetachedCaptureSurface } from './browser-detached-capture-surface.mjs';
import { isAgentPlatformConversationUrl, isAgentPlatformHost } from './browser-agent-platform.mjs';

const SAFE_ROLES = new Set(['textbox','searchbox','combobox','button','checkbox','radio','switch','tab','menuitem','link']);
const TEXT_INPUT_ROLES = new Set(['textbox','searchbox','combobox']);
// PRESS_KEY (2026-09-19 action-variability directive): geometry-free single
// key dispatch to a tab. Whitelisted non-printing keys only — printing keys
// and modifier combinations stay on the semantic type lane so every text
// effect keeps its exact composer/ref proof contract.
const SAFE_PRESS_KEYS = new Map([
  ['Escape', { code: 'Escape', keyCode: 27 }],
  ['Tab', { code: 'Tab', keyCode: 9 }],
  ['Enter', { code: 'Enter', keyCode: 13 }],
  ['ArrowUp', { code: 'ArrowUp', keyCode: 38 }],
  ['ArrowDown', { code: 'ArrowDown', keyCode: 40 }],
  ['ArrowLeft', { code: 'ArrowLeft', keyCode: 37 }],
  ['ArrowRight', { code: 'ArrowRight', keyCode: 39 }],
  ['Home', { code: 'Home', keyCode: 36 }],
  ['End', { code: 'End', keyCode: 35 }],
  ['PageUp', { code: 'PageUp', keyCode: 33 }],
  ['PageDown', { code: 'PageDown', keyCode: 34 }],
  ['Delete', { code: 'Delete', keyCode: 46 }],
  ['Backspace', { code: 'Backspace', keyCode: 8 }],
]);
const CHATGPT_COMPOSER_NAMES = new Set(['Чат с ChatGPT', 'Chat with ChatGPT', 'Message ChatGPT']);
const CDP_SUBMIT_OUTCOME_METHODS = new Set([
  'Accessibility.nodesUpdated',
  'DOM.documentUpdated',
  'Page.frameNavigated',
  'Page.navigatedWithinDocument',
  'Page.lifecycleEvent',
  'Runtime.executionContextCreated',
]);
const NATIVE_BROWSER_PROCESS_INCARNATION_ID = crypto.randomUUID();
const DEFAULT_CAPTURE_VIEW_MAX_ATTEMPTS = 5;
const DEFAULT_CAPTURE_VIEW_RETRY_DELAY_MS = 150;
const DEFAULT_CAPTURE_CDP_DEADLINE_MS = 5000;
// Command execution may legitimately span several CDP round-trips (AX tree walks,
// submit outcome latches), so its deadline is far more generous than capture's.
// The bound exists because an unbounded CDP await was observed live to wedge the
// single steady-state command lease loop (one_steady_state_lease_loop): heartbeat
// stayed alive while the whole command plane froze. A deadline turns that wedge
// into a fail-closed FAILED command and frees the loop.
const DEFAULT_COMMAND_CDP_DEADLINE_MS = 30000;
const clip = (value, max) => String(value ?? '').slice(0, max);
const axRawValue = (node, key) => String(node?.[key]?.value ?? '');
const axValue = (node, key) => axRawValue(node, key).trim();
function axPropertyValue(node, key) {
  const row = (Array.isArray(node?.properties) ? node.properties : [])
    .find((property) => String(property?.name || '') === String(key));
  return row?.value?.value ?? null;
}
function normalizedSemanticRole(node) {
  const role = axValue(node, 'role').toLowerCase();
  if (TEXT_INPUT_ROLES.has(role)) return role;
  // R82 liveness hardening: controlled editors can expose an explicitly
  // editable AX node without Chromium preserving the historical textbox role.
  // Normalize only explicit AX editability; never infer write authority from
  // names, geometry, focus, DOM text, or provider-specific selectors.
  const editable = String(axPropertyValue(node, 'editable') ?? '').trim().toLowerCase();
  return ['true', 'plaintext', 'richtext'].includes(editable) ? 'textbox' : role;
}
const sha256 = (value) => crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');

export function nativeBrowserTargetIdentity(webContents) {
  if (!webContents || webContents.isDestroyed?.()) throw new Error('native_control_webcontents_unavailable');
  const id = Number(webContents.id);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('native_control_webcontents_id_invalid');
  return Object.freeze({
    process_incarnation_id: NATIVE_BROWSER_PROCESS_INCARNATION_ID,
    target_id: `webcontents:${id}`,
    authority_effect: false,
  });
}

async function withDebugger(webContents, fn) {
  if (!webContents || webContents.isDestroyed?.()) throw new Error('native_control_webcontents_unavailable');
  return withPersistentBrowserDebugger(webContents, fn);
}

function semanticNodeFrameIds(nodes = []) {
  const byId = new Map(nodes.map((node) => [String(node?.nodeId || ''), node]));
  const resolved = new Map();
  const resolving = new Set();
  const frameFor = (node) => {
    const nodeId = String(node?.nodeId || '');
    if (resolved.has(nodeId)) return resolved.get(nodeId);
    if (!nodeId || resolving.has(nodeId)) return null;
    resolving.add(nodeId);
    const direct = clip(node?.frameId, 192) || null;
    const inherited = direct || frameFor(byId.get(String(node?.parentId || '')));
    resolving.delete(nodeId);
    resolved.set(nodeId, inherited);
    return inherited;
  };
  for (const node of nodes) frameFor(node);
  return resolved;
}

function uniqueSemanticTargets(nodes = [], { semanticRefContext = null } = {}) {
  const candidates = [];
  const counts = new Map();
  const frameIds = semanticNodeFrameIds(nodes);
  for (const node of nodes) {
    if (node?.ignored === true) continue;
    const role = normalizedSemanticRole(node);
    const name = axValue(node, 'name');
    const backendNodeId = Number(node?.backendDOMNodeId || 0);
    // GLM agent platform (2026-09-19): the chat.z.ai composer is a textarea
    // whose accessible name is a localized placeholder — it can be unnamed in
    // other locales or conversation surfaces. Unnamed text inputs stay
    // addressable through the exact semantic_ref (backend node id); unnamed
    // non-input controls stay hidden so there is no ambiguous click authority.
    if (!SAFE_ROLES.has(role) || (!name && !TEXT_INPUT_ROLES.has(role)) || !Number.isInteger(backendNodeId) || backendNodeId <= 0) continue;
    const key = `${role}\u0000${name}`;
    if (name) counts.set(key, Number(counts.get(key) || 0) + 1);
    const frameId = frameIds.get(String(node?.nodeId || '')) || null;
    const row = {
      role,
      name: name ? clip(name, 240) : null,
      backend_node_id: backendNodeId,
      frame_id: frameId,
      selector_mode: name ? 'ROLE_NAME_OR_BACKEND_NODE_ID' : 'BACKEND_NODE_ID_REQUIRED',
    };
    if (
      semanticRefContext
      && frameId
      && frameId === semanticRefContext.frameId
    ) {
      row.semantic_ref = buildNativeSemanticRef({
        stateRevisionId: semanticRefContext.stateRevisionId,
        targetId: semanticRefContext.targetId,
        runtimeTargetId: semanticRefContext.runtimeTargetId,
        frameId,
        backendNodeId,
        executionContextUniqueId: semanticRefContext.executionContextUniqueId,
        role,
        name: row.name,
      });
    }
    if (TEXT_INPUT_ROLES.has(role)) {
      const value = axRawValue(node, 'value');
      row.value_length = value.length;
      row.value_sha256 = value ? sha256(value) : null;
      row.value_exposed = false;
    }
    candidates.push(row);
  }
  // D-P1 (2026-09-18): a sidebar-heavy ChatGPT surface can saturate the 120-target
  // bound with link/button nodes alone, truncating the composer textbox out of the
  // semantic projection. Every unique text-input row is therefore reserved ahead of
  // the bound; the total projection stays capped at 120 rows.
  const uniqueRows = candidates.filter((row) => !row.name || counts.get(`${row.role}\u0000${row.name}`) === 1);
  const inputRows = uniqueRows.filter((row) => TEXT_INPUT_ROLES.has(row.role));
  const otherRows = uniqueRows.filter((row) => !TEXT_INPUT_ROLES.has(row.role));
  return [...inputRows, ...otherRows].slice(0, 120);
}

function textExcerpt(nodes = []) {
  const parts = [];
  for (const node of nodes) {
    if (node?.ignored === true) continue;
    const role = axValue(node, 'role').toLowerCase();
    const name = axValue(node, 'name');
    if (!name) continue;
    if (['statictext','heading','paragraph','listitem','article','status','alert'].includes(role)) parts.push(name);
    if (parts.join('\n').length >= 12000) break;
  }
  return clip(parts.join('\n'), 12000);
}

// Structured perception (Tier 2 break repair #8, perception poverty): the
// interaction element tree — role / text / selector / visibility per element
// with a bounded ancestor role path, derived from the SAME Accessibility tree
// the frame already walks. Read-only projection: no geometry, no input
// values, no authority. Agents and operators get addressable structure
// instead of a flat text excerpt.
const INTERACTION_TREE_ROLES = new Set([
  ...SAFE_ROLES,
  'heading', 'paragraph', 'link', 'statictext', 'listitem', 'article', 'status', 'alert', 'dialog', 'menu', 'menubar', 'list', 'listitem', 'navigation', 'region', 'main',
]);
const INTERACTION_TREE_MAX_ELEMENTS = 96;
const INTERACTION_TREE_MAX_DEPTH = 8;

export function buildInteractionTree(nodes = []) {
  const byNodeId = new Map();
  for (const node of nodes) {
    const id = String(node?.nodeId || '');
    if (id) byNodeId.set(id, node);
  }
  const rolePath = (node) => {
    const parts = [];
    let current = node;
    for (let depth = 0; current && depth < INTERACTION_TREE_MAX_DEPTH; depth += 1) {
      const role = axValue(current, 'role').toLowerCase();
      if (role && role !== 'none' && role !== 'generic' && role !== 'ignored') parts.unshift(role);
      current = current?.parentId ? byNodeId.get(String(current.parentId)) : null;
    }
    return parts;
  };
  const visibilityOf = (node) => {
    const properties = Array.isArray(node?.properties) ? node.properties : [];
    for (const property of properties) {
      if (String(property?.name || '') === 'hidden') {
        const value = property?.value?.value;
        return value !== true;
      }
    }
    return null;
  };
  const elements = [];
  for (const node of nodes) {
    if (elements.length >= INTERACTION_TREE_MAX_ELEMENTS) break;
    if (node?.ignored === true) continue;
    const role = axValue(node, 'role').toLowerCase();
    const text = axValue(node, 'name');
    if (!INTERACTION_TREE_ROLES.has(role) || !text) continue;
    const backendNodeId = Number(node?.backendDOMNodeId || 0);
    const path = rolePath(node).join('>');
    elements.push(Object.freeze({
      path: clip(path || role, 160),
      role,
      text: clip(text, 160),
      selector: Number.isInteger(backendNodeId) && backendNodeId > 0 ? `backend_node_id:${backendNodeId}` : null,
      visible: visibilityOf(node),
    }));
  }
  return Object.freeze({
    schema: 'metaengine.native-browser.interaction-tree.v1',
    element_count: elements.length,
    truncated: elements.length >= INTERACTION_TREE_MAX_ELEMENTS,
    elements: Object.freeze(elements),
    input_values_exposed: false,
    authority_effect: false,
  });
}

// READ_TRANSCRIPT (2026-09-19 observability directive): paged, bounded text
// read of a conversation surface. Same AX-tree text projection as the frame
// excerpt, but with an explicit offset and a larger ceiling so agents and
// supervisors can read long GLM conversations the 12k frame excerpt cannot
// hold. Read-only: no semantic refs, no input values, no authority.
export async function captureTranscript(webContents, { offset = 0, max_chars = 48000 } = {}) {
  const identity = nativeBrowserTargetIdentity(webContents);
  const boundedOffset = Math.max(0, Math.min(240000, Number(offset) || 0));
  const boundedMax = Math.max(1000, Math.min(60000, Number(max_chars) || 48000));
  return withDebugger(webContents, async (dbg) => {
    const tree = await dbg.sendCommand('Accessibility.getFullAXTree');
    const nodes = Array.isArray(tree?.nodes) ? tree.nodes : [];
    const parts = [];
    let total = 0;
    for (const node of nodes) {
      if (node?.ignored === true) continue;
      const role = axValue(node, 'role').toLowerCase();
      const name = axValue(node, 'name');
      if (!name) continue;
      if (['statictext','heading','paragraph','listitem','article','status','alert'].includes(role)) {
        parts.push(name);
        total += name.length + 1;
        if (total >= boundedOffset + boundedMax) break;
      }
    }
    const full = parts.join('\n');
    const page = full.slice(boundedOffset, boundedOffset + boundedMax);
    return {
      schema: 'metaengine.native-browser.transcript.v1',
      captured_at: new Date().toISOString(),
      process_incarnation_id: identity.process_incarnation_id,
      target_id: identity.target_id,
      url: clip(webContents.getURL?.() || '', 1200),
      title: clip(webContents.getTitle?.() || '', 240),
      offset: boundedOffset,
      max_chars: boundedMax,
      total_chars: Math.min(full.length, 240000),
      has_more: boundedOffset + page.length < full.length,
      text: page,
      semantic_refs_issued: 0,
      page_data_authority: false,
      authority_effect: false,
    };
  });
}

function isChatGptConversationUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:'
      && ['chatgpt.com','www.chatgpt.com'].includes(url.hostname.toLowerCase())
      && /^\/c\/[a-z0-9-]+\/?$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function exactChatGptControls(nodes, kind) {
  return uniqueSemanticTargets(nodes).filter((row) => row.role === 'button' && chatGptControlMatches(kind, row.name));
}

function isExactChatGptComposer(target, command) {
  return String(command?.platform || '').toUpperCase() === 'CHATGPT'
    && target?.role === 'textbox'
    && CHATGPT_COMPOSER_NAMES.has(String(target?.name || ''));
}

// The GLM composer gate. The target already comes from an exact semantic_ref
// (backend node identity is pinned by the ref), so the gate adds the platform,
// the live host and the text-input role. The composer's accessible name is a
// localized placeholder and is deliberately NOT part of the gate.
function isExactGlmComposer(webContents, target, command) {
  if (String(command?.platform || '').toUpperCase() !== 'GLM_ZAI') return false;
  let host = '';
  try { host = new URL(String(webContents?.getURL?.() || '')).hostname.toLowerCase(); } catch {}
  return isAgentPlatformHost(host) && TEXT_INPUT_ROLES.has(String(target?.role || ''));
}

// GLM submit readback: the composer's AX value returning to '' proves the
// site consumed the typed prompt; a root -> /c/<id> transition proves a new
// conversation was created. Both are URL/metadata-class proofs — no named
// control exists on chat.z.ai to hang a GENERATING observation on.
// D-K2: also the in-command composer value reader for verified replaces.
// Returns null when the node is absent (unproven), '' when provably empty.
async function readBackendNodeValue(dbg, backendNodeId) {
  const tree = await dbg.sendCommand('Accessibility.getFullAXTree').catch(() => null);
  const nodes = Array.isArray(tree?.nodes) ? tree.nodes : [];
  const node = nodes.find((row) => row?.ignored !== true && Number(row?.backendDOMNodeId || 0) === Number(backendNodeId));
  return node ? axRawValue(node, 'value') : null;
}

async function inspectGlmSubmit(dbg, webContents, { preUrl, backendNodeId } = {}) {
  // D-M1 consistency: the AX tree snapshot and the URL read must come from
  // the same instant. A submit landing between the tree await and the URL
  // read used to produce a mixed-epoch observation (pre-submit composer
  // value + post-submit /c/ URL), misreporting the composer as uncleared.
  // When the URL moved across the tree read, re-read the tree ONCE so both
  // proofs describe the same post-navigation surface. Bounded: two reads max.
  const urlBeforeTree = clip(webContents.getURL?.() || '', 1200);
  let tree = await dbg.sendCommand('Accessibility.getFullAXTree');
  let url = clip(webContents.getURL?.() || '', 1200);
  if (url !== urlBeforeTree) {
    tree = await dbg.sendCommand('Accessibility.getFullAXTree');
    url = clip(webContents.getURL?.() || '', 1200);
  }
  const nodes = Array.isArray(tree?.nodes) ? tree.nodes : [];
  const node = nodes.find((row) => row?.ignored !== true && Number(row?.backendDOMNodeId || 0) === Number(backendNodeId));
  const value = node ? axRawValue(node, 'value') : null;
  const composerCleared = node != null && value === '';
  const rootToConversation = !isAgentPlatformConversationUrl(preUrl) && isAgentPlatformConversationUrl(url);
  if (composerCleared || rootToConversation) {
    return {
      resolved: true,
      effect_state: composerCleared ? 'PROVEN_COMPOSER_CLEARED' : 'PROVEN_NEW_CONVERSATION',
      stop_observed: false,
      composer_cleared: composerCleared,
      new_conversation_observed: rootToConversation,
      post_url_sha256: url ? sha256(url) : null,
      automatic_retry_allowed: false,
      authority_effect: false,
    };
  }
  return {
    resolved: false,
    effect_state: 'PENDING_AFTER_ENTER',
    stop_observed: false,
    composer_cleared: false,
    new_conversation_observed: false,
    post_url_sha256: url ? sha256(url) : null,
    observation_error: null,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
}

function openGlmSubmitOutcomeLatch(dbg, webContents, { preUrl, backendNodeId, timeoutMs = 2000 } = {}) {
  return openCdpOutcomeLatch({
    subscribe: (listener) => nativeBrowserCdpPool.subscribe(webContents, listener),
    inspect: () => inspectGlmSubmit(dbg, webContents, { preUrl, backendNodeId }),
    isResolved: (row) => row?.resolved === true,
    onDeadline: (last, lastError) => ({
      resolved: false,
      effect_state: 'AMBIGUOUS_AFTER_ENTER',
      stop_observed: false,
      composer_cleared: last?.composer_cleared === true,
      new_conversation_observed: last?.new_conversation_observed === true,
      post_url_sha256: last?.post_url_sha256 || null,
      observation_error: lastError || null,
      automatic_retry_allowed: false,
      authority_effect: false,
    }),
    eventFilter: (event) => CDP_SUBMIT_OUTCOME_METHODS.has(String(event?.method || '')),
    timeoutMs,
  });
}

async function inspectChatGptSubmit(dbg, webContents, { preUrl } = {}) {
  const tree = await dbg.sendCommand('Accessibility.getFullAXTree');
  const nodes = Array.isArray(tree?.nodes) ? tree.nodes : [];
  const stopCount = exactChatGptControls(nodes, 'STOP').length;
  const sendCount = exactChatGptControls(nodes, 'SEND').length;
  const url = clip(webContents.getURL?.() || '', 1200);
  const rootToConversation = !isChatGptConversationUrl(preUrl) && isChatGptConversationUrl(url);
  if (stopCount === 1 || rootToConversation) {
    return {
      resolved: true,
      effect_state: stopCount === 1 ? 'PROVEN_GENERATING' : 'PROVEN_NEW_CONVERSATION',
      stop_observed: stopCount === 1,
      new_conversation_observed: rootToConversation,
      send_control_remaining: sendCount > 0,
      post_url_sha256: url ? sha256(url) : null,
      automatic_retry_allowed: false,
      authority_effect: false,
    };
  }
  return {
    resolved: false,
    effect_state: 'PENDING_AFTER_ENTER',
    stop_observed: false,
    new_conversation_observed: false,
    send_control_remaining: sendCount > 0,
    post_url_sha256: url ? sha256(url) : null,
    observation_error: null,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
}

function openChatGptSubmitOutcomeLatch(dbg, webContents, { preUrl, timeoutMs = 2000 } = {}) {
  return openCdpOutcomeLatch({
    subscribe: (listener) => nativeBrowserCdpPool.subscribe(webContents, listener),
    inspect: () => inspectChatGptSubmit(dbg, webContents, { preUrl }),
    isResolved: (row) => row?.resolved === true,
    onDeadline: (last, lastError) => ({
      resolved: false,
      effect_state: 'AMBIGUOUS_AFTER_ENTER',
      stop_observed: last?.stop_observed === true,
      new_conversation_observed: last?.new_conversation_observed === true,
      send_control_remaining: last?.send_control_remaining === true,
      post_url_sha256: last?.post_url_sha256 || null,
      observation_error: lastError || null,
      automatic_retry_allowed: false,
      authority_effect: false,
    }),
    eventFilter: (event) => CDP_SUBMIT_OUTCOME_METHODS.has(String(event?.method || '')),
    timeoutMs,
  });
}

export async function captureSemanticFrame(webContents) {
  const identity = nativeBrowserTargetIdentity(webContents);
  return withDebugger(webContents, async (dbg) => {
    const [tree, metrics] = await Promise.all([
      dbg.sendCommand('Accessibility.getFullAXTree'),
      dbg.sendCommand('Page.getLayoutMetrics').catch(() => null),
    ]);
    const nodes = Array.isArray(tree?.nodes) ? tree.nodes : [];
    const viewport = metrics?.cssVisualViewport || metrics?.visualViewport || null;
    const capturedAt = new Date().toISOString();
    const url = clip(webContents.getURL?.() || '', 1200);
    let runtime = dbg.bindingIdentity?.() || null;
    if (runtime && runtime.main_frame_id && !runtime.main_execution_context_unique_id) {
      // D-L4 v2: a document replacement after attach clears the execution-
      // context binding, and idempotent Runtime.enable never re-delivers it.
      // Attempt a bounded disable -> enable toggle recovery so semantic refs
      // can be issued for THIS document instead of staying dead forever.
      await recoverNativeExecutionContextBinding(webContents);
      runtime = dbg.bindingIdentity?.() || runtime;
    }
    let runtimeObservation = null;
    if (runtime) {
      try {
        runtimeObservation = recordNativeEffectRuntimeObservation({
          process_incarnation_id: identity.process_incarnation_id,
          target_id: identity.target_id,
          observed_at: capturedAt,
          document_url_sha256: sha256(url),
          runtime_binding: {
            web_contents_id: runtime.web_contents_id,
            renderer_pid: runtime.os_pid,
            runtime_target_id: runtime.target_id,
            attachment_generation: runtime.attachment_generation,
            document_generation: runtime.document_generation,
            binding_generation: runtime.binding_generation,
            semantic_generation: runtime.semantic_generation,
          },
        });
      } catch {}
    }
    const semanticRefContext = runtimeObservation
      && runtime?.main_frame_id
      && runtime?.main_execution_context_unique_id
      ? {
          stateRevisionId: runtimeObservation.state_revision_id,
          targetId: identity.target_id,
          runtimeTargetId: runtimeObservation.runtime_binding.runtime_target_id,
          frameId: runtime.main_frame_id,
          executionContextUniqueId: runtime.main_execution_context_unique_id,
        }
      : null;
    const semanticTargets = uniqueSemanticTargets(nodes, { semanticRefContext });
    return {
      schema: 'metaengine.native-browser.perception.v1',
      captured_at: capturedAt,
      process_incarnation_id: identity.process_incarnation_id,
      target_id: identity.target_id,
      url,
      title: clip(webContents.getTitle?.() || '', 240),
      semantic_targets: semanticTargets,
      unnamed_text_inputs_addressable_by_backend_node_id: true,
      semantic_refs_issued: semanticTargets.filter((row) => row.semantic_ref).length,
      semantic_ref_context_complete: semanticRefContext != null,
      semantic_input_values_exposed: false,
      semantic_input_value_hashes: true,
      text_excerpt: textExcerpt(nodes),
      interaction_tree: buildInteractionTree(nodes),
      viewport: viewport ? {
        width: Number(viewport.clientWidth || viewport.width || 0),
        height: Number(viewport.clientHeight || viewport.height || 0),
        page_x: Number(viewport.pageX || 0),
        page_y: Number(viewport.pageY || 0),
        scale: Number(viewport.scale || 1),
      } : null,
      runtime_binding_observed: runtimeObservation != null,
      runtime_observation_id: runtimeObservation?.observation_id || null,
      state_revision_id: runtimeObservation?.state_revision_id || null,
      runtime_main_frame_id: runtime?.main_frame_id || null,
      runtime_execution_context_unique_id: runtime?.main_execution_context_unique_id || null,
      runtime_binding_generation: runtimeObservation?.runtime_binding?.binding_generation || null,
      runtime_document_generation: runtimeObservation?.runtime_binding?.document_generation || null,
      authority_effect: false,
    };
  });
}


// D-M1 (live 2026-09-19): animated off-screen surfaces (suggestion carousels,
// timers, skeleton loaders) mutate the DOM continuously, advancing only
// semantic_generation and invalidating EVERY captured semantic ref on the tab
// within milliseconds — observed live as three consecutive
// CAPTURE -> SEMANTIC_TYPE native_semantic_ref_stale failures against a
// stable, un-navigated composer, plus spurious D-K7 composer rollovers. A DOM
// mutation anywhere does not change the identity of an unrelated node:
// backend_node_id is stable for the node's lifetime and role/name evidence
// re-read from a fresh AX tree proves the node is still exactly what the ref
// captured. Re-anchoring is therefore permitted when the SOLE delta since the
// binding observation is semantic_generation — same document, same runtime
// binding, same URL, same frame, same execution context — and fails closed on
// any document/binding/URL movement (navigations, re-attachments and
// same-document navigations still kill refs outright).
function isMutationOnlySemanticChurn(latestRevision, currentRevision) {
  if (!latestRevision || !currentRevision) return false;
  return latestRevision.process_incarnation_id === currentRevision.process_incarnation_id
    && latestRevision.target_id === currentRevision.target_id
    && latestRevision.web_contents_id === currentRevision.web_contents_id
    && Number(latestRevision.renderer_pid) === Number(currentRevision.renderer_pid)
    && latestRevision.runtime_target_id === currentRevision.runtime_target_id
    && Number(latestRevision.attachment_generation) === Number(currentRevision.attachment_generation)
    && Number(latestRevision.document_generation) === Number(currentRevision.document_generation)
    && Number(latestRevision.binding_generation) === Number(currentRevision.binding_generation)
    && latestRevision.document_url_sha256 === currentRevision.document_url_sha256
    && Number(currentRevision.semantic_generation) > Number(latestRevision.semantic_generation);
}

function classifySemanticRefCurrency(webContents, dbg) {
  const identity = nativeBrowserTargetIdentity(webContents);
  const runtime = dbg.bindingIdentity?.() || null;
  const latest = latestNativeEffectRuntimeObservationForTarget({ target_id: identity.target_id });
  if (!runtime || !latest || !runtime.main_frame_id || !runtime.main_execution_context_unique_id) {
    return { identity, runtime: null, latest: null, currentRevision: null, currency: 'STALE' };
  }
  const currentRevision = projectNativeRuntimeStateRevision({
    process_incarnation_id: identity.process_incarnation_id,
    target_id: identity.target_id,
    document_url_sha256: sha256(clip(webContents.getURL?.() || '', 1200)),
    runtime_binding: {
      web_contents_id: runtime.web_contents_id,
      renderer_pid: runtime.os_pid,
      runtime_target_id: runtime.target_id,
      attachment_generation: runtime.attachment_generation,
      document_generation: runtime.document_generation,
      binding_generation: runtime.binding_generation,
      semantic_generation: runtime.semantic_generation,
    },
  });
  if (latest.state_revision_id === currentRevision.revision_id) {
    return { identity, runtime, latest, currentRevision, currency: 'CURRENT' };
  }
  if (isMutationOnlySemanticChurn(latest.state_revision, currentRevision)) {
    return { identity, runtime, latest, currentRevision, currency: 'MUTATION_CHURN' };
  }
  return { identity, runtime, latest, currentRevision, currency: 'STALE' };
}

// Re-anchor a mutation-churned ref to the current revision: re-resolve the
// exact node by backend_node_id through the SAME capture-path projection
// (uniqueSemanticTargets with a freshly recorded observation), then require
// the re-read role/name evidence to still match what the ref captured. The
// physical effect is never retried here — only the perception binding moves
// forward, so the no-double-effect contract of every command lane is intact.
async function reanchorSemanticRef(webContents, dbg, ref, { identity, runtime, currentRevision }) {
  const tree = await dbg.sendCommand('Accessibility.getFullAXTree');
  const runtimeObservation = recordNativeEffectRuntimeObservation({
    process_incarnation_id: identity.process_incarnation_id,
    target_id: identity.target_id,
    observed_at: new Date().toISOString(),
    document_url_sha256: currentRevision.document_url_sha256,
    runtime_binding: {
      web_contents_id: runtime.web_contents_id,
      renderer_pid: runtime.os_pid,
      runtime_target_id: runtime.target_id,
      attachment_generation: runtime.attachment_generation,
      document_generation: runtime.document_generation,
      binding_generation: runtime.binding_generation,
      semantic_generation: runtime.semantic_generation,
    },
  });
  const semanticRefContext = runtime.main_frame_id && runtime.main_execution_context_unique_id
    ? {
        stateRevisionId: runtimeObservation.state_revision_id,
        targetId: identity.target_id,
        runtimeTargetId: runtimeObservation.runtime_binding.runtime_target_id,
        frameId: runtime.main_frame_id,
        executionContextUniqueId: runtime.main_execution_context_unique_id,
      }
    : null;
  const rows = uniqueSemanticTargets(tree?.nodes || [], { semanticRefContext });
  const evidenceRole = ref?.evidence?.role ? String(ref.evidence.role).toLowerCase() : null;
  const evidenceName = ref?.evidence?.name ? clip(String(ref.evidence.name), 240) : null;
  const row = rows.find((candidate) => Number(candidate.backend_node_id) === Number(ref?.backend_node_id)) || null;
  if (
    !row
    || !row.semantic_ref
    || (evidenceRole && row.role !== evidenceRole)
    || (row.name || null) !== (evidenceName || null)
  ) {
    throw new Error('native_semantic_ref_stale');
  }
  return row;
}

// Currency gate for every semantic-command checkpoint: returns a ref that is
// proven current for THIS instant, re-anchoring across mutation-only churn
// and failing closed on any document-level movement.
async function requireCurrentSemanticRef(webContents, dbg, ref) {
  if (!ref) throw new Error('native_semantic_ref_required');
  const state = classifySemanticRefCurrency(webContents, dbg);
  if (state.currency === 'CURRENT') {
    return assertNativeSemanticRefCurrent({
      ref,
      stateRevisionId: state.currentRevision.revision_id,
      targetId: state.identity.target_id,
      runtimeTargetId: state.runtime.target_id,
      frameId: state.runtime.main_frame_id,
      backendNodeId: ref.backend_node_id,
      executionContextUniqueId: state.runtime.main_execution_context_unique_id,
    });
  }
  if (state.currency === 'MUTATION_CHURN') {
    return (await reanchorSemanticRef(webContents, dbg, ref, state)).semantic_ref;
  }
  throw new Error('native_semantic_ref_stale');
}

async function exactTarget(webContents, dbg, roleRaw, nameRaw, semanticRef) {
  if (semanticRef) {
    // D-M1: the gate re-anchors across mutation-only churn (carousel ticks),
    // so resolution survives an animated surface without ever relaxing the
    // document-level staleness fence.
    const ref = await requireCurrentSemanticRef(webContents, dbg, semanticRef);
    return {
      role: String(ref?.evidence?.role || roleRaw || '').trim().toLowerCase(),
      name: String(ref?.evidence?.name || nameRaw || '').trim(),
      backend_node_id: ref.backend_node_id,
      frame_id: ref.frame_id,
      semantic_ref: ref,
    };
  }
  const tree = await dbg.sendCommand('Accessibility.getFullAXTree');
  const role = String(roleRaw || '').trim().toLowerCase();
  const name = String(nameRaw || '').trim();
  if (!SAFE_ROLES.has(role) || !name) throw new Error('native_semantic_target_invalid');
  const matches = uniqueSemanticTargets(tree?.nodes || []).filter((row) => row.role === role && row.name === name);
  if (matches.length !== 1) throw new Error(matches.length ? `native_semantic_target_ambiguous:${matches.length}` : 'native_semantic_target_not_found');
  return matches[0];
}

async function clickBackendNode(dbg, backendNodeId, beforeDispatch = null, { clickCount = 1 } = {}) {
  const model = await dbg.sendCommand('DOM.getBoxModel', { backendNodeId });
  const quad = model?.model?.content || model?.model?.border;
  if (!Array.isArray(quad) || quad.length < 8) throw new Error('native_semantic_box_unavailable');
  const xs = [quad[0],quad[2],quad[4],quad[6]].map(Number);
  const ys = [quad[1],quad[3],quad[5],quad[7]].map(Number);
  const x = xs.reduce((a,b)=>a+b,0) / xs.length;
  const y = ys.reduce((a,b)=>a+b,0) / ys.length;
  // D-M2 guard: a zero-area or collapsed box can never receive a viewport
  // click — hidden carousel slides and clipped strips fail closed here
  // instead of dispatching an effect into empty space.
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  if (!(width > 0 && height > 0)) throw new Error('native_semantic_target_not_visible');
  // D-M1: the pre-dispatch currency gate may re-anchor asynchronously.
  await beforeDispatch?.();
  const count = Number.isSafeInteger(clickCount) && clickCount >= 1 && clickCount <= 3 ? Math.trunc(clickCount) : 1;
  await dbg.sendCommand('Input.dispatchMouseEvent', { type:'mouseMoved', x, y, button:'none' });
  await dbg.sendCommand('Input.dispatchMouseEvent', { type:'mousePressed', x, y, button:'left', clickCount: count });
  await dbg.sendCommand('Input.dispatchMouseEvent', { type:'mouseReleased', x, y, button:'left', clickCount: count });
  return { x, y, click_count: count };
}

function assertCurrentEffectRuntime(webContents, dbg, binding) {
  if (binding?.schema !== 'metaengine.native-supervisor.effect-binding.v2') return;
  const runtime = dbg.bindingIdentity?.();
  if (!runtime) throw new Error('native_effect_runtime_binding_current_unavailable');
  assertNativeEffectRuntimeBindingCurrent({
    binding,
    document_url_sha256: sha256(clip(webContents.getURL?.() || '', 1200)),
    runtime_binding: {
      web_contents_id: runtime.web_contents_id,
      renderer_pid: runtime.os_pid,
      runtime_target_id: runtime.target_id,
      attachment_generation: runtime.attachment_generation,
      document_generation: runtime.document_generation,
      binding_generation: runtime.binding_generation,
      semantic_generation: runtime.semantic_generation,
    },
  });
}

export async function executeSemanticCommand(webContents, command) {
  const action = String(command?.action || '');
  const localIdentity = nativeBrowserTargetIdentity(webContents);
  // F-L1a: the whole semantic command execution is bounded by a CDP deadline so a
  // wedged debugger await can no longer freeze the steady-state command loop.
  return runBoundedCdpCommand(webContents, () => withDebugger(webContents, async (dbg) => {
    let effectBinding = null;
    if (command?.command_id && nativeActionRequiresEffectBinding(action)) {
      effectBinding = assertNativeEffectBindingMatches({
        command,
        binding: command?.effect_binding,
        clientId: command?.effect_binding?.client_id,
        processIncarnationId: localIdentity.process_incarnation_id,
        tabId: command?.payload?.tab_id,
        targetId: localIdentity.target_id,
      });
      assertCurrentEffectRuntime(webContents, dbg, effectBinding);
    }

    if (action === 'SCROLL') {
      const metrics = await dbg.sendCommand('Page.getLayoutMetrics');
      const vp = metrics?.cssVisualViewport || metrics?.visualViewport || {};
      const layout = metrics?.layoutViewport || {};
      const content = metrics?.cssContentSize || metrics?.contentSize || {};
      const x = Math.max(1, Number(vp.clientWidth || vp.width || 800) / 2);
      const y = Math.max(1, Number(vp.clientHeight || vp.height || 600) / 2);
      const deltaY = Math.max(-4000, Math.min(4000, Number(command?.payload?.delta_y || 0)));
      if (!deltaY) throw new Error('native_scroll_delta_invalid');
      assertCurrentEffectRuntime(webContents, dbg, effectBinding);
      const beforePageY = Number(vp.pageY ?? layout.pageY ?? 0);
      const viewportHeight = Number(vp.clientHeight || vp.height || 0);
      const contentHeight = Number(content.height || 0);
      const maxScrollY = Math.max(0, contentHeight - viewportHeight);
      await dbg.sendCommand('Input.dispatchMouseEvent', { type:'mouseWheel', x, y, deltaX:0, deltaY });
      // Postcondition readback: distinguish "moved" from "already at the scroll
      // boundary" so a legitimate boundary no-op can be proven instead of being
      // quarantined as AMBIGUOUS (observed live as FAILED postcondition_not_confirmed).
      let scroll = null;
      try {
        const after = await dbg.sendCommand('Page.getLayoutMetrics');
        const afterVp = after?.cssVisualViewport || after?.visualViewport || after?.layoutViewport || {};
        const afterPageY = Number(afterVp.pageY ?? 0);
        const moved = afterPageY !== beforePageY;
        const atBoundary = (deltaY < 0 && beforePageY <= 0)
          || (deltaY > 0 && beforePageY >= maxScrollY - 1);
        scroll = {
          from_page_y: beforePageY,
          to_page_y: afterPageY,
          viewport_height: viewportHeight,
          content_height: contentHeight,
          max_scroll_y: maxScrollY,
          moved,
          at_boundary: !moved && atBoundary,
          proof: moved ? 'VIEWPORT_PAGE_Y_CHANGED' : (atBoundary ? 'SCROLL_BOUNDARY_REACHED' : null),
        };
      } catch {
        scroll = null;
      }
      return { action, delta_y: deltaY, scroll, authority_effect: true };
    }

    if (action === 'STOP_GENERATION') {
      if (String(command?.platform || '').toUpperCase() === 'GLM_ZAI') {
        // The GLM stop control is an unnamed morphing send button (live recon
        // 2026-09-19): only an exact semantic_ref to a freshly captured button
        // target can authorize the click. Named-control resolution — the
        // ChatGPT path below — does not exist on chat.z.ai.
        const stopRef = command?.payload?.semantic_ref || null;
        if (!stopRef) throw new Error('native_glm_stop_requires_semantic_ref_button');
        const stopTarget = await exactTarget(webContents, dbg, command?.payload?.role || 'button', command?.payload?.accessible_name, stopRef);
        if (stopTarget.role !== 'button') throw new Error('native_glm_stop_requires_button_target');
        const stopPoint = await clickBackendNode(dbg, stopTarget.backend_node_id, () => assertCurrentEffectRuntime(webContents, dbg, effectBinding));
        return { action, target: stopTarget, point: stopPoint, platform: 'GLM_ZAI', authority_effect: true };
      }
      const tree = await dbg.sendCommand('Accessibility.getFullAXTree');
      const targets = exactChatGptControls(tree?.nodes || [], 'STOP');
      if (targets.length !== 1) throw new Error(targets.length ? `native_stop_target_ambiguous:${targets.length}` : 'native_stop_target_not_found');
      const point = await clickBackendNode(dbg, targets[0].backend_node_id, () => assertCurrentEffectRuntime(webContents, dbg, effectBinding));
      return { action, target: targets[0], point, authority_effect: true };
    }

    const role = command?.payload?.role;
    const name = command?.payload?.accessible_name;
    const semanticRef = command?.payload?.semantic_ref || null;

    if (action === 'PRESS_KEY') {
      const keyName = String(command?.payload?.key || '');
      const mapped = SAFE_PRESS_KEYS.get(keyName);
      if (!mapped) throw new Error('native_press_key_invalid');
      // Optional focus target: without a semantic_ref the key goes to the
      // focused element of the tab (menus, modals, list navigation); with a
      // ref the element is focused first — both paths keep the same
      // effect-runtime binding proof as every other input mutation.
      let keyTarget = null;
      if (semanticRef) {
        keyTarget = await exactTarget(webContents, dbg, role, name, semanticRef);
        await requireCurrentSemanticRef(webContents, dbg, keyTarget.semantic_ref || semanticRef);
        await dbg.sendCommand('DOM.focus', { backendNodeId: keyTarget.backend_node_id });
      }
      assertCurrentEffectRuntime(webContents, dbg, effectBinding);
      await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: keyName, code: mapped.code, windowsVirtualKeyCode: mapped.keyCode });
      await dbg.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code: mapped.code, windowsVirtualKeyCode: mapped.keyCode });
      return {
        action,
        key: keyName,
        target: keyTarget,
        mouse_geometry_required: false,
        authority_effect: true,
      };
    }

    if (!semanticRef) throw new Error('native_semantic_ref_required');
    const target = await exactTarget(webContents, dbg, role, name, semanticRef);
    // D-M1: every checkpoint below works from the freshest re-anchored ref
    // (exactTarget returns it) so mutation churn between checkpoints can be
    // re-anchored instead of failing the already-resolved effect.
    let liveRef = target.semantic_ref || semanticRef;

    if (action === 'SEMANTIC_FOCUS') {
      liveRef = await requireCurrentSemanticRef(webContents, dbg, liveRef);
      assertCurrentEffectRuntime(webContents, dbg, effectBinding);
      await dbg.sendCommand('DOM.focus', { backendNodeId: target.backend_node_id });
      return { action, target, authority_effect: true };
    }

    if (action === 'TYPED_CLICK') {
      const point = await clickBackendNode(dbg, target.backend_node_id, async () => {
        liveRef = await requireCurrentSemanticRef(webContents, dbg, liveRef);
        assertCurrentEffectRuntime(webContents, dbg, effectBinding);
      });
      return { action, target, point, authority_effect: true };
    }

    if (action === 'SEMANTIC_TYPE') {
      const text = String(command?.payload?.text ?? '');
      if (!text || text.length > 120000) throw new Error('native_semantic_text_invalid');
      if (!TEXT_INPUT_ROLES.has(target.role)) throw new Error('native_semantic_type_requires_text_input');
      const submitAfterType = command?.payload?.submit_after_type === true;
      const semanticPlatform = String(command?.platform || '').toUpperCase();
      if (submitAfterType && semanticPlatform === 'GLM_ZAI' && !isExactGlmComposer(webContents, target, command)) {
        throw new Error('native_semantic_submit_requires_exact_glm_composer');
      }
      if (submitAfterType && semanticPlatform !== 'GLM_ZAI' && !isExactChatGptComposer(target, command)) {
        throw new Error('native_semantic_submit_requires_exact_chatgpt_composer');
      }
      const preUrl = clip(webContents.getURL?.() || '', 1200);
      liveRef = await requireCurrentSemanticRef(webContents, dbg, liveRef);
      assertCurrentEffectRuntime(webContents, dbg, effectBinding);
      await dbg.sendCommand('DOM.focus', { backendNodeId: target.backend_node_id });
      // D-K2/D-K6 (live 2026-09-19): Ctrl+A + Input.insertText is NOT a
      // reliable replace on the chat.z.ai composer — live probes proved the
      // insert APPENDS (Chromium's IME-style insertText does not reliably
      // replace the selection), so each "replace" grew a stale draft (the
      // live fleet composer accumulated four unsent task prompts, ~10k chars,
      // later submitted as one garbage message). The replace on the GLM lane
      // is now ONE ATOMIC clear-and-type gesture: Ctrl+A, Delete (honors the
      // selection; no-op if the site prevents selection), insertText —
      // followed by an AX-value readback verification (equality against the
      // typed text, hash-only in receipts). A submit-path replace that cannot
      // be proven fails closed BEFORE Enter so no corrupted multi-prompt
      // text can ever be sent. There is deliberately NO second attempt: the
      // insert's own DOM mutation invalidates the semantic ref mid-effect
      // (native_semantic_ref_stale), and re-typing would append a second
      // copy of the prompt — exactly the ambiguity this lane prevents. The
      // legacy ChatGPT operator lane keeps its historical unverified replace.
      const replaceRequested = command?.payload?.replace_existing !== false;
      const verifyReplace = replaceRequested && semanticPlatform === 'GLM_ZAI';
      let typeReadback = null;
      let replaceVerified = !verifyReplace;
      let replaceGesture = null;
      if (replaceRequested) {
        if (verifyReplace) {
          const valueBefore = await readBackendNodeValue(dbg, target.backend_node_id);
          // D-M3 (live 2026-09-19): the agent-task composer on the
          // PRECONVERSATION_ROOT surface IGNORES synthetic key events entirely
          // (live-proven: a targeted Backspace was a no-op, Ctrl+A+Delete never
          // cleared a 26.7k-char account-synced draft, insertText appended).
          // Two replace gestures, ordered by surface:
          //   KEY_ATOMIC      - Ctrl+A, Delete, insertText. Proven on
          //                     conversation composers where keys are honored.
          //   CLICK_SELECT    - triple-click the composer (native select-all),
          //                     then a single insertText that replaces the
          //                     selection. For key-ignoring editors; also
          //                     self-healing - it replaces a poisoned draft
          //                     wholesale instead of appending to it.
          // Fail-fast rule: a gesture whose readback is neither the text
          // (verified) nor the untouched before-value (provable no-op) has
          // already mutated the draft - the second gesture is NOT attempted
          // so no double-append can occur. A preexisting exact match needs no
          // gesture at all (resume path: a previous type succeeded but the
          // submit did not dispatch).
          // R-DRAFT-FOCUS (live 2026-09-21): the chat.z.ai composer regressed
          // to a line-selecting triple-click (live-proven: a 48286-char draft
          // selected exactly 201 chars — one line), so CLICK_SELECT can only
          // PARTIALLY replace an oversized draft and its fail-fast blocked the
          // proven KEY_ATOMIC path behind it on PRECONVERSATION_ROOT. Meanwhile
          // Ctrl+A+Delete through CDP key events DO select-all+clear the whole
          // textarea (live-proven selectionStart=0/selectionEnd=len) when the
          // element is focused. Fixes: (1) KEY_ATOMIC now DOM.focuses the
          // composer first — keys without focus landed on <body> and were the
          // real D-M3 "ignored keys" mechanism; (2) KEY_ATOMIC runs FIRST on
          // every surface, CLICK_SELECT is the fallback.
          const gestureOrder = ['KEY_ATOMIC', 'CLICK_SELECT'];
          let valueAfter = valueBefore;
          if (valueBefore === text) {
            replaceVerified = true;
            replaceGesture = 'PREEXISTING_MATCH';
          } else {
            for (const gesture of gestureOrder) {
              liveRef = await requireCurrentSemanticRef(webContents, dbg, liveRef);
              assertCurrentEffectRuntime(webContents, dbg, effectBinding);
              if (gesture === 'CLICK_SELECT') {
                // A provably empty composer needs no selection: the insert
                // alone produces the exact text and the zero-geometry
                // contract of the fresh-dispatch path is preserved. The
                // triple-click (and its box geometry) is reserved for
                // clearing a non-empty or unreadable draft.
                if (valueBefore !== '') {
                  await clickBackendNode(dbg, target.backend_node_id, null, { clickCount: 3 });
                }
              } else {
                // R-DRAFT-FOCUS: focus the exact composer backend node before
                // dispatching editing keys. Without focus the Ctrl+A/Delete
                // sequence selected nothing (keys reached <body>), insertText
                // appended at the site-restored cursor, and the whole gesture
                // degenerated into draft growth. DOM.focus is geometry-free.
                await dbg.sendCommand('DOM.focus', { backendNodeId: target.backend_node_id });
                // D-U1 fix (2026-09-19): the Ctrl+A dispatch carried no
                // windowsVirtualKeyCode — Chromium synthesizes keyCode 0 for
                // it, and editors keying on keyCode treat the select-all as a
                // non-event. Enter/Delete already carry theirs; Ctrl+A now
                // does too so every editing key in the gesture is consistent.
                await dbg.sendCommand('Input.dispatchKeyEvent', { type:'rawKeyDown', key:'a', code:'KeyA', modifiers:2, windowsVirtualKeyCode:65, nativeVirtualKeyCode:65 });
                await dbg.sendCommand('Input.dispatchKeyEvent', { type:'keyUp', key:'a', code:'KeyA', modifiers:2, windowsVirtualKeyCode:65, nativeVirtualKeyCode:65 });
                await dbg.sendCommand('Input.dispatchKeyEvent', { type:'rawKeyDown', key:'Delete', code:'Delete', windowsVirtualKeyCode:46, nativeVirtualKeyCode:46 });
                await dbg.sendCommand('Input.dispatchKeyEvent', { type:'keyUp', key:'Delete', code:'Delete', windowsVirtualKeyCode:46 });
              }
              await dbg.sendCommand('Input.insertText', { text });
              valueAfter = await readBackendNodeValue(dbg, target.backend_node_id);
              replaceGesture = gesture;
              if (valueAfter === text) {
                replaceVerified = true;
                break;
              }
              if (valueAfter !== valueBefore) break; // mutated (append/partial) - fail fast, no second gesture
            }
          }
          typeReadback = {
            value_length_before: valueBefore == null ? null : valueBefore.length,
            value_length_after: valueAfter == null ? null : valueAfter.length,
            value_sha256_after: valueAfter == null || valueAfter === '' ? null : sha256(valueAfter),
          };
          replaceVerified = valueAfter === text;
        } else {
          liveRef = await requireCurrentSemanticRef(webContents, dbg, liveRef);
          assertCurrentEffectRuntime(webContents, dbg, effectBinding);
          await dbg.sendCommand('Input.dispatchKeyEvent', { type:'rawKeyDown', key:'a', code:'KeyA', modifiers:2, windowsVirtualKeyCode:65, nativeVirtualKeyCode:65 });
          await dbg.sendCommand('Input.dispatchKeyEvent', { type:'keyUp', key:'a', code:'KeyA', modifiers:2, windowsVirtualKeyCode:65, nativeVirtualKeyCode:65 });
          liveRef = await requireCurrentSemanticRef(webContents, dbg, liveRef);
          assertCurrentEffectRuntime(webContents, dbg, effectBinding);
          await dbg.sendCommand('Input.insertText', { text });
        }
      } else {
        liveRef = await requireCurrentSemanticRef(webContents, dbg, liveRef);
        assertCurrentEffectRuntime(webContents, dbg, effectBinding);
        await dbg.sendCommand('Input.insertText', { text });
      }
      if (submitAfterType && verifyReplace && !replaceVerified) {
        throw new Error('native_semantic_type_replace_unverified');
      }
      if (!submitAfterType) {
        return {
          action,
          target,
          inserted_chars: text.length,
          replace_existing: replaceRequested,
          replace_verified: verifyReplace ? replaceVerified : null,
          replace_gesture: verifyReplace ? replaceGesture : null,
          ...(typeReadback || {}),
          prompt_sha256: sha256(text),
          prompt_included: false,
          authority_effect: true,
        };
      }

      if (semanticPlatform === 'GLM_ZAI') {
        // GLM submit: Enter-first with composer-cleared / new-conversation
        // readback. The send control is an unnamed button inside a named
        // wrapper (live recon 2026-09-19) — name-based click authority is
        // impossible, so there is deliberately NO click fallback here: an
        // Enter that provably did not submit stays AMBIGUOUS and fails closed
        // (observed live: a logged-out chat.z.ai keeps the prompt in the
        // composer, which is exactly the session-auth signal the caller needs).
        const outcomeLatch = openGlmSubmitOutcomeLatch(dbg, webContents, { preUrl, backendNodeId: target.backend_node_id });
        try {
          // D-M1: the site's own post-insert re-render mutates the DOM after
          // insertText (controlled composer), which is exactly the
          // mutation-only churn window this gate re-anchors across — the
          // Enter submit no longer dies on the typing it just performed.
          liveRef = await requireCurrentSemanticRef(webContents, dbg, liveRef);
          assertCurrentEffectRuntime(webContents, dbg, effectBinding);
          await dbg.sendCommand('Input.dispatchKeyEvent', {
            type:'rawKeyDown', key:'Enter', code:'Enter', windowsVirtualKeyCode:13, nativeVirtualKeyCode:13,
          });
          await dbg.sendCommand('Input.dispatchKeyEvent', {
            type:'keyUp', key:'Enter', code:'Enter', windowsVirtualKeyCode:13, nativeVirtualKeyCode:13,
          });
          const observed = await outcomeLatch.wait();
          const { resolved: _glmResolved, ...glmObservation } = observed || {};
          return {
            action,
            target,
            inserted_chars: text.length,
            replace_existing: replaceRequested,
            replace_verified: verifyReplace ? replaceVerified : null,
            replace_gesture: verifyReplace ? replaceGesture : null,
            ...(typeReadback || {}),
            submit_after_type: true,
            prompt_sha256: sha256(text),
            prompt_included: false,
            platform: 'GLM_ZAI',
            ...glmObservation,
            event_driven_readback: true,
            readback_poll_timer_required: false,
            authority_effect: true,
          };
        } finally {
          outcomeLatch.close();
        }
      }

      const readyTree = await dbg.sendCommand('Accessibility.getFullAXTree');
      const sendTargets = exactChatGptControls(readyTree?.nodes || [], 'SEND');
      if (sendTargets.length !== 1) throw new Error(sendTargets.length ? `native_semantic_send_target_ambiguous:${sendTargets.length}` : 'native_semantic_send_target_not_found');
      const outcomeLatch = openChatGptSubmitOutcomeLatch(dbg, webContents, { preUrl });
      try {
        liveRef = await requireCurrentSemanticRef(webContents, dbg, liveRef);
        assertCurrentEffectRuntime(webContents, dbg, effectBinding);
        await dbg.sendCommand('Input.dispatchKeyEvent', {
          type:'rawKeyDown', key:'Enter', code:'Enter', windowsVirtualKeyCode:13, nativeVirtualKeyCode:13,
        });
        await dbg.sendCommand('Input.dispatchKeyEvent', {
          type:'keyUp', key:'Enter', code:'Enter', windowsVirtualKeyCode:13, nativeVirtualKeyCode:13,
        });
        let observed = await outcomeLatch.wait();
        // D-P2 (2026-09-18): the current ChatGPT composer ignores a synthetic
        // Enter keypress (live-observed: the typed prompt stayed in the composer
        // and only a physical SEND-control click submitted it). When the
        // event-driven latch misses the Enter, re-resolve the single SEND
        // control from a fresh tree and click it through the same bounded
        // backend-node path used by STOP_GENERATION, then observe a fresh
        // latch. Enter-first preserves the zero-geometry background-submit
        // contract; the click fallback runs only when Enter provably produced
        // no submit. If Enter did submit but the latch missed it, the SEND
        // control is already gone and the re-resolution fails closed — no
        // second physical effect is possible.
        if (observed?.resolved !== true) {
          const fallbackTree = await dbg.sendCommand('Accessibility.getFullAXTree');
          const fallbackSends = exactChatGptControls(fallbackTree?.nodes || [], 'SEND');
          if (fallbackSends.length !== 1) throw new Error(fallbackSends.length ? `native_semantic_send_target_ambiguous:${fallbackSends.length}` : 'native_semantic_send_target_not_found');
          const fallbackLatch = openChatGptSubmitOutcomeLatch(dbg, webContents, { preUrl });
          try {
            liveRef = await requireCurrentSemanticRef(webContents, dbg, liveRef);
            assertCurrentEffectRuntime(webContents, dbg, effectBinding);
            await clickBackendNode(dbg, fallbackSends[0].backend_node_id, async () => {
              liveRef = await requireCurrentSemanticRef(webContents, dbg, liveRef);
              assertCurrentEffectRuntime(webContents, dbg, effectBinding);
            });
            const fallbackObserved = await fallbackLatch.wait();
            if (fallbackObserved?.resolved === true) observed = fallbackObserved;
          } finally {
            fallbackLatch.close();
          }
        }
        const { resolved: _resolved, ...observation } = observed || {};
        return {
          action,
          target,
          inserted_chars: text.length,
          replace_existing: replaceRequested,
          replace_verified: verifyReplace ? replaceVerified : null,
          replace_gesture: verifyReplace ? replaceGesture : null,
          ...(typeReadback || {}),
          submit_after_type: true,
          prompt_sha256: sha256(text),
          prompt_included: false,
          send_control: { role: sendTargets[0].role, name: sendTargets[0].name },
          ...observation,
          event_driven_readback: true,
          readback_poll_timer_required: false,
          authority_effect: true,
        };
      } finally {
        outcomeLatch.close();
      }
    }

    throw new Error('native_semantic_action_not_supported');
  }));
}

function captureSurfaceSize(image) {
  const size = image?.getSize?.() || null;
  const width = Number(size?.width);
  const height = Number(size?.height);
  return {
    width,
    height,
    valid: Number.isSafeInteger(width) && width > 0 && Number.isSafeInteger(height) && height > 0,
  };
}

function isTransientCaptureSurfaceError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('current display surface not available for capture')
    || message.includes('native_capture_surface_unavailable');
}

function captureSurfaceUnavailableError(attempts, lastError = null) {
  const error = new Error(`native_capture_surface_unavailable_after_retry:${attempts}:${clip(lastError?.message || lastError || 'ZERO_SIZED_SURFACE', 160)}`);
  error.code = 'NATIVE_CAPTURE_SURFACE_UNAVAILABLE';
  error.attempts = attempts;
  return error;
}

function captureViewport(metrics) {
  const viewport = metrics?.cssVisualViewport || metrics?.visualViewport || null;
  const width = Math.floor(Number(viewport?.clientWidth || viewport?.width || 0));
  const height = Math.floor(Number(viewport?.clientHeight || viewport?.height || 0));
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
    throw new Error('native_capture_cdp_viewport_unavailable');
  }
  return {
    x: Math.max(0, Number(viewport?.pageX || 0)),
    y: Math.max(0, Number(viewport?.pageY || 0)),
    width,
    height,
  };
}

function decodeCdpJpeg(value) {
  const encoded = String(value || '');
  if (!encoded || encoded.length > 2_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error('native_capture_cdp_payload_invalid');
  }
  const jpeg = Buffer.from(encoded, 'base64');
  if (!jpeg.byteLength) throw new Error('native_capture_thumbnail_empty');
  return jpeg;
}

function captureCdpTimeoutError(deadlineMs) {
  const error = new Error(`native_capture_cdp_timeout:${deadlineMs}`);
  error.code = 'NATIVE_CAPTURE_CDP_TIMEOUT';
  error.deadline_ms = deadlineMs;
  error.automatic_retry_allowed = false;
  return error;
}

async function runBoundedCdpCapture(webContents, task, {
  deadlineMs = DEFAULT_CAPTURE_CDP_DEADLINE_MS,
  releaseDebuggerImpl = releasePersistentBrowserDebugger,
} = {}) {
  const boundedDeadlineMs = Math.max(10, Math.min(15000, Number(deadlineMs) || DEFAULT_CAPTURE_CDP_DEADLINE_MS));
  let timer = null;
  const work = Promise.resolve().then(task);
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try { releaseDebuggerImpl?.(webContents); } catch {}
      reject(captureCdpTimeoutError(boundedDeadlineMs));
    }, boundedDeadlineMs);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function commandCdpTimeoutError(deadlineMs) {
  const error = new Error(`native_supervisor_cdp_deadline:${deadlineMs}`);
  error.code = 'NATIVE_SUPERVISOR_CDP_TIMEOUT';
  error.deadline_ms = deadlineMs;
  // Fail-closed: an unproven CDP dispatch outcome is never blindly retried.
  error.automatic_retry_allowed = false;
  return error;
}

// F-L1a: every semantic command execution is bounded. On deadline the persistent
// debugger session for this webContents is released (dropping the wedged CDP
// channel) and the command fails closed, so the steady-state lease loop survives.
// Exported for contract tests (pure wrapper with injected release hook).
export async function runBoundedCdpCommand(webContents, task, {
  deadlineMs = DEFAULT_COMMAND_CDP_DEADLINE_MS,
  releaseDebuggerImpl = releasePersistentBrowserDebugger,
} = {}) {
  const boundedDeadlineMs = Math.max(5000, Math.min(60000, Number(deadlineMs) || DEFAULT_COMMAND_CDP_DEADLINE_MS));
  let timer = null;
  const work = Promise.resolve().then(task);
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try { releaseDebuggerImpl?.(webContents); } catch {}
      reject(commandCdpTimeoutError(boundedDeadlineMs));
    }, boundedDeadlineMs);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function captureCdpThumbnail(webContents, {
  withDebuggerImpl = withDebugger,
  maxWidth = 720,
  retryMaxWidth = 520,
  fromSurface = true,
  deadlineMs = DEFAULT_CAPTURE_CDP_DEADLINE_MS,
  releaseDebuggerImpl = releasePersistentBrowserDebugger,
} = {}) {
  return runBoundedCdpCapture(webContents, () => withDebuggerImpl(webContents, async (dbg) => {
    const viewport = captureViewport(await dbg.sendCommand('Page.getLayoutMetrics'));
    const take = async (quality, widthLimit) => {
      const payload = {
        format: 'jpeg',
        quality,
        fromSurface,
        captureBeyondViewport: false,
        optimizeForSpeed: true,
      };
      if (fromSurface) {
        const scale = Math.min(1, Math.max(0.1, Number(widthLimit) / viewport.width));
        payload.clip = { ...viewport, scale };
      }
      const shot = await dbg.sendCommand('Page.captureScreenshot', payload);
      return decodeCdpJpeg(shot?.data);
    };
    let jpeg = await take(55, maxWidth);
    if (jpeg.byteLength > 120000) jpeg = await take(fromSurface ? 45 : 35, retryMaxWidth);
    if (jpeg.byteLength > 150000 && !fromSurface) jpeg = await take(25, retryMaxWidth);
    if (jpeg.byteLength > 150000) throw new Error('native_capture_thumbnail_too_large');
    return { jpeg, viewport, fromSurface };
  }), { deadlineMs, releaseDebuggerImpl });
}

async function capturePageWithBoundedSurfaceReadiness(webContents, {
  maxAttempts = DEFAULT_CAPTURE_VIEW_MAX_ATTEMPTS,
  retryDelayMs = DEFAULT_CAPTURE_VIEW_RETRY_DELAY_MS,
  sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const attempts = Math.max(1, Math.min(8, Number(maxAttempts) || DEFAULT_CAPTURE_VIEW_MAX_ATTEMPTS));
  const delayMs = Math.max(0, Math.min(1000, Number(retryDelayMs) || 0));
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (!webContents || webContents.isDestroyed?.()) throw new Error('native_capture_webcontents_unavailable');
    try {
      const image = await webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
      const size = captureSurfaceSize(image);
      if (size.valid) return { image, size, attempts: attempt, transientRetries: attempt - 1 };
      lastError = new Error('native_capture_surface_unavailable');
    } catch (error) {
      if (webContents?.isDestroyed?.()) throw new Error('native_capture_webcontents_unavailable');
      if (!isTransientCaptureSurfaceError(error)) throw error;
      lastError = error;
    }
    if (attempt < attempts && delayMs > 0) await sleepImpl(delayMs);
  }
  throw captureSurfaceUnavailableError(attempts, lastError);
}

async function visualStateRevisionSnapshot(webContents) {
  try {
    const identity = nativeBrowserTargetIdentity(webContents);
    return await withDebugger(webContents, async (dbg) => {
      let runtime = dbg.bindingIdentity?.() || null;
      if (runtime && !runtime.main_frame_id) {
        await new Promise((resolve) => setImmediate(resolve));
        runtime = dbg.bindingIdentity?.() || runtime;
      }
      if (!runtime?.main_frame_id) return null;
      const revision = projectNativeRuntimeStateRevision({
        process_incarnation_id: identity.process_incarnation_id,
        target_id: identity.target_id,
        document_url_sha256: sha256(clip(webContents.getURL?.() || '', 1200)),
        runtime_binding: {
          web_contents_id: runtime.web_contents_id,
          renderer_pid: runtime.os_pid,
          runtime_target_id: runtime.target_id,
          attachment_generation: runtime.attachment_generation,
          document_generation: runtime.document_generation,
          binding_generation: runtime.binding_generation,
          semantic_generation: runtime.semantic_generation,
        },
      });
      return Object.freeze({
        target_id: identity.target_id,
        runtime_target_id: runtime.target_id,
        frame_id: runtime.main_frame_id,
        state_revision_id: revision.revision_id,
      });
    });
  } catch {
    return null;
  }
}

async function sealRevisionBoundCapture(webContents, before, receipt) {
  const after = await visualStateRevisionSnapshot(webContents);
  if (before && (!after
    || before.target_id !== after.target_id
    || before.runtime_target_id !== after.runtime_target_id
    || before.frame_id !== after.frame_id
    || before.state_revision_id !== after.state_revision_id)) {
    const error = new Error('native_capture_state_revision_changed');
    error.code = 'NATIVE_CAPTURE_STATE_REVISION_CHANGED';
    error.automatic_retry_allowed = false;
    throw error;
  }
  return {
    ...receipt,
    target_id: before?.target_id || null,
    runtime_target_id: before?.runtime_target_id || null,
    frame_id: before?.frame_id || null,
    state_revision_id: before?.state_revision_id || null,
    revision_bound: Boolean(before && after),
    revision_conflict_policy: 'DISCARD_REOBSERVE_NO_AUTOMATIC_RETRY',
    automatic_retry_allowed: false,
  };
}

export async function captureViewThumbnail(webContents, options = {}) {
  if (!webContents || webContents.isDestroyed?.()) throw new Error('native_capture_webcontents_unavailable');
  const revisionBefore = await visualStateRevisionSnapshot(webContents);
  const {
    surfaceExpected = true,
    withDebuggerImpl = withDebugger,
    cdpDeadlineMs = DEFAULT_CAPTURE_CDP_DEADLINE_MS,
    releaseDebuggerImpl = releasePersistentBrowserDebugger,
    temporarySurfaceDeadlineMs = DEFAULT_CAPTURE_CDP_DEADLINE_MS,
    resolveViewImpl = resolveExactWebContentsView,
    withDetachedSurfaceImpl = withTemporaryDetachedCaptureSurface,
    ...surfaceOptions
  } = options;
  let captured = null;
  let surfaceError = null;
  let temporarySurfaceLease = false;
  if (surfaceExpected !== false) {
    try {
      captured = await capturePageWithBoundedSurfaceReadiness(webContents, surfaceOptions);
    } catch (error) {
      if (error?.code !== 'NATIVE_CAPTURE_SURFACE_UNAVAILABLE') throw error;
      surfaceError = error;
    }
  } else {
    const exactView = typeof resolveViewImpl === 'function' ? resolveViewImpl(webContents) : null;
    if (exactView?.webContents === webContents && exactView.getVisible?.() !== false && typeof withDetachedSurfaceImpl === 'function') {
      try {
        captured = await withDetachedSurfaceImpl(
          exactView,
          () => capturePageWithBoundedSurfaceReadiness(webContents, surfaceOptions),
          { deadlineMs: temporarySurfaceDeadlineMs },
        );
        temporarySurfaceLease = true;
      } catch (error) {
        const wrapped = captureSurfaceUnavailableError(0, error);
        wrapped.temporary_surface_error_code = error?.code || null;
        wrapped.automatic_retry_allowed = false;
        throw wrapped;
      }
    } else {
      surfaceError = captureSurfaceUnavailableError(0, 'DETACHED_VIEW');
    }
  }

  if (!captured) {
    try {
      const fallback = await captureCdpThumbnail(webContents, {
        withDebuggerImpl,
        fromSurface: surfaceExpected !== false,
        deadlineMs: cdpDeadlineMs,
        releaseDebuggerImpl,
      });
      const jpeg = fallback.jpeg;
      return sealRevisionBoundCapture(webContents, revisionBefore, {
        schema: 'metaengine.native-browser.capture-thumbnail.v1',
        captured_at: new Date().toISOString(),
        url: clip(webContents.getURL?.() || '', 1200),
        title: clip(webContents.getTitle?.() || '', 240),
        source_width: fallback.viewport.width,
        source_height: fallback.viewport.height,
        capture_attempts: Number(surfaceError?.attempts || 0),
        transient_surface_retries: Number(surfaceError?.attempts || 0),
        bounded_surface_readiness: true,
        capture_backend: 'CDP_SCREENSHOT',
        capture_from_surface: fallback.fromSurface,
        cdp_deadline_ms: Math.max(10, Math.min(15000, Number(cdpDeadlineMs) || DEFAULT_CAPTURE_CDP_DEADLINE_MS)),
        detached_surface_fallback: surfaceExpected === false,
        temporary_surface_lease: false,
        native_surface_error: clip(surfaceError?.message || 'native_capture_surface_unavailable', 240),
        jpeg_bytes: jpeg.byteLength,
        sha256: crypto.createHash('sha256').update(jpeg).digest('hex'),
        jpeg_base64: jpeg.toString('base64'),
        authority_effect: false,
      });
    } catch (fallbackError) {
      const error = new Error(`${surfaceError?.message || 'native_capture_surface_unavailable'}:cdp_fallback:${clip(fallbackError?.message || fallbackError, 160)}`);
      error.code = 'NATIVE_CAPTURE_SURFACE_UNAVAILABLE';
      error.attempts = Number(surfaceError?.attempts || 0);
      error.cdp_error_code = fallbackError?.code || null;
      error.automatic_retry_allowed = false;
      throw error;
    }
  }
  let image = captured.image;
  const size = captured.size;
  if (size.width > 720) image = image.resize({ width: 720, quality: 'good' });
  let jpeg = image.toJPEG(55);
  if (jpeg.byteLength > 120000) {
    image = image.resize({ width: Math.min(520, image.getSize().width), quality: 'good' });
    jpeg = image.toJPEG(45);
  }
  if (!Buffer.isBuffer(jpeg) || jpeg.byteLength === 0) throw new Error('native_capture_thumbnail_empty');
  if (jpeg.byteLength > 150000) throw new Error('native_capture_thumbnail_too_large');
  return sealRevisionBoundCapture(webContents, revisionBefore, {
    schema: 'metaengine.native-browser.capture-thumbnail.v1',
    captured_at: new Date().toISOString(),
    url: clip(webContents.getURL?.() || '', 1200),
    title: clip(webContents.getTitle?.() || '', 240),
    source_width: size.width,
    source_height: size.height,
    capture_attempts: captured.attempts,
    transient_surface_retries: captured.transientRetries,
    bounded_surface_readiness: true,
    capture_backend: 'ELECTRON_CAPTURE_PAGE',
    capture_from_surface: true,
    detached_surface_fallback: temporarySurfaceLease,
    temporary_surface_lease: temporarySurfaceLease,
    temporary_surface_deadline_ms: temporarySurfaceLease
      ? Math.max(250, Math.min(15000, Number(temporarySurfaceDeadlineMs) || DEFAULT_CAPTURE_CDP_DEADLINE_MS))
      : null,
    native_surface_error: temporarySurfaceLease ? 'DETACHED_VIEW_TEMPORARY_SURFACE_LEASED' : null,
    jpeg_bytes: jpeg.byteLength,
    sha256: crypto.createHash('sha256').update(jpeg).digest('hex'),
    jpeg_base64: jpeg.toString('base64'),
    authority_effect: false,
  });
}
