import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const missionUrl = new URL('../src/me2/me2-mission-control.mjs', import.meta.url);
const main = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
const preload = await readFile(new URL('../src/preload-shell.cjs', import.meta.url), 'utf8');
const integration = await readFile(new URL('../src/me2/me2-integration-entry.mjs', import.meta.url), 'utf8');

test('R107 duplicate ME2 Mission Control scheduler is physically removed', () => {
  assert.equal(fs.existsSync(missionUrl), false);
  assert.doesNotMatch(main, /me2Mission|me2FleetTabsSetHost|primary-agent-session-select/);
  assert.doesNotMatch(preload, /selectPrimaryAgentSession|primary-agent-session-select/);
  assert.doesNotMatch(integration, /startMe2MissionControl|stopMe2MissionControl|me2MissionControlStatus/);
});

test('R107 integration advertises native fleet replacement instead of a compatibility poller', () => {
  assert.match(integration, /DAEMON_MISSION_CONTROL_REMOVED/);
  assert.match(integration, /NATIVE_BROWSER_FLEET_AND_SUPERVISOR/);
  assert.match(integration, /REMOVED_NATIVE_BROWSER_FLEET_AUTHORITY/);
  assert.doesNotMatch(integration, /ME2_MISSION_POLL_MS|setInterval\([^)]*Mission|\/agentchat/);
});

test('R107 Browser-owned actor selection remains exact and presentation-only', () => {
  assert.match(main, /const matches = primaryChatFleetRoster\(\)\.actors\.filter/);
  assert.match(main, /primary_chat_actor_ambiguous/);
  assert.match(main, /selection_applied: true/);
  assert.match(main, /exact_native_binding: true/);
  assert.match(main, /scheduler_authority: false/);
  assert.match(main, /browser_command_authority: false/);
});
