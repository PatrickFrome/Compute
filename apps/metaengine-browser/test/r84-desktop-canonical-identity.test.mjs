import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import {
  me2FleetTabsGetHost,
  me2FleetTabsHostStatus,
  me2FleetTabsResolveIdentity,
  me2FleetTabsSetHost,
} from '../src/me2/me2-fleet-tabs-host.mjs';

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
      browsercell_identity: id,
      browsercell_identity_source: 'CANONICAL_TAB_ID',
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
      exact_identity: true,
      execution_authority: true,
      command_leasing: true,
      authority_effect: true,
    }),
  });

  const identity = me2FleetTabsResolveIdentity(tabId);
  assert.equal(identity.schema, 'metaengine.browser.me2.native-conversation-identity.v1');
  assert.equal(identity.tab_id, tabId);
  assert.equal(identity.browsercell_identity, tabId);
  assert.equal(identity.web_contents_id, 77);
  assert.equal(identity.webcontents_binding_generation, 9);
  assert.equal(identity.runtime_binding_generation, 12);
  assert.equal(identity.cell_id, 'cell:worker-7');
  assert.equal(identity.target_id, 'target-77');
  assert.equal(identity.exact_identity, true);
  assert.equal(identity.execution_authority, false);
  assert.equal(identity.command_leasing, false);
  assert.equal(identity.automatic_retry_allowed, false);
  assert.equal(identity.authority_effect, false);

  const status = me2FleetTabsHostStatus();
  assert.equal(status.exact_identity_resolver_registered, true);
  assert.equal(status.physical_close_registered, true);
  assert.equal(status.select_registered, true);
  assert.equal(status.second_tab_registry, false);
  assert.equal(typeof me2FleetTabsGetHost().resolveIdentity, 'function');
});

test('R84 Browser root wires Mission Control to existing exact WebContents/CDP identity', async () => {
  const main = await fs.readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
  const mission = await fs.readFile(new URL('../src/me2/me2-mission-control.mjs', import.meta.url), 'utf8');

  assert.match(main, /ExactBrowserTabViewMap, resolveExactWebContentsTabBinding/);
  assert.match(main, /browsercell_identity:\s*id/);
  assert.match(main, /browsercell_identity_source:\s*'CANONICAL_TAB_ID'/);
  assert.match(main, /runtime_binding_index\?\.bindings/);
  assert.match(main, /resolveIdentity:\s*\(tabId\) => canonicalTabRuntimeIdentity\(tabId\)/);
  assert.match(main, /closeTab:\s*\(tabId\) => closeTab\(tabId\)/);

  assert.match(mission, /me2FleetTabsResolveIdentity/);
  assert.match(mission, /runtime_identity:\s*nativeIdentity/);
  assert.match(mission, /await host\.closeTab\(known\.tab_id\)/);
});
