import crypto from 'node:crypto';
import { chatGptControlMatches } from './chatgpt-ui-controls.mjs';
import {
  assertNativeEffectBindingMatches,
  nativeActionRequiresEffectBinding,
} from './native-effect-binding.mjs';

const SAFE_ROLES = new Set(['textbox','searchbox','combobox','button','checkbox','radio','switch','tab','menuitem','link']);
const TEXT_INPUT_ROLES = new Set(['textbox','searchbox','combobox']);
const CHATGPT_COMPOSER_NAMES = new Set(['Чат с ChatGPT', 'Chat with ChatGPT', 'Message ChatGPT']);
const NATIVE_BROWSER_PROCESS_INCARNATION_ID = crypto.randomUUID();
const clip = (value, max) => String(value ?? '').slice(0, max);
const axRawValue = (node, key) => String(node?.[key]?.value ?? '');
const axValue = (node, key) => axRawValue(node, key).trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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
  const dbg = webContents.debugger;
  let attachedHere = false;
  if (!dbg.isAttached()) {
    dbg.attach('1.3');
    attachedHere = true;
  }
  try { return await fn(dbg); }
  finally {
    if (attachedHere && dbg.isAttached()) {
      try { dbg.detach(); } catch {}
    }
  }
}

function semanticTargetRow(node) {
  if (node?.ignored === true) return null;
  const role = axValue(node, 'role').toLowerCase();
  const name = axValue(node, 'name');
  const backendNodeId = Number(node?.backendDOMNodeId || 0);
  if (!SAFE_ROLES.has(role) || !Number.isInteger(backendNodeId) || backendNodeId <= 0) return null;
  // GLM/Z.ai currently exposes its contenteditable composer as an unnamed AX
  // textbox. Never discard unnamed text inputs: they remain addressable only by
  // the fresh backend node id returned by perception. Unnamed non-input controls
  // stay hidden so there is no ambiguous click authority.
  if (!name && !TEXT_INPUT_ROLES.has(role)) return null;
  const row = {
    role,
    name: name ? clip(name, 240) : null,
    backend_node_id: backendNodeId,
    semantic_target_id: `ax:${backendNodeId}`,
    selector_mode: name ? 'ROLE_NAME_OR_BACKEND_NODE_ID' : 'BACKEND_NODE_ID_REQUIRED',
  };
  if (TEXT_INPUT_ROLES.has(role)) {
    const value = axRawValue(node, 'value');
    row.value_length = value.length;
    row.value_sha256 = value ? sha256(value) : null;
    row.value_exposed = false;
  }
  return row;
}

