import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  classifyChatAuthReadbackFromTabs,
  classifyChatAuthUrl,
  compareUserSessionContinuity,
  checkTabCardinalityContinuity,
  isChatSurfaceUrl,
} from './chatgpt-auth-readback.mjs';

export const SELF_UPDATE_SESSION_CONTINUITY_SCHEMA = 'metaengine.self-update-session-continuity.v1';
const SAFE_TAB_ID_RE = /^tab_[a-z0-9-]{8,96}$/i;
const HTTPS_RE = /^https:\/\//i;
const SAFE_CONTINUITY_ID_RE = /^[a-z0-9-]{8,120}$/i;
// Bounded auth-redirect readback after restoring a ChatGPT tab: the registry
// URL only reflects the server-side /c/ -> /auth/login redirect once the
// navigation settles, so we poll the (metadata-only) state a bounded number
// of times before deciding the tab survived.
const DEFAULT_AUTH_READBACK_POLL_ATTEMPTS = 3;
const DEFAULT_AUTH_READBACK_POLL_DELAY_MS = 400;
const DEFAULT_TAB_CARDINALITY_SLACK = 2;

const defaultSleep = (ms) => new Promise((resolve) => { const timer = setTimeout(resolve, ms); timer.unref?.(); });

function clip(value, max = 240) { return String(value ?? '').slice(0, max); }
function clone(value) { return value == null ? value : structuredClone(value); }

function sanitizeTab(tab, selectedTabId) {
  const tabId = clip(tab?.tab_id, 120);
  const url = clip(tab?.url, 2048);
  if (!SAFE_TAB_ID_RE.test(tabId) || !HTTPS_RE.test(url)) return null;
  return {
    prior_tab_id: tabId,
    url,
    kind: clip(tab?.kind || 'USER_WEB', 48),
    selected: tabId === String(selectedTabId || ''),
    generation_state: ['GENERATING', 'IDLE', 'UNKNOWN'].includes(String(tab?.generation_state || '').toUpperCase())
      ? String(tab.generation_state).toUpperCase()
      : 'UNKNOWN',
  };
}

function sanitizeLifecycle(snapshot) {
  const active = snapshot?.active_request;
  const keepalive = snapshot?.keepalive;
  if (!active && !keepalive) return null;
  return {
    active_request: active ? {
      wake_id: clip(active.wake_id, 160),
      tab_id: clip(active.tab_id, 120),
      retry_attempt: Math.max(0, Number(active.retry_attempt) || 0),
      same_chat_retry_attempt: Math.max(0, Number(active.same_chat_retry_attempt) || 0),
      blocked_ambiguous: active.blocked_ambiguous === true,
      effect_class: clip(active.effect_class, 80),
    } : null,
    keepalive: keepalive ? {
      supervisor_id: clip(keepalive.supervisor_id, 80),
      supervisor_epoch: Math.max(1, Number(keepalive.supervisor_epoch) || 1),
      cycle_seq: Math.max(0, Number(keepalive.cycle_seq) || 0),
      conversation_url: HTTPS_RE.test(String(keepalive.conversation_url || '')) ? clip(keepalive.conversation_url, 2048) : null,
      tab_id: clip(keepalive.tab_id, 120) || null,
      last_wake_reason: clip(keepalive.last_wake_reason, 80) || null,
      pending_wake: keepalive.pending_wake ? clone(keepalive.pending_wake) : null,
      queued_wake_count: Array.isArray(keepalive.queued_wakes) ? keepalive.queued_wakes.length : 0,
    } : null,
  };
}

// Metadata-only pre-install auth readback. Stored in the capsule so the
// successor can compare pre/post user-session continuity (Qualification V2)
// without ever persisting cookie values, storage contents or page text.
function sanitizeAuthReadback(readback) {
  if (!readback || typeof readback !== 'object') return null;
  const authState = String(readback.auth_state || '').toUpperCase();
  if (!['AUTHENTICATED', 'AUTH_REQUIRED', 'UNKNOWN', 'NO_CHATGPT_TABS'].includes(authState)) return null;
  return {
    auth_state: authState,
    chatgpt_tab_count: Math.max(0, Number(readback.chatgpt_tab_count) || 0),
    auth_redirect_tab_count: Math.max(0, Number(readback.auth_redirect_tab_count) || 0),
    authenticated_tab_count: Math.max(0, Number(readback.authenticated_tab_count) || 0),
    metadata_only: true,
    cookie_values_read: false,
  };
}

