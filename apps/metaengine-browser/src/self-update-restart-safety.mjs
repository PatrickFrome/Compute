import { chatGptControlMatches } from './chatgpt-ui-controls.mjs';

const CHATGPT_RE = /^https:\/\/(?:www\.)?(?:chatgpt\.com|chat\.openai\.com)(?:[/:?#]|$)/i;
const SAFE_WORKER_GENERATION = new Set(['IDLE', 'TERMINAL']);
const BUSY_DOWNLOAD_STATES = new Set(['STARTING', 'DOWNLOADING', 'VERIFYING', 'CANCELLING']);

function chatGptGenerating(frame) {
  return Boolean(frame?.semantic_targets?.some((target) =>
    target?.role === 'button' && chatGptControlMatches('STOP', target?.name)));
}

function networkActiveForTab(state, tabId) {
  const id = String(tabId || '');
  const tab = (state?.tabs || []).find((row) => String(row?.tab_id || '') === id) || null;
  const rows = state?.network?.tabs || state?.tab_network?.tabs || [];
  const network = rows.find((row) => String(row?.tab_id || '') === id
    || Number(row?.webcontents_id || 0) === Number(tab?.webcontents_id || -1)) || tab?.network || null;
  return Number(network?.inflight_tracked || 0) > 0;
}

function lifecycleAllowsRestart(snapshot) {
  if (!snapshot || String(snapshot.supervisor_generation || '').toUpperCase() !== 'IDLE') return false;
  if (snapshot.active_request) return false;
  if (snapshot.last_recovery?.ambiguous === true) return false;
  const workers = Array.isArray(snapshot.worker_signals) ? snapshot.worker_signals : [];
  return workers.every((signal) => SAFE_WORKER_GENERATION.has(String(signal?.generation_state || 'UNKNOWN').toUpperCase()));
}

function downloadsAllowRestart(state) {
  const value = String(state?.downloads?.state || state?.downloads?.status || 'IDLE').toUpperCase();
  return !BUSY_DOWNLOAD_STATES.has(value);
}

export async function confirmSelfUpdateRestartSafety({ getState, captureTab, lifecycleSnapshot } = {}) {
  if (typeof getState !== 'function' || typeof captureTab !== 'function') return false;
  const lifecycle = typeof lifecycleSnapshot === 'function' ? lifecycleSnapshot() : lifecycleSnapshot;
  if (!lifecycleAllowsRestart(lifecycle)) return false;

  let state;
  try { state = await getState(); }
  catch { return false; }
  if (!downloadsAllowRestart(state)) return false;

  const chatTabs = (state?.tabs || []).filter((tab) => CHATGPT_RE.test(String(tab?.url || '')));
  for (const tab of chatTabs) {
    const tabId = String(tab?.tab_id || '');
    if (!tabId || networkActiveForTab(state, tabId)) return false;
    let frame;
    try { frame = await captureTab(tabId); }
    catch { return false; }
    if (chatGptGenerating(frame)) return false;
  }

  return true;
}
