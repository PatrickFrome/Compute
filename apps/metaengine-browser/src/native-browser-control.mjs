import crypto from 'node:crypto';

const SAFE_ROLES = new Set(['textbox','searchbox','combobox','button','checkbox','radio','switch','tab','menuitem','link']);
const clip = (value, max) => String(value ?? '').slice(0, max);
const axValue = (node, key) => String(node?.[key]?.value ?? '').trim();

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

function uniqueSemanticTargets(nodes = []) {
  const candidates = [];
  const counts = new Map();
  for (const node of nodes) {
    if (node?.ignored === true) continue;
    const role = axValue(node, 'role').toLowerCase();
    const name = axValue(node, 'name');
    const backendNodeId = Number(node?.backendDOMNodeId || 0);
    if (!SAFE_ROLES.has(role) || !name || !Number.isInteger(backendNodeId) || backendNodeId <= 0) continue;
    const key = `${role}\u0000${name}`;
    counts.set(key, Number(counts.get(key) || 0) + 1);
    candidates.push({ role, name: clip(name, 240), backend_node_id: backendNodeId });
  }
  return candidates.filter((row) => counts.get(`${row.role}\u0000${row.name}`) === 1).slice(0, 120);
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

export async function captureSemanticFrame(webContents) {
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
      url: clip(webContents.getURL?.() || '', 1200),
      title: clip(webContents.getTitle?.() || '', 240),
      semantic_targets: uniqueSemanticTargets(nodes),
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

async function exactTarget(dbg, roleRaw, nameRaw) {
  const tree = await dbg.sendCommand('Accessibility.getFullAXTree');
  const role = String(roleRaw || '').trim().toLowerCase();
  const name = String(nameRaw || '').trim();
  if (!SAFE_ROLES.has(role) || !name) throw new Error('native_semantic_target_invalid');
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
      const tree = await dbg.sendCommand('Accessibility.getFullAXTree');
      const targets = uniqueSemanticTargets(tree?.nodes || []).filter((row) => row.role === 'button' && /^(stop|stop generating|остановить|остановить создание)$/i.test(row.name));
      if (targets.length !== 1) throw new Error(targets.length ? `native_stop_target_ambiguous:${targets.length}` : 'native_stop_target_not_found');
      const point = await clickBackendNode(dbg, targets[0].backend_node_id);
      return { action, target: targets[0], point, authority_effect: true };
    }

    const role = command?.payload?.role;
    const name = command?.payload?.accessible_name;
    const target = await exactTarget(dbg, role, name);

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
      await dbg.sendCommand('DOM.focus', { backendNodeId: target.backend_node_id });
      if (command?.payload?.replace_existing !== false) {
        await dbg.sendCommand('Input.dispatchKeyEvent', { type:'rawKeyDown', key:'a', code:'KeyA', modifiers:2 });
        await dbg.sendCommand('Input.dispatchKeyEvent', { type:'keyUp', key:'a', code:'KeyA', modifiers:2 });
      }
      await dbg.sendCommand('Input.insertText', { text });
      return { action, target, inserted_chars: text.length, replace_existing: command?.payload?.replace_existing !== false, authority_effect: true };
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
