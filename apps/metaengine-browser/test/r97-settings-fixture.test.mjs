import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createBrowserGuardianStatusObserver } from '../src/browser-guardian-status-observer.mjs';
import { createGithubRepositoryConnection } from '../src/github-repository-connection.mjs';

async function fixture() {
  const source = await readFile(new URL('./me2-r85-visual-evidence.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('function registerPresentationIpc() {');
  const end = source.indexOf('\nasync function waitFor(', start);
  assert.ok(start >= 0 && end > start);
  const handlers = new Map();
  const context = vm.createContext({
    ipcMain: { handle(channel, handler) {
      assert.equal(handlers.has(channel), false, `duplicate handler: ${channel}`);
      handlers.set(channel, handler);
    } },
    goalSubmitCount: 0,
  });
  vm.runInContext(source.slice(start, end) + '\nregisterPresentationIpc();', context);
  const invoke = async (channel, ...args) => {
    assert.ok(handlers.has(channel), `No handler registered for '${channel}'`);
    return handlers.get(channel)({}, ...args);
  };
  const exposed = {};
  const preload = await readFile(new URL('../src/preload-shell.cjs', import.meta.url), 'utf8');
  vm.runInNewContext(preload, {
    require(name) {
      assert.equal(name, 'electron');
      return { contextBridge: { exposeInMainWorld: (key, value) => { exposed[key] = value; } },
        ipcRenderer: { invoke, on() {} } };
    },
    location: { protocol: 'http:', hostname: '127.0.0.1', port: '8137' },
  });
  return { invoke, bridge: exposed.metaengineClient, context };
}
const plain = value => JSON.parse(JSON.stringify(value));


test('R97 settings reads expose only absent/unverified production states without effects', async () => {
  const { bridge, context } = await fixture();
  let externalReads = 0;
  const guardian = createBrowserGuardianStatusObserver({readStatus: () => { externalReads++; throw Error('unexpected'); }}).snapshot();
  const repository = createGithubRepositoryConnection({readRepository: async () => null,
    readCredential: async () => { externalReads++; throw Error('unexpected credential read'); },
    fetchImpl: async () => { externalReads++; throw Error('unexpected network'); }, now: () => null});
  const expectedRepository = await repository.connect();
  const main = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
  const start = main.indexOf('function githubChatState() {');
  const end = main.indexOf('\nasync function connectGithubChat()', start);
  assert.ok(start >= 0 && end > start);
  const expectedChat = vm.runInNewContext(main.slice(start,end)+';githubChatState()', {githubChatRelay:null,githubChatRelayError:null});
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(plain(await bridge.guardianStatus()), plain(guardian));
    assert.deepEqual(plain(await bridge.githubRepositoryStatus()), expectedRepository);
    assert.deepEqual(plain(await bridge.githubChatStatus()), plain(expectedChat));
    assert.equal(await bridge.latestGoal(), null);
    assert.equal(context.goalSubmitCount, 0);
  }
  assert.equal(externalReads, 0);
});

test('R97 repository status rejects injected parameters and action endpoints remain absent', async () => {
  const { invoke } = await fixture();
  await assert.rejects(() => invoke('metaengine:client:github-repository-status', {authenticated:true}), /CALLER_ARGUMENTS_FORBIDDEN/);
  for (const channel of ['activate-guardian','github-repository-connect','github-chat-connect','github-chat-disconnect']) {
    await assert.rejects(() => invoke('metaengine:client:'+channel), /No handler registered/);
  }
});

test('R97 settings routes and section probes match current semantic UI, not retired tabs', async () => {
  const [harness, system, store, shell, operator] = await Promise.all([
    readFile(new URL('./me2-r85-visual-evidence.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../../me2-ui/src/components/me2/pages/system.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../me2-ui/src/components/me2/store.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../me2-ui/src/components/me2/shell/me2-shell.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../me2-ui/src/components/me2/pages/operator-observatory.tsx', import.meta.url), 'utf8'),
  ]);
  const sections = [...system.matchAll(/<section[^>]+data-testid="([^"]+)"/g)].map(m=>m[1]);
  assert.deepEqual(sections, ['native-work-readiness','github-repository-connection','github-chat-control','guardian-runtime-status']);
  const pages = [...store.matchAll(/\{key:'([^']+)',label:'([^']+)'/g)].filter(m=>m[1]!=='system');
  assert.equal(pages.length, 4);
  for (const [,key,label] of pages) assert.ok(harness.includes(`['${key}','${label}',`), `missing current route: ${key}`);
  for (const section of sections) assert.ok(harness.includes(`'${section}'`));
  assert.match(system, /PAGES\.filter\(page=>page\.key!=='system'\)/);
  assert.match(system, /aria-label="Рабочие экраны"/);
  assert.match(shell, /case "operator": return <OperatorObservatoryPage \/>/);
  assert.match(operator, /data-authority-effect="false"/);
  assert.doesNotMatch(harness, /settings-open-|settings-areas|settings-advanced-surfaces|settings-tab-runtime/);
  assert.match(harness, /guardian_activation_disabled \|\| !settingsCapture\.metrics\.github_chat_revoke_disabled/);
  assert.match(harness, /work_badge\?\.admin_ready !== 'true' \|\| pausedCapture\.metrics\.work_badge\?\.state !== 'PAUSED'/);
  assert.match(harness, /state'\) === 'UNAVAILABLE'.+data-admin-ready'\) === 'false'/);
});

test('R97 current palette probes retain the full font, contrast, icon and screenshot gates', async () => {
  const harness = await readFile(new URL('./me2-r85-visual-evidence.mjs', import.meta.url), 'utf8');
  assert.match(harness, /querySelectorAll\('\[cmdk-item\], \[cmdk-group-heading\], \[role=dialog\] \[role=status\]'\)/);
  assert.match(harness, /palette_text_styles\.length < 4/);
  assert.match(harness, /row\.font_size < 12 \|\| row\.contrast < 4\.5/);
  assert.match(harness, /assertPaletteDecorativeSearch\(searchCapture\.metrics\)/);
  assert.match(harness, /png\.length < 4096/);
  assert.match(harness, /sha256: digest\(png\)/);
  assert.match(harness, /const VISUAL_PHASE_TIMEOUT_MS = 120_000/);
});


test('all executable R97 receipt consumers migrate to v2 and fail closed on stale schema', async () => {
  for (const path of ['../../../.github/workflows/client-wave10-w62-source-r97.yml',
    '../../../.github/workflows/browser-windows-package-smoke.yml',
    '../../../.github/workflows/browser-agent-result-installer-source-qualification.yml']) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8');
    assert.ok(source.includes("$evidence.schema -ne 'metaengine.browser.r97-visual-evidence.v2'"));
    assert.ok(!source.includes('metaengine.browser.r97-visual-evidence.v1'));
    assert.ok(source.includes("$evidence.PSObject.Properties.Name -contains 'advanced_surfaces_settings_only'"));
    assert.ok(source.includes('$evidence.settings_controls_scoped_and_routes_verified -isnot [bool]'));
    assert.ok(source.includes('$evidence.settings_controls_scoped_and_routes_verified -ne $true'));
  }
});


test('R97 permits only the current noninteractive aria-hidden search SVG beside accessible input', async () => {
  const source = await readFile(new URL('./me2-r85-visual-evidence.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('function assertPaletteDecorativeSearch(metrics) {');
  const end = source.indexOf('\nasync function capture(', start);
  assert.ok(start >= 0 && end > start);
  const validate = vm.runInNewContext(source.slice(start,end)+';assertPaletteDecorativeSearch');
  const valid = {palette_svg_count:1,palette_search_input_accessible:true,palette_icons:[{
    identity:'lucide-search',aria_hidden:'true',parent_slot:'command-input-wrapper',interactive:false,
    shape:[{tag:'path',d:'m21 21-4.34-4.34'},{tag:'circle',cx:'11',cy:'11',r:'8'}],
  }]};
  validate(valid);
  for (const change of [m=>m.palette_icons[0].identity='lucide-terminal',m=>m.palette_icons[0].interactive=true,
    m=>m.palette_icons[0].aria_hidden='false',m=>m.palette_search_input_accessible=false,
    m=>m.palette_icons[0].shape[0].d='unexpected',m=>m.palette_svg_count=2,
    m=>m.palette_icons.push({...m.palette_icons[0]}),m=>m.palette_icons[0].parent_slot='command-item']) {
    const mutated=structuredClone(valid);change(mutated);
    assert.throws(()=>validate(mutated), /ui1_palette_icon_contract_failed/);
  }
  const ui = await readFile(new URL('../../me2-ui/src/components/ui/command.tsx', import.meta.url), 'utf8');
  const palette = await readFile(new URL('../../me2-ui/src/components/me2/shell/command-palette.tsx', import.meta.url), 'utf8');
  assert.match(ui, /import \{ SearchIcon \} from "lucide-react"/);
  assert.match(ui, /<SearchIcon className="size-4 shrink-0 opacity-50" aria-hidden \/>/);
  assert.match(palette, /aria-label="Поиск по экранам и задачам"/);
});
