(() => {
  "use strict";

  const PENDING_KEY = "a2SupervisorPendingIncidentV1";
  const LAST_INCIDENT_KEY = "a2SupervisorLastIncidentReceiptV1";
  const LAST_ACTION_KEY = "a2SupervisorLastChatActionV1";

  function trustedSidepanel(sender) {
    const expected = chrome.runtime.getURL("sidepanel.html");
    return sender?.id === chrome.runtime.id && typeof sender?.url === "string" && sender.url.startsWith(expected);
  }

  function sanitizePending(value) {
    if (!value || typeof value !== "object") return null;
    return {
      incident_id: value.incident_id || null,
      source: value.source || null,
      status: value.status || null,
      attempt: Number(value.attempt || 0),
      epoch: Number(value.epoch || 0) || null,
      execution_class: value.execution_class || null,
      created_at: value.created_at || null,
      sent_at: value.sent_at || null,
      last_progress_at: value.last_progress_at || null,
      fingerprint_sha256: value.fingerprint_sha256 || null,
      last_error_code: value.last_error_code || null
    };
  }

  async function status() {
    const chat = typeof globalThis.A2_SUPERVISOR_CHAT_STATUS === "function"
      ? await globalThis.A2_SUPERVISOR_CHAT_STATUS()
      : { enabled: false, tab_present: false, health: { state: "UNAVAILABLE" } };
    const local = await chrome.storage.local.get([PENDING_KEY, LAST_INCIDENT_KEY, LAST_ACTION_KEY]);
    return {
      chat,
      pending_incident: sanitizePending(local[PENDING_KEY]),
      last_incident: local[LAST_INCIDENT_KEY] || null,
      last_action: local[LAST_ACTION_KEY] || null
    };
  }

  async function openChat() {
    if (typeof globalThis.A2_SUPERVISOR_CHAT_ENSURE !== "function") throw new Error("supervisor_chat_session_manager_unavailable");
    const tab = await globalThis.A2_SUPERVISOR_CHAT_ENSURE("sidepanel_open");
    const tabId = Number(tab?.id || tab?.tab_id);
    if (!Number.isInteger(tabId)) throw new Error("supervisor_chat_tab_unavailable");
    await chrome.tabs.update(tabId, { active: true });
    return status();
  }

  async function recoverChat() {
    if (typeof globalThis.A2_SUPERVISOR_CHAT_RECOVER !== "function") throw new Error("supervisor_chat_recovery_unavailable");
    await globalThis.A2_SUPERVISOR_CHAT_RECOVER("sidepanel_manual_recovery");
    return status();
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const type = String(message?.type || "");
    if (!["A2_SUPERVISOR_CHAT_STATUS", "A2_SUPERVISOR_CHAT_OPEN", "A2_SUPERVISOR_CHAT_RECOVER"].includes(type)) return false;
    if (!trustedSidepanel(sender)) {
      sendResponse({ ok: false, error: "supervisor_chat_ui_sender_not_trusted" });
      return false;
    }
    const operation = type === "A2_SUPERVISOR_CHAT_STATUS" ? status
      : type === "A2_SUPERVISOR_CHAT_OPEN" ? openChat
      : recoverChat;
    operation().then((state) => sendResponse({ ok: true, state }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  });

  globalThis.A2_SUPERVISOR_CHAT_BOARD_STATUS = status;
})();