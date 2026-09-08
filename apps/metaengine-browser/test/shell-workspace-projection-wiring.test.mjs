import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const read = (relative) => fs.readFile(new URL(relative, import.meta.url), 'utf8');

function functionSlice(source, name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = source.indexOf(`${nextName.startsWith('async ') ? '' : 'function '}${nextName}`, start + 1);
  assert.notEqual(end, -1, `${nextName} must exist after ${name}`);
  return source.slice(start, end);
}

test('trusted main process owns one full shell projection plus two bounded presentation projections', async () => {
  const main = await read('../src/main.mjs');
  assert.match(main, /import \{ projectWorkspaceWorkbench \} from '\.\/workspace-workbench-projection\.mjs'/);
  assert.match(main, /const tabs = registry\.snapshot\(\)/);
  assert.match(main, /const fleetSnapshot = fleet\?\.snapshot\(\) \|\| null/);
  assert.match(main, /const ownerSafetyGatesSnapshot = ownerSafetyGates\?\.snapshot\(\) \|\| null/);
  assert.match(main, /const developmentPlaneSnapshot = developmentPlane\?\.snapshot\(\) \|\| null/);
  assert.match(main, /const supervisor = nativeSupervisor\?\.snapshot\(\) \|\| null/);
  assert.match(main, /const compute = await bridge\.health\(\)/);
  assert.match(main, /const presentationFocus = devosPresentationFocus\.snapshot\(\)/);
  assert.match(main, /const devosPresentationFocus = createDevOSPresentationFocusState\(\)/);

  const shellStart = main.indexOf('async function shellSnapshot()');
  const shellEnd = main.indexOf('async function publishSnapshot()', shellStart);
  assert.ok(shellStart >= 0 && shellEnd > shellStart, 'shellSnapshot must remain bounded');
  const shell = main.slice(shellStart, shellEnd);
  assert.match(shell, /const workspaces = projectWorkspaceWorkbench\(\{\s*tabs,\s*fleet: fleetSnapshot,\s*owner_safety_gates: ownerSafetyGatesSnapshot,\s*development_plane: developmentPlaneSnapshot,\s*supervisor,\s*compute,\s*presentation_focus: presentationFocus,\s*\}\)/s);
  assert.match(shell, /fleet: fleetSnapshot,\s*owner_safety_gates: ownerSafetyGatesSnapshot,\s*development_plane: developmentPlaneSnapshot,\s*supervisor,/s);
  assert.match(shell, /\r?\n\s{4}workspaces,\r?\n\s{4}compute,\r?\n/);
  assert.equal((shell.match(/projectWorkspaceWorkbench\(/g) || []).length, 1, 'shell snapshot must have exactly one full trusted workspace projection');
  assert.equal((shell.match(/await bridge\.health\(\)/g) || []).length, 1, 'shell snapshot must perform one Compute health read and reuse it');

  const intent = functionSlice(main, 'currentDevOSPresentationProjection', 'selectBrowserTabForPresentation');
  assert.equal((intent.match(/projectWorkspaceWorkbench\(/g) || []).length, 1, 'intent planning may use one separate identity-only projection');
  assert.match(intent, /tabs: registry\.snapshot\(\)/);
  assert.match(intent, /fleet: fleet\?\.snapshot\(\) \|\| null/);
  assert.match(intent, /supervisor: nativeSupervisor\?\.snapshot\(\) \|\| null/);
  assert.match(intent, /presentation_focus: devosPresentationFocus\.snapshot\(\)/);
  assert.match(intent, /devos_sources: devosSourceSnapshot/);
  assert.doesNotMatch(intent, /await bridge\.health|developmentPlane|ownerSafetyGates|\bcompute\b/);

  const presentationShell = functionSlice(main, 'currentDevOSPresentationShellView', 'fallbackSelectedSurface');
  assert.equal((presentationShell.match(/projectWorkspaceWorkbench\(/g) || []).length, 1, 'surface-grid planning may use one separate presentation-shell projection');
  assert.match(presentationShell, /tabs: registry\.snapshot\(\)/);
  assert.match(presentationShell, /fleet: fleet\?\.snapshot\(\) \|\| null/);
  assert.match(presentationShell, /supervisor: nativeSupervisor\?\.snapshot\(\) \|\| null/);
  assert.match(presentationShell, /presentation_focus: devosPresentationFocus\.snapshot\(\)/);
  assert.match(presentationShell, /session_layouts: devosSessionLayouts\.snapshot\(\)/);
  assert.match(presentationShell, /devos_sources: devosSourceSnapshot/);
  assert.doesNotMatch(presentationShell, /await bridge\.health|developmentPlane|ownerSafetyGates|\bcompute\b/);

  assert.equal((main.match(/projectWorkspaceWorkbench\(/g) || []).length, 3, 'main process may expose only the full shell, identity-only intent, and presentation-shell grid projections');
  assert.equal((main.match(/createDevOSPresentationFocusState\(\)/g) || []).length, 1, 'presentation focus must have one main-process owner');
});

test('renderer is presentation-only and cannot reconstruct durable binding authority', async () => {
  const ui = await read('../ui/app.js');
  assert.match(ui, /const projection = next\?\.workspaces/);
  assert.match(ui, /projection\.grouping_authority !== 'DURABLE_WORKSPACE_BINDING_ONLY'/);
  assert.match(ui, /unavailableWorkspaceProjection/);
  assert.doesNotMatch(ui, /workspace_bindings/);
  assert.doesNotMatch(ui, /lease_current/);
  assert.doesNotMatch(ui, /binding\?\.target_id|binding\.target_id/);
  assert.doesNotMatch(ui, /binding\?\.agent_generation_epoch|binding\.agent_generation_epoch/);
  assert.doesNotMatch(ui, /new Map\([^\n]*workspace/i);
  assert.doesNotMatch(ui, /current_command\?\.payload|command\?\.payload/);
});

test('pure workspace projection remains zero-authority and exact-fenced', async () => {
  const source = await read('../src/workspace-workbench-projection.mjs');
  assert.match(source, /binding\.lease_current!==true/);
  assert.match(source, /TARGET_BINDING_DRIFT/);
  assert.match(source, /AGENT_GENERATION_DRIFT/);
  assert.match(source, /grouping_authority:'DURABLE_WORKSPACE_BINDING_ONLY'/);
  assert.match(source, /attachDevOSSystemAttention\(devosBase,\{\.\.\.snapshot,workspaces:base\}\)/);
  assert.match(source, /automatic_retry_allowed:false/);
  assert.match(source, /browser_actuation_authority:false/);
  assert.match(source, /authority_effect:false/);
});
