import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { verifyFinalRuntimeCommand } from '../src/final-runtime-activation.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

function source(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('packaged browser enters through the final runtime activation hook', () => {
  const pkg = JSON.parse(source('package.json'));
  assert.equal(pkg.main, 'src/final-runtime-entry.mjs');

  const entry = source('src/final-runtime-entry.mjs');
  assert.match(entry, /registerHooks/);
  assert.match(entry, /development-plane-activated\.mjs/);
  assert.match(entry, /native-supervisor-client-activated\.mjs/);
  assert.match(entry, /context\.parentURL !== mainUrl/);
  assert.match(entry, /second_scheduler: false/);

  const development = source('src/development-plane-activated.mjs');
  assert.match(development, /extends ProvenDevelopmentPlane/);
  assert.match(development, /registerFinalRuntimeDevelopmentPlane\(this\)/);

  const supervisor = source('src/native-supervisor-client-activated.mjs');
  assert.match(supervisor, /extends ProvenNativeSupervisorClient/);
  assert.match(supervisor, /markFinalRuntimeSupervisorStarted\(this\)/);
  assert.match(supervisor, /final_runtime_activation_required/);
});

test('Host activation is primary before enrollment while remote signing remains fail-closed', () => {
  const hostIdentity = source('src/host-agent-supervisor-identity.mjs');
  const connectBody = hostIdentity.match(/async connect\(\) \{([\s\S]*?)\n    \},/)?.[1] || '';
  assert.match(connectBody, /await client\.connect\(\)/);
  assert.doesNotMatch(connectBody, /identity\.ensure\(/);
  assert.match(hostIdentity, /WAITING_FOR_ENROLLMENT/);
  assert.match(hostIdentity, /startup_requires_enrollment: false/);
  assert.match(hostIdentity, /remote_requests_require_enrollment: true/);
  assert.match(hostIdentity, /remote_signing_ready: enrolled/);

  const strictDelegation = source('src/supervisor-identity-delegation.mjs');
  assert.match(strictDelegation, /!UUID_RE\.test\(clientId\) \|\| !UUID_RE\.test\(deviceId\)/);
  assert.match(strictDelegation, /supervisor_identity_delegation_identity_invalid/);
});

test('verified execution refuses to confirm an unproven mutation', () => {
  const command = {
    action: 'TYPED_CLICK',
    payload: { tab_id: 'tab_00000000-0000-4000-8000-000000000001' },
  };
  const verification = verifyFinalRuntimeCommand(command, { ok: true, authority_effect: true }, {
    tabs: [{ tab_id: command.payload.tab_id, selected: true, url: 'https://chatgpt.com/' }],
    active_tab: { tab_id: command.payload.tab_id, url: 'https://chatgpt.com/' },
  });
  assert.deepEqual(verification, {
    confirmed: false,
    no_effect_proven: false,
    evidence_conflict: false,
    evidence: 'POSTCONDITION_NOT_PROVEN',
    automatic_retry_allowed: false,
    authority_effect: false,
  });
});

test('verified execution accepts exact tab readback for select and close', () => {
  const tabId = 'tab_00000000-0000-4000-8000-000000000001';
  assert.equal(verifyFinalRuntimeCommand({ action: 'SELECT_TAB', payload: { tab_id: tabId } }, {}, {
    tabs: [{ tab_id: tabId, selected: true }],
    active_tab: { tab_id: tabId },
  }).confirmed, true);
  assert.equal(verifyFinalRuntimeCommand({ action: 'CLOSE_TAB', payload: { tab_id: tabId } }, {}, {
    tabs: [],
    active_tab: null,
  }).confirmed, true);
});

test('activation registry remains single-scheduler and never fabricates production authority', () => {
  const activation = source('src/final-runtime-activation.mjs');
  const registry = source('src/final-runtime-activation-registry.mjs');
  assert.match(activation, /scheduler_owner: 'NATIVE_SUPERVISOR_CLIENT'/);
  assert.match(activation, /fast_control_production_mutation_authority: false/);
  assert.match(activation, /production_authority_fabricated: false/);
  assert.match(registry, /second_scheduler: false/);
  assert.match(registry, /production_authority_fabricated: false/);
  assert.doesNotMatch(registry, /setInterval\(/);
});
