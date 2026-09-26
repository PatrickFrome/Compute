import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import {
  me2FleetTabsGetHost,
  me2FleetTabsHostStatus,
  me2FleetTabsResolveIdentity,
  me2FleetTabsSetHost,
} from '../src/me2/me2-fleet-tabs-host.mjs';
import { me2NativeConversationUrl } from '../src/me2/me2-mission-control.mjs';

function registry() {
  const tabId = 'tab_11111111-1111-4111-8111-111111111111';
  const rows = new Map([[tabId, { tab_id: tabId, role: 'FLEET', url: 'https://chat.z.ai/c/example' }]]);
  return {
    get: (id) => rows.get(String(id)) || null,
    snapshot: () => ({ tabs: [...rows.values()] }),
    census: () => ({ by_role: { FLEET: 1 } }),
  };
}

test('R84 ME2 tab host projects canonical Browser identity without creating authority', () => {
  const tabId = 'tab_11111111-1111-4111-8111-111111111111';
  me2FleetTabsSetHost({
    registry: registry(),
    createTab: async () => ({ tab_id: tabId }),
    closeTab: async () => true,
    selectTab: () => true,
    resolveIdentity: (id) => ({
      tab_id: id,
      browsercell_identity: 'cell:worker-7',
      browsercell_identity_source: 'BROWSER_RUNTIME_BINDING_INDEX',
      web_contents_id: 77,
      webcontents_binding_generation: 9,
      runtime_binding_generation: 12,
      cell_id: 'cell:worker-7',
      cell_generation: 3,
      renderer_process_key: '9001:123.5',
      target_id: 'target-77',
      document_generation: 4,
      semantic_revision: 18,
      runtime_binding_live: true,
      runtime_identity_complete: true,
      runtime_binding_source: 'BROWSER_RUNTIME_BINDING_INDEX_O1',
      identity_lookup_complexity: 'O(1)',
      exact_identity: true,
      execution_authority: true,
      command_leasing: true,
      authority_effect: true,
    }),
  });

  const identity = me2FleetTabsResolveIdentity(tabId);
  assert.equal(identity.schema, 'metaengine.browser.me2.native-conversation-identity.v1');
  assert.equal(identity.tab_id, tabId);
  assert.equal(identity.browsercell_identity, 'cell:worker-7');
  assert.equal(identity.browsercell_identity_source, 'BROWSER_RUNTIME_BINDING_INDEX');
  assert.equal(identity.web_contents_id, 77);
  assert.equal(identity.webcontents_binding_generation, 9);
  assert.equal(identity.runtime_binding_generation, 12);
  assert.equal(identity.cell_id, 'cell:worker-7');
  assert.equal(identity.target_id, 'target-77');
  assert.equal(identity.runtime_identity_complete, true);
  assert.equal(identity.runtime_binding_source, 'BROWSER_RUNTIME_BINDING_INDEX_O1');
  assert.equal(identity.identity_lookup_complexity, 'O(1)');
  assert.equal(identity.webcontents_target_fallback, false);
  assert.equal(identity.exact_identity, true);
  assert.equal(identity.execution_authority, false);
  assert.equal(identity.command_leasing, false);
  assert.equal(identity.automatic_retry_allowed, false);
  assert.equal(identity.authority_effect, false);

  const status = me2FleetTabsHostStatus();
  assert.equal(status.exact_identity_resolver_registered, true);
  assert.equal(status.physical_close_registered, true);
  assert.equal(status.select_registered, true);
  assert.equal(status.canonical_runtime_binding_only, true);
  assert.equal(status.browsercell_fallback_allowed, false);
  assert.equal(status.target_fallback_allowed, false);
  assert.equal(status.second_tab_registry, false);
  assert.equal(status.canonical_runtime_binding_only, true);
  assert.equal(status.browsercell_fallback_allowed, false);
  assert.equal(status.target_fallback_allowed, false);
  assert.equal(typeof me2FleetTabsGetHost().resolveIdentity, 'function');
});

