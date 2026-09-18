import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const installedQualification = await readFile(
  new URL('../../../.github/workflows/browser-windows-installed-chat-qualification.yml', import.meta.url),
  'utf8',
);
const activationSoak = await readFile(
  new URL('../scripts/windows-autonomous-session-soak.ps1', import.meta.url),
  'utf8',
);

test('installed Chat qualification proves always-on clean-genesis preconnect without manufacturing startup navigation', () => {
  assert.match(installedQualification, /metaengine-native-supervisor-control-state-v1\.json/);
  assert.match(installedQualification, /metaengine\.native-supervisor\.control-state\.v1/);
  assert.match(installedQualification, /supervisor_mode[^\n]*CONTROL/);
  assert.match(installedQualification, /armed[^\n]*true/i);
  assert.match(installedQualification, /clean_genesis_control_verified/);
  assert.match(installedQualification, /control_state_armed/);
  assert.match(installedQualification, /automatic_initial_tab_suppressed/);
  assert.match(installedQualification, /automatic_initial_remote_load_suppressed/);
  assert.match(installedQualification, /PERSISTENT_PRECONNECT_ONLY/);
  assert.doesNotMatch(installedQualification, /installed_initial_chatgpt_surface_not_exposed/);
  assert.doesNotMatch(installedQualification, /installed_initial_chatgpt_remote_load_not_ready/);
});

test('activation soak treats initial remote topology as runtime-genesis intent independent from always-on authority', () => {
  assert.match(activationSoak, /metaengine-native-supervisor-control-state-v1\.json/);
  assert.match(activationSoak, /metaengine-runtime-generation-v1\.json/);
  assert.match(activationSoak, /\$zeroTopologyStartup\s*=\s*\$requestedInitialTabs -eq 0/);
  assert.match(activationSoak, /if \(-not \$zeroTopologyStartup\)/);
  assert.match(activationSoak, /INITIAL_TAB_CREATE/);
  assert.match(activationSoak, /INITIAL_REMOTE_LOAD/);
  assert.match(activationSoak, /soak_zero_topology_startup_created_initial_tab/);
  assert.match(activationSoak, /soak_zero_topology_startup_started_initial_remote_load/);
  assert.match(activationSoak, /startup_control_always_on_verified/);
  assert.match(activationSoak, /zero_topology_startup_verified/);
});

test('qualification harness changes remain evidence-only and cannot grant runtime authority', () => {
  for (const source of [installedQualification, activationSoak]) {
    assert.doesNotMatch(source, /SET_MODE|GATE_SEND|GATE_DISABLE|FLEET_RECONCILE/);
  }
});