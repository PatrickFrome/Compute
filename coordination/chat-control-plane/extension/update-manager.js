(() => {
  "use strict";

  const STATE_KEY = "a2OperatorUpdateStateV060";
  const PENDING_KEY = "a2BridgePendingCommandV0523";
  const GLM_LEDGER_KEY = "a2GlmTransportV0523";
  const GPT_LEDGER_KEY = "a2ChatgptDispatchedV0523";
  const INTENT_KEY = "a2OperatorHeldPromptIntentV060";
  const DRAIN_ALARM = "a2-operator-update-drain";
  const ORDERING_POLICY = "STRICT_GLM_FIRST_ACTUATED_V1";
  let draining = false;
  let targetVersion = null;
  let checkPromise = null;

  const baseRequest = globalThis.A2_BRIDGE_REQUEST;
  if (typeof baseRequest === "function") {
    globalThis.A2_BRIDGE_REQUEST = async (path, init = {}) => {
      if (draining && String(path || "") === "/v1/commands/next") {
        return new Response(JSON.stringify({ command: null, ordering_policy: ORDERING_POLICY, update_drain: true }), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
        });
      }
      return baseRequest(path, init);
    };
  }

  async function statePatch(patch) {
    const stored = await chrome.storage.local.get(STATE_KEY);
    const previous = stored[STATE_KEY] && typeof stored[STATE_KEY] === "object" ? stored[STATE_KEY] : {};
    await chrome.storage.local.set({
      [STATE_KEY]: {
        ...previous,
        ...patch,
        target_version: targetVersion || patch?.target_version || previous.target_version || null,
        updated_at: new Date().toISOString()
      }
    });
  }

  function activeGlmTransport(rows) {
    if (!Array.isArray(rows)) return null;
    return [...rows].reverse().find((row) => ["DISPATCHED", "ACTUATED"].includes(String(row?.state || ""))) || null;
  }

  function ambiguousGptTransport(rows) {
    if (!Array.isArray(rows)) return null;
    return [...rows].reverse().find((row) => String(row?.phase || "") === "PRE_ENTER_DURABLE") || null;
  }

  async function safeReloadState() {
    const [local, session] = await Promise.all([
      chrome.storage.local.get([PENDING_KEY, GLM_LEDGER_KEY, GPT_LEDGER_KEY, "chatgptRolloverPending"]),
      chrome.storage.session.get(INTENT_KEY)
    ]);
    const broker = typeof globalThis.A2_DEBUGGER_STATUS === "function" ? globalThis.A2_DEBUGGER_STATUS() : [];
    const brokerBusy = Array.isArray(broker) ? broker.find((row) => Number(row?.pending || 0) > 0 || Boolean(row?.active_owner)) : null;
    const glmBusy = activeGlmTransport(local[GLM_LEDGER_KEY]);
    const gptAmbiguous = ambiguousGptTransport(local[GPT_LEDGER_KEY]);
    const reasons = [];
    if (local[PENDING_KEY]?.command_id) reasons.push(`pending_command:${local[PENDING_KEY].command_id}`);
    if (session[INTENT_KEY]?.intent_id) reasons.push(`held_prompt:${session[INTENT_KEY].intent_id}`);
    if (local.chatgptRolloverPending === true) reasons.push("chatgpt_rollover_pending");
    if (glmBusy) reasons.push(`glm_transport:${glmBusy.state}`);
    if (gptAmbiguous) reasons.push("gpt_pre_enter_ambiguous");
    if (brokerBusy) reasons.push(`debugger_broker:${brokerBusy.active_owner || brokerBusy.pending}`);
    return { safe: reasons.length === 0, reasons };
  }

  async function checkDrain() {
    if (!draining || checkPromise) return checkPromise;
    checkPromise = (async () => {
      const state = await safeReloadState();
      if (!state.safe) {
        await statePatch({ status: "WAITING_SAFE_BOUNDARY", blocked_by: state.reasons });
        return false;
      }
      await statePatch({ status: "SAFE_RELOAD", blocked_by: [], safe_at: new Date().toISOString() });
      await chrome.alarms.clear(DRAIN_ALARM).catch(() => {});
      chrome.runtime.reload();
      return true;
    })().finally(() => { checkPromise = null; });
    return checkPromise;
  }

  async function beginDrain(version) {
    targetVersion = String(version || "unknown").slice(0, 64);
    draining = true;
    await statePatch({
      status: "DRAINING",
      target_version: targetVersion,
      available_at: new Date().toISOString(),
      blocked_by: []
    });
    await chrome.alarms.create(DRAIN_ALARM, { periodInMinutes: 0.5 });
    await checkDrain();
  }

  chrome.runtime.onUpdateAvailable.addListener((details) => {
    beginDrain(details?.version).catch((error) => statePatch({ status: "DRAIN_ERROR", error: String(error?.message || error) }).catch(() => {}));
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name === DRAIN_ALARM) checkDrain().catch(() => {});
  });

  chrome.runtime.onInstalled.addListener(() => {
    draining = false;
    targetVersion = null;
    chrome.alarms.clear(DRAIN_ALARM).catch(() => {});
    chrome.storage.local.set({ [STATE_KEY]: { status: "CURRENT", version: chrome.runtime.getManifest().version, updated_at: new Date().toISOString() } }).catch(() => {});
  });

  globalThis.A2_UPDATE_DRAIN_ACTIVE = () => draining;
  globalThis.A2_UPDATE_SAFE_STATE = safeReloadState;
})();
