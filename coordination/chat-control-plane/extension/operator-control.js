(() => {
  "use strict";

  const MODE_KEY = "operatorMode";
  const INTENT_KEY = "a2OperatorHeldPromptIntentV060";
  const INTENT_TTL_MS = 15 * 60 * 1000;
  const MAX_DRAFT_CHARS = 120000;
  const MODES = new Set(["OBSERVE", "GATE_SEND"]);
  const ALLOWED_PLATFORMS = new Set(["CHATGPT", "GLM_ZAI"]);
  const ORDERING_POLICY = "STRICT_GLM_FIRST_ACTUATED_V1";

  const normalize = (value) => String(value ?? "").replace(/\r\n?/g, "\n").trim();
  function compat(path, fallback) {
    try { return globalThis.A2_COMPAT_GET?.(path, fallback) ?? fallback; }
    catch (_) { return fallback; }
  }
  function promptGateAllowed() { return compat("features.prompt_gate_enabled", true) === true; }

  function normUrl(value) {
    try {
      const url = new URL(String(value || ""));
      url.hash = "";
      url.search = "";
      url.pathname = url.pathname.replace(/\/+$/, "") || "/";
      return `${url.origin}${url.pathname}`;
    } catch (_) { return ""; }
  }

  function platformOf(value) {
    try {
      const host = new URL(String(value || "")).hostname.toLowerCase();
      if (host === "chatgpt.com" || host === "chat.openai.com") return "CHATGPT";
      if (host === "chat.z.ai") return "GLM_ZAI";
    } catch (_) {}
    return "UNKNOWN";
  }

  async function sha256(value) {
    const bytes = new TextEncoder().encode(String(value ?? ""));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function trustedOperatorSender(sender) {
    const expected = chrome.runtime.getURL("sidepanel.html");
    return sender?.id === chrome.runtime.id && typeof sender?.url === "string" && sender.url.startsWith(expected);
  }

  function trustedPageSender(sender, claimedPlatform) {
    if (sender?.id !== chrome.runtime.id || !Number.isInteger(sender?.tab?.id)) return false;
    const actual = platformOf(sender.tab.url || sender.url || "");
    return ALLOWED_PLATFORMS.has(actual) && actual === String(claimedPlatform || actual);
  }

  async function getMode() {
    const stored = await chrome.storage.local.get(MODE_KEY);
    const mode = MODES.has(String(stored[MODE_KEY] || "")) ? String(stored[MODE_KEY]) : "OBSERVE";
    return mode === "GATE_SEND" && !promptGateAllowed() ? "OBSERVE" : mode;
  }

  async function heldIntent() {
    const stored = await chrome.storage.session.get(INTENT_KEY);
    const intent = stored[INTENT_KEY] || null;
    if (!intent) return null;
    const created = Date.parse(intent.created_at || "");
    if (!Number.isFinite(created) || Date.now() - created > INTENT_TTL_MS) {
      await chrome.storage.session.remove(INTENT_KEY);
      return null;
    }
    return intent;
  }

  async function clearIntent() { await chrome.storage.session.remove(INTENT_KEY); }

  async function broadcastMode(mode) {
    const tabs = await chrome.tabs.query({});
    await Promise.allSettled(tabs.filter((tab) => Number.isInteger(tab?.id) && ALLOWED_PLATFORMS.has(platformOf(tab.url || "")))
      .map((tab) => chrome.tabs.sendMessage(tab.id, { type: "A2_PROMPT_GATE_CONFIG", mode })));
  }

  async function setMode(mode) {
    const next = MODES.has(String(mode || "")) ? String(mode) : null;
    if (!next) throw new Error("operator_mode_invalid");
    if (next === "GATE_SEND" && !promptGateAllowed()) throw new Error("compat_feature_prompt_gate_disabled");
    if (next === "OBSERVE") {
      const intent = await heldIntent();
      if (intent?.tab_id) {
        await chrome.tabs.sendMessage(intent.tab_id, {
          type: "A2_PROMPT_GATE_RESOLUTION",
          intent_id: intent.intent_id,
          action: "CANCEL"
        }).catch(() => null);
      }
      await clearIntent();
    }
    await chrome.storage.local.set({ [MODE_KEY]: next });
    await broadcastMode(next);
    return next;
  }

  async function saveSensorError(message, sender) {
    const error = String(message?.error || "prompt_gate_sensor_error").slice(0, 240);
    await chrome.storage.local.set({
      operatorSensorLastError: error,
      operatorSensorLastErrorAt: new Date().toISOString(),
      operatorSensorLastPlatform: String(message?.platform || platformOf(sender?.tab?.url || "")),
      operatorSensorLastEventType: String(message?.event_type || "UNKNOWN").slice(0, 80)
    });
  }

  async function createIntent(message, sender) {
    // Sender/tab/platform binding is checked before mutable operator mode. This
    // keeps the trust boundary deterministic and avoids returning mode-derived
    // errors to a sender that never had authority to create an intent.
    if (!trustedPageSender(sender, message?.platform)) throw new Error("prompt_gate_sender_invalid");
    if (await getMode() !== "GATE_SEND") throw new Error("prompt_gate_not_enabled");
    const draft = String(message?.draft || "").slice(0, MAX_DRAFT_CHARS);
    if (!normalize(draft)) throw new Error("prompt_gate_draft_empty");
    const pageUrl = normUrl(sender.tab.url || message?.page_url || "");
    if (!pageUrl || pageUrl !== normUrl(message?.page_url || pageUrl)) throw new Error("prompt_gate_page_binding_invalid");
    const draftSha256 = await sha256(normalize(draft));
    const existing = await heldIntent();
    if (existing) {
      if (Number(existing.tab_id) === Number(sender.tab.id) && existing.platform === String(message.platform) && existing.page_url === pageUrl && existing.draft_sha256 === draftSha256) return existing;
      throw new Error("prompt_gate_intent_already_held");
    }
    const intent = {
      schema: "metaengine.a2-browser-operator.prompt-intent.v1",
      intent_id: crypto.randomUUID(),
      tab_id: sender.tab.id,
      platform: String(message.platform),
      event_type: String(message.event_type || "UNKNOWN").slice(0, 80),
      page_url: pageUrl,
      original_draft: draft,
      draft_sha256: draftSha256,
      created_at: new Date().toISOString(),
      authority_effect: false
    };
    await chrome.storage.session.set({ [INTENT_KEY]: intent });
    return intent;
  }

  async function resolveIntent(message) {
    const intent = await heldIntent();
    if (!intent?.intent_id) throw new Error("prompt_gate_no_held_intent");
    if (String(message?.intent_id || "") !== String(intent.intent_id)) throw new Error("prompt_gate_intent_mismatch");
    const action = String(message?.action || "CANCEL");
    if (!["CANCEL", "ALLOW_ONCE", "REWRITE_ALLOW_ONCE"].includes(action)) throw new Error("prompt_gate_resolution_invalid");

    if (action !== "CANCEL") {
      const tab = await chrome.tabs.get(intent.tab_id).catch(() => null);
      if (!tab?.id || normUrl(tab.url || "") !== intent.page_url || platformOf(tab.url || "") !== intent.platform) {
        await clearIntent();
        throw new Error("prompt_gate_tab_binding_lost");
      }
    }

    let draft = intent.original_draft;
    let pageAction = action;
    let trustedRewrite = null;
    if (action === "REWRITE_ALLOW_ONCE") {
      draft = String(message?.draft || "").slice(0, MAX_DRAFT_CHARS);
      if (!normalize(draft)) throw new Error("prompt_gate_rewrite_empty");
      if (typeof globalThis.A2_OPERATOR_TRUSTED_REPLACE_DRAFT !== "function") throw new Error("operator_trusted_rewrite_unavailable");
      trustedRewrite = await globalThis.A2_OPERATOR_TRUSTED_REPLACE_DRAFT(intent.tab_id, intent.platform, draft);
      if (trustedRewrite?.ok !== true || trustedRewrite?.exact_readback !== true) throw new Error("operator_trusted_rewrite_not_verified");
      pageAction = "ALLOW_ONCE";
    }

    const response = await chrome.tabs.sendMessage(intent.tab_id, {
      type: "A2_PROMPT_GATE_RESOLUTION",
      intent_id: intent.intent_id,
      action: pageAction,
      draft
    }).catch((error) => ({ ok: false, error: String(error?.message || error) }));
    if (!response?.ok) throw new Error(response?.error || "prompt_gate_page_resolution_failed");
    await clearIntent();
    return { action, page_action: pageAction, trusted_rewrite: trustedRewrite, response };
  }

  async function operatorStatus() {
    const [local, sessionIntent] = await Promise.all([
      chrome.storage.local.get([
        MODE_KEY, "armed", "daemonOnlineAt", "daemonLastError", "operatorSensorLastError",
        "lastOrderingPolicy", "snapshot:CHATGPT", "snapshot:GLM_ZAI",
        "a2BridgePendingCommandV0523", "a2BridgeGlmActuatedPredecessorV0523",
        "a2OperatorUpdateStateV060", "a2OperatorCompatStatusV1",
        "operatorDebuggerLastDetach", "operatorDebuggerLastDetachAt"
      ]),
      heldIntent()
    ]);
    return {
      operator_runtime: globalThis.A2_OPERATOR_RUNTIME || "0.6.0-dev",
      extension_version: chrome.runtime.getManifest().version,
      armed: local.armed === true,
      operator_mode: await getMode(),
      prompt_gate_allowed: promptGateAllowed(),
      operator_actions_allowed: compat("kill_switches.operator_actions_disabled", false) !== true,
      point_click_allowed: compat("features.point_click_enabled", true) === true && compat("features.screenshot_sensor_enabled", true) === true,
      screenshot_sensor_allowed: compat("features.screenshot_sensor_enabled", true) === true,
      ordering_policy: local.lastOrderingPolicy || ORDERING_POLICY,
      glm_predecessor_command_id: local.a2BridgeGlmActuatedPredecessorV0523 || null,
      pending_command: local.a2BridgePendingCommandV0523 || null,
      snapshots: {
        CHATGPT: local["snapshot:CHATGPT"]?.snapshot || null,
        GLM_ZAI: local["snapshot:GLM_ZAI"]?.snapshot || null
      },
      daemon_online_at: local.daemonOnlineAt || null,
      daemon_error: local.daemonLastError || null,
      sensor_error: local.operatorSensorLastError || null,
      prompt_intent: sessionIntent || null,
      update: local.a2OperatorUpdateStateV060 || null,
      compatibility: local.a2OperatorCompatStatusV1 || { status: "UNPROVISIONED" },
      debugger_broker: typeof globalThis.A2_DEBUGGER_STATUS === "function" ? globalThis.A2_DEBUGGER_STATUS() : [],
      debugger_last_detach: local.operatorDebuggerLastDetach || null,
      debugger_last_detach_at: local.operatorDebuggerLastDetachAt || null
    };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const type = String(message?.type || "");
    if (type === "A2_PROMPT_GATE_READY") {
      if (!trustedPageSender(sender, message?.platform)) {
        sendResponse({ ok: false, error: "prompt_gate_sender_invalid", mode: "OBSERVE" });
        return false;
      }
      getMode().then((mode) => sendResponse({ ok: true, mode })).catch((error) => sendResponse({ ok: false, error: String(error?.message || error), mode: "OBSERVE" }));
      return true;
    }
    if (type === "A2_PROMPT_GATE_INTENT") {
      createIntent(message, sender).then((intent) => sendResponse({ ok: true, intent_id: intent.intent_id, draft_sha256: intent.draft_sha256 }))
        .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
      return true;
    }
    if (type === "A2_PROMPT_GATE_SENSOR_ERROR") {
      if (!trustedPageSender(sender, message?.platform)) {
        sendResponse({ ok: false, error: "prompt_gate_sender_invalid" });
        return false;
      }
      saveSensorError(message, sender).then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
      return true;
    }

    if (!["A2_OPERATOR_STATUS", "A2_OPERATOR_SET_MODE", "A2_OPERATOR_SET_ARM", "A2_OPERATOR_RESOLVE_PROMPT"].includes(type)) return false;
    if (!trustedOperatorSender(sender)) {
      sendResponse({ ok: false, error: "operator_sender_not_trusted" });
      return false;
    }
    if (type === "A2_OPERATOR_STATUS") {
      operatorStatus().then((state) => sendResponse({ ok: true, state })).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
      return true;
    }
    if (type === "A2_OPERATOR_SET_MODE") {
      setMode(message?.mode).then((mode) => sendResponse({ ok: true, mode })).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
      return true;
    }
    if (type === "A2_OPERATOR_SET_ARM") {
      chrome.storage.local.set({ armed: message?.armed === true }).then(() => sendResponse({ ok: true, armed: message?.armed === true }))
        .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
      return true;
    }
    if (type === "A2_OPERATOR_RESOLVE_PROMPT") {
      resolveIntent(message).then((result) => sendResponse({ ok: true, ...result })).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
      return true;
    }
    return false;
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    heldIntent().then((intent) => {
      if (Number(intent?.tab_id) === Number(tabId)) return clearIntent();
    }).catch(() => {});
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!changeInfo.url) return;
    heldIntent().then((intent) => {
      if (Number(intent?.tab_id) !== Number(tabId)) return;
      if (normUrl(tab?.url || changeInfo.url || "") !== intent.page_url) return clearIntent();
    }).catch(() => {});
  });

  (async () => {
    const current = await chrome.storage.local.get(MODE_KEY);
    if (!MODES.has(String(current[MODE_KEY] || ""))) await chrome.storage.local.set({ [MODE_KEY]: "OBSERVE" });
    await chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});
    await broadcastMode(await getMode());
  })().catch((error) => console.error("a2_operator_control_init_failed", error));
})();
