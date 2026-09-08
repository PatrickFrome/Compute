import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const preload = await readFile(new URL('../src/preload-shell.cjs', import.meta.url), 'utf8');

function zeroAuthority() {
  return {
    projection_is_authority: false,
    scheduler_authority: false,
    execution_authority: false,
    command_leasing: false,
    automatic_effect_retry_allowed: false,
    page_model_authority: false,
    authority_effect: false,
  };
}

function snapshotFixture() {
  const devos = Object.freeze({
    schema: 'metaengine.devos.projection.v1',
    mode: 'DEVELOPMENT_OS',
    primary_object: 'SESSION',
    hierarchy: Object.freeze(['OBJECTIVE', 'WORKSPACE', 'SESSION', 'TASK', 'SURFACE', 'ARTIFACT']),
    objectives: Object.freeze([]),
    workspaces: Object.freeze([]),
    sessions: Object.freeze([]),
    surfaces: Object.freeze([]),
    artifacts: Object.freeze([]),
    attention: Object.freeze([]),
    bounded: true,
    browser_is_shell: false,
    browser_is_surface: true,
    ...zeroAuthority(),
  });
  const devosShell = Object.freeze({
    schema: 'metaengine.devos.shell-view-model.v1',
    valid: true,
    reason: null,
    primary_object: 'SESSION',
    roots: Object.freeze([]),
    session_groups: Object.freeze([]),
    now: Object.freeze([]),
    selected_session: null,
    selected_surface: null,
    layout_preferences: null,
    counts: Object.freeze({ sessions: 0, surfaces: 0, attention: 0, visible_groups: 0 }),
    browser_is_shell: false,
    browser_is_surface: true,
    renderer_selection_authority: false,
    renderer_routing_authority: false,
    ...zeroAuthority(),
  });
  return { schema: 'metaengine.browser-shell.snapshot.v3', workspaces: { devos, devos_shell: devosShell }, authority_effect: false };
}

function executePreload(initialSnapshot = snapshotFixture()) {
  const listeners = new Map();
  const invocations = [];
  let exposed = null;
  let snapshot = initialSnapshot;
  const ipcRenderer = {
    invoke(channel, payload) {
      invocations.push({ channel, payload });
      if (channel === 'metaengine:shell:snapshot') return Promise.resolve(snapshot);
      if (channel === 'metaengine:shell:command') return Promise.resolve({ ok: true });
      return Promise.reject(new Error(`unexpected_channel:${channel}`));
    },
    on(channel, listener) { listeners.set(channel, listener); },
  };
  const contextBridge = {
    exposeInMainWorld(name, value) {
      assert.equal(name, 'metaengineShell');
      exposed = value;
    },
  };
  const context = vm.createContext({
    require(name) {
      if (name !== 'electron') throw new Error(`unexpected_require:${name}`);
      return { contextBridge, ipcRenderer };
    },
    Object,
    Array,
    Number,
    String,
    Set,
    Promise,
  });
  new vm.Script(preload, { filename: 'preload-shell.cjs' }).runInContext(context);
  assert.ok(exposed);
  return {
    api: exposed,
    listeners,
    invocations,
    setSnapshot(next) { snapshot = next; },
  };
}

function assertZeroAuthority(value) {
  assert.equal(value.projection_is_authority, false);
  assert.equal(value.scheduler_authority, false);
  assert.equal(value.execution_authority, false);
  assert.equal(value.command_leasing, false);
  assert.equal(value.automatic_effect_retry_allowed, false);
  assert.equal(value.page_model_authority, false);
  assert.equal(value.authority_effect, false);
}

function assertEmptyArray(value) {
  assert.equal(Array.isArray(value), true);
  assert.equal(value.length, 0);
}

test('sandbox preload promotes canonical DevOS and shell ViewModel through snapshot()', async () => {
  const harness = executePreload();
  const result = await harness.api.snapshot();
  assert.equal(result.devos.schema, 'metaengine.devos.projection.v1');
  assert.equal(result.devos_shell.schema, 'metaengine.devos.shell-view-model.v1');
  assert.equal(result.devos_shell.valid, true);
  assert.equal(result.devos_shell.renderer_selection_authority, false);
  assert.equal(result.devos_shell.renderer_routing_authority, false);
  assertZeroAuthority(result.devos);
  assertZeroAuthority(result.devos_shell);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(harness.invocations[0].channel, 'metaengine:shell:snapshot');
  assert.equal(harness.invocations[0].payload, undefined);
});

test('snapshot listener receives the same decorated zero-authority shell ViewModel', () => {
  const harness = executePreload();
  const received = [];
  const unsubscribe = harness.api.onSnapshot((value) => received.push(value));
  const listener = harness.listeners.get('metaengine:shell:snapshot');
  assert.equal(typeof listener, 'function');
  listener({}, snapshotFixture());
  assert.equal(received.length, 1);
  assert.equal(received[0].devos_shell.schema, 'metaengine.devos.shell-view-model.v1');
  assert.equal(received[0].devos_shell.valid, true);
  assertZeroAuthority(received[0].devos_shell);
  unsubscribe();
  listener({}, snapshotFixture());
  assert.equal(received.length, 1);
});

test('invalid shell ViewModel fails closed without corrupting canonical DevOS projection', async () => {
  const source = snapshotFixture();
  const corrupt = {
    ...source,
    workspaces: {
      ...source.workspaces,
      devos_shell: { ...source.workspaces.devos_shell, renderer_selection_authority: true },
    },
  };
  const harness = executePreload(corrupt);
  const result = await harness.api.snapshot();
  assert.equal(result.devos.schema, 'metaengine.devos.projection.v1');
  assert.equal(result.devos_shell.schema, 'metaengine.devos.shell-view-model.v1');
  assert.equal(result.devos_shell.valid, false);
  assert.equal(result.devos_shell.reason, 'INVALID_VIEW_MODEL');
  assertEmptyArray(result.devos_shell.roots);
  assertEmptyArray(result.devos_shell.session_groups);
  assertEmptyArray(result.devos_shell.now);
  assertZeroAuthority(result.devos_shell);
});

test('missing shell ViewModel is explicit NOT_EXPOSED instead of inferred from tabs or DevOS', async () => {
  const source = snapshotFixture();
  const harness = executePreload({ ...source, workspaces: { devos: source.workspaces.devos } });
  const result = await harness.api.snapshot();
  assert.equal(result.devos_shell.valid, false);
  assert.equal(result.devos_shell.reason, 'NOT_EXPOSED');
  assertEmptyArray(result.devos_shell.roots);
  assertEmptyArray(result.devos_shell.now);
  assertZeroAuthority(result.devos_shell);
});

test('command bridge remains generic and ViewModel promotion cannot create a new command path', async () => {
  const harness = executePreload();
  const result = await harness.api.command('SHELL_LAYOUT_SET', { sidebar: 'COMPACT', operations: 'CLOSED' });
  assert.equal(result.ok, true);
  const invocation = harness.invocations.at(-1);
  assert.equal(invocation.channel, 'metaengine:shell:command');
  assert.equal(invocation.payload.command, 'SHELL_LAYOUT_SET');
  assert.equal(invocation.payload.payload.sidebar, 'COMPACT');
  assert.equal(invocation.payload.payload.operations, 'CLOSED');
  assert.equal('ipcRenderer' in harness.api, false);
  assert.equal('send' in harness.api, false);
  assert.equal('on' in harness.api, false);
});
