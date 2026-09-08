import { app, BaseWindow, WebContentsView } from 'electron';
import assert from 'node:assert/strict';
import { planDevOSSurfaceGrid } from '../src/metaengine-devos-surface-grid.mjs';
import { createDevOSSessionLayoutRegistry } from '../src/metaengine-devos-session-layout.mjs';

app.enableSandbox();

function zeroAuthority() {
  return {
    projection_is_authority: false,
    scheduler_authority: false,
    execution_authority: false,
    command_leasing: false,
    automatic_effect_retry_allowed: false,
    page_model_authority: false,
    authority_effect: false,
  };
}

function surface(tabId, title) {
  return Object.freeze({
    surface_id: `browser:${tabId}`,
    session_id: 'session:physical',
    type: 'BROWSER',
    title,
    tab_id: tabId,
    runtime_bound: true,
    presentation_only: false,
    ...zeroAuthority(),
  });
}

function distinctBounds(rows) {
  const keys = rows.map((row) => JSON.stringify(row));
  return new Set(keys).size === keys.length;
}

async function run() {
  await app.whenReady();
  const win = new BaseWindow({ width: 1280, height: 820, show: true, backgroundColor: '#090c11', title: 'DevOS Multi-Surface Physical E2E' });
  const surfaces = [surface('physical-a', 'Physical A'), surface('physical-b', 'Physical B'), surface('physical-c', 'Physical C')];
  const views = new Map();
  const loads = [];
  for (const [index, row] of surfaces.entries()) {
    const view = new WebContentsView({ webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
    views.set(row.tab_id, view);
    win.contentView.addChildView(view);
    const html = `<html><head><title>${row.title}</title></head><body style="margin:0;background:rgb(${20 + index * 20},${24 + index * 20},${30 + index * 20});color:white;font:16px sans-serif"><h1>${row.title}</h1></body></html>`;
    loads.push(view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`));
  }
  await Promise.all(loads);

  const rendererEvidence = surfaces.map((row) => {
    const contents = views.get(row.tab_id).webContents;
    return Object.freeze({
      tab_id: row.tab_id,
      title: contents.getTitle(),
      url: contents.getURL(),
      os_process_id: contents.getOSProcessId(),
      loading: contents.isLoading(),
      destroyed: contents.isDestroyed(),
    });
  });
  assert.equal(rendererEvidence.every((row) => row.destroyed === false && row.loading === false), true);
  assert.equal(rendererEvidence.every((row) => Number.isInteger(row.os_process_id) && row.os_process_id > 0), true);
  assert.deepEqual(rendererEvidence.map((row) => row.title), surfaces.map((row) => row.title));
  assert.equal(rendererEvidence.every((row) => row.url.startsWith('data:text/html;charset=utf-8,')), true);

  const layouts = createDevOSSessionLayoutRegistry();
  layouts.activate('session:physical');
  layouts.setSurfaceLayout('session:physical', 'TRIPLE_RIGHT');
  layouts.setActiveSurface('session:physical', 'browser:physical-b');

  const first = planDevOSSurfaceGrid({
    bounds: { x: 220, y: 44, width: 1040, height: 740 },
    surfaces,
    focused_surface_id: layouts.get('session:physical').active_surface_id,
    requested_layout: layouts.get('session:physical').requested_surface_layout,
  });
  assert.equal(first.panes.length, 3);
  assert.equal(first.browser_panes.length, 3);
  assert.equal(first.multi_surface, true);
  assert.equal(first.panes[0].surface_id, 'browser:physical-b');
  for (const pane of first.browser_panes) views.get(pane.tab_id).setBounds(pane.content_bounds);
  const firstBounds = first.browser_panes.map((pane) => views.get(pane.tab_id).getBounds());
  assert.equal(distinctBounds(firstBounds), true);
  assert.equal(firstBounds.every((row) => row.width > 0 && row.height > 0), true);

  views.get('physical-b').webContents.focus();
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(views.get('physical-b').webContents.isFocused(), true);

  win.setContentSize(1040, 700);
  const resized = planDevOSSurfaceGrid({
    bounds: { x: 120, y: 44, width: 900, height: 620 },
    surfaces,
    focused_surface_id: 'browser:physical-b',
    requested_layout: 'TRIPLE_RIGHT',
  });
  assert.equal(resized.panes.length >= 2, true);
  for (const pane of resized.browser_panes) views.get(pane.tab_id).setBounds(pane.content_bounds);
  const resizedBounds = resized.browser_panes.map((pane) => views.get(pane.tab_id).getBounds());
  assert.notDeepEqual(resizedBounds, firstBounds);
  assert.equal(distinctBounds(resizedBounds), true);

  const checkpoint = layouts.snapshot();
  const restored = createDevOSSessionLayoutRegistry();
  restored.restore(checkpoint);
  assert.equal(restored.get('session:physical').requested_surface_layout, 'TRIPLE_RIGHT');
  assert.equal(restored.get('session:physical').active_surface_id, 'browser:physical-b');

  const proof = Object.freeze({
    schema: 'metaengine.devos.multisurface-physical-e2e.v1',
    ok: true,
    electron: process.versions.electron,
    simultaneously_attached_webcontents_views: views.size,
    live_renderer_processes: rendererEvidence.length,
    initial_layout: first.effective_layout,
    resized_layout: resized.effective_layout,
    focused_surface_id: restored.get('session:physical').active_surface_id,
    layout_persisted: true,
    resize_reflow_proven: true,
    renderer_load_proven: true,
    renderer_process_proven: true,
    exact_main_owned_bounds: true,
    hosted_viz_capture_required: false,
    renderer_dimensions_authoritative: false,
    authority_effect: false,
  });
  console.log(JSON.stringify(proof));

  for (const view of views.values()) {
    try { win.contentView.removeChildView(view); } catch {}
    if (!view.webContents.isDestroyed()) view.webContents.close();
  }
  win.close();
  app.quit();
}

run().catch((error) => {
  console.error(error?.stack || error);
  app.exit(1);
});
