import fs from 'node:fs/promises';

const files = {
  html: 'apps/metaengine-browser/ui/index.html',
  main: 'apps/metaengine-browser/src/main.mjs',
  visual: 'apps/metaengine-browser/test/browser-shell-visual-evidence.mjs',
  finalTest: 'apps/metaengine-browser/test/browser-final-shell-ui.test.mjs',
  a11yTest: 'apps/metaengine-browser/test/browser-shell-accessibility-ui.test.mjs',
  hotpathTest: 'apps/metaengine-browser/test/browser-chatgpt-fast-open.test.mjs',
};

function exact(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}:expected_once:${count}`);
  return source.replace(before, after);
}

let html = await fs.readFile(files.html, 'utf8');
html = exact(html, '<meta name="color-scheme" content="light">', '<meta name="color-scheme" content="dark">', 'html_color_scheme');
html = exact(html, '<link rel="stylesheet" href="metaengine://shell/app.css">', '<link rel="stylesheet" href="metaengine://shell/app.css">\n  <link rel="stylesheet" href="metaengine://shell/dark-workspace.css">', 'html_dark_css');
html = exact(html, 'data-final-shell="telegram-browser-v1"', 'data-final-shell="metaengine-dark-workspace-v2"', 'html_shell_contract');
html = exact(html, '<strong>Chats & Agents</strong>', '<strong>Workspace</strong>', 'html_rail_title');
html = exact(html, "if (title) title.textContent = 'Sessions & Agents';", "if (title) title.textContent = 'Workspace';", 'html_dynamic_rail_title');
html = exact(html, "search.placeholder = 'Search sessions, agents, workspaces';", "search.placeholder = 'Search tabs, sessions, agents';", 'html_search_placeholder');
await fs.writeFile(files.html, html);

let main = await fs.readFile(files.main, 'utf8');
main = exact(main,
  "import { app, BaseWindow, MessageChannelMain, WebContentsView, ipcMain, protocol, safeStorage, session, utilityProcess } from 'electron';",
  "import { app, BaseWindow, MessageChannelMain, WebContentsView, ipcMain, nativeTheme, protocol, safeStorage, session, utilityProcess } from 'electron';",
  'main_native_theme_import');
main = exact(main, 'app.enableSandbox();', "app.enableSandbox();\nnativeTheme.themeSource = 'dark';", 'main_native_theme');
main = exact(main,
  "if (!['index.html', 'app.js', 'app.css'].includes(rel)) return new Response('not found', { status: 404 });",
  "if (!['index.html', 'app.js', 'app.css', 'dark-workspace.css'].includes(rel)) return new Response('not found', { status: 404 });",
  'main_shell_asset_allowlist');
main = exact(main,
  "userSession = session.fromPartition(SECURITY_POLICY.user_space_partition, { cache: true });\n  userSession.setPermissionCheckHandler(() => false);",
  "userSession = session.fromPartition(SECURITY_POLICY.user_space_partition, { cache: true });\n  try { userSession.preconnect({ url: 'https://chatgpt.com/', numSockets: 2 }); } catch {}\n  userSession.setPermissionCheckHandler(() => false);",
  'main_chat_preconnect');
main = exact(main,
  "if (command === 'NEW_CHATGPT') return createTab('https://chatgpt.com/', { select: true, load: true });",
  "if (command === 'NEW_CHATGPT') return createTab('https://chatgpt.com/', { select: true, load: true, awaitLoad: false });",
  'main_fast_chat_command');
main = exact(main,
  "async function createTab(input = 'https://chatgpt.com/', { select = true, load = true, role = 'USER' } = {}) {",
  "async function createTab(input = 'https://chatgpt.com/', { select = true, load = true, awaitLoad = true, role = 'USER' } = {}) {",
  'main_create_tab_signature');
main = exact(main,
  "  if (load) await view.webContents.loadURL(d.normalized_url);\n  invalidatePerception();\n  await publishSnapshot();\n  return { ...tab, webcontents_id: view.webContents.id };",
  "  if (load) {\n    const pendingLoad = view.webContents.loadURL(d.normalized_url);\n    if (awaitLoad) await pendingLoad;\n    else void pendingLoad.catch(() => publishSnapshot().catch(() => {}));\n  }\n  invalidatePerception();\n  await publishSnapshot();\n  return { ...tab, webcontents_id: view.webContents.id, load_pending: load && !awaitLoad };",
  'main_create_tab_load');
await fs.writeFile(files.main, main);

let visual = await fs.readFile(files.visual, 'utf8');
visual = exact(visual,
  "import { fileURLToPath } from 'node:url';",
  "import { fileURLToPath } from 'node:url';\nimport { normalizeShellLayoutState, planShellLayout } from '../src/shell-layout.mjs';",
  'visual_layout_import');
visual = exact(visual,
  "  const sidebarWidth = 272;\n  const operationsWidth = 352;",
  "  const layout = planShellLayout({\n    width,\n    height,\n    state: normalizeShellLayoutState({ sidebar: 'EXPANDED', operations: 'OPEN' }),\n  });",
  'visual_layout_constants');
visual = exact(visual,
  "    layout: Object.freeze({\n      requested: Object.freeze({ sidebar: 'EXPANDED', operations: 'OPEN' }),\n      effective_sidebar: 'EXPANDED', effective_operations: 'OPEN', overlay_remote_content: false, renderer_dimensions_authoritative: false,\n      shell_bounds: Object.freeze({ x: 0, y: 0, width, height }),\n      sidebar_bounds: Object.freeze({ x: 0, y: 48, width: sidebarWidth, height: Math.max(0, height - 48) }),\n      operations_bounds: Object.freeze({ x: Math.max(0, width - operationsWidth), y: 48, width: operationsWidth, height: Math.max(0, height - 48) }),\n      remote_bounds: Object.freeze({ x: sidebarWidth, y: 48, width: Math.max(0, width - sidebarWidth - operationsWidth), height: Math.max(0, height - 48) }),\n    }),",
  "    layout,",
  'visual_layout_projection');
visual = exact(visual,
  "const rel = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\\/+/, '');\n    if (!['index.html', 'app.js', 'app.css'].includes(rel)) return new Response('not found', { status: 404 });",
  "const rel = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\\/+/, '');\n    if (!['index.html', 'app.js', 'app.css', 'dark-workspace.css'].includes(rel)) return new Response('not found', { status: 404 });",
  'visual_shell_asset_allowlist');
visual = exact(visual,
  "  const windowRef = new BaseWindow({ width: 1440, height: 960, show: false, backgroundColor: '#ffffff', title: 'METAENGINE Browser Visual Evidence' });",
  "  const windowRef = new BaseWindow({ width: 1440, height: 960, show: false, backgroundColor: '#090c11', title: 'METAENGINE Browser Visual Evidence' });",
  'visual_dark_window');
visual = exact(visual,
  "    if (!allCaptures.every((row) => row.metrics.ops_text_length > 400)) throw new Error('visual_evidence_brain_not_rendered');",
  "    if (!allCaptures.every((row) => row.metrics.ops_text_length > 400)) throw new Error('visual_evidence_brain_not_rendered');\n    const byName = Object.fromEntries(allCaptures.map((row) => [row.name, row]));\n    if (byName['shell-1920x1080']?.metrics.body_sidebar !== 'EXPANDED' || byName['shell-1920x1080']?.metrics.body_operations !== 'OPEN') throw new Error('visual_evidence_wide_layout_not_exact');\n    for (const name of ['shell-1100x760', 'shell-1024x720']) {\n      if (byName[name]?.metrics.body_sidebar !== 'COMPACT' || byName[name]?.metrics.body_operations !== 'CLOSED') throw new Error(`visual_evidence_adaptation_missing:${name}`);\n    }",
  'visual_responsive_assertions');
await fs.writeFile(files.visual, visual);

await fs.writeFile(files.finalTest, `import assert from 'node:assert/strict';\nimport { readFile } from 'node:fs/promises';\nimport test from 'node:test';\n\nconst html = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');\nconst app = await readFile(new URL('../ui/app.js', import.meta.url), 'utf8');\nconst dark = await readFile(new URL('../ui/dark-workspace.css', import.meta.url), 'utf8');\n\ntest('dark workspace v2 replaces the Telegram presentation contract', () => {\n  assert.match(html, /data-final-shell=\\"metaengine-dark-workspace-v2\\"/);\n  assert.doesNotMatch(html, /data-final-shell=\\"telegram-browser-v1\\"/);\n  assert.match(html, /metaengine:\\/\\/shell\\/dark-workspace\\.css/);\n  assert.match(html, /<meta name=\\"color-scheme\\" content=\\"dark\\">/);\n  assert.match(dark, /color-scheme:dark/);\n  assert.match(dark, /background:#090c11/);\n});\n\ntest('browser-first chrome is flat dense and active-surface subordinate', () => {\n  assert.match(dark, /--top-height:44px/);\n  assert.match(dark, /--sidebar-width:240px/);\n  assert.match(dark, /--ops-width:320px/);\n  assert.match(dark, /\\.verticalTab\\.active[^{]*\\{[\\s\\S]*background:#141d28/);\n  assert.match(dark, /\\.tabAvatar[^{]*\\{[\\s\\S]*border-radius:7px/);\n  assert.doesNotMatch(dark, /border-radius:50%[^}]*tabAvatar/);\n  assert.match(html, /<strong>Workspace<\\/strong>/);\n});\n\ntest('keyboard-first workbench grammar and Session authority boundaries remain intact', () => {\n  assert.match(html, /placeholder=\\"Search · > command · @ agent · \\/ skill\\"/);\n  assert.match(app, /AGENTIC_SECTIONS = Object\\.freeze\\(\\['attention', 'activity', 'context', 'sessions', 'skills'\\]\\)/);\n  assert.match(app, /presentationFocus\\.selectSession/);\n  assert.match(app, /presentationFocus\\.selectSurface/);\n  assert.match(app, /Browser actuation authority', 'NONE'/);\n  assert.match(app, /Scheduler authority', 'NONE'/);\n  assert.match(app, /Automatic effect retry', 'NONE'/);\n});\n\ntest('dark theme adds no network or execution surface in renderer CSS', () => {\n  const executable = dark.replace(/\\/\\*[\\s\\S]*?\\*\\//g, '');\n  assert.doesNotMatch(executable, /url\\s*\\(|@import|javascript:|expression\\s*\\(/i);\n  assert.doesNotMatch(executable, /api\\.command|metaengineShell|fetch\\s*\\(|WebSocket|EventSource/);\n});\n`);

await fs.writeFile(files.a11yTest, `import assert from 'node:assert/strict';\nimport { readFile } from 'node:fs/promises';\nimport test from 'node:test';\n\nconst css = await readFile(new URL('../ui/app.css', import.meta.url), 'utf8');\nconst dark = await readFile(new URL('../ui/dark-workspace.css', import.meta.url), 'utf8');\nconst html = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');\nconst app = await readFile(new URL('../ui/app.js', import.meta.url), 'utf8');\n\ntest('health labels remain assistive while compact dots stay visible in dark mode', () => {\n  const hardening = css.lastIndexOf('.systemChip b,.systemChip .systemValue{');\n  assert.notEqual(hardening, -1);\n  const rule = css.slice(hardening, css.indexOf('}', hardening) + 1);\n  assert.match(rule, /clip-path:inset\\(50%\\)!important/);\n  assert.match(html, /id=\\"systems\\" class=\\"systems\\" aria-label=\\"Browser health\\" aria-live=\\"off\\"/);\n  assert.match(dark, /@media\\(max-width:1120px\\)[\\s\\S]*\\.systems\\{display:flex!important/);\n});\n\ntest('dark workspace keeps readable metadata and strong focus states', () => {\n  for (const size of ['font-size:9px', 'font-size:9.5px', 'font-size:10px', 'font-size:10.5px']) assert.match(dark, new RegExp(size.replace('.', '\\\\.')));\n  assert.match(dark, /outline:2px solid var\\(--accent\\)/);\n  assert.match(dark, /@media\\(forced-colors:active\\)/);\n  assert.match(dark, /outline:2px solid Highlight/);\n});\n\ntest('pointer controls preserve the 24px target floor', () => {\n  assert.match(dark, /\\.miniButton\\{width:28px;height:28px/);\n  assert.match(dark, /\\.tabClose\\{width:26px;height:26px/);\n  assert.match(dark, /\\.goButton\\{width:27px;height:27px/);\n  assert.match(dark, /\\.iconButton\\{width:28px;height:28px/);\n});\n\ntest('omnibox route mode still returns to selected Chat or Web surface', () => {\n  const start = app.indexOf('function updateWorkbenchRouteKind()');\n  const end = app.indexOf('installAgenticNav();', start);\n  const fn = app.slice(start, end);\n  assert.match(fn, /routeKind\\.textContent = 'CMD'/);\n  assert.match(fn, /routeKind\\.textContent = 'TAB'/);\n  assert.match(fn, /routeKind\\.textContent = 'SKILL'/);\n  assert.match(fn, /routeKind\\.textContent = chat \\? 'CHAT' : 'WEB'/);\n});\n`);

await fs.writeFile(files.hotpathTest, `import assert from 'node:assert/strict';\nimport { readFile } from 'node:fs/promises';\nimport test from 'node:test';\n\nconst main = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');\n\ntest('ChatGPT interactive open preconnects the persistent authenticated session', () => {\n  assert.match(main, /userSession\\.preconnect\\(\\{ url: 'https:\\/\\/chatgpt\\.com\\/', numSockets: 2 \\}\\)/);\n  assert.match(main, /user_space_partition/);\n  assert.doesNotMatch(main, /preconnect[\\s\\S]{0,220}(setInterval|setTimeout|retry)/i);\n});\n\ntest('New Chat selects and exposes the exact WebContents before network completion without retry authority', () => {\n  assert.match(main, /NEW_CHATGPT'\\) return createTab\\('https:\\/\\/chatgpt\\.com\\/', \\{ select: true, load: true, awaitLoad: false \\}\\)/);\n  const start = main.indexOf('async function createTab(');\n  const end = main.indexOf('async function loadTab(', start);\n  const fn = main.slice(start, end);\n  assert.ok(fn.indexOf('registry.select(tab.tab_id)') < fn.indexOf('view.webContents.loadURL(d.normalized_url)'));\n  assert.ok(fn.indexOf('attachSelected()') < fn.indexOf('view.webContents.loadURL(d.normalized_url)'));\n  assert.match(fn, /if \\(awaitLoad\\) await pendingLoad/);\n  assert.match(fn, /load_pending: load && !awaitLoad/);\n  assert.doesNotMatch(fn, /retry|setTimeout|setInterval/i);\n});\n\ntest('native Electron chrome is dark but remote content policy is unchanged', () => {\n  assert.match(main, /nativeTheme\\.themeSource = 'dark'/);\n  assert.match(main, /REMOTE_WEB_PREFERENCES/);\n  assert.doesNotMatch(main, /nodeIntegration:\\s*true/);\n});\n`);

console.log(JSON.stringify({ ok: true, schema: 'metaengine.browser.dark-workspace-v2-patch.v1' }));
