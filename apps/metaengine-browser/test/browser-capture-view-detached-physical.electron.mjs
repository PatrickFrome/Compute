import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { app, BaseWindow, WebContentsView } from 'electron';

import { captureViewThumbnail } from '../src/native-browser-control.mjs';

app.enableSandbox();

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const diagnostic = (phase, method, extra = {}) => console.log(JSON.stringify({
  schema: 'metaengine.browser.detached-capture-cdp-stage.v1',
  phase,
  method,
  ...extra,
  authority_effect: false,
}));

function installCdpDiagnostics(webContents) {
  const debuggerApi = webContents?.debugger;
  if (!debuggerApi || typeof debuggerApi.sendCommand !== 'function') {
    throw new Error('detached_capture_cdp_diagnostics_debugger_unavailable');
  }
  const originalSendCommand = debuggerApi.sendCommand;
  const sendDescriptor = Object.hasOwn(debuggerApi, 'sendCommand') ? Object.getOwnPropertyDescriptor(debuggerApi, 'sendCommand') : null;
  debuggerApi.sendCommand = async function instrumentedSendCommand(...args) {
    const method = String(args[0] || 'UNKNOWN');
    diagnostic('START', method);
    try {
      const result = await originalSendCommand.apply(debuggerApi, args);
      diagnostic('END', method);
      return result;
    } catch (error) {
      diagnostic('ERROR', method, { error: String(error?.message || error).slice(0, 240) });
      throw error;
    }
  };
  return () => {
    try {
      if (sendDescriptor) Object.defineProperty(debuggerApi, 'sendCommand', sendDescriptor);
      else if (debuggerApi.sendCommand !== originalSendCommand) delete debuggerApi.sendCommand;
    } catch {}
  };
}

async function run() {
  await app.whenReady();
  const win = new BaseWindow({
    width: 1080,
    height: 760,
    show: true,
    backgroundColor: '#10151d',
    title: 'Detached CAPTURE_VIEW physical proof',
  });
  const shell = new WebContentsView({
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  });
  const target = new WebContentsView({
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  });
  win.contentView.addChildView(shell);
  win.contentView.addChildView(target);
  shell.setBounds({ x: 0, y: 0, width: 1080, height: 80 });
  target.setBounds({ x: 0, y: 80, width: 1080, height: 680 });
  const restoreDiagnostics = installCdpDiagnostics(target.webContents);

  try {
    const nonce = crypto.randomUUID();
    const html = [
      '<!doctype html><html><head><title>Detached capture target</title></head>',
      '<body style="margin:0;width:100vw;height:100vh;overflow:hidden;',
      'background:linear-gradient(135deg,#183153,#00a6a6);color:#fff;',
      'font:700 42px system-ui;display:grid;place-items:center">',
      `<main id="proof">METAENGINE DETACHED CAPTURE VIEW ${nonce}</main></body></html>`,
    ].join('');
    await Promise.all([
      shell.webContents.loadURL('data:text/html,<body style="background:%2310151d"></body>'),
      target.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`),
    ]);
    await wait(150);
    assert.equal(target.webContents.isDestroyed(), false);
    assert.equal(win.contentView.children.includes(target), true);

    win.contentView.removeChildView(target);
    assert.equal(win.contentView.children.includes(target), false);
    await wait(150);
    diagnostic('START', 'captureViewThumbnail');

    const result = await captureViewThumbnail(target.webContents, { surfaceExpected: false });
    const jpeg = Buffer.from(result.jpeg_base64, 'base64');
    assert.equal(result.schema, 'metaengine.native-browser.capture-thumbnail.v1');
    assert.equal(result.capture_backend, 'CDP_SCREENSHOT');
    assert.equal(result.detached_surface_fallback, true);
    assert.equal(result.capture_attempts, 0);
    assert.ok(result.source_width > 0 && result.source_height > 0);
    assert.ok(result.jpeg_bytes > 0 && result.jpeg_bytes <= 150_000);
    assert.equal(jpeg.byteLength, result.jpeg_bytes);
    assert.deepEqual([...jpeg.subarray(0, 2)], [0xff, 0xd8]);
    assert.match(result.sha256, /^[a-f0-9]{64}$/);
    assert.equal(win.contentView.children.includes(target), false);
    diagnostic('END', 'captureViewThumbnail');

    console.log(JSON.stringify({
      schema: 'metaengine.browser.detached-capture-view-physical-e2e.v1',
      ok: true,
      electron: process.versions.electron,
      capture_backend: result.capture_backend,
      detached_surface_fallback: result.detached_surface_fallback,
      capture_from_surface: result.capture_from_surface,
      source_width: result.source_width,
      source_height: result.source_height,
      jpeg_bytes: result.jpeg_bytes,
      sha256: result.sha256,
      target_still_detached: !win.contentView.children.includes(target),
      authority_effect: false,
    }));
  } finally {
    restoreDiagnostics();
    try { win.contentView.removeChildView(target); } catch {}
    try { win.contentView.removeChildView(shell); } catch {}
    if (!target.webContents.isDestroyed()) target.webContents.close();
    if (!shell.webContents.isDestroyed()) shell.webContents.close();
    win.close();
    app.quit();
  }
}

run().catch((error) => {
  diagnostic('ERROR', 'captureViewThumbnail', {
    error: String(error?.stack || error).replace(/\s+/g, ' ').slice(0, 800),
  });
  app.exit(1);
});
