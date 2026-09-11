import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONTROL_ACTION_MANIFEST,
  CONTROL_ACTION_MANIFEST_REVISION,
  browserImplementedControlActions,
  controlActionDescriptor,
  genericIssueV1ControlActions,
  publicBrowserControlActions,
} from '../src/control-actions-manifest.mjs';
import { browserControlCapabilities } from '../src/browser-control-capabilities.mjs';
import { classifyNativeSupervisorCommand } from '../src/native-supervisor-command-lanes.mjs';

const exactTab = 'tab_00000000-0000-4000-8000-000000000001';

test('canonical control action manifest is unique, bounded and digest-addressed', () => {
  assert.equal(CONTROL_ACTION_MANIFEST.length, 46);
  assert.equal(new Set(CONTROL_ACTION_MANIFEST.map((row) => row.action)).size, CONTROL_ACTION_MANIFEST.length);
  assert.match(CONTROL_ACTION_MANIFEST_REVISION, /^sha256:[0-9a-f]{64}$/);
  for (const row of CONTROL_ACTION_MANIFEST) {
    assert.equal(row.authority_effect, false, row.action);
    assert.equal(row.automatic_retry_allowed, false, row.action);
    assert.ok(['READ_ONLY', 'TAB_MUTATION', 'GLOBAL_MUTATION', 'EMERGENCY'].includes(row.lane), row.action);
  }
});

test('Browser public capabilities are derived from the canonical manifest revision', () => {
  const capabilities = browserControlCapabilities();
  assert.equal(capabilities.capability_revision, CONTROL_ACTION_MANIFEST_REVISION);
  assert.deepEqual(
    capabilities.implemented.map((row) => row.action),
    publicBrowserControlActions().map((row) => row.action),
  );
  assert.equal(capabilities.implemented.some((row) => row.action === 'TAB_CENSUS'), true);
  assert.equal(capabilities.implemented.some((row) => row.action === 'FLEET_STATUS'), true);
  assert.equal(capabilities.implemented.some((row) => row.action === 'SET_MODE'), false);
  assert.equal(capabilities.implemented.some((row) => row.action === 'RESOLVE_PROMPT'), false);
});

test('manifest records current legacy and unimplemented drift explicitly instead of hiding it', () => {
  const setMode = controlActionDescriptor('SET_MODE');
  assert.equal(setMode.browser_implemented, true);
  assert.equal(setMode.public_capability, false);
  assert.equal(setMode.generic_issue_v1, true);
  assert.equal(setMode.deprecated, true);

  const unresolved = controlActionDescriptor('RESOLVE_PROMPT');
  assert.equal(unresolved.browser_implemented, false);
  assert.equal(unresolved.public_capability, false);
  assert.equal(unresolved.generic_issue_v1, false);

  assert.ok(browserImplementedControlActions().length < CONTROL_ACTION_MANIFEST.length);
  assert.ok(genericIssueV1ControlActions().length < browserImplementedControlActions().length);
});

test('scheduler lane taxonomy agrees with the canonical manifest for every declared action', () => {
  for (const row of CONTROL_ACTION_MANIFEST) {
    const payload = row.action === 'SET_SUPERVISOR_MODE'
      ? { mode: 'CONTROL' }
      : row.lane === 'TAB_MUTATION'
        ? { tab_id: exactTab }
        : {};
    const descriptor = classifyNativeSupervisorCommand({ action: row.action, payload });
    assert.equal(descriptor.lane, row.lane, row.action);
    assert.equal(descriptor.read_only, row.effect === 'READ_ONLY', row.action);
    assert.equal(descriptor.authority_effect, false, row.action);
  }
});

test('emergency specialization remains narrower than general authority mutation', () => {
  assert.equal(classifyNativeSupervisorCommand({ action: 'DISARM', payload: {} }).lane, 'EMERGENCY');
  assert.equal(classifyNativeSupervisorCommand({ action: 'SET_SUPERVISOR_MODE', payload: { mode: 'OFF' } }).lane, 'EMERGENCY');
  assert.equal(classifyNativeSupervisorCommand({ action: 'SET_SUPERVISOR_MODE', payload: { mode: 'CONTROL' } }).lane, 'GLOBAL_MUTATION');
});
