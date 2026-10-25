import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';

const read = relative => readFile(new URL(relative, import.meta.url), 'utf8');
const store = await read('../../me2-ui/src/components/me2/store.tsx');
const main = await read('../src/main.mjs');
const topbar = await read('../../me2-ui/src/components/me2/shell/topbar.tsx');
const palette = await read('../../me2-ui/src/components/me2/shell/command-palette.tsx');

// Evaluate production presentation code with an inert Zustand adapter.
// No Electron window, OS effect, native runtime or model runs in this unit test.
function presentationStore() {
  let state;
  const calls = [], keys = [];
  const create = factory => {
    const set = update => { state = {...state, ...(typeof update === 'function' ? update(state) : update)}; };
    state = factory(set, () => state);
    return {getState: () => state};
  };
  const context = vm.createContext({create, Promise,
    window: {metaengineShell: {setPrimaryPage: page => { calls.push(page); return Promise.resolve(); }}},
    localStorage: {getItem: () => null, setItem() {}}, history: {replaceState() {}}, location: {hash: ''},
    document: {addEventListener: (kind, fn) => { if (kind === 'keydown') keys.push(fn); }},
  });
  const source = stripTypeScriptTypes(store, {mode: 'strip'})
    .replace(/import\s*\{create\}\s*from\s*['"]zustand['"];?/, '')
    .replace(/\bexport\s+(?=const|function)/g, '');
  const api = vm.runInContext(source + '\n;({PAGES,normalizePageKey,useMe2});', context);
  return {...api, calls, keys};
}

test('five real renderer screens exactly match native presentation acceptance, including Operator', async () => {
  const api = presentationStore();
  const pages = Array.from(api.PAGES, page => page.key);
  assert.deepEqual(pages, ['browser', 'tasks', 'code', 'operator', 'system']);
  const declaration = main.match(/const ME2_PRIMARY_PAGES = new Set\((\[[^\n]+\])\);/);
  assert.ok(declaration, 'native presentation allowlist must remain explicit');
  assert.deepEqual(Array.from(vm.runInNewContext(declaration[1])), pages);

  const start = main.indexOf("ipcMain.handle('metaengine:shell:primary-page'");
  const end = main.indexOf("ipcMain.handle('metaengine:shell:primary-overlay'", start);
  assert.ok(start >= 0 && end > start);
  let handler, checks = 0, layouts = 0;
  const context = vm.createContext({
    ipcMain: {handle: (_channel, fn) => {handler = fn;}},
    ME2_PRIMARY_PAGES: new Set(pages), primaryShellPage: 'browser',
    assertShellSender: event => {checks++; if (event !== 'trusted-fixture') throw Error('untrusted_sender');},
    layout: () => {layouts++;}, nativeBrowserSurfaceAllowed: () => context.primaryShellPage === 'browser',
  });
  vm.runInContext(main.slice(start, end), context);
  for (const page of pages) {
    const result = await handler('trusted-fixture', page);
    assert.equal(result.page, page);
    assert.equal(result.native_browser_surface_visible, page === 'browser');
    assert.equal(result.presentation_only, true);
    for (const field of ['scheduler_authority','browser_command_authority','release_authority','authority_effect']) assert.equal(result[field], false);
  }
  assert.equal(layouts, pages.length);
  for (const page of ['command','agents','compute','supervisor','memory','observability','unknown']) {
    await assert.rejects(handler('trusted-fixture', page), /primary_shell_page_invalid/);
  }
  await assert.rejects(handler('untrusted-fixture', 'operator'), /untrusted_sender/);
  assert.equal(layouts, pages.length, 'rejected navigation cannot change native bounds');
  assert.equal(checks, pages.length + 8);
});

test('persisted retired routes normalize without reviving removed product panels', () => {
  const api = presentationStore();
  for (const old of ['supervisor','memory','observability']) assert.equal(api.normalizePageKey(old), 'operator');
  for (const old of ['command','agents','compute','unknown',null]) assert.equal(api.normalizePageKey(old), 'browser');
  const state = () => api.useMe2.getState();
  state().init();
  state().init();
  assert.equal(api.keys.length, 1, 'initialization cannot duplicate global shortcut listeners');
  state().setPage('operator');
  assert.equal(state().page, 'operator');
  assert.equal(api.calls.at(-1), 'operator');
  for (let i = 0; i < 25; i++) state().setPage(i % 2 ? 'tasks' : 'browser');
  assert.equal(state().recentPages.length, 20);
  let prevented = 0;
  api.keys[0]({key: 'k', ctrlKey: true, preventDefault: () => {prevented++;}});
  assert.equal(state().paletteOpen, true);
  api.keys[0]({key: 'ArrowLeft', altKey: true, preventDefault: () => {prevented++;}});
  assert.equal(prevented, 1, 'retired Alt navigation has no handler');
});

test('top chrome retains search and settings without retired workspace or stage selectors', () => {
  assert.doesNotMatch(topbar, /workflowStageForPage|WORKSPACES\.map|WORKFLOW_STAGES\.map|data-testid="workspace-(?:switcher|reset-layout)"/);
  assert.match(topbar, /data-testid="global-cmdbar"/);
  assert.match(topbar, /data-testid="settings-button"/);
  assert.match(topbar, /Search workspace and tasks/);
  assert.match(topbar, /setPage\("system"\)/);
  assert.match(palette, /PAGES\.map/);
});

test('brand and selection accent remains distinct from observed runtime readiness', () => {
  assert.match(topbar, /border-cyan-900/);
  assert.match(topbar, /text-cyan-300/);
  assert.match(topbar, /border-emerald-900/);
  assert.match(topbar, /text-emerald-300/);
  assert.match(topbar, /badge\.autonomous_ready_color/);
  assert.match(topbar, /projectClientWorkBadge/);
});
