import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { EventEmitter } from 'node:events';

import { TabRegistry } from '../src/tab-registry.mjs';
import {
  assertReloadAllowed,
  reloadBlockedByAuthRedirect,
} from '../src/reload-auth-redirect-gate.mjs';
import {
  classifyChatGptAuthReadbackFromTabs,
  classifyChatGptAuthUrl,
  checkTabCardinalityContinuity,
  compareUserSessionContinuity,
} from '../src/chatgpt-auth-readback.mjs';
import {
  beginSelfUpdateSessionContinuityRestoreAttempt,
  buildSelfUpdateSessionContinuity,
  persistSelfUpdateSessionContinuity,
  planPostRestoreDuplicateTabCleanup,
  restoreSelfUpdateSessionContinuity,
  selfUpdateSessionContinuityPath,
} from '../src/self-update-session-continuity.mjs';
import { recordAcceptedSignedSupervisorHeartbeat } from '../src/self-update-successor-qualification.mjs';
import { persistPreInstallReceipt, persistUpdatedSuccessorReceipt } from '../src/self-update-handoff.mjs';
import { PersistentBrowserCdpSessionPool } from '../src/browser-persistent-cdp-session.mjs';

const noSleep = async () => {};

// ---------------------------------------------------------------------------
// Point 1 — RELOAD gate (command plane)
// ---------------------------------------------------------------------------

test('RELOAD is refused on ChatGPT auth-redirect surfaces with a typed error', () => {
  assert.equal(reloadBlockedByAuthRedirect({ action: 'RELOAD', url: 'https://chatgpt.com/auth/login' }), true);
  assert.equal(reloadBlockedByAuthRedirect({ action: 'RELOAD', url: 'https://chatgpt.com/auth/login?next=%2Fc%2Fabc' }), true);
  assert.equal(reloadBlockedByAuthRedirect({ action: 'RELOAD', url: 'https://www.chatgpt.com/auth/' }), true);
  assert.throws(() => assertReloadAllowed({ action: 'RELOAD', url: 'https://chatgpt.com/auth/login' }), (error) => {
    assert.equal(error.code, 'reload_auth_redirect_forbidden');
    return true;
  });
});

test('RELOAD gate allows healthy ChatGPT surfaces, non-ChatGPT tabs and other actions', () => {
  assert.equal(reloadBlockedByAuthRedirect({ action: 'RELOAD', url: 'https://chatgpt.com/' }), false);
  assert.equal(reloadBlockedByAuthRedirect({ action: 'RELOAD', url: 'https://chatgpt.com/c/abc-def' }), false);
  assert.equal(reloadBlockedByAuthRedirect({ action: 'RELOAD', url: 'https://example.com/auth/login' }), false);
  assert.equal(reloadBlockedByAuthRedirect({ action: 'NAVIGATE', url: 'https://chatgpt.com/auth/login' }), false);
  assert.equal(reloadBlockedByAuthRedirect({ action: 'BACK', url: 'https://chatgpt.com/auth/login' }), false);
  assert.equal(assertReloadAllowed({ action: 'RELOAD', url: 'https://chatgpt.com/c/abc' }), true);
});

// ---------------------------------------------------------------------------
// Point 5 — auth readback + cardinality classifiers (metadata-only)
// ---------------------------------------------------------------------------

test('URL auth classification distinguishes auth redirects from signed-in surfaces', () => {
  assert.equal(classifyChatGptAuthUrl('https://chatgpt.com/auth/login'), 'AUTH_REQUIRED');
  assert.equal(classifyChatGptAuthUrl('https://chatgpt.com/c/conv-123'), 'AUTHENTICATED');
  assert.equal(classifyChatGptAuthUrl('https://chatgpt.com/'), 'AUTHENTICATED');
  assert.equal(classifyChatGptAuthUrl('https://example.com/auth/login'), 'NOT_CHATGPT');
  assert.equal(classifyChatGptAuthUrl('not a url'), 'NOT_CHATGPT');
});