export function buildSelfUpdateSessionContinuity({
  currentVersion,
  targetVersion,
  tabsSnapshot,
  lifecycleSnapshot = null,
  preAuthReadback = null,
  continuityId = null,
  createdAt = new Date().toISOString(),
} = {}) {
  const selected = tabsSnapshot?.selected_tab_id || null;
  const tabs = (tabsSnapshot?.tabs || []).map((tab) => sanitizeTab(tab, selected)).filter(Boolean).slice(0, 32);
  return {
    schema: SELF_UPDATE_SESSION_CONTINUITY_SCHEMA,
    // One-shot restore identity: the durable attempt fence and the
    // created_by_continuity_id tab stamping both bind to this id.
    continuity_id: SAFE_CONTINUITY_ID_RE.test(String(continuityId || '')) ? String(continuityId) : crypto.randomUUID(),
    current_version: clip(currentVersion, 80),
    target_version: clip(targetVersion, 80),
    created_at: clip(createdAt, 80),
    tabs,
    pre_tab_count: tabs.length,
    pre_auth_readback: sanitizeAuthReadback(preAuthReadback),
    lifecycle: sanitizeLifecycle(lifecycleSnapshot),
    persisted_chat_text: false,
    persisted_tab_titles: false,
    persisted_credentials: false,
    authority_effect: false,
  };
}

export async function restoreSelfUpdateSessionContinuity({
  row,
  currentVersion,
  getState,
  executeCommand,
  authPollAttempts = DEFAULT_AUTH_READBACK_POLL_ATTEMPTS,
  authPollDelayMs = DEFAULT_AUTH_READBACK_POLL_DELAY_MS,
  cardinalitySlack = DEFAULT_TAB_CARDINALITY_SLACK,
  sleep = defaultSleep,
} = {}) {
  if (row?.schema !== SELF_UPDATE_SESSION_CONTINUITY_SCHEMA || !Array.isArray(row.tabs)) {
    throw new Error('self_update_session_continuity_schema_invalid');
  }
  if (typeof getState !== 'function' || typeof executeCommand !== 'function') {
    throw new Error('self_update_session_continuity_restore_dependencies_invalid');
  }
  if (row.target_version && String(row.target_version) !== String(currentVersion || '')) {
    return {
      state: 'TARGET_VERSION_MISMATCH', restored_tabs: 0, failed_tabs: 0,
      tab_count: row.tabs.length, target_version: row.target_version, bindings: [], authority_effect: false,
    };
  }

  const continuityId = SAFE_CONTINUITY_ID_RE.test(String(row?.continuity_id || ''))
    ? String(row.continuity_id)
    : null;
  const state = await getState();
  const byUrl = new Map();
  for (const tab of state?.tabs || []) {
    const url = String(tab?.url || '');
    if (url && !byUrl.has(url)) byUrl.set(url, tab);
  }

  // Bounded post-creation readback: watch the restored tab's registry URL for
  // the /c/ -> /auth/login redirect. Metadata only; no CDP, no page reads.
  const readbackTabUrl = async (tabId) => {
    let lastUrl = null;
    const attempts = Math.max(1, Math.min(10, Number(authPollAttempts) || DEFAULT_AUTH_READBACK_POLL_ATTEMPTS));
    const delayMs = Math.max(0, Number(authPollDelayMs) || 0);
    for (let i = 0; i < attempts; i += 1) {
      if (i > 0) await sleep(delayMs);
      const snapshot = await getState();
      const tab = (snapshot?.tabs || []).find((item) => String(item?.tab_id || '') === String(tabId));
      if (tab?.url) {
        lastUrl = String(tab.url);
        if (classifyChatAuthUrl(lastUrl) === 'AUTH_REQUIRED') return lastUrl;
      }
    }
    return lastUrl;
  };

  let selectedTabId = null;
  let restoredTabs = 0;
  let failedTabs = 0;
  let skippedAuthRequiredTabs = 0;
  let authRequiredLatched = false;
  const bindings = [];
  const createdTabIds = [];
  for (const prior of row.tabs) {
    const url = String(prior?.url || '');
    if (!HTTPS_RE.test(url)) { failedTabs += 1; continue; }
    // AUTH_REQUIRED is terminal for ChatGPT-surface restoration: the user
    // session is gone and only a human sign-in can restore it. Restoring
    // more ChatGPT tabs would only mint more login pages (the exact
    // 7 -> 14 -> 21 -> 28 -> 32 amplifier of the 2026-09-17 incident).
    // Non-ChatGPT tabs are unaffected and still restore.
    if (authRequiredLatched && isChatSurfaceUrl(url)) { skippedAuthRequiredTabs += 1; continue; }
    let current = byUrl.get(url) || null;
    if (!current) {
      try {
        current = await executeCommand({
          action: 'NEW_TAB',
          payload: {
            url,
            select: false,
            ...(continuityId ? { created_by_continuity_id: continuityId } : {}),
          },
          platform: null,
        });
        if (current?.tab_id) {
          byUrl.set(url, current);
          restoredTabs += 1;
          createdTabIds.push(String(current.tab_id));
        } else {
          failedTabs += 1;
          continue;
        }
      } catch {
        failedTabs += 1;
        continue;
      }
      if (isChatSurfaceUrl(url)) {
        const observedUrl = await readbackTabUrl(current.tab_id);
        if (observedUrl != null && classifyChatAuthUrl(observedUrl) === 'AUTH_REQUIRED') {
          authRequiredLatched = true;
        }
      }
    }
    if (current?.tab_id) {
      bindings.push({
        prior_tab_id: String(prior.prior_tab_id || ''),
        tab_id: String(current.tab_id),
        generation_state: String(prior.generation_state || 'UNKNOWN').toUpperCase(),
      });
    }
    if (prior?.selected === true && current?.tab_id) selectedTabId = String(current.tab_id);
  }

  if (selectedTabId) {
    try { await executeCommand({ action: 'SELECT_TAB', payload: { tab_id: selectedTabId }, platform: null }); }
    catch { failedTabs += 1; }
  }

  const finalState = await getState();
  const postReadback = classifyChatAuthReadbackFromTabs(finalState?.tabs);
  const hadChatTabs = row.tabs.some((tab) => isChatSurfaceUrl(String(tab?.url || '')));
  const authRequiredTerminal = authRequiredLatched
    || (hadChatTabs && postReadback.auth_state === 'AUTH_REQUIRED');
  const cardinality = checkTabCardinalityContinuity({
    preTabCount: Number.isSafeInteger(Number(row.pre_tab_count)) && Number(row.pre_tab_count) > 0
      ? Number(row.pre_tab_count)
      : row.tabs.length,
    postTabCount: Array.isArray(finalState?.tabs) ? finalState.tabs.length : null,
    slack: cardinalitySlack,
  });
  const userSessionContinuity = compareUserSessionContinuity({
    preAuthState: row.pre_auth_readback?.auth_state,
    postAuthState: postReadback.auth_state,
  });

  let resultState;
  if (authRequiredTerminal) resultState = 'AUTH_REQUIRED';
  else if (failedTabs === 0) resultState = 'RESTORED';
  else resultState = 'PARTIAL';

  return {
    state: resultState,
    continuity_id: continuityId,
    restored_tabs: restoredTabs,
    failed_tabs: failedTabs,
    skipped_auth_required_tabs: skippedAuthRequiredTabs,
    created_tab_ids: createdTabIds,
    tab_count: row.tabs.length,
    target_version: row.target_version || null,
    selected_tab_id: selectedTabId,
    had_generating_tabs: row.tabs.some((tab) => tab?.generation_state === 'GENERATING'),
    lifecycle_resume_present: Boolean(row.lifecycle?.active_request),
    auth_readback: postReadback,
    user_session_continuity: userSessionContinuity,
    tab_cardinality: cardinality,
    bindings,
    authority_effect: false,
  };
}

