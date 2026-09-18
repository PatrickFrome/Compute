(() => {
  "use strict";

  const SNAPSHOT_KEY = "a2SupervisorChatSnapshotV1";
  const PENDING_KEY = "a2SupervisorPendingIncidentV1";
  const LAST_ACTION_KEY = "a2SupervisorLastChatActionV1";
  let processPromise = null;

  function assistantState(row) {
    const snap = row?.snapshot || null;
    const messages = Array.isArray(snap?.messages) ? snap.messages : [];
    const assistants = messages.filter((message) => String(message?.role || "").toLowerCase() === "assistant");
    const tail = assistants[assistants.length - 1] || null;
    return {
      assistant_count: assistants.length,
      assistant_tail_sha256: tail?.text_sha256 || null,
      generating: snap?.generating === true
    };
  }

  function advanced(baseline, current) {
    if (!baseline || !current) return false;
    if (Number(current.assistant_count || 0) > Number(baseline.assistant_count || 0)) return true;
    return Boolean(current.assistant_tail_sha256 && current.assistant_tail_sha256 !== baseline.assistant_tail_sha256);
  }

  async function maybeProcess(row) {
    if (processPromise) return processPromise;
    processPromise = (async () => {
      if (typeof globalThis.A2_SUPERVISOR_CHAT_PROCESS_RESPONSE !== "function") return null;
      const x = await chrome.storage.local.get([PENDING_KEY, LAST_ACTION_KEY]);
      const pending = x[PENDING_KEY] || null;
      if (!pending?.incident_id || !["WAITING_RESPONSE", "WAITING_AMBIGUOUS"].includes(String(pending.status || ""))) return null;
      const current = assistantState(row);
      if (current.generating === true || !advanced(pending.baseline || null, current)) return null;
      const prior = x[LAST_ACTION_KEY] || null;
      if (prior?.incident_id === pending.incident_id && prior?.response_sha256 && prior.response_sha256 === current.assistant_tail_sha256) return prior;

      const receipt = await globalThis.A2_SUPERVISOR_CHAT_PROCESS_RESPONSE(pending, row);
      const durable = {
        ...receipt,
        incident_id: pending.incident_id,
        response_sha256: current.assistant_tail_sha256 || null,
        response_assistant_count: current.assistant_count,
        processed_at: new Date().toISOString()
      };
      await chrome.storage.local.set({ [LAST_ACTION_KEY]: durable });
      return durable;
    })().finally(() => { processPromise = null; });
    return processPromise;
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "session" || !changes[SNAPSHOT_KEY]?.newValue) return;
    maybeProcess(changes[SNAPSHOT_KEY].newValue).catch(() => {});
  });

  globalThis.A2_SUPERVISOR_CHAT_MAYBE_PROCESS_ACTION = maybeProcess;
})();