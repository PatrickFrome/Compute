import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { projectMetaengineDevOS as projectEsm } from '../src/metaengine-devos-projection.mjs';

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

test('ESM and preload CJS projection surfaces share one canonical implementation contract', () => {
  const input = sampleSnapshot();
  assert.deepEqual(projectEsm(input), projectionCore.projectMetaengineDevOS(input));
  assert.equal(projectionCore.projectMetaengineDevOS(input).primary_object, 'SESSION');
  assert.equal(projectionCore.projectMetaengineDevOS(input).surfaces[0].type, 'BROWSER');
});

test('preload decorates snapshot data without exposing raw Electron IPC primitives', () => {
  assert.match(preload, /require\('\.\/metaengine-devos-projection-core\.cjs'\)/);
  assert.match(preload, /function decorateSnapshot\(value\)/);
  assert.match(preload, /devos: projectMetaengineDevOS\(value\)/);
  assert.match(preload, /snapshot: \(\) => ipcRenderer\.invoke\('metaengine:shell:snapshot'\)\.then\(decorateSnapshot\)/);
  assert.doesNotMatch(preload, /exposeInMainWorld\([^)]*ipcRenderer/s);
  assert.doesNotMatch(preload, /\bon:\s*ipcRenderer\.on\b/);
  assert.doesNotMatch(preload, /\bsend:\s*ipcRenderer\.send\b/);
});

test('preload projection failure is fail-soft and zero-authority', () => {
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
});