test('registry readback classifies the incident topology: 26 login + 6 root tabs', () => {
  const tabs = [
    ...Array.from({ length: 26 }, () => ({ tab_id: 'tab_x', url: 'https://chatgpt.com/auth/login', kind: 'CHATGPT' })),
    ...Array.from({ length: 6 }, () => ({ tab_id: 'tab_y', url: 'https://chatgpt.com/', kind: 'CHATGPT' })),
    { tab_id: 'tab_z', url: 'https://example.com/', kind: 'USER_WEB' },
  ];
  const readback = classifyChatGptAuthReadbackFromTabs(tabs);
  assert.equal(readback.auth_state, 'AUTH_REQUIRED');
  assert.equal(readback.chatgpt_tab_count, 32);
  assert.equal(readback.auth_redirect_tab_count, 26);
  assert.equal(readback.authenticated_tab_count, 6);
  assert.equal(readback.metadata_only, true);
  assert.equal(readback.cookie_values_read, false);
});

test('user session continuity comparison and tab cardinality catch the 7 -> 32 amplification', () => {
  assert.equal(compareUserSessionContinuity({ preAuthState: 'AUTHENTICATED', postAuthState: 'AUTHENTICATED' }), 'CONTINUED');
  assert.equal(compareUserSessionContinuity({ preAuthState: 'AUTHENTICATED', postAuthState: 'AUTH_REQUIRED' }), 'LOST');
  assert.equal(compareUserSessionContinuity({ preAuthState: 'UNKNOWN', postAuthState: 'AUTH_REQUIRED' }), 'UNKNOWN');
  assert.equal(compareUserSessionContinuity({ preAuthState: 'NO_CHATGPT_TABS', postAuthState: 'AUTH_REQUIRED' }), 'NOT_APPLICABLE');

  assert.equal(checkTabCardinalityContinuity({ preTabCount: 7, postTabCount: 9 }).state, 'CONTINUOUS');
  assert.equal(checkTabCardinalityContinuity({ preTabCount: 7, postTabCount: 14 }).state, 'VIOLATED');
  assert.equal(checkTabCardinalityContinuity({ preTabCount: 7, postTabCount: 32 }).state, 'VIOLATED');
  assert.equal(checkTabCardinalityContinuity({ preTabCount: null, postTabCount: 32 }).state, 'UNKNOWN');
  const incident = checkTabCardinalityContinuity({ preTabCount: 7, postTabCount: 32 });
  assert.equal(incident.pre_tab_count, 7);
  assert.equal(incident.post_tab_count, 32);
});

// ---------------------------------------------------------------------------
// Point 2 — one-shot durable restore-attempt fence
// ---------------------------------------------------------------------------

async function tempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

