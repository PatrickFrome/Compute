import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import { normalizeAgentPlatformConversationUrl } from '../src/browser-agent-platform.mjs';

test('R108 Browser root keeps canonical exact identity while ME2 Agent lifecycle authority is absent', async () => {
  const main = await fs.readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');

  assert.match(main, /ExactBrowserTabViewMap, resolveExactWebContentsTabBinding/);
  assert.match(main, /function canonicalTabRuntimeIdentity\(tabId\)/);
  assert.match(main, /nativeSupervisor\?\.runtimeBinding\?\.\(id\)/);
  assert.match(main, /browsercell_identity:\s*cellId/);
  assert.match(main, /browsercell_identity_source:\s*cellId \? 'BROWSER_RUNTIME_BINDING_INDEX' : null/);
  assert.match(main, /target_id:\s*runtimeTargetId/);
  assert.match(main, /identity_lookup_complexity:\s*'O\(1\)'/);
  assert.match(main, /function primaryChatFleetRoster\(\)/);
  assert.match(main, /function selectPrimaryChatActor\(actorId\)/);
  assert.doesNotMatch(main, /me2Mission|me2FleetTabsSetHost|primary-agent-session-select/);
  assert.doesNotMatch(main, /runtimeRows\.find/);
  assert.doesNotMatch(main, /semanticRows\.find/);
  assert.doesNotMatch(main, /target_id:\s*runtimeTargetId\s*\|\|/);
  assert.match(main, /webcontents_target_fallback:\s*false/);
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


test('R108 canonical ChatGPT conversation normalization is strict and retired z.ai is never active Agent proof', () => {
  assert.throws(
    () => normalizeAgentPlatformConversationUrl('api-session-123'),
    /fleet_transport_conversation_origin_invalid/,
  );
  assert.throws(
    () => normalizeAgentPlatformConversationUrl('http://chatgpt.com/c/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'),
    /fleet_transport_conversation_origin_invalid/,
  );
  assert.throws(
    () => normalizeAgentPlatformConversationUrl('https://example.com/c/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'),
    /fleet_transport_conversation_origin_invalid/,
  );
  assert.throws(
    () => normalizeAgentPlatformConversationUrl('https://chat.z.ai/c/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'),
    /fleet_transport_conversation_origin_invalid/,
  );
  assert.equal(
    normalizeAgentPlatformConversationUrl('https://www.chatgpt.com/c/AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE/'),
    'https://chatgpt.com/c/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  );
});
