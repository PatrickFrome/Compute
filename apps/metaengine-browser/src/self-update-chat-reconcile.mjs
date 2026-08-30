import { chatGptControlMatches, uniqueChatGptControl } from './chatgpt-ui-controls.mjs';

function hasStop(frame) {
  return Boolean(frame?.semantic_targets?.some((target) =>
    target?.role === 'button' && chatGptControlMatches('STOP', target?.name)));
}

export async function reconcileRestoredGeneratingChats({ bindings = [], captureTab, clickControl } = {}) {
  if (typeof captureTab !== 'function' || typeof clickControl !== 'function') {
    throw new Error('self_update_chat_reconcile_dependencies_invalid');
  }
  const rows = [];
  for (const binding of bindings) {
    if (String(binding?.generation_state || '').toUpperCase() !== 'GENERATING') continue;
    const tabId = String(binding?.tab_id || '');
    if (!tabId) continue;
    let frame;
    try { frame = await captureTab(tabId); }
    catch {
      rows.push({ tab_id: tabId, state: 'CAPTURE_FAILED', authority_effect: false });
      continue;
    }
    if (hasStop(frame)) {
      rows.push({ tab_id: tabId, state: 'GENERATION_CONTINUED', authority_effect: false });
      continue;
    }
    const control = uniqueChatGptControl(frame, 'CONTINUE');
    if (!control) {
      rows.push({ tab_id: tabId, state: 'TERMINAL_OR_IDLE', authority_effect: false });
      continue;
    }
    try {
      await clickControl(tabId, control.name);
      const readback = await captureTab(tabId).catch(() => null);
      rows.push({
        tab_id: tabId,
        state: readback && hasStop(readback) ? 'CONTINUE_CONFIRMED' : 'CONTINUE_DISPATCHED',
        authority_effect: true,
      });
    } catch {
      rows.push({ tab_id: tabId, state: 'CONTINUE_AMBIGUOUS', authority_effect: false });
    }
  }
  return {
    schema: 'metaengine.self-update-chat-reconcile.v1',
    tabs: rows,
    ambiguous_count: rows.filter((row) => row.state === 'CONTINUE_AMBIGUOUS').length,
    authority_effect: rows.some((row) => row.authority_effect === true),
  };
}