function uniqueSemanticTargets(nodes = []) {
  const candidates = [];
  const counts = new Map();
  for (const node of nodes) {
    const row = semanticTargetRow(node);
    if (!row) continue;
    if (row.name) {
      const key = `${row.role}\u0000${row.name}`;
      counts.set(key, Number(counts.get(key) || 0) + 1);
    }
    candidates.push(row);
  }
  return candidates
    .filter((row) => !row.name || counts.get(`${row.role}\u0000${row.name}`) === 1)
    .slice(0, 120);
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

function isGlmConversationUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:'
      && url.hostname.toLowerCase() === 'chat.z.ai'
      && /^\/c\/[a-z0-9-]+\/?$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function exactChatGptControls(nodes, kind) {
  return uniqueSemanticTargets(nodes).filter((row) => row.role === 'button' && row.name && chatGptControlMatches(kind, row.name));
}

function isExactChatGptComposer(target, command) {
  return String(command?.platform || '').toUpperCase() === 'CHATGPT'
    && target?.role === 'textbox'
    && CHATGPT_COMPOSER_NAMES.has(String(target?.name || ''));
}

function isExactGlmComposer(webContents, target, command) {
  let host = '';
  try { host = new URL(String(webContents?.getURL?.() || '')).hostname.toLowerCase(); } catch {}
  const backendNodeId = Number(command?.payload?.backend_node_id || 0);
  return String(command?.platform || '').toUpperCase() === 'GLM_ZAI'
    && host === 'chat.z.ai'
    && TEXT_INPUT_ROLES.has(String(target?.role || ''))
    && Number.isInteger(backendNodeId)
    && backendNodeId > 0
    && backendNodeId === Number(target?.backend_node_id || 0);
}

function exactBackendNode(nodes, backendNodeId) {
  const id = Number(backendNodeId || 0);
  if (!Number.isInteger(id) || id <= 0) return null;
  const matches = (nodes || []).filter((node) => node?.ignored !== true && Number(node?.backendDOMNodeId || 0) === id);
  return matches.length === 1 ? matches[0] : null;
}

async function observeGlmInputAfterInsert(dbg, { backendNodeId, expectedText }) {
  const tree = await dbg.sendCommand('Accessibility.getFullAXTree');
  const node = exactBackendNode(tree?.nodes || [], backendNodeId);
  if (!node) throw new Error('native_glm_pre_submit_target_unavailable');
  const role = axValue(node, 'role').toLowerCase();
  if (!TEXT_INPUT_ROLES.has(role)) throw new Error(`native_glm_pre_submit_role_changed:${role || 'unknown'}`);
  const observedValue = axRawValue(node, 'value');
  const expectedHash = sha256(expectedText);
  const observedHash = observedValue ? sha256(observedValue) : null;
  if (!observedValue || observedHash !== expectedHash) throw new Error('native_glm_pre_submit_input_unverified');
  return Object.freeze({
    backend_node_id: Number(backendNodeId),
    role,
    value_length: observedValue.length,
    value_sha256: observedHash,
    value_exposed: false,
    exact_prompt_readback: true,
    authority_effect: false,
  });
}

async function observeChatGptSubmit(dbg, webContents, { preUrl, attempts = 20, intervalMs = 100 } = {}) {
  let last = { stop_count: 0, send_count: 0, url: clip(webContents.getURL?.() || '', 1200) };
  for (let i = 0; i < attempts; i += 1) {
    if (i > 0) await sleep(intervalMs);
    const tree = await dbg.sendCommand('Accessibility.getFullAXTree');
    const nodes = Array.isArray(tree?.nodes) ? tree.nodes : [];
    const stopCount = exactChatGptControls(nodes, 'STOP').length;
    const sendCount = exactChatGptControls(nodes, 'SEND').length;
    const url = clip(webContents.getURL?.() || '', 1200);
    last = { stop_count: stopCount, send_count: sendCount, url };
    const rootToConversation = !isChatGptConversationUrl(preUrl) && isChatGptConversationUrl(url);
    if (stopCount === 1 || rootToConversation) {
      return {
        effect_state: stopCount === 1 ? 'PROVEN_GENERATING' : 'PROVEN_NEW_CONVERSATION',
        stop_observed: stopCount === 1,
        new_conversation_observed: rootToConversation,
        post_url_sha256: url ? sha256(url) : null,
        automatic_retry_allowed: false,
        authority_effect: false,
      };
    }
  }
  return {
    effect_state: 'AMBIGUOUS_AFTER_ENTER',
    stop_observed: last.stop_count === 1,
    new_conversation_observed: false,
    send_control_remaining: last.send_count > 0,
    post_url_sha256: last.url ? sha256(last.url) : null,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
}

async function observeGlmSubmit(dbg, webContents, { preUrl, backendNodeId, preSubmitValueSha256, attempts = 20, intervalMs = 100 } = {}) {
  if (!preSubmitValueSha256) throw new Error('native_glm_submit_precondition_missing');
  let lastUrl = clip(webContents.getURL?.() || '', 1200);
  for (let i = 0; i < attempts; i += 1) {
    if (i > 0) await sleep(intervalMs);
    const tree = await dbg.sendCommand('Accessibility.getFullAXTree');
    const node = exactBackendNode(tree?.nodes || [], backendNodeId);
    const value = node ? axRawValue(node, 'value') : null;
    const url = clip(webContents.getURL?.() || '', 1200);
    lastUrl = url;
    const rootToConversation = !isGlmConversationUrl(preUrl) && isGlmConversationUrl(url);
    const clearedAfterPositiveReadback = node != null && value === '';
    if (clearedAfterPositiveReadback || rootToConversation) {
      return {
        effect_state: clearedAfterPositiveReadback ? 'PROVEN_COMPOSER_CLEARED' : 'PROVEN_NEW_CONVERSATION',
        composer_cleared: clearedAfterPositiveReadback,
        pre_submit_value_sha256: preSubmitValueSha256,
        new_conversation_observed: rootToConversation,
        post_url_sha256: url ? sha256(url) : null,
        automatic_retry_allowed: false,
        authority_effect: false,
      };
    }
  }
  return {
    effect_state: 'AMBIGUOUS_AFTER_ENTER',
    composer_cleared: false,
    pre_submit_value_sha256: preSubmitValueSha256,
    new_conversation_observed: false,
    post_url_sha256: lastUrl ? sha256(lastUrl) : null,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
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
    return {
      schema: 'metaengine.native-browser.perception.v1',
      captured_at: new Date().toISOString(),
      process_incarnation_id: identity.process_incarnation_id,
      target_id: identity.target_id,
      url: clip(webContents.getURL?.() || '', 1200),
      title: clip(webContents.getTitle?.() || '', 240),
      semantic_targets: uniqueSemanticTargets(nodes),
      unnamed_text_inputs_addressable_by_backend_node_id: true,
      semantic_input_values_exposed: false,
      semantic_input_value_hashes: true,
      text_excerpt: textExcerpt(nodes),
      viewport: viewport ? {
        width: Number(viewport.clientWidth || viewport.width || 0),
        height: Number(viewport.clientHeight || viewport.height || 0),
        page_x: Number(viewport.pageX || 0),
        page_y: Number(viewport.pageY || 0),
        scale: Number(viewport.scale || 1),
      } : null,
      authority_effect: false,
    };
  });
}

async function exactTarget(dbg, roleRaw, nameRaw, backendNodeIdRaw = null) {
  const tree = await dbg.sendCommand('Accessibility.getFullAXTree');
  const role = String(roleRaw || '').trim().toLowerCase();
  const name = String(nameRaw || '').trim();
  const backendNodeId = Number(backendNodeIdRaw || 0);
  if (!SAFE_ROLES.has(role)) throw new Error('native_semantic_target_invalid');

  if (Number.isInteger(backendNodeId) && backendNodeId > 0) {
    const rawMatches = (tree?.nodes || []).filter((node) => node?.ignored !== true && Number(node?.backendDOMNodeId || 0) === backendNodeId);
    if (rawMatches.length !== 1) throw new Error(rawMatches.length ? `native_semantic_backend_target_ambiguous:${rawMatches.length}` : 'native_semantic_backend_target_not_found');
    const target = semanticTargetRow(rawMatches[0]);
    if (!target) throw new Error('native_semantic_backend_target_not_actionable');
    if (target.role !== role) throw new Error(`native_semantic_target_role_changed:${target.role}`);
    if (name && target.name !== name) throw new Error('native_semantic_target_name_changed');
    return target;
  }

  if (!name) throw new Error('native_semantic_target_invalid');
  const matches = uniqueSemanticTargets(tree?.nodes || []).filter((row) => row.role === role && row.name === name);
  if (matches.length !== 1) throw new Error(matches.length ? `native_semantic_target_ambiguous:${matches.length}` : 'native_semantic_target_not_found');
  return matches[0];
}

async function clickBackendNode(dbg, backendNodeId) {
  const model = await dbg.sendCommand('DOM.getBoxModel', { backendNodeId });
  const quad = model?.model?.content || model?.model?.border;
  if (!Array.isArray(quad) || quad.length < 8) throw new Error('native_semantic_box_unavailable');
  const xs = [quad[0],quad[2],quad[4],quad[6]].map(Number);
  const ys = [quad[1],quad[3],quad[5],quad[7]].map(Number);
  const x = xs.reduce((a,b)=>a+b,0) / xs.length;
  const y = ys.reduce((a,b)=>a+b,0) / ys.length;
  await dbg.sendCommand('Input.dispatchMouseEvent', { type:'mouseMoved', x, y, button:'none' });
  await dbg.sendCommand('Input.dispatchMouseEvent', { type:'mousePressed', x, y, button:'left', clickCount:1 });
  await dbg.sendCommand('Input.dispatchMouseEvent', { type:'mouseReleased', x, y, button:'left', clickCount:1 });
  return { x, y };
}

export async function executeSemanticCommand(webContents, command) {
  const action = String(command?.action || '');
  const localIdentity = nativeBrowserTargetIdentity(webContents);
  if (command?.command_id && nativeActionRequiresEffectBinding(action)) {
    assertNativeEffectBindingMatches({
      command,
      binding: command?.effect_binding,
      clientId: command?.effect_binding?.client_id,
      processIncarnationId: localIdentity.process_incarnation_id,
      tabId: command?.payload?.tab_id,
      targetId: localIdentity.target_id,
    });
  }
  return withDebugger(webContents, async (dbg) => {
    if (action === 'SCROLL') {
      const metrics = await dbg.sendCommand('Page.getLayoutMetrics');
      const vp = metrics?.cssVisualViewport || metrics?.visualViewport || {};
      const x = Math.max(1, Number(vp.clientWidth || vp.width || 800) / 2);
      const y = Math.max(1, Number(vp.clientHeight || vp.height || 600) / 2);
      const deltaY = Math.max(-4000, Math.min(4000, Number(command?.payload?.delta_y || 0)));
      if (!deltaY) throw new Error('native_scroll_delta_invalid');
      await dbg.sendCommand('Input.dispatchMouseEvent', { type:'mouseWheel', x, y, deltaX:0, deltaY });
      return { action, delta_y: deltaY, authority_effect: true };
    }

    if (action === 'STOP_GENERATION') {
      if (String(command?.platform || '').toUpperCase() === 'GLM_ZAI') {
        throw new Error('native_glm_stop_requires_observed_typed_click');
      }
      const tree = await dbg.sendCommand('Accessibility.getFullAXTree');
      const targets = exactChatGptControls(tree?.nodes || [], 'STOP');
      if (targets.length !== 1) throw new Error(targets.length ? `native_stop_target_ambiguous:${targets.length}` : 'native_stop_target_not_found');
      const point = await clickBackendNode(dbg, targets[0].backend_node_id);
      return { action, target: targets[0], point, authority_effect: true };
    }

    const role = command?.payload?.role;
    const name = command?.payload?.accessible_name;
    const backendNodeId = command?.payload?.backend_node_id;
    const target = await exactTarget(dbg, role, name, backendNodeId);

    if (action === 'SEMANTIC_FOCUS') {
      await dbg.sendCommand('DOM.focus', { backendNodeId: target.backend_node_id });
      return { action, target, authority_effect: true };
    }

    if (action === 'TYPED_CLICK') {
      const point = await clickBackendNode(dbg, target.backend_node_id);
      return { action, target, point, authority_effect: true };
    }

    if (action === 'SEMANTIC_TYPE') {
      const text = String(command?.payload?.text ?? '');
      if (!text || text.length > 120000) throw new Error('native_semantic_text_invalid');
      if (!TEXT_INPUT_ROLES.has(target.role)) throw new Error('native_semantic_type_requires_text_input');
      const submitAfterType = command?.payload?.submit_after_type === true;
      const replaceExisting = command?.payload?.replace_existing !== false;
      const platform = String(command?.platform || '').toUpperCase();
      if (submitAfterType && platform === 'CHATGPT' && !isExactChatGptComposer(target, command)) {
        throw new Error('native_semantic_submit_requires_exact_chatgpt_composer');
      }
      if (submitAfterType && platform === 'GLM_ZAI' && !isExactGlmComposer(webContents, target, command)) {
        throw new Error('native_semantic_submit_requires_exact_glm_backend_target');
      }
      if (submitAfterType && platform === 'GLM_ZAI' && !replaceExisting) {
        throw new Error('native_glm_submit_requires_replace_existing_for_exact_readback');
      }
      if (submitAfterType && !['CHATGPT','GLM_ZAI'].includes(platform)) {
        throw new Error('native_semantic_submit_platform_not_supported');
      }
      const preUrl = clip(webContents.getURL?.() || '', 1200);
      await dbg.sendCommand('DOM.focus', { backendNodeId: target.backend_node_id });
      if (replaceExisting) {
        await dbg.sendCommand('Input.dispatchKeyEvent', { type:'rawKeyDown', key:'a', code:'KeyA', modifiers:2 });
        await dbg.sendCommand('Input.dispatchKeyEvent', { type:'keyUp', key:'a', code:'KeyA', modifiers:2 });
      }
      await dbg.sendCommand('Input.insertText', { text });
      if (!submitAfterType) {
        return { action, target, inserted_chars: text.length, replace_existing: replaceExisting, prompt_sha256: sha256(text), prompt_included: false, authority_effect: true };
      }

      let sendControl = null;
      let glmPreSubmit = null;
      if (platform === 'CHATGPT') {
        const readyTree = await dbg.sendCommand('Accessibility.getFullAXTree');
        const sendTargets = exactChatGptControls(readyTree?.nodes || [], 'SEND');
        if (sendTargets.length !== 1) throw new Error(sendTargets.length ? `native_semantic_send_target_ambiguous:${sendTargets.length}` : 'native_semantic_send_target_not_found');
        sendControl = { role: sendTargets[0].role, name: sendTargets[0].name };
      } else {
        glmPreSubmit = await observeGlmInputAfterInsert(dbg, { backendNodeId: target.backend_node_id, expectedText: text });
        sendControl = { mode: 'ENTER_KEY', backend_node_id: target.backend_node_id, pre_submit_exact_readback: true };
      }

      await dbg.sendCommand('Input.dispatchKeyEvent', {
        type:'rawKeyDown', key:'Enter', code:'Enter', windowsVirtualKeyCode:13, nativeVirtualKeyCode:13,
      });
      await dbg.sendCommand('Input.dispatchKeyEvent', {
        type:'keyUp', key:'Enter', code:'Enter', windowsVirtualKeyCode:13, nativeVirtualKeyCode:13,
      });
      const observation = platform === 'GLM_ZAI'
        ? await observeGlmSubmit(dbg, webContents, {
          preUrl,
          backendNodeId: target.backend_node_id,
          preSubmitValueSha256: glmPreSubmit?.value_sha256 || null,
        })
        : await observeChatGptSubmit(dbg, webContents, { preUrl });
      return {
        action,
        target,
        inserted_chars: text.length,
        replace_existing: replaceExisting,
        submit_after_type: true,
        prompt_sha256: sha256(text),
        prompt_included: false,
        send_control: sendControl,
        ...(glmPreSubmit ? { pre_submit_readback: glmPreSubmit } : {}),
        ...observation,
        authority_effect: true,
      };
    }

    throw new Error('native_semantic_action_not_supported');
  });
}

export async function captureViewThumbnail(webContents) {
  if (!webContents || webContents.isDestroyed?.()) throw new Error('native_capture_webcontents_unavailable');
  let image = await webContents.capturePage();
  const size = image.getSize();
  if (size.width > 720) image = image.resize({ width: 720, quality: 'good' });
  let jpeg = image.toJPEG(55);
  if (jpeg.byteLength > 120000) {
    image = image.resize({ width: Math.min(520, image.getSize().width), quality: 'good' });
    jpeg = image.toJPEG(45);
  }
  if (jpeg.byteLength > 150000) throw new Error('native_capture_thumbnail_too_large');
  return {
    schema: 'metaengine.native-browser.capture-thumbnail.v1',
    captured_at: new Date().toISOString(),
    url: clip(webContents.getURL?.() || '', 1200),
    title: clip(webContents.getTitle?.() || '', 240),
    source_width: size.width,
    source_height: size.height,
    jpeg_bytes: jpeg.byteLength,
    sha256: crypto.createHash('sha256').update(jpeg).digest('hex'),
    jpeg_base64: jpeg.toString('base64'),
    authority_effect: false,
  };
}