test('R84 Browser root wires Mission Control to existing exact WebContents/CDP identity', async () => {
  const main = await fs.readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
  const mission = await fs.readFile(new URL('../src/me2/me2-mission-control.mjs', import.meta.url), 'utf8');

  assert.match(main, /ExactBrowserTabViewMap, resolveExactWebContentsTabBinding/);
  assert.match(main, /nativeSupervisor\?\.runtimeBinding\?\.\(id\)/);
  assert.match(main, /browsercell_identity:\s*cellId/);
  assert.match(main, /browsercell_identity_source:\s*cellId \? 'BROWSER_RUNTIME_BINDING_INDEX' : null/);
  assert.match(main, /target_id:\s*runtimeTargetId/);
  assert.match(main, /identity_lookup_complexity:\s*'O\(1\)'/);
  assert.doesNotMatch(main, /runtimeRows\.find/);
  assert.doesNotMatch(main, /semanticRows\.find/);
  assert.doesNotMatch(main, /target_id:\s*runtime\?\.target_id \|\| semantic\?\.target_id \|\|/);
  assert.match(main, /resolveIdentity:\s*\(tabId\) => canonicalTabRuntimeIdentity\(tabId\)/);
  assert.match(main, /closeTab:\s*\(tabId\) => closeTab\(tabId\)/);
  assert.match(main, /webcontents_target_fallback:\s*false/);
  assert.doesNotMatch(main, /target_id:\s*runtimeTargetId\s*\|\|/);

  assert.match(mission, /me2FleetTabsResolveIdentity/);
  assert.match(mission, /runtime_identity:\s*nativeIdentity/);
  assert.match(mission, /await host\.closeTab\(known\.tab_id\)/);
  assert.match(mission, /conversation_url_required/);
  assert.match(mission, /g\.ui_route_authorized === true/);
  assert.doesNotMatch(mission, /#chat=\$\{encodeURIComponent\(session\.id\)\}/);
  assert.match(mission, /AGENT_TAB_ADOPTED/);
});

test('R84 identity projection never fabricates BrowserCell or CDP target when Brain binding is absent', () => {
  const tabId = 'tab_22222222-2222-4222-8222-222222222222';
  const rows = new Map([[tabId, { tab_id: tabId, role: 'FLEET', url: 'https://chat.z.ai/c/no-brain-binding' }]]);
  me2FleetTabsSetHost({
    registry: {
      get: (id) => rows.get(String(id)) || null,
      snapshot: () => ({ tabs: [...rows.values()] }),
      census: () => ({ by_role: { FLEET: 1 } }),
    },
    createTab: async () => ({ tab_id: tabId }),
    resolveIdentity: (id) => ({
      tab_id: id,
      browsercell_identity: null,
      browsercell_identity_source: null,
      web_contents_id: 88,
      webcontents_binding_generation: 2,
      runtime_binding_generation: null,
      cell_id: null,
      cell_generation: null,
      renderer_process_key: null,
      target_id: null,
      document_generation: 0,
      semantic_revision: 0,
      runtime_binding_live: false,
      runtime_identity_complete: false,
      runtime_binding_source: null,
      identity_lookup_complexity: 'O(1)',
      exact_identity: true,
      authority_effect: false,
    }),
  });

  const identity = me2FleetTabsResolveIdentity(tabId);
  assert.equal(identity.browsercell_identity, null);
  assert.equal(identity.browsercell_identity_source, null);
  assert.equal(identity.cell_id, null);
  assert.equal(identity.target_id, null);
  assert.equal(identity.runtime_binding_live, false);
  assert.equal(identity.runtime_identity_complete, false);
  assert.equal(identity.webcontents_target_fallback, false);
  assert.equal(identity.execution_authority, false);
  assert.equal(identity.authority_effect, false);
});

test('R84 desktop gateway semantic port closes upgraded sockets under Browser lifecycle ownership', async () => {
  const gateway = await fs.readFile(new URL('../src/me2/me2-ui-gateway.mjs', import.meta.url), 'utf8');
  assert.match(gateway, /const sockets = new Set\(\)/);
  assert.match(gateway, /server\.on\('connection', trackSocket\)/);
  assert.match(gateway, /trackSocket\(tcpConnect/);
  assert.match(gateway, /for \(const socket of \[\.\.\.sockets\]\)/);
  assert.match(gateway, /socket\.destroy\(\)/);
  assert.match(gateway, /me2UiHostStatus/);
  assert.match(gateway, /uiRouteAuthorized/);
  assert.match(gateway, /ui_upstream_unowned/);
  assert.match(gateway, /ui_route_authorized:\s*me2UiHostStatus\(\)\?\.routing_authorized === true/);
  assert.match(gateway, /upgraded_socket_shutdown_bounded:\s*true/);
  assert.match(gateway, /authority_effect:\s*false/);
});


test('R84 native conversation binding requires exact provider conversation_url, never daemon session id', () => {
  assert.equal(me2NativeConversationUrl({ id: 'api-session-123' }), null);
  assert.equal(me2NativeConversationUrl({
    id: 'api-session-123',
    conversation_url: 'http://chat.z.ai/c/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  }), null);
  assert.equal(me2NativeConversationUrl({
    id: 'api-session-123',
    conversation_url: 'https://example.com/c/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  }), null);
  assert.equal(me2NativeConversationUrl({
    id: 'api-session-123',
    conversation_url: 'https://chat.z.ai/c/AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE/',
  }), 'https://chat.z.ai/c/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
});