test('restore attempt fence claims the capsule by durable rename before any NEW_TAB', async () => {
  const dir = await tempDir('metaengine-oneshot-fence-');
  const row = buildSelfUpdateSessionContinuity({
    currentVersion: '1.0.0', targetVersion: '1.0.1',
    tabsSnapshot: { tabs: [{ tab_id: 'tab_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', url: 'https://chatgpt.com/c/a' }] },
  });
  await persistSelfUpdateSessionContinuity(dir, row);

  const attempt = await beginSelfUpdateSessionContinuityRestoreAttempt(dir);
  assert.ok(attempt);
  assert.equal(attempt.row.continuity_id, row.continuity_id);
  // Canonical path is gone — no process can ever replay this capsule.
  await assert.rejects(() => fs.access(selfUpdateSessionContinuityPath(dir)), /ENOENT/);
  // Attempt sidecar is durable audit evidence.
  await fs.access(attempt.attempt_path);
  const sidecar = JSON.parse(await fs.readFile(attempt.attempt_path, 'utf8'));
  assert.equal(sidecar.continuity_id, row.continuity_id);

  // A crashed process, a restart, a successor: no second attempt ever.
  const second = await beginSelfUpdateSessionContinuityRestoreAttempt(dir);
  assert.equal(second, null);
  await fs.rm(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Points 2+3 — amplifier regression: 7 conversations, forced auth redirect,
// five restarts. Bounded tabs, zero replay, AUTH_REQUIRED terminal.
// ---------------------------------------------------------------------------

function incidentCapsule() {
  const tabs = Array.from({ length: 7 }, (_unused, index) => ({
    tab_id: `tab_${String(index).padStart(8, '0')}-0000-0000-0000-000000000000`,
    url: `https://chatgpt.com/c/incident-conversation-${index}`,
    kind: 'CHATGPT',
  }));
  return buildSelfUpdateSessionContinuity({
    currentVersion: '0.7.0-dev.35230443849.0',
    targetVersion: '0.7.0-dev.35230443849.1',
    tabsSnapshot: { tabs, selected_tab_id: tabs[0].tab_id },
    preAuthReadback: { auth_state: 'AUTHENTICATED', chatgpt_tab_count: 7, authenticated_tab_count: 7, auth_redirect_tab_count: 0 },
  });
}

test('forced auth redirect restores at most ONE ChatGPT tab and latches AUTH_REQUIRED terminal', async () => {
  const row = incidentCapsule();
  const state = { tabs: [] };
  let newTabs = 0;
  const executeCommand = async (command) => {
    if (command.action === 'NEW_TAB') {
      newTabs += 1;
      // The server redirected the freshly restored /c/ tab to the login page
      // (the exact live incident behavior).
      const tab = {
        tab_id: `tab_new${newTabs}-0000-0000-0000-000000000000`,
        url: 'https://chatgpt.com/auth/login',
        created_by_continuity_id: command.payload.created_by_continuity_id,
      };
      state.tabs.push(tab);
      return tab;
    }
    if (command.action === 'SELECT_TAB') return { ok: true, tab_id: command.payload.tab_id };
    throw new Error(`unexpected:${command.action}`);
  };

  const result = await restoreSelfUpdateSessionContinuity({
    row,
    currentVersion: '0.7.0-dev.35230443849.1',
    getState: async () => state,
    executeCommand,
    sleep: noSleep,
  });

  // The amplifier is cut at ONE tab, not seven.
  assert.equal(newTabs, 1);
  assert.equal(result.state, 'AUTH_REQUIRED');
  assert.equal(result.skipped_auth_required_tabs, 6);
  assert.equal(result.restored_tabs, 1);
  // Qualification V2 evidence is present and negative.
  assert.equal(result.user_session_continuity, 'LOST');
  assert.equal(result.auth_readback.auth_state, 'AUTH_REQUIRED');
  assert.equal(result.auth_readback.auth_redirect_tab_count, 1);
  assert.equal(result.tab_cardinality.state, 'CONTINUOUS');
  // Provenance stamp flowed into the created tab.
  assert.equal(state.tabs[0].created_by_continuity_id, row.continuity_id);
  // No navigation-class commands were ever issued.
  assert.equal(newTabs <= 1, true);
});

test('five restarts after the fenced attempt replay nothing at all', async () => {
  const dir = await tempDir('metaengine-amplifier-regression-');
  const capsule = incidentCapsule();
  await persistSelfUpdateSessionContinuity(dir, capsule);

  let newTabs = 0;
  const runRestoreProcess = async () => {
    const attempt = await beginSelfUpdateSessionContinuityRestoreAttempt(dir);
    if (!attempt) return null;
    const state = { tabs: [] };
    return restoreSelfUpdateSessionContinuity({
      row: attempt.row,
      currentVersion: '0.7.0-dev.35230443849.1',
      getState: async () => state,
      executeCommand: async (command) => {
        if (command.action === 'NEW_TAB') {
          newTabs += 1;
          const tab = { tab_id: `tab_p${newTabs}-0000-0000-0000-000000000000`, url: 'https://chatgpt.com/auth/login' };
          state.tabs.push(tab);
          return tab;
        }
        if (command.action === 'SELECT_TAB') return { ok: true };
        throw new Error(`unexpected:${command.action}`);
      },
      sleep: noSleep,
    });
  };

  const first = await runRestoreProcess();
  assert.equal(first.state, 'AUTH_REQUIRED');
  assert.equal(newTabs, 1);
  for (let restart = 0; restart < 5; restart += 1) {
    const again = await runRestoreProcess();
    assert.equal(again, null);
  }
  // Old behavior: 7 -> 14 -> 21 -> 28 -> 32 tabs. New behavior: one tab, once.
  assert.equal(newTabs, 1);
  await fs.rm(dir, { recursive: true, force: true });
});

test('non-ChatGPT tabs still restore after the auth latch', async () => {
  const row = buildSelfUpdateSessionContinuity({
    currentVersion: '1.0.0', targetVersion: '1.0.1',
    tabsSnapshot: {
      tabs: [
        { tab_id: 'tab_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', url: 'https://chatgpt.com/c/conv', kind: 'CHATGPT' },
        { tab_id: 'tab_bbbbbbbb-cccc-dddd-eeee-ffffffffffff', url: 'https://example.com/docs', kind: 'USER_WEB' },
      ],
    },
    preAuthReadback: { auth_state: 'AUTHENTICATED', chatgpt_tab_count: 1, authenticated_tab_count: 1, auth_redirect_tab_count: 0 },
  });
  const state = { tabs: [] };
  const result = await restoreSelfUpdateSessionContinuity({
    row,
    currentVersion: '1.0.1',
    getState: async () => state,
    executeCommand: async (command) => {
      if (command.action === 'NEW_TAB') {
        const url = command.payload.url.includes('chatgpt.com')
          ? 'https://chatgpt.com/auth/login'
          : command.payload.url;
        const tab = { tab_id: `tab_new-${state.tabs.length + 1}-0000-0000-0000-000000000000`, url };
        state.tabs.push(tab);
        return tab;
      }
      if (command.action === 'SELECT_TAB') return { ok: true };
      throw new Error(`unexpected:${command.action}`);
    },
    sleep: noSleep,
  });
  assert.equal(result.state, 'AUTH_REQUIRED');
  // The ChatGPT tab was restored (then redirected, latching the terminal
  // state); the USER_WEB tab still restored afterwards.
  assert.equal(result.restored_tabs, 2);
  assert.equal(result.skipped_auth_required_tabs, 0);
  assert.equal(state.tabs.some((tab) => tab.url === 'https://example.com/docs'), true);
});

test('healthy session restores fully with positive Qualification V2 evidence', async () => {
  const row = incidentCapsule();
  const state = { tabs: [] };
  const result = await restoreSelfUpdateSessionContinuity({
    row,
    currentVersion: '0.7.0-dev.35230443849.1',
    getState: async () => state,
    executeCommand: async (command) => {
      if (command.action === 'NEW_TAB') {
        const tab = {
          tab_id: `tab_new-${state.tabs.length + 1}-0000-0000-0000-000000000000`,
          url: command.payload.url,
          created_by_continuity_id: command.payload.created_by_continuity_id,
        };
        state.tabs.push(tab);
        return tab;
      }
      if (command.action === 'SELECT_TAB') return { ok: true, tab_id: command.payload.tab_id };
      throw new Error(`unexpected:${command.action}`);
    },
    sleep: noSleep,
  });
  assert.equal(result.state, 'RESTORED');
  assert.equal(result.restored_tabs, 7);
  assert.equal(result.failed_tabs, 0);
  assert.equal(result.user_session_continuity, 'CONTINUED');
  assert.equal(result.tab_cardinality.state, 'CONTINUOUS');
  assert.equal(result.tab_cardinality.pre_tab_count, 7);
  assert.equal(result.tab_cardinality.post_tab_count, 7);
  assert.equal(result.auth_readback.auth_state, 'AUTHENTICATED');
});

// ---------------------------------------------------------------------------
// Point 4 — cleanup by proof only (created_by_continuity_id)
// ---------------------------------------------------------------------------

test('duplicate cleanup closes only provable duplicates of this attempt, never legacy live tabs', () => {
  const continuityId = '11111111-2222-4333-8444-555555555555';
  const capsule = buildSelfUpdateSessionContinuity({
    currentVersion: '1.0.0', targetVersion: '1.0.1',
    tabsSnapshot: { tabs: [{ tab_id: 'tab_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', url: 'https://example.com/a' }] },
    continuityId,
  });
  const attemptTabs = [
    { tab_id: 'tab_attempt1-0000-0000-0000-000000000000', url: 'https://example.com/a', created_by_continuity_id: continuityId, created_at: '2026-09-17T14:52:35.000Z' },
    { tab_id: 'tab_attempt2-0000-0000-0000-000000000000', url: 'https://chatgpt.com/auth/login', created_by_continuity_id: continuityId, created_at: '2026-09-17T14:52:36.000Z' },
    { tab_id: 'tab_attempt3-0000-0000-0000-000000000000', url: 'https://chatgpt.com/auth/login', created_by_continuity_id: continuityId, created_at: '2026-09-17T14:52:37.000Z' },
  ];
  const currentTabs = [...attemptTabs, ...Array.from({ length: 32 }, (_unused, index) => ({
    tab_id: `tab_legacy${index}-0000-0000-0000-000000000000`,
    url: index < 26 ? 'https://chatgpt.com/auth/login' : 'https://chatgpt.com/',
    created_at: '2026-09-17T15:00:00.000Z',
  }))];

  const plan = planPostRestoreDuplicateTabCleanup({ continuityRow: capsule, currentTabs });
  // Capsule wanted 1 tab; the attempt created 3 -> close the 2 newest, keep 1.
  assert.equal(plan.close_tab_ids.length, 2);
  assert.deepEqual(plan.close_tab_ids, ['tab_attempt2-0000-0000-0000-000000000000', 'tab_attempt3-0000-0000-0000-000000000000']);
  assert.equal(plan.arbitrary_tab_close, false);
  // None of the 32 legacy live tabs is in the close set.
  for (const id of plan.close_tab_ids) assert.match(id, /^tab_attempt/);

  // No stamp on the capsule row -> nothing is provable -> nothing closes.
  const legacyCapsule = { tabs: [{ url: 'https://example.com/a' }] };
  const empty = planPostRestoreDuplicateTabCleanup({ continuityRow: legacyCapsule, currentTabs });
  assert.deepEqual(empty.close_tab_ids, []);

  // Attempt created exactly the desired count -> nothing closes.
  const exact = planPostRestoreDuplicateTabCleanup({
    continuityRow: capsule,
    currentTabs: [attemptTabs[0]],
  });
  assert.deepEqual(exact.close_tab_ids, []);
  assert.equal(exact.attempt_tab_count, 1);
});

// ---------------------------------------------------------------------------
// Point 4 — tab registry provenance stamping
// ---------------------------------------------------------------------------

test('tab registry stamps immutable created_by_continuity_id provenance', () => {
  const registry = new TabRegistry();
  const continuityId = '11111111-2222-4333-8444-555555555555';
  const tab = registry.create({ url: 'https://chatgpt.com/c/a', kind: 'CHATGPT', created_by_continuity_id: continuityId });
  assert.equal(tab.created_by_continuity_id, continuityId);

  const updated = registry.update(tab.tab_id, { title: 'renamed', created_by_continuity_id: '99999999-9999-4999-8999-999999999999' });
  // Provenance is immutable: a patch cannot rewrite or remove it.
  assert.equal(updated.created_by_continuity_id, continuityId);

  assert.throws(() => registry.create({ url: 'https://example.com/', created_by_continuity_id: 'bad id!' }), /tab_created_by_continuity_id_invalid/);

  const plain = registry.create({ url: 'https://example.com/' });
  assert.equal('created_by_continuity_id' in plain, false);

  const snapshot = registry.snapshot();
  const stamped = snapshot.tabs.find((row) => row.tab_id === tab.tab_id);
  assert.equal(stamped.created_by_continuity_id, continuityId);
});

// ---------------------------------------------------------------------------
// Point 5 — Qualification V2 heartbeat predicate
// ---------------------------------------------------------------------------

async function qualificationAppFixture() {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-qualification-v2-'));
  let version = '0.7.0-dev.35230443849.0';
  const app = {
    isPackaged: true,
    getPath: (name) => { assert.equal(name, 'userData'); return userData; },
    getVersion: () => version,
    hasSingleInstanceLock: () => true,
  };
  const target = '0.7.0-dev.35230443849.1';
  await persistPreInstallReceipt(app, {
    schema: 'metaengine.self-update.pre-install-receipt.v1',
    version: target,
    available_version: target,
    metadata_verified: true,
    publisher_verified: true,
    restart_gate_safe: true,
    restart_gate_since: new Date().toISOString(),
    recorded_at: new Date().toISOString(),
    authority_effect: false,
  });
  version = target;
  await persistUpdatedSuccessorReceipt(app, { argv: ['browser', '--updated'], primaryInstance: true });
  return { app, version: target };
}

function qualificationHeartbeatState(version, sessionContinuity) {
  return {
    shell_version: version,
    self_update_session_continuity: sessionContinuity,
    self_update: {
      state: 'CURRENT',
      current_version: version,
      last_error: null,
      host_resilience: {
        state: 'ACTIVE',
        sentinel_worker_healthy: true,
        sentinel: { lifecycle: 'ARMED', worker_ready: true, worker_heartbeat_age_ms: 250 },
      },
    },
  };
}

test('RESTORED with LOST user session quarantines fail-closed (Qualification V2)', async () => {
  const { app, version } = await qualificationAppFixture();
  const result = await recordAcceptedSignedSupervisorHeartbeat({
    app,
    state: qualificationHeartbeatState(version, {
      state: 'RESTORED',
      user_session_continuity: 'LOST',
      tab_cardinality_continuity: 'CONTINUOUS',
      authority_effect: false,
    }),
  });
  assert.equal(result.state, 'QUARANTINED');
  assert.equal(result.reason, 'session_continuity_user_session_lost');
});

test('RESTORED with VIOLATED tab cardinality quarantines fail-closed (Qualification V2)', async () => {
  const { app, version } = await qualificationAppFixture();
  const result = await recordAcceptedSignedSupervisorHeartbeat({
    app,
    state: qualificationHeartbeatState(version, {
      state: 'RESTORED',
      user_session_continuity: 'CONTINUED',
      tab_cardinality_continuity: 'VIOLATED',
      authority_effect: false,
    }),
  });
  assert.equal(result.state, 'QUARANTINED');
  assert.equal(result.reason, 'session_continuity_tab_cardinality_violated');
});

test('AUTH_REQUIRED restore state is a hard continuity failure (Qualification V2)', async () => {
  const { app, version } = await qualificationAppFixture();
  const result = await recordAcceptedSignedSupervisorHeartbeat({
    app,
    state: qualificationHeartbeatState(version, {
      state: 'AUTH_REQUIRED',
      user_session_continuity: 'LOST',
      tab_cardinality_continuity: 'CONTINUOUS',
      authority_effect: false,
    }),
  });
  assert.equal(result.state, 'QUARANTINED');
  assert.equal(result.reason, 'session_continuity_auth_required');
});

test('RESTORED with positive V2 evidence stays healthy, and legacy payloads without V2 fields still pass', async () => {
  const positive = await qualificationAppFixture();
  const healthy = await recordAcceptedSignedSupervisorHeartbeat({
    app: positive.app,
    state: qualificationHeartbeatState(positive.version, {
      state: 'RESTORED',
      user_session_continuity: 'CONTINUED',
      tab_cardinality_continuity: 'CONTINUOUS',
      authority_effect: false,
    }),
  });
  assert.equal(healthy.state, 'HEARTBEAT_HEALTHY');
  assert.equal(healthy.session_continuity_restored, true);

  const legacy = await qualificationAppFixture();
  const compatible = await recordAcceptedSignedSupervisorHeartbeat({
    app: legacy.app,
    state: qualificationHeartbeatState(legacy.version, {
      state: 'RESTORED',
      authority_effect: false,
    }),
  });
  assert.equal(compatible.state, 'HEARTBEAT_HEALTHY');

  const unknown = await qualificationAppFixture();
  const tolerated = await recordAcceptedSignedSupervisorHeartbeat({
    app: unknown.app,
    state: qualificationHeartbeatState(unknown.version, {
      state: 'RESTORED',
      user_session_continuity: 'UNKNOWN',
      tab_cardinality_continuity: 'UNKNOWN',
      authority_effect: false,
    }),
  });
  assert.equal(tolerated.state, 'HEARTBEAT_HEALTHY');
});

// ---------------------------------------------------------------------------
// Point 1 — DOM.documentUpdated triggers bounded Runtime re-seed, no navigation
// ---------------------------------------------------------------------------

class ReseedFakeDebugger extends EventEmitter {
  attached = false;
  calls = [];

  isAttached() { return this.attached; }
  attach() { this.attached = true; }

  async sendCommand(method, params = {}, sessionId = undefined) {
    this.calls.push({ method, params, sessionId: sessionId || null });
    if (method === 'Page.getFrameTree') {
      return { frameTree: { frame: { id: 'frame-root', loaderId: 'loader-root', url: 'https://chatgpt.com/' } } };
    }
    return {};
  }
}

class ReseedFakeWebContents extends EventEmitter {
  constructor(id, debuggerInstance) {
    super();
    this.id = id;
    this.debugger = debuggerInstance;
  }
  isDestroyed() { return false; }
  getOSProcessId() { return 1801; }
  getOrCreateDevToolsTargetId() { return `root-target-${this.id}`; }
}

test('DOM.documentUpdated triggers bounded Runtime re-seed without any navigation command', async () => {
  const dbg = new ReseedFakeDebugger();
  const wc = new ReseedFakeWebContents(901, dbg);
  const pool = new PersistentBrowserCdpSessionPool();
  await pool.ensure(wc);
  await new Promise((resolve) => setImmediate(resolve));

  const runtimeEnableBefore = dbg.calls.filter((call) => call.method === 'Runtime.enable').length;
  const getDocumentBefore = dbg.calls.filter((call) => call.method === 'DOM.getDocument').length;
  assert.ok(runtimeEnableBefore >= 1);

  dbg.emit('message', {}, 'DOM.documentUpdated', {});
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setTimeout(resolve, 30));

  const runtimeEnableAfter = dbg.calls.filter((call) => call.method === 'Runtime.enable').length;
  const getDocumentAfter = dbg.calls.filter((call) => call.method === 'DOM.getDocument').length;
  assert.equal(runtimeEnableAfter, runtimeEnableBefore + 1);
  assert.equal(getDocumentAfter, getDocumentBefore + 1);
  // NO navigation-class recovery was attempted.
  assert.equal(dbg.calls.some((call) => /Page\.(reload|navigate)/i.test(call.method)), false);
  assert.equal(dbg.calls.some((call) => /Runtime\.evaluate/i.test(call.method)), false);

  const identity = pool.identity(wc);
  assert.equal(identity.runtime_reseed_count, 1);
  assert.ok(identity.last_runtime_reseed_at);

  // A second event while idle re-seeds again (single-flight, bounded), still
  // without navigation.
  dbg.emit('message', {}, 'DOM.documentUpdated', {});
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(dbg.calls.filter((call) => call.method === 'Runtime.enable').length, runtimeEnableAfter + 1);
  assert.equal(dbg.calls.some((call) => /Page\.(reload|navigate)/i.test(call.method)), false);
});
