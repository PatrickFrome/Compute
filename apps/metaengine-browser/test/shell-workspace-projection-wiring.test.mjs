import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const read = (relative) => fs.readFile(new URL(relative, import.meta.url), 'utf8');

test('trusted main process owns workspace and DevOS system projection exactly once', async () => {
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
  assert.match(main, /const workspaces = projectWorkspaceWorkbench\(\{\s*tabs,\s*fleet: fleetSnapshot,\s*owner_safety_gates: ownerSafetyGatesSnapshot,\s*development_plane: developmentPlaneSnapshot,\s*supervisor,\s*compute,\s*presentation_focus: presentationFocus,\s*\}\)/s);
  assert.match(main, /fleet: fleetSnapshot,\s*owner_safety_gates: ownerSafetyGatesSnapshot,\s*development_plane: developmentPlaneSnapshot,\s*supervisor,/s);
  assert.match(main, /\r?\n\s{4}workspaces,\r?\n\s{4}compute,\r?\n/);
  assert.equal((main.match(/projectWorkspaceWorkbench\(/g) || []).length, 1, 'workspace projection must have one trusted shell call site');
  assert.equal((main.match(/createDevOSPresentationFocusState\(\)/g) || []).length, 1, 'presentation focus must have one main-process owner');
  assert.equal((main.match(/await bridge\.health\(\)/g) || []).length, 1, 'shell snapshot must perform one Compute health read and reuse it');
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
