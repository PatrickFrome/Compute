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

// ---------------------------------------------------------------------------
// D-P2 (2026-09-18): the ChatGPT composer stopped acting on a synthetic Enter;
// the submit path must keep Enter (zero-geometry background contract) but fall
// back to a bounded SEND-control click when the event-driven latch misses it.
// ---------------------------------------------------------------------------

test('D-P2: source contract — Enter first, bounded click fallback, fail-closed re-resolution', () => {
  const enter = source.indexOf("type:'rawKeyDown', key:'Enter'");
  const latchWait = source.indexOf('await outcomeLatch.wait()', enter);
  const fallback = source.indexOf('D-P2 (2026-09-18)', latchWait);
  const fallbackResolve = source.indexOf('const fallbackSends = exactChatGptControls(fallbackTree?.nodes || [], \'SEND\')', fallback);
  const fallbackThrow = source.indexOf("native_semantic_send_target_not_found'", fallbackResolve);
  const fallbackClick = source.indexOf('await clickBackendNode(dbg, fallbackSends[0].backend_node_id', fallbackThrow);
  assert.ok(enter >= 0, 'Enter dispatch retained');
  assert.ok(latchWait > enter, 'first latch wait follows Enter');
  assert.ok(fallbackResolve > latchWait, 'fallback re-resolves the SEND control only after the latch missed');
  assert.ok(fallbackThrow > fallbackResolve, 'fallback re-resolution fails closed when the control is gone');
  assert.ok(fallbackClick > fallbackThrow, 'bounded click fallback is last resort');
});

test('D-P2: source contract — fallback preserves every runtime fence', () => {
  const fallback = source.indexOf('D-P2 (2026-09-18)');
  const section = source.slice(fallback, source.indexOf('const { resolved: _resolved', fallback));
  // D-M1: the fence is now the re-anchoring currency gate (liveRef).
  assert.match(section, /requireCurrentSemanticRef\(webContents, dbg, liveRef\)/);
  assert.match(section, /assertCurrentEffectRuntime\(webContents, dbg, effectBinding\)/);
  assert.match(section, /fallbackLatch\.close\(\)/);
});