// Cleanup by proof only: close tabs whose created_by_continuity_id matches
// THIS restore attempt beyond the capsule's own tab count. The 32 live tabs
// of the 2026-09-17 incident carry no such stamp and are never touched.
export function planPostRestoreDuplicateTabCleanup({ continuityRow, currentTabs = [] } = {}) {
  const continuityId = String(continuityRow?.continuity_id || '');
  const desired = Array.isArray(continuityRow?.tabs) ? continuityRow.tabs.length : 0;
  if (!SAFE_CONTINUITY_ID_RE.test(continuityId)) {
    return Object.freeze({
      close_tab_ids: [],
      desired_tab_count: desired,
      attempt_tab_count: 0,
      arbitrary_tab_close: false,
      authority_effect: false,
    });
  }
  const attemptTabs = (currentTabs || [])
    .filter((tab) => String(tab?.created_by_continuity_id || '') === continuityId && tab?.tab_id)
    .sort((a, b) => String(a?.created_at || '').localeCompare(String(b?.created_at || '')));
  const closeTabIds = attemptTabs.length > Math.max(0, desired)
    ? attemptTabs.slice(Math.max(0, desired)).map((tab) => String(tab.tab_id))
    : [];
  return Object.freeze({
    close_tab_ids: closeTabIds,
    desired_tab_count: desired,
    attempt_tab_count: attemptTabs.length,
    closed_tabs_created_by_continuity_id: continuityId,
    arbitrary_tab_close: false,
    authority_effect: false,
  });
}

