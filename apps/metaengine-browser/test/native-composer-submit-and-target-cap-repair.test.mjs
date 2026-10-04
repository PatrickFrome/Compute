import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/native-browser-control.mjs', import.meta.url), 'utf8');

// ---------------------------------------------------------------------------
// D-P1 (2026-09-18): sidebar-heavy ChatGPT surfaces saturated the 120-target
// bound with link/button nodes and truncated the composer textbox out of the
// semantic projection, killing every wake send with
// supervisor_composer_not_unique. Text-input rows must be reserved ahead of
// the bound.
// ---------------------------------------------------------------------------

function ax(role, name, id) {
  return {
    nodeId: `ax-${id}`,
    ignored: false,
    role: { value: role },
    name: { value: name },
    backendDOMNodeId: id,
    frameId: 'frame-root',
  };
}

test('D-P1: semantic projection reserves text inputs ahead of the 120-target bound', async () => {
  const { captureSemanticFrame } = await import('../src/native-browser-control.mjs');
  // 130 unique sidebar buttons + 1 composer textbox, AX-order: sidebar first.
  const nodes = [];
  for (let i = 1; i <= 130; i += 1) nodes.push(ax('button', `Кнопка сайдбара №${i}`, 1000 + i));
  nodes.push(ax('textbox', 'Чат с ChatGPT', 2001));

  let axReads = 0;
  const listeners = new Map();
  let attached = false;
  const debuggerApi = {
    isAttached: () => attached,
    attach: () => { attached = true; },
    detach: () => { attached = false; },
    on(name, fn) { const rows = listeners.get(name) || new Set(); rows.add(fn); listeners.set(name, rows); },
    off(name, fn) { listeners.get(name)?.delete(fn); },
    async sendCommand(method) {
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'frame-root', url: 'https://chatgpt.com/c/abc' } } };
      if (method === 'Runtime.enable') {
        for (const fn of listeners.get('message') || []) {
          fn({}, 'Runtime.executionContextCreated', { context: { id: 1, uniqueId: 'ctx-1', auxData: { frameId: 'frame-root', isDefault: true } } }, null);
        }
        return {};
      }
      if (method === 'Accessibility.getFullAXTree') { axReads += 1; return { nodes }; }
      if (method === 'Page.getLayoutMetrics') return { cssVisualViewport: { clientWidth: 1200, clientHeight: 800 } };
      if (['Page.enable', 'DOM.enable', 'Accessibility.enable', 'Page.setLifecycleEventsEnabled', 'Network.enable', 'Target.setAutoAttach', 'DOM.getDocument'].includes(method)) return {};
      throw new Error(`unexpected_debugger_command:${method}`);
    },
  };
  const webContents = {
    id: 9100,
    debugger: debuggerApi,
    isDestroyed: () => false,
    getURL: () => 'https://chatgpt.com/c/abc',
    getTitle: () => 'ChatGPT',
    getOSProcessId: () => 99100,
    getOrCreateDevToolsTargetId: () => 'target-9100',
  };

  const frame = await captureSemanticFrame(webContents);
  const targets = frame.semantic_targets;
  assert.equal(targets.length, 120, 'projection stays bounded at 120 rows');
  const textbox = targets.find((row) => row.role === 'textbox' && row.name === 'Чат с ChatGPT');
  assert.ok(textbox, 'composer textbox survives a sidebar-saturated projection');
  assert.equal(targets[0].role, 'textbox', 'text inputs are reserved ahead of the bound');
  assert.equal(frame.semantic_refs_issued, 120, 'every emitted row still carries a semantic ref');
});

test('D-P1: source contract — input reservation precedes the 120 slice', () => {
  assert.match(source, /const inputRows = uniqueRows\.filter\(\(row\) => TEXT_INPUT_ROLES\.has\(row\.role\)\)/);
  assert.match(source, /return \[\.\.\.inputRows, \.\.\.otherRows\]\.slice\(0, 120\)/);
});

