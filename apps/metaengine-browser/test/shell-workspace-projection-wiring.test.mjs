import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const read = (relative) => fs.readFile(new URL(relative, import.meta.url), 'utf8');

test('trusted main process owns workspace admission projection exactly once', async () => {
  const main = await read('../src/main.mjs');
  assert.match(main, /import \{ projectWorkspaceWorkbench \} from '\.\/workspace-workbench-projection\.mjs'/);
  assert.match(main, /const tabs = registry\.snapshot\(\)/);
  assert.match(main, /const fleetSnapshot = fleet\?\.snapshot\(\) \|\| null/);
  assert.match(main, /const supervisor = nativeSupervisor\?\.snapshot\(\) \|\| null/);
  assert.match(main, /const workspaces = projectWorkspaceWorkbench\(\{ tabs, fleet: fleetSnapshot, supervisor \}\)/);
  // Workspace projection must be surfaced directly from the one trusted main-process
  // call site. It need not remain adjacent to any unrelated additive read-only shell
  // field (for example context_packs), because object field adjacency carries no
  // authority semantics.
  assert.match(main, /\r?\n\s{4}workspaces,\r?\n/);
  assert.match(main, /\r?\n\s{4}compute: await bridge\.health\(\),\r?\n/);
  assert.equal((main.match(/projectWorkspaceWorkbench\(/g) || []).length, 1, 'workspace projection must have one trusted shell call site');
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
  assert.match(source, /automatic_retry_allowed:false/);
  assert.match(source, /browser_actuation_authority:false/);
  assert.match(source, /authority_effect:false/);
});
