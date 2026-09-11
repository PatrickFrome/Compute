import assert from 'node:assert/strict';
import test from 'node:test';
import { captureSemanticFrame, executeSemanticCommand } from '../src/native-browser-control.mjs';
import { releasePersistentBrowserDebugger } from '../src/browser-persistent-cdp-session.mjs';

function createFakeWebContents() {
  const listeners = new Map();
  let attached = false;
  const commands = [];
  const debuggerApi = {
    attach_count: 0,
    detach_count: 0,
    commands,
    isAttached() { return attached; },
    attach(version) {
      assert.equal(version, '1.3');
      attached = true;
      this.attach_count += 1;
    },
    detach() {
      attached = false;
      this.detach_count += 1;
    },
    on(name, handler) {
      const rows = listeners.get(name) || new Set();
      rows.add(handler);
      listeners.set(name, rows);
    },
    off(name, handler) { listeners.get(name)?.delete(handler); },
    async sendCommand(method, params = {}) {
      commands.push({ method, params });
      if (method === 'Accessibility.getFullAXTree') return { nodes: [] };
      if (method === 'Page.getLayoutMetrics') {
        return { cssVisualViewport: { clientWidth: 1280, clientHeight: 720, pageX: 0, pageY: 0, scale: 1 } };
      }
      if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
      return {};
    },
  };
  const webContents = {
    id: 77,
    debugger: debuggerApi,
    isDestroyed: () => false,
    getOSProcessId: () => 9001,
    getURL: () => 'https://chatgpt.com/',
    getTitle: () => 'ChatGPT',
    once(name, handler) {
      const rows = listeners.get(`wc:${name}`) || new Set();
      rows.add(handler);
      listeners.set(`wc:${name}`, rows);
    },
    off(name, handler) { listeners.get(`wc:${name}`)?.delete(handler); },
  };
  return { webContents, debuggerApi };
}

test('native capture and effects reuse one persistent CDP attachment', async () => {
  const { webContents, debuggerApi } = createFakeWebContents();
  try {
    const first = await captureSemanticFrame(webContents);
    const second = await captureSemanticFrame(webContents);
    const effect = await executeSemanticCommand(webContents, { action: 'SCROLL', payload: { delta_y: 240 } });

    assert.equal(first.target_id, 'webcontents:77');
    assert.equal(second.target_id, 'webcontents:77');
    assert.equal(effect.action, 'SCROLL');
    assert.equal(effect.authority_effect, true);
    assert.equal(debuggerApi.attach_count, 1);
    assert.equal(debuggerApi.detach_count, 0);

    const enabled = debuggerApi.commands.filter((row) => row.method === 'Accessibility.enable');
    const captures = debuggerApi.commands.filter((row) => row.method === 'Accessibility.getFullAXTree');
    assert.equal(enabled.length, 1);
    assert.equal(captures.length, 2);
    assert.ok(debuggerApi.commands.some((row) => row.method === 'Input.dispatchMouseEvent' && row.params.type === 'mouseWheel'));
  } finally {
    assert.equal(releasePersistentBrowserDebugger(webContents), true);
  }
  assert.equal(debuggerApi.detach_count, 1);
});
