import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const main = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
const preload = await readFile(new URL('../src/preload-shell.cjs', import.meta.url), 'utf8');
const integration = await readFile(new URL('../src/me2/me2-integration-entry.mjs', import.meta.url), 'utf8');
const probe = await readFile(new URL('../../me2-daemon/browser-probe-entry.ts', import.meta.url), 'utf8');
const missionUrl = new URL('../src/me2/me2-mission-control.mjs', import.meta.url);

test('R108 has one Browser-owned Agent lifecycle authority', () => {
  assert.equal(fs.existsSync(missionUrl), false);
  assert.doesNotMatch(main, /me2Mission|me2FleetTabsSetHost|primary-agent-session-select/);
  assert.doesNotMatch(preload, /selectPrimaryAgentSession|primary-agent-session-select/);
  assert.doesNotMatch(integration, /startMe2MissionControl|stopMe2MissionControl|me2MissionControlStatus|\/agentchat/);
  assert.match(main, /primaryChatFleetRoster/);
  assert.match(main, /selectPrimaryChatActor/);
  assert.match(integration, /DAEMON_MISSION_CONTROL_REMOVED/);
  assert.match(integration, /NATIVE_BROWSER_FLEET_AND_SUPERVISOR/);
});

test('R108 packaged ME2 is a standalone zero-authority compatibility probe', () => {
  assert.doesNotMatch(probe, /import\(['"]\.\/index|from ['"]\.\/index|z-ai-web-dev-sdk|SqlMirror/);
  for (const marker of [
    'model_execution_enabled: false',
    'provider_api_enabled: false',
    'provider_network_enabled: false',
    'scheduler_authority: false',
    'browser_actuation_authority: false',
    'filesystem_mutation_enabled: false',
    'sql_mutation_enabled: false',
    'legacy_daemon_module_loaded: false',
    'socket_mutation_surface_enabled: false',
    'authority_effect: false',
  ]) assert.equal(probe.includes(marker), true, 'missing zero-authority marker: ' + marker);
});
