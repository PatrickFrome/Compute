(() => {
  "use strict";

  const rawSend = globalThis.A2_CHATGPT_TRUSTED_SEND;
  if (typeof rawSend !== "function") return;

  const CHATGPT_ROOT = "https://chatgpt.com/";
  const LEDGER_KEY = "a2ChatgptDispatchedV0523";
  const RECOVERY_KEY = "a2ChatgptRolloverRecoveryV062";
  const MAX_PROBE_RELOADS = 1;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function normUrl(value) {
    try {
      const u = new URL(String(value || ""));
      u.hash = ""; u.search = ""; u.pathname = u.pathname.replace(/\/+$/, "") || "/";
      return `${u.origin}${u.pathname}`;
    } catch (_) { return ""; }
  }
  function isConversation(value) {
    try {
      const u = new URL(String(value || ""));
      return ["chatgpt.com", "chat.openai.com"].includes(u.hostname.toLowerCase()) && u.pathname.startsWith("/c/");
    } catch (_) { return false; }
  }
  async function ledgerRow(command) {
    const stored = await chrome.storage.local.get(LEDGER_KEY);
    const rows = Array.isArray(stored[LEDGER_KEY]) ? stored[LEDGER_KEY] : [];
    const id = String(command?.command_id || ""), idem = String(command?.idempotency_key || "");
    return rows.find((row) => row?.command_id === id || (idem && row?.idempotency_key === idem)) || null;
  }
  async function snapshotReady(tabId, timeout = 15_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        const r = await chrome.tabs.sendMessage(tabId, { type: "GET_CHAT_SNAPSHOT" });
        if (r?.ok && r.snapshot) return r.snapshot;
      } catch (_) {}
      await sleep(180);
    }
    throw new Error("chatgpt_rollover_content_not_ready");
  }
  async function probeExhaustion(tabId, allowReload = true) {
    for (let attempt = 0; attempt <= (allowReload ? MAX_PROBE_RELOADS : 0); attempt += 1) {
      try {
        const result = await chrome.tabs.sendMessage(tabId, { type: "A2_CHATGPT_EXHAUSTION_STATUS" });
        if (result?.ok === true) return result;
      } catch (_) {}
      if (attempt < MAX_PROBE_RELOADS) {
        await chrome.tabs.reload(tabId);
        await snapshotReady(tabId);
      }
    }
    return { ok: false, exhausted: false, reason: "probe_unavailable" };
  }
  async function markRecovery(tabId, command, phase, extra = {}) {
    const marker = {
      schema: "metaengine.a2-chatgpt-rollover-recovery.v1",
      command_id: String(command?.command_id || "") || null,
      idempotency_key: String(command?.idempotency_key || "") || null,
      tab_id: Number(tabId), phase, at: new Date().toISOString(), authority_effect: false, ...extra
    };
    await chrome.storage.local.set({ [RECOVERY_KEY]: marker });
    return marker;
  }
  async function prepareRoot(tabId, command, reason) {
    await chrome.storage.local.set({
      chatgptRolloverPending: true,
      chatgptRolloverPendingTabId: Number(tabId),
      chatgptUrl: CHATGPT_ROOT
    });
    await markRecovery(tabId, command, "ROOT_NAVIGATION", { reason });
    await chrome.tabs.update(Number(tabId), { url: CHATGPT_ROOT, active: false });
    await snapshotReady(Number(tabId));
  }
  async function finalizeNewConversation(tabId, command, timeout = 18_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const tab = await chrome.tabs.get(Number(tabId));
      const url = normUrl(tab?.url || "");
      if (isConversation(url)) {
        await chrome.storage.local.set({
          chatgptUrl: url,
          chatgptRolloverPending: false,
          chatgptRolloverPendingTabId: null
        });
        await markRecovery(tabId, command, "NEW_CONVERSATION_PINNED", { new_url: url });
        return url;
      }
      await sleep(200);
    }
    await markRecovery(tabId, command, "NEW_CONVERSATION_PENDING", { reason: "url_not_materialized_yet" });
    return null;
  }
  function durableReplayResult(prior, recovery) {
    if (prior?.phase === "ACTUATED") {
      return { ok: true, status: "SENT_ALREADY_DURABLE", execution_class: "ACTUATED", durable_dispatch_replay: true, phase: prior.phase, recovery };
    }
    return { ok: false, status: "FAILED_DURABLE_AMBIGUOUS_NO_RETRY", execution_class: "AMBIGUOUS_NO_RETRY", durable_dispatch_replay: true, phase: prior?.phase || null, error: "chatgpt_durable_pre_enter_ambiguous", recovery };
  }

  async function trustedSend(tabId, command) {
    const tab = await chrome.tabs.get(Number(tabId));
    const current = normUrl(tab?.url || "");
    const stored = await chrome.storage.local.get(["chatgptRolloverPending", "chatgptRolloverPendingTabId"]);
    const rootPending = current === CHATGPT_ROOT.slice(0, -1) || current === CHATGPT_ROOT;
    const pendingForTab = stored.chatgptRolloverPending === true && Number(stored.chatgptRolloverPendingTabId) === Number(tabId);

    if (rootPending && pendingForTab) {
      const result = await rawSend(Number(tabId), command);
      if (result?.ok === true && ["ACTUATED", "VERIFIED"].includes(String(result.execution_class || ""))) {
        finalizeNewConversation(tabId, command).catch(() => {});
      }
      return { ...result, recovery: { ...(result?.recovery || {}), rollover_v062: true, entered_from_root: true } };
    }

    if (!isConversation(current)) return rawSend(Number(tabId), command);

    const exhaustion = await probeExhaustion(Number(tabId), true);
    if (exhaustion?.exhausted !== true) return rawSend(Number(tabId), command);

    const prior = await ledgerRow(command);
    await prepareRoot(Number(tabId), command, exhaustion.reason || "conversation_length_limit");

    if (prior) {
      const recovery = { rollover_v062: true, exhausted: true, root_prepositioned: true, resend_forbidden: true };
      await markRecovery(tabId, command, "DURABLE_REPLAY_NO_RESEND", { ledger_phase: prior.phase || null });
      return durableReplayResult(prior, recovery);
    }

    const result = await rawSend(Number(tabId), command);
    if (result?.ok === true && ["ACTUATED", "VERIFIED"].includes(String(result.execution_class || ""))) {
      finalizeNewConversation(tabId, command).catch(() => {});
    }
    return { ...result, recovery: { ...(result?.recovery || {}), rollover_v062: true, exhausted: true, root_prepositioned: true } };
  }

  globalThis.A2_CHATGPT_TRUSTED_SEND_RAW_V062 = rawSend;
  globalThis.A2_CHATGPT_TRUSTED_SEND = trustedSend;
})();
