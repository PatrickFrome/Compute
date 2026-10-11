import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

// Exercise the actual main-process presentation functions without loading
// Electron, mutating the registry or borrowing command execution authority.
const source = await fs.readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
function functionSource(name, next) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`\nfunction ${next}(`, start);
  assert.ok(start >= 0 && end > start, `main presentation function ${name} unavailable`);
  return source.slice(start, end);
}
const rosterSource = functionSource('primaryChatFleetRoster', 'selectPrimaryChatActor');
const visibilitySource = source.slice(source.indexOf('function nativeBrowserSurfaceAllowed('), source.indexOf('\nasync function preparePrimaryShellTarget('));
function presentation({ state = 'PROVISIONING_AMBIGUOUS', selected = 'tab_agent', actor = true, destroyed = false,
  page = 'browser', overlay = false, mode = 'ME2_PRIMARY', target = 'webcontents:7', indexed = true } = {}) {
  const tab = { tab_id: 'tab_agent', url: 'https://chatgpt.com/c/verified-existing-tab', title: 'Existing Agent' };
  const inputAgent = { agent_id: 'agent_impl', tab_id: tab.tab_id, target_id: target, role: 'IMPLEMENTER', lifecycle_state: state,
    ambiguous_reason: 'TRANSPORT_BOOTSTRAP_EFFECT_PENDING' };
  const context = {
    Object, URL,
    registry: { selected: () => selected ? { tab_id: selected } : null, get: id => id === tab.tab_id ? tab : null },
    views: new Map([[tab.tab_id, { webContents: { id: 7, isDestroyed: () => destroyed } }]]),
    resolveExactWebContentsTabBinding: () => indexed ? { tab_id: tab.tab_id, web_contents_id: 7 } : null,
    fleet: { snapshot: () => ({ agents: actor ? [inputAgent] : [] }) },
    nativeSupervisor: { snapshot: () => ({}) },
    isAgentPlatformHost: host => host === 'chatgpt.com',
    AGENT_PLATFORM_PROVIDER: 'provider', AGENT_PLATFORM_ID: 'platform', AGENT_PLATFORM_MODEL: 'model',
    primaryShellMode: mode, primaryShellPage: page, primaryShellOverlayActive: overlay,
  };
  vm.createContext(context);
  vm.runInContext(`${rosterSource}\n${visibilitySource}`, context);
  return { context, inputAgent };
}

test('background selected tab cannot cover the native shell empty state without a roster actor', () => {
  const { context } = presentation({ actor: false });
  assert.equal(context.primaryChatFleetRoster().actor_count, 0);
  assert.equal(context.nativeBrowserSurfaceAllowed(), false);
});

test('ambiguous bound Agent is inspectable with its actual state and no promotion', () => {
  const { context, inputAgent } = presentation();
  const roster = context.primaryChatFleetRoster();
  assert.equal(roster.actor_count, 1);
  assert.equal(roster.selected_actor_id, 'agent:agent_impl');
  const actor = roster.actors[0];
  assert.equal(actor.state, 'PROVISIONING_AMBIGUOUS');
  assert.equal(actor.recovery_required, true);
  assert.equal(actor.recovery_reason, 'TRANSPORT_BOOTSTRAP_EFFECT_PENDING');
  assert.equal(actor.exact_native_binding, true);
  assert.equal(actor.presentation_only, true);
  assert.equal(actor.authority_effect, false);
  assert.equal(context.nativeBrowserSurfaceAllowed(), true);
  assert.equal(inputAgent.lifecycle_state, 'PROVISIONING_AMBIGUOUS');
});

test('native view follows the exact selected actor and stays behind other pages or overlays', () => {
  for (const options of [{ selected: 'tab_background' }, { selected: null }, { destroyed: true },
    { page: 'system' }, { overlay: true }, { state: 'RETIRED' }, { target: 'webcontents:8' }, { indexed: false }]) {
    const { context } = presentation(options);
    assert.equal(context.nativeBrowserSurfaceAllowed(), false, JSON.stringify(options));
  }
  assert.equal(presentation({ state: 'ACTIVE' }).context.nativeBrowserSurfaceAllowed(), true);
  assert.equal(presentation({ mode: 'FAIL_CLOSED_RECOVERY', actor: false }).context.nativeBrowserSurfaceAllowed(), true);
});
