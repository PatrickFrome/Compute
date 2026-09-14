import assert from 'node:assert/strict';
import { app, BaseWindow, WebContentsView } from 'electron';

import { captureViewThumbnail } from '../src/native-browser-control.mjs';
import {
  nativeBrowserCdpPool,
  persistentBrowserDebuggerBinding,
  releasePersistentBrowserDebugger,
} from '../src/browser-persistent-cdp-session.mjs';

app.enableSandbox();

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

  try {
    const html = [
      '<!doctype html><html><head><title>Detached capture target</title></head>',
      '<body style="margin:0;width:100vw;height:100vh;overflow:hidden;',
      'background:linear-gradient(135deg,#183153,#00a6a6);color:#fff;',
      'font:700 42px system-ui;display:grid;place-items:center">',
      '<main id="proof">METAENGINE DETACHED CAPTURE VIEW</main></body></html>',
    ].join('');
    await Promise.all([
      shell.webContents.loadURL('data:text/html,<body style="background:%2310151d"></body>'),
      target.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`),
    ]);
    await wait(150);
    assert.equal(target.webContents.isDestroyed(), false);
    assert.equal(win.contentView.children.includes(target), true);

    // Production tabs are kept on one event-driven persistent CDP session by the
    // realtime semantic plane. Prove the detached fallback against that invariant
    // instead of cold-attaching the full semantic domain set after detachment.
    const preDetachBinding = await persistentBrowserDebuggerBinding(target.webContents);
    assert.equal(preDetachBinding.ready, true);
    assert.equal(preDetachBinding.attached, true);
    assert.equal(preDetachBinding.event_stream_capable, true);
    assert.equal(preDetachBinding.web_contents_id, target.webContents.id);
    assert.ok(preDetachBinding.target_id);
    assert.ok(preDetachBinding.attachment_generation >= 1);

    win.contentView.removeChildView(target);
    assert.equal(win.contentView.children.includes(target), false);
    await wait(150);

    const beforeCapture = nativeBrowserCdpPool.identity(target.webContents, {
      require_ready: true,
      require_event_stream: true,
    });
    assert.ok(beforeCapture);
    assert.equal(beforeCapture.target_id, preDetachBinding.target_id);
    assert.equal(beforeCapture.attachment_generation, preDetachBinding.attachment_generation);

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

    const postCaptureBinding = nativeBrowserCdpPool.identity(target.webContents, {
      require_ready: true,
      require_event_stream: true,
    });
    assert.ok(postCaptureBinding);
    assert.equal(postCaptureBinding.target_id, preDetachBinding.target_id);
    assert.equal(postCaptureBinding.attachment_generation, preDetachBinding.attachment_generation);

    console.log(JSON.stringify({
      schema: 'metaengine.browser.detached-capture-view-physical-e2e.v1',
      ok: true,
      electron: process.versions.electron,
      capture_backend: result.capture_backend,
      detached_surface_fallback: result.detached_surface_fallback,
      persistent_cdp_prearmed: true,
      attachment_generation_stable: true,
      target_id_stable: true,
      source_width: result.source_width,
      source_height: result.source_height,
      jpeg_bytes: result.jpeg_bytes,
      sha256: result.sha256,
      authority_effect: false,
    }));
  } finally {
    try { releasePersistentBrowserDebugger(target.webContents); } catch {}
    try { win.contentView.removeChildView(target); } catch {}
    try { win.contentView.removeChildView(shell); } catch {}
    if (!target.webContents.isDestroyed()) target.webContents.close();
    if (!shell.webContents.isDestroyed()) shell.webContents.close();
    win.close();
    app.quit();
  }
}

run().catch((error) => {
  console.error(error?.stack || error);
  app.exit(1);
});
