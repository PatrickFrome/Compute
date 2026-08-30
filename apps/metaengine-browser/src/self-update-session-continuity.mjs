import fs from 'node:fs/promises';
import path from 'node:path';

export const SELF_UPDATE_SESSION_CONTINUITY_SCHEMA = 'metaengine.self-update-session-continuity.v1';
const SAFE_TAB_ID_RE = /^tab_[a-z0-9-]{8,96}$/i;
const HTTPS_RE = /^https:\/\//i;

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
    title: clip(tab?.title || '', 240),
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

export function buildSelfUpdateSessionContinuity({
  currentVersion,
  targetVersion,
  tabsSnapshot,
  lifecycleSnapshot = null,
  createdAt = new Date().toISOString(),
} = {}) {
  const selected = tabsSnapshot?.selected_tab_id || null;
  const tabs = (tabsSnapshot?.tabs || []).map((tab) => sanitizeTab(tab, selected)).filter(Boolean).slice(0, 32);
  return {
    schema: SELF_UPDATE_SESSION_CONTINUITY_SCHEMA,
    current_version: clip(currentVersion, 80),
    target_version: clip(targetVersion, 80),
    created_at: clip(createdAt, 80),
    tabs,
    lifecycle: sanitizeLifecycle(lifecycleSnapshot),
    persisted_chat_text: false,
    persisted_credentials: false,
    authority_effect: false,
  };
}

export function selfUpdateSessionContinuityPath(userDataPath) {
  return path.join(String(userDataPath), 'metaengine-self-update-session-continuity-v1.json');
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

export async function clearSelfUpdateSessionContinuity(userDataPath) {
  try { await fs.unlink(selfUpdateSessionContinuityPath(userDataPath)); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
}
