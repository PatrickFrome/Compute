import assert from 'node:assert/strict';
import test from 'node:test';
import { taskContentSnapshotForDisplay } from '../../me2-ui/src/lib/task-content-snapshot.mjs';

test('probe empty snapshot cannot become task truth', () => {
  assert.equal(taskContentSnapshotForDisplay({ ok:true, tasks:[], archived:[], browser_probe:{ read_only:true }, task_content_authority:false }), null);
  assert.equal(taskContentSnapshotForDisplay({ ok:true, tasks:[], archived:[], meta:{ projection:'BROWSER_PROBE_ONLY' } }), null);
});

test('authoritative task snapshot remains displayable', () => {
  const value={ ok:true, tasks:[], archived:[], task_content_authority:true };
  assert.equal(taskContentSnapshotForDisplay(value), value);
});

test('legacy daemon effects are explicitly listed and browser controls remain outside the deny set', async () => {
  const source=await import('../../me2-ui/src/lib/task-content-snapshot.mjs');
  for (const action of ['BUDGET_FLUSH','ENVIRONMENT_RESET','DB_HYGIENE','EVAL_RUN','TASK_HANDOFF','BRAIN_THINK']) assert.equal(source.LEGACY_DAEMON_EFFECT_ACTIONS.has(action),true);
  for (const action of ['BROWSER_TABS','BROWSER_SELECT_TAB','BROWSER_OPEN','BROWSER_CLOSE','BROWSER_NAVIGATE','EVENTS_SEARCH']) assert.equal(source.isSupportedLegacyDaemonAction(action),true);
  for (const action of ['AGENT_SPAWN','TASK_RETRY','FLEET_RECONCILE','BUDGET_ADJUST','EVAL_RUN','ENVIRONMENT_RESET','SHELL_EXEC','UNKNOWN_ACTION']) assert.equal(source.isSupportedLegacyDaemonAction(action),false);
});

test('dynamic catalog only exposes known compatible controls and read-only actions', async () => {
  const { filterSupportedLegacyDaemonActionCatalog } = await import('../../me2-ui/src/lib/task-content-snapshot.mjs');
  const filtered=filterSupportedLegacyDaemonActionCatalog([
    { action:'PING' }, { action:'BROWSER_OPEN' }, { action:'AGENT_SPAWN' },
    { action:'FLEET_RECONCILE' }, { action:'TASK_ENQUEUE' }, { action:'UNKNOWN_ACTION' }, null,
  ]);
  assert.deepEqual(filtered.map((row) => row.action), ['PING','BROWSER_OPEN']);
  assert.deepEqual(filterSupportedLegacyDaemonActionCatalog({ action:'PING' }), []);
});