test('R82: explicitly editable AX generic composer is normalized to a semantic textbox', async () => {
  const { captureSemanticFrame } = await import('../src/native-browser-control.mjs');
  const nodes = [
    {
      nodeId: 'ax-composer',
      ignored: false,
      role: { value: 'generic' },
      name: { value: 'Send a Message' },
      value: { value: '' },
      backendDOMNodeId: 2201,
      frameId: 'frame-root',
      properties: [{ name: 'editable', value: { type: 'token', value: 'richtext' } }],
    },
    ax('button', 'Chat Menu', 2202),
  ];

  const listeners = new Map();
  let attached = false;
  const debuggerApi = {
    isAttached: () => attached,
    attach: () => { attached = true; },
    detach: () => { attached = false; },
    on(name, fn) { const rows = listeners.get(name) || new Set(); rows.add(fn); listeners.set(name, rows); },
    off(name, fn) { listeners.get(name)?.delete(fn); },
    async sendCommand(method) {
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'frame-root', url: 'https://chat.z.ai/c/live-r82' } } };
      if (method === 'Runtime.enable') {
        for (const fn of listeners.get('message') || []) {
          fn({}, 'Runtime.executionContextCreated', { context: { id: 1, uniqueId: 'ctx-r82', auxData: { frameId: 'frame-root', isDefault: true } } }, null);
        }
        return {};
      }
      if (method === 'Accessibility.getFullAXTree') return { nodes };
      if (method === 'Page.getLayoutMetrics') return { cssVisualViewport: { clientWidth: 1200, clientHeight: 800 } };
      if (['Page.enable', 'DOM.enable', 'Accessibility.enable', 'Page.setLifecycleEventsEnabled', 'Network.enable', 'Target.setAutoAttach', 'DOM.getDocument'].includes(method)) return {};
      throw new Error(`unexpected_debugger_command:${method}`);
    },
  };
  const webContents = {
    id: 9201,
    debugger: debuggerApi,
    isDestroyed: () => false,
    getURL: () => 'https://chat.z.ai/c/live-r82',
    getTitle: () => 'Z.ai',
    getOSProcessId: () => 99201,
    getOrCreateDevToolsTargetId: () => 'target-9201',
  };

  const frame = await captureSemanticFrame(webContents);
  const composer = frame.semantic_targets.find((row) => row.backend_node_id === 2201);
  assert.ok(composer, 'explicitly editable AX node must survive semantic projection');
  assert.equal(composer.role, 'textbox');
  assert.equal(composer.name, 'Send a Message');
  assert.ok(composer.semantic_ref, 'normalized composer retains exact backend-node semantic identity');
  assert.equal(composer.semantic_ref.evidence.role, 'textbox');
  assert.equal(composer.value_length, 0);
});

test('R84 live regression: editable AX descendants do not become false composer textboxes', async () => {
  const { captureSemanticFrame } = await import('../src/native-browser-control.mjs');
  const nodes = [
    {
      nodeId: 'ax-composer',
      ignored: false,
      role: { value: 'generic' },
      name: { value: 'Send a Message' },
      value: { value: '' },
      backendDOMNodeId: 2301,
      frameId: 'frame-root',
      properties: [{ name: 'editable', value: { type: 'token', value: 'richtext' } }],
    },
    {
      nodeId: 'ax-static',
      parentId: 'ax-composer',
      ignored: false,
      role: { value: 'StaticText' },
      name: { value: 'stale draft line' },
      backendDOMNodeId: 2302,
      frameId: 'frame-root',
      properties: [{ name: 'editable', value: { type: 'token', value: 'richtext' } }],
    },
    {
      nodeId: 'ax-paragraph',
      parentId: 'ax-composer',
      ignored: false,
      role: { value: 'paragraph' },
      name: { value: 'another draft line' },
      backendDOMNodeId: 2303,
      frameId: 'frame-root',
      properties: [{ name: 'editable', value: { type: 'token', value: 'richtext' } }],
    },
  ];

  const listeners = new Map();
  let attached = false;
  const debuggerApi = {
    isAttached: () => attached,
    attach: () => { attached = true; },
    detach: () => { attached = false; },
    on(name, fn) { const rows = listeners.get(name) || new Set(); rows.add(fn); listeners.set(name, rows); },
    off(name, fn) { listeners.get(name)?.delete(fn); },
    async sendCommand(method) {
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'frame-root', url: 'https://chat.z.ai/' } } };
      if (method === 'Runtime.enable') {
        for (const fn of listeners.get('message') || []) {
          fn({}, 'Runtime.executionContextCreated', { context: { id: 1, uniqueId: 'ctx-r84-desc', auxData: { frameId: 'frame-root', isDefault: true } } }, null);
        }
        return {};
      }
      if (method === 'Accessibility.getFullAXTree') return { nodes };
      if (method === 'Page.getLayoutMetrics') return { cssVisualViewport: { clientWidth: 1200, clientHeight: 800 } };
      if (['Page.enable', 'DOM.enable', 'Accessibility.enable', 'Page.setLifecycleEventsEnabled', 'Network.enable', 'Target.setAutoAttach', 'DOM.getDocument'].includes(method)) return {};
      throw new Error(`unexpected_debugger_command:${method}`);
    },
  };
  const webContents = {
    id: 9301,
    debugger: debuggerApi,
    isDestroyed: () => false,
    getURL: () => 'https://chat.z.ai/',
    getTitle: () => 'Z.ai',
    getOSProcessId: () => 99301,
    getOrCreateDevToolsTargetId: () => 'target-9301',
  };

  const frame = await captureSemanticFrame(webContents);
  const textboxes = frame.semantic_targets.filter((row) => row.role === 'textbox');
  assert.equal(textboxes.length, 1, 'only the editable generic composer is projected as a textbox');
  assert.equal(textboxes[0].backend_node_id, 2301);
  assert.equal(textboxes[0].name, 'Send a Message');
  assert.ok(textboxes[0].semantic_ref);
  assert.equal(frame.semantic_targets.some((row) => row.backend_node_id === 2302), false, 'editable StaticText descendant stays non-actionable');
  assert.equal(frame.semantic_targets.some((row) => row.backend_node_id === 2303), false, 'editable paragraph descendant stays non-actionable');
});

