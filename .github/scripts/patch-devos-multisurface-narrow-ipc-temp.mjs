import { readFile, writeFile } from 'node:fs/promises';

function replaceOne(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}:expected_1:got_${count}`);
  return source.replace(before, after);
}

const mainPath = 'apps/metaengine-browser/src/main.mjs';
const appPath = 'apps/metaengine-browser/ui/app.js';
const preloadPath = 'apps/metaengine-browser/src/preload-shell.cjs';

let main = await readFile(mainPath, 'utf8');
main = replaceOne(main,
  "  if (command === 'DEVOS_SURFACE_LAYOUT_SET') {\n    const sessionId = String(payload?.session_id || '');\n    const devos = currentDevOSPresentationProjection();\n    if (!devos.sessions.some((row) => String(row.session_id) === sessionId)) throw new Error('devos_surface_layout_session_not_found');\n    const entry = devosSessionLayouts.setSurfaceLayout(sessionId, payload?.layout);\n    await saveDevOSSessionLayouts();\n    layout();\n    await publishSnapshot();\n    return entry;\n  }\n",
  '',
  'remove_generic_layout_command');
main = replaceOne(main,
  "ipcMain.handle('metaengine:shell:presentation-focus:snapshot', async (event) => {\n  assertShellSender(event);\n  return devosPresentationFocus.snapshot();\n});",
  "ipcMain.handle('metaengine:shell:presentation-focus:snapshot', async (event) => {\n  assertShellSender(event);\n  return devosPresentationFocus.snapshot();\n});\nipcMain.handle('metaengine:shell:presentation-layout:set', async (event, sessionId, layoutMode) => {\n  assertShellSender(event);\n  const id = String(sessionId || '');\n  const devos = currentDevOSPresentationProjection();\n  if (!devos.sessions.some((row) => String(row.session_id) === id)) throw new Error('devos_surface_layout_session_not_found');\n  const entry = devosSessionLayouts.setSurfaceLayout(id, layoutMode);\n  await saveDevOSSessionLayouts();\n  layout();\n  await publishSnapshot();\n  return entry;\n});",
  'add_narrow_layout_ipc');
await writeFile(mainPath, main);

let app = await readFile(appPath, 'utf8');
app = replaceOne(app,
  "api.command('DEVOS_SURFACE_LAYOUT_SET', { session_id: selectedSession.session_id, layout: mode })",
  "api.presentationFocus.setLayout(selectedSession.session_id, mode)",
  'renderer_narrow_layout_method');
await writeFile(appPath, app);

let preload = await readFile(preloadPath, 'utf8');
preload = replaceOne(preload,
  "    selectSurface: (sessionId, surfaceId) => ipcRenderer.invoke('metaengine:shell:presentation-focus:select-surface', String(sessionId ?? ''), String(surfaceId ?? '')),\n    clear: () => ipcRenderer.invoke('metaengine:shell:presentation-focus:clear'),",
  "    selectSurface: (sessionId, surfaceId) => ipcRenderer.invoke('metaengine:shell:presentation-focus:select-surface', String(sessionId ?? ''), String(surfaceId ?? '')),\n    setLayout: (sessionId, layoutMode) => ipcRenderer.invoke('metaengine:shell:presentation-layout:set', String(sessionId ?? ''), String(layoutMode ?? '')),\n    clear: () => ipcRenderer.invoke('metaengine:shell:presentation-focus:clear'),",
  'preload_narrow_layout_method');
await writeFile(preloadPath, preload);

console.log(JSON.stringify({ schema: 'metaengine.devos.multisurface-narrow-ipc-patcher.v1', authority_effect: false }));