export function selfUpdateSessionContinuityPath(userDataPath) {
  return path.join(String(userDataPath), 'metaengine-self-update-session-continuity-v1.json');
}

export function selfUpdateSessionContinuityAttemptPath(userDataPath, continuityId, attemptedAt = new Date().toISOString()) {
  const id = String(continuityId || 'unknown').replace(/[^0-9A-Za-z-]/g, '-').slice(0, 120);
  const stamp = String(attemptedAt || new Date().toISOString()).replace(/[^0-9A-Za-z.-]/g, '-').slice(0, 96);
  return path.join(String(userDataPath), `metaengine-self-update-session-continuity-attempt-${id}-${stamp}.json`);
}

export function selfUpdateSessionContinuityQuarantinePath(userDataPath, quarantinedAt = new Date().toISOString()) {
  const stamp = String(quarantinedAt || new Date().toISOString()).replace(/[^0-9A-Za-z.-]/g, '-').slice(0, 96);
  return path.join(String(userDataPath), `metaengine-self-update-session-continuity-quarantine-${stamp}.json`);
}

export function selfUpdateSessionContinuitySupersedePath(userDataPath, supersededAt = new Date().toISOString()) {
  const stamp = String(supersededAt || new Date().toISOString()).replace(/[^0-9A-Za-z.-]/g, '-').slice(0, 96);
  return path.join(String(userDataPath), `metaengine-self-update-session-continuity-superseded-${stamp}.json`);
}

export async function persistSelfUpdateSessionContinuity(userDataPath, row) {
  if (row?.schema !== SELF_UPDATE_SESSION_CONTINUITY_SCHEMA) throw new Error('self_update_session_continuity_schema_invalid');
  const target = selfUpdateSessionContinuityPath(userDataPath);
  const temp = `${target}.tmp`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(temp, `${JSON.stringify(row, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temp, target);
  return target;
}

export async function loadSelfUpdateSessionContinuity(userDataPath) {
  const target = selfUpdateSessionContinuityPath(userDataPath);
  try {
    const row = JSON.parse(await fs.readFile(target, 'utf8'));
    if (row?.schema !== SELF_UPDATE_SESSION_CONTINUITY_SCHEMA || !Array.isArray(row.tabs)) return null;
    return row;
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

// One-shot restore fence (P0 repair, point 2): atomically claims the durable
// capsule by RENAMING it to an attempt sidecar BEFORE any NEW_TAB is issued.
// A process that crashes mid-restore, or any successor process started later,
// can never replay the capsule: the canonical path no longer exists and no
// code path writes it back. The attempt sidecar is durable audit evidence and
// is never deleted.
export async function beginSelfUpdateSessionContinuityRestoreAttempt(userDataPath, { attemptedAt = new Date().toISOString() } = {}) {
  const row = await loadSelfUpdateSessionContinuity(userDataPath);
  if (!row) return null;
  const target = selfUpdateSessionContinuityPath(userDataPath);
  const attemptPath = selfUpdateSessionContinuityAttemptPath(userDataPath, row.continuity_id, attemptedAt);
  await fs.mkdir(path.dirname(attemptPath), { recursive: true });
  // The rename IS the fence. Fail closed: if it cannot complete durably, no
  // restore may run at all.
  await fs.rename(target, attemptPath);
  return { row, attempt_path: attemptPath };
}

export async function quarantineSelfUpdateSessionContinuity(userDataPath, { quarantinedAt = new Date().toISOString() } = {}) {
  const target = selfUpdateSessionContinuityPath(userDataPath);
  const quarantine = selfUpdateSessionContinuityQuarantinePath(userDataPath, quarantinedAt);
  try {
    await fs.rename(target, quarantine);
    return quarantine;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

// Archives a session-continuity capsule whose target version was strictly older
// than the currently running version. The install that capsule was prepared for
// has already been superseded, so keeping the file only blocks successor
// qualification forever. The archive is a pure rename (durable, sidecar-named,
// never deleted) so auditors can still inspect the superseded attempt. No page
// authority and no installer effect is involved.
export async function supersedeSelfUpdateSessionContinuity(userDataPath, { supersededAt = new Date().toISOString() } = {}) {
  const target = selfUpdateSessionContinuityPath(userDataPath);
  const superseded = selfUpdateSessionContinuitySupersedePath(userDataPath, supersededAt);
  try {
    await fs.rename(target, superseded);
    return superseded;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export async function clearSelfUpdateSessionContinuity(userDataPath) {
  try { await fs.unlink(selfUpdateSessionContinuityPath(userDataPath)); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
}