test('R97: CAPTURE exposes exact AX focus readback without geometry', async () => {
  const { captureSemanticFrame } = await import('../src/native-browser-control.mjs');
  const nodes = [
    {
      ...ax('button', 'Agent', 2401),
      properties: [
        { name: 'focusable', value: { type: 'boolean', value: true } },
        { name: 'focused', value: { type: 'boolean', value: true } },
      ],
    },
    {
      ...ax('button', 'Chat', 2402),
      properties: [
        { name: 'focusable', value: { type: 'boolean', value: true } },
        { name: 'focused', value: { type: 'boolean', value: false } },
      ],
    },
  ];

  const listeners = new Map();
  let attached = false;
  const debuggerApi = {
    isAttached: () => attached,
    attach: () => { attached = true; },
    detach: () => { attached = false; },
    on(name, fn) { const rows = listeners.get(name) || new Set(); rows.add(fn); listeners.set(name, rows); },
    off(name, fn) { listeners.get(name)?.delete(fn); },
    async sendCommand(method) {
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'frame-root', url: 'https://chat.z.ai/' } } };
      if (method === 'Runtime.enable') {
        for (const fn of listeners.get('message') || []) {
          fn({}, 'Runtime.executionContextCreated', { context: { id: 1, uniqueId: 'ctx-r97-focus', auxData: { frameId: 'frame-root', isDefault: true } } }, null);
        }
        return {};
      }
      if (method === 'Accessibility.getFullAXTree') return { nodes };
      if (method === 'Page.getLayoutMetrics') return { cssVisualViewport: { clientWidth: 1200, clientHeight: 800 } };
      if (['Page.enable', 'DOM.enable', 'Accessibility.enable', 'Page.setLifecycleEventsEnabled', 'Network.enable', 'Target.setAutoAttach', 'DOM.getDocument'].includes(method)) return {};
      throw new Error(`unexpected_debugger_command:${method}`);
    },
  };
  const webContents = {
    id: 9401,
    debugger: debuggerApi,
    isDestroyed: () => false,
    getURL: () => 'https://chat.z.ai/',
    getTitle: () => 'Z.ai',
    getOSProcessId: () => 99401,
    getOrCreateDevToolsTargetId: () => 'target-9401',
  };

  const frame = await captureSemanticFrame(webContents);
  const agent = frame.semantic_targets.find((row) => row.name === 'Agent');
  assert.equal(agent.focusable, true);
  assert.equal(agent.focused, true);
  assert.equal(frame.focused_target_count, 1);
  assert.equal(frame.focused_target?.name, 'Agent');
  assert.equal(frame.focused_target?.backend_node_id, 2401);
  assert.equal(frame.focus_readback_geometry_free, true);
  assert.ok(frame.focused_target?.semantic_ref, 'focused target retains exact semantic identity');
});

// ---------------------------------------------------------------------------
// D-P2 (2026-09-18): the ChatGPT composer stopped acting on a synthetic Enter;
// the submit path must keep Enter (zero-geometry background contract) but fall
// back to a bounded SEND-control click when the event-driven latch misses it.
// ---------------------------------------------------------------------------

test('ChatGPT submit uses one exact semantic Send activation with no Enter fallback', () => {
  const start = source.indexOf('if (command?.payload?.chatgpt_submit === true)');
  const section = source.slice(start, source.indexOf("if (action === 'SEMANTIC_TYPE')", start));
  assert.match(section, /sends\.length !== 1/);
  assert.match(section, /native_chatgpt_typed_draft_not_exact/);
  assert.match(section, /await activateBackendNode/);
  assert.match(section, /await latch\.wait\(\)/);
  assert.doesNotMatch(section, /Input\.dispatchKeyEvent|fallbackSends/);
});

test('ChatGPT Send preserves every runtime fence and closes its outcome latch', () => {
  const start = source.indexOf('if (command?.payload?.chatgpt_submit === true)');
  const section = source.slice(start, source.indexOf("if (action === 'SEMANTIC_TYPE')", start));
  // D-M1: the fence is now the re-anchoring currency gate (liveRef).
  assert.match(section, /requireCurrentSemanticRef\(webContents, dbg, liveRef\)/);
  assert.match(section, /assertCurrentEffectRuntime\(webContents, dbg, effectBinding\)/);
  assert.match(section, /latch\.close\(\)/);
  assert.doesNotMatch(section, /DOM\.getBoxModel|Input\.dispatchMouseEvent/);
});
