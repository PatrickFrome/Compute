import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { projectMetaengineDevOS as projectEsm } from '../src/metaengine-devos-projection.mjs';
import { projectWorkspaceWorkbench } from '../src/workspace-workbench-projection.mjs';

const require = createRequire(import.meta.url);
const projectionCore = require('../src/metaengine-devos-projection-core.cjs');
const preload = await readFile(new URL('../src/preload-shell.cjs', import.meta.url), 'utf8');

function sampleSnapshot() {
  return {
    authority_effect: false,
    tabs: {
      selected_tab_id: 'tab.1',
      tabs: [{ tab_id: 'tab.1', title: 'Build proof', url: 'https://example.com', kind: 'WEB' }],
    },
    owner_safety_gates: { wildcard_disabled: false },
    fleet: { agents: [] },
    supervisor: {
      realtime_process_plane: {
        browser_brain: {
          collaboration_fabric: {
            workbench: {
              schema: 'metaengine.browser-brain.collaboration-workbench.v1',
              bounded: true,
              advisory_only: true,
              projection_is_authority: false,
              scheduler_authority: false,
              execution_authority: false,
              command_leasing: false,
              authority_effect: false,
              contexts: [{
                context_id: 'ctx.1',
                progress: { ready: 0, active: 1, blocked: 0, completed: 0, failed: 0, active_agents: ['agent.1'] },
                artifact_refs: [],
                tasks: [{ task_id: 'task.1', objective: 'Build DevOS shell', status: 'ACTIVE', owner_agent_id: 'agent.1' }],
              }],
            },
          },
        },
      },
    },
    workspaces: {
      schema: 'metaengine.browser.workspace-workbench-projection.v1',
      grouping_authority: 'DURABLE_WORKSPACE_BINDING_ONLY',
      url_heuristic_grouping: false,
      title_heuristic_grouping: false,
      browser_actuation_authority: false,
      authority_effect: false,
      groups: [],
    },
  };
}

test('ESM and CJS projection surfaces share one canonical implementation contract', () => {
  const input = sampleSnapshot();
  assert.deepEqual(projectEsm(input), projectionCore.projectMetaengineDevOS(input));
  assert.equal(projectionCore.projectMetaengineDevOS(input).primary_object, 'SESSION');
  assert.equal(projectionCore.projectMetaengineDevOS(input).surfaces[0].type, 'BROWSER');
});

test('main-process workspace read model embeds the bounded DevOS projection', () => {
  const input = sampleSnapshot();
  const workspaces = projectWorkspaceWorkbench({ tabs: input.tabs, fleet: input.fleet, supervisor: input.supervisor });
  assert.equal(workspaces.devos.schema, 'metaengine.devos.projection.v1');
  assert.equal(workspaces.devos.primary_object, 'SESSION');
  assert.equal(workspaces.devos.sessions.length, 2);
  const taskSession = workspaces.devos.sessions.find((row) => row.session_id === 'session:ctx.1');
  const browserSession = workspaces.devos.sessions.find((row) => row.session_id === 'session:browser-unbound');
  assert.ok(taskSession);
  assert.ok(browserSession);
  assert.equal(browserSession.browser_only, true);
  assert.equal(browserSession.task_count, 0);
  assert.equal(browserSession.objective_id, null);
  assert.equal(browserSession.workspace_id, null);
  assert.equal(workspaces.devos.surfaces[0].type, 'BROWSER');
  assert.equal(workspaces.devos.surfaces[0].session_id, 'session:browser-unbound');
  assert.equal(workspaces.devos.selected.session_id, 'session:browser-unbound');
  assert.equal(workspaces.devos.scheduler_authority, false);
  assert.equal(workspaces.devos.execution_authority, false);
  assert.equal(workspaces.devos.authority_effect, false);
});

test('sandboxed preload promotes precomputed DevOS data without local module loading or raw Electron IPC exposure', () => {
  assert.doesNotMatch(preload, /require\(['"]\.\//);
  assert.match(preload, /function decorateSnapshot\(value\)/);
  assert.match(preload, /const candidate = value\?\.workspaces\?\.devos/);
  assert.match(preload, /const shellCandidate = value\?\.workspaces\?\.devos_shell/);
  assert.match(preload, /return Object\.freeze\(\{ \.\.\.value, devos, devos_shell \}\)/);
  assert.match(preload, /snapshot: \(\) => ipcRenderer\.invoke\('metaengine:shell:snapshot'\)\.then\(decorateSnapshot\)/);
  assert.doesNotMatch(preload, /exposeInMainWorld\([^)]*ipcRenderer/s);
  assert.doesNotMatch(preload, /\bon:\s*ipcRenderer\.on\b/);
  assert.doesNotMatch(preload, /\bsend:\s*ipcRenderer\.send\b/);
});

test('preload rejects invalid projection and falls back to zero-authority unavailable state', () => {
  const start = preload.indexOf('function unavailableDevOSProjection');
  const end = preload.indexOf('function decorateSnapshot', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const source = preload.slice(start, end);
  for (const invariant of [
    'projection_is_authority: false',
    'scheduler_authority: false',
    'execution_authority: false',
    'command_leasing: false',
    'automatic_effect_retry_allowed: false',
    'page_model_authority: false',
    'authority_effect: false',
  ]) assert.match(source, new RegExp(invariant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(preload, /candidate\?\.projection_is_authority === false/);
  assert.match(preload, /candidate\?\.scheduler_authority === false/);
  assert.match(preload, /candidate\?\.execution_authority === false/);
  assert.match(preload, /candidate\?\.command_leasing === false/);
  assert.match(preload, /candidate\?\.authority_effect === false/);
});
