const CHATGPT_URL_RE = /^https:\/\/(?:www\.)?chatgpt\.com(?:\/|$)/i;

function finitePositive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

export function positiveViewport(frame) {
  return finitePositive(frame?.viewport?.width) && finitePositive(frame?.viewport?.height);
}

function exactBinding(frame, tabId) {
  if (String(frame?.tab_id || '') !== String(tabId || '')) return null;
  const processIncarnationId = String(frame?.process_incarnation_id || '');
  const targetId = String(frame?.target_id || '');
  if (!processIncarnationId || !targetId) return null;
  return Object.freeze({
    tab_id: String(tabId),
    process_incarnation_id: processIncarnationId,
    target_id: targetId,
  });
}

function sameBinding(left, right) {
  return Boolean(left && right
    && left.tab_id === right.tab_id
    && left.process_incarnation_id === right.process_incarnation_id
    && left.target_id === right.target_id);
}

function selectedTabId(state) {
  const active = String(state?.active_tab?.tab_id || '');
  if (active) return active;
  const selected = (state?.tabs || []).filter((tab) => tab?.selected === true);
  return selected.length === 1 ? String(selected[0]?.tab_id || '') : '';
}

function exactControl(frame, command) {
  const role = String(command?.payload?.role || '');
  const name = String(command?.payload?.accessible_name || '');
  const rows = (frame?.semantic_targets || []).filter((row) => String(row?.role || '') === role && String(row?.name || '') === name);
  return rows.length === 1 ? rows[0] : null;
}

function localClickShape(command) {
  if (String(command?.action || '') !== 'TYPED_CLICK' || command?.command_id) return null;
  const tabId = String(command?.payload?.tab_id || '');
  return tabId ? { tab_id: tabId } : null;
}

function isSupervisorTab(tabId, state) {
  const fleetTabs = new Set((state?.fleet?.agents || []).map((agent) => String(agent?.tab_id || '')).filter(Boolean));
  if (fleetTabs.has(tabId)) return false;
  const tab = (state?.tabs || []).find((row) => String(row?.tab_id || '') === tabId) || null;
  return Boolean(tab && CHATGPT_URL_RE.test(String(tab?.url || '')));
}

function noClick(reason) {
  return Object.freeze({
    ok: false,
    clicked: false,
    no_effect: true,
    reason,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

/**
 * Guard only local supervisor TYPED_CLICK. Remote DB-leased commands and fleet
 * worker clicks retain their existing authority paths. The guard deliberately
 * returns a conservative no-click result instead of throwing after a draft may
 * already have been typed; the caller can mark the logical wake ambiguous and
 * must not retype/retry it without a fresh proof boundary.
 */
export async function executeGuardedSupervisorLocalClick({ command, getState, executeCommand } = {}) {
  if (typeof getState !== 'function' || typeof executeCommand !== 'function') throw new Error('supervisor_local_click_guard_dependencies_required');
  const shape = localClickShape(command);
  if (!shape) return Object.freeze({ handled: false, result: null });
  const initialState = await getState();
  if (!isSupervisorTab(shape.tab_id, initialState)) return Object.freeze({ handled: false, result: null });

  const tabId = shape.tab_id;
  let beforeFrame;
  try {
    beforeFrame = await executeCommand({ action: 'CAPTURE', payload: { tab_id: tabId }, platform: command?.platform || null });
  } catch {
    return Object.freeze({ handled: true, result: noClick('SUPERVISOR_PRECLICK_CAPTURE_FAILED') });
  }
  const beforeBinding = exactBinding(beforeFrame, tabId);
  if (!beforeBinding) return Object.freeze({ handled: true, result: noClick('SUPERVISOR_PRECLICK_BINDING_INVALID') });

  try {
    await executeCommand({ action: 'SELECT_TAB', payload: { tab_id: tabId }, platform: command?.platform || null });
  } catch {
    return Object.freeze({ handled: true, result: noClick('SUPERVISOR_SELECT_TAB_FAILED') });
  }

  let selectedState;
  try {
    selectedState = await getState();
  } catch {
    return Object.freeze({ handled: true, result: noClick('SUPERVISOR_SELECTED_STATE_READBACK_FAILED') });
  }
  if (selectedTabId(selectedState) !== tabId) {
    return Object.freeze({ handled: true, result: noClick('SUPERVISOR_SELECTED_TAB_MISMATCH') });
  }

  let afterFrame;
  try {
    afterFrame = await executeCommand({ action: 'CAPTURE', payload: { tab_id: tabId }, platform: command?.platform || null });
  } catch {
    return Object.freeze({ handled: true, result: noClick('SUPERVISOR_POSTSELECT_CAPTURE_FAILED') });
  }
  const afterBinding = exactBinding(afterFrame, tabId);
  if (!sameBinding(beforeBinding, afterBinding)) {
    return Object.freeze({ handled: true, result: noClick('SUPERVISOR_CLICK_BINDING_DRIFT') });
  }
  if (!positiveViewport(afterFrame)) {
    return Object.freeze({ handled: true, result: noClick('SUPERVISOR_VIEWPORT_NOT_POSITIVE') });
  }
  if (!exactControl(afterFrame, command)) {
    return Object.freeze({ handled: true, result: noClick('SUPERVISOR_CLICK_CONTROL_NOT_UNIQUE') });
  }

  const result = await executeCommand(command);
  return Object.freeze({ handled: true, result });
}
