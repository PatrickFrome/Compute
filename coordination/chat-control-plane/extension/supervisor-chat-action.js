(() => {
  "use strict";

  const MODE_KEY = "a2SupervisorModeV1";
  const LAST_ACTION_KEY = "a2SupervisorLastChatActionV1";
  const MARKER = "A2_SUPERVISOR_ACTION";
  const MODES = new Set(["OFF", "MONITOR", "CONTROL"]);
  const ACTIONS = new Set([
    "ARM", "DISARM", "SET_SUPERVISOR_MODE", "SET_MODE", "POLL", "CAPTURE",
    "STOP_GENERATION", "SCROLL", "SEMANTIC_FOCUS", "SEMANTIC_TYPE", "RESOLVE_PROMPT"
  ]);
  const BOOTSTRAP_ACTIONS = new Set(["ARM", "DISARM", "SET_SUPERVISOR_MODE"]);
  const SAFE_ROLES = new Set(["textbox", "searchbox", "combobox", "button", "checkbox", "radio", "switch", "tab", "menuitem"]);
  const MAX_JSON_CHARS = 4096;
  const MAX_TEXT_CHARS = 120000;

  const normalize = (value) => String(value ?? "").replace(/\r\n?/g, "\n").trim();
  const clip = (value, max = 240) => String(value ?? "").slice(0, max);

  function safeError(error) {
    return clip(String(error?.message || error || "supervisor_chat_action_failed").replace(/https?:\/\/\S+/giu, "URL"), 240);
  }

  async function mode() {
    const x = await chrome.storage.session.get(MODE_KEY);
    const value = String(x[MODE_KEY] || "OFF").toUpperCase();
    return MODES.has(value) ? value : "OFF";
  }

  function extractJson(text) {
    const raw = String(text || "");
    const markerIndex = raw.lastIndexOf(MARKER);
    if (markerIndex < 0) return null;
    const tail = raw.slice(markerIndex + MARKER.length).trimStart();
    if (!tail) throw new Error("supervisor_chat_action_payload_missing");

    if (tail.startsWith("```")) {
      const firstBreak = tail.indexOf("\n");
      if (firstBreak < 0) throw new Error("supervisor_chat_action_fence_invalid");
      const rest = tail.slice(firstBreak + 1);
      const end = rest.indexOf("```");
      if (end < 0) throw new Error("supervisor_chat_action_fence_unclosed");
      const candidate = rest.slice(0, end).trim();
      if (!candidate || candidate.length > MAX_JSON_CHARS) throw new Error("supervisor_chat_action_json_size_invalid");
      return candidate;
    }

    const line = tail.split("\n").find((value) => normalize(value));
    if (!line || line.length > MAX_JSON_CHARS) throw new Error("supervisor_chat_action_json_size_invalid");
    return line.trim();
  }

  function parseAction(text) {
    const candidate = extractJson(text);
    if (candidate == null) return null;
    let value;
    try { value = JSON.parse(candidate); }
    catch (_) { throw new Error("supervisor_chat_action_json_invalid"); }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("supervisor_chat_action_object_required");
    const keys = Object.keys(value);
    if (keys.some((key) => !["action", "platform", "payload"].includes(key))) throw new Error("supervisor_chat_action_unknown_field");
    const action = String(value.action || "").toUpperCase();
    if (!ACTIONS.has(action)) throw new Error("supervisor_chat_action_not_allowed");
    const platform = value.platform == null ? null : String(value.platform).toUpperCase();
    if (platform != null && !["CHATGPT", "GLM_ZAI"].includes(platform)) throw new Error("supervisor_chat_action_platform_invalid");
    const payload = value.payload == null ? {} : value.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("supervisor_chat_action_payload_invalid");
    return { action, platform, payload };
  }

  function validatePayload(command) {
    const { action, platform, payload } = command;
    const allowedPayload = {
      ARM: [], DISARM: [], POLL: [], CAPTURE: [], STOP_GENERATION: [],
      SET_SUPERVISOR_MODE: ["mode"], SET_MODE: ["mode"], SCROLL: ["delta_y"],
      SEMANTIC_FOCUS: ["role", "accessible_name"],
      SEMANTIC_TYPE: ["role", "accessible_name", "text", "replace_existing"],
      RESOLVE_PROMPT: ["action", "draft"]
    }[action];
    if (Object.keys(payload).some((key) => !allowedPayload.includes(key))) throw new Error("supervisor_chat_action_payload_unknown_field");
    if (["CAPTURE", "STOP_GENERATION", "SCROLL", "SEMANTIC_FOCUS", "SEMANTIC_TYPE"].includes(action) && !platform) throw new Error("supervisor_chat_action_platform_required");
    if (!["CAPTURE", "STOP_GENERATION", "SCROLL", "SEMANTIC_FOCUS", "SEMANTIC_TYPE"].includes(action) && platform) throw new Error("supervisor_chat_action_platform_unexpected");

    if (action === "SET_SUPERVISOR_MODE" && !MODES.has(String(payload.mode || "").toUpperCase())) throw new Error("supervisor_chat_mode_invalid");
    if (action === "SET_MODE" && !["OBSERVE", "GATE_SEND"].includes(String(payload.mode || "").toUpperCase())) throw new Error("supervisor_chat_operator_mode_invalid");
    if (action === "SCROLL") {
      const delta = Number(payload.delta_y);
      if (!Number.isFinite(delta) || Math.abs(delta) > 5000) throw new Error("supervisor_chat_scroll_invalid");
    }
    if (["SEMANTIC_FOCUS", "SEMANTIC_TYPE"].includes(action)) {
      const role = normalize(payload.role).toLowerCase();
      const name = normalize(payload.accessible_name);
      if (!SAFE_ROLES.has(role) || !name || name.length > 500) throw new Error("supervisor_chat_semantic_target_invalid");
      if (action === "SEMANTIC_TYPE") {
        const text = String(payload.text ?? "");
        if (!text || text.length > MAX_TEXT_CHARS) throw new Error("supervisor_chat_semantic_text_invalid");
      }
    }
    if (action === "RESOLVE_PROMPT") {
      const resolution = String(payload.action || "CANCEL").toUpperCase();
      if (!["CANCEL", "ALLOW_ONCE", "REWRITE_ALLOW_ONCE"].includes(resolution)) throw new Error("supervisor_chat_prompt_resolution_invalid");
      if (resolution === "REWRITE_ALLOW_ONCE" && !normalize(payload.draft)) throw new Error("supervisor_chat_prompt_rewrite_empty");
    }
    return command;
  }

  async function broadcastPromptMode(next) {
    const tabs = await chrome.tabs.query({});
    await Promise.allSettled(tabs.filter((tab) => Number.isInteger(tab?.id) && (() => {
      try { const host = new URL(tab.url || "").hostname.toLowerCase(); return ["chatgpt.com", "chat.openai.com", "chat.z.ai"].includes(host); }
      catch (_) { return false; }
    })()).map((tab) => chrome.tabs.sendMessage(tab.id, { type: "A2_PROMPT_GATE_CONFIG", mode: next })));
  }

  async function setOperatorMode(nextRaw) {
    const next = String(nextRaw || "").toUpperCase();
    if (!["OBSERVE", "GATE_SEND"].includes(next)) throw new Error("supervisor_chat_operator_mode_invalid");
    if (next === "OBSERVE") await chrome.storage.session.remove("a2OperatorHeldPromptIntentV060");
    await chrome.storage.local.set({ operatorMode: next });
    await broadcastPromptMode(next);
    return { mode: next };
  }

  async function semantic(action, command) {
    if (typeof globalThis.A2_OPERATOR_CAPTURE_PERCEPTION !== "function" || typeof globalThis.A2_OPERATOR_SEMANTIC_ACTION !== "function") throw new Error("supervisor_chat_semantic_runtime_unavailable");
    const frame = await globalThis.A2_OPERATOR_CAPTURE_PERCEPTION(command.platform);
    const role = normalize(command.payload.role).toLowerCase();
    const name = normalize(command.payload.accessible_name);
    const rows = Array.isArray(frame?.accessibility) ? frame.accessibility : [];
    const matches = rows.filter((node) => node?.ignored !== true && normalize(node?.role).toLowerCase() === role && normalize(node?.name) === name && Number.isInteger(Number(node?.backend_dom_node_id)));
    if (matches.length !== 1) throw new Error(matches.length ? `supervisor_chat_semantic_target_ambiguous:${matches.length}` : "supervisor_chat_semantic_target_not_found");
    const message = { action, platform: command.platform, perception_captured_at: frame.captured_at, role, accessible_name: name };
    if (action === "TYPE_SEMANTIC") {
      message.text = String(command.payload.text);
      message.replace_existing = command.payload.replace_existing !== false;
    }
    return globalThis.A2_OPERATOR_SEMANTIC_ACTION(message);
  }

  async function resolvePrompt(command) {
    const x = await chrome.storage.session.get("a2OperatorHeldPromptIntentV060");
    const intent = x.a2OperatorHeldPromptIntentV060 || null;
    if (!intent?.intent_id || !Number.isInteger(Number(intent.tab_id))) throw new Error("supervisor_chat_no_held_prompt");
    const action = String(command.payload.action || "CANCEL").toUpperCase();
    let pageAction = action;
    let draft = intent.original_draft;
    if (action === "REWRITE_ALLOW_ONCE") {
      draft = String(command.payload.draft || "");
      if (typeof globalThis.A2_OPERATOR_TRUSTED_REPLACE_DRAFT !== "function") throw new Error("supervisor_chat_prompt_rewrite_unavailable");
      const rewrite = await globalThis.A2_OPERATOR_TRUSTED_REPLACE_DRAFT(intent.tab_id, intent.platform, draft);
      if (rewrite?.exact_readback !== true) throw new Error("supervisor_chat_prompt_rewrite_readback_failed");
      pageAction = "ALLOW_ONCE";
    }
    const response = await chrome.tabs.sendMessage(intent.tab_id, { type: "A2_PROMPT_GATE_RESOLUTION", intent_id: intent.intent_id, action: pageAction, draft });
    if (!response?.ok) throw new Error(response?.error || "supervisor_chat_prompt_resolution_failed");
    await chrome.storage.session.remove("a2OperatorHeldPromptIntentV060");
    return { action, page_action: pageAction };
  }

  async function execute(command) {
    validatePayload(command);
    const currentMode = await mode();
    if (currentMode !== "CONTROL" && !BOOTSTRAP_ACTIONS.has(command.action)) throw new Error(`supervisor_chat_control_required:${currentMode}`);

    if (command.action === "SET_SUPERVISOR_MODE") {
      const next = String(command.payload.mode || "").toUpperCase();
      await chrome.storage.session.set({ [MODE_KEY]: next });
      if (next === "OFF") await chrome.storage.local.set({ armed: false });
      return { supervisor_mode: next };
    }
    if (command.action === "ARM") { await chrome.storage.local.set({ armed: true }); return { armed: true }; }
    if (command.action === "DISARM") { await chrome.storage.local.set({ armed: false }); return { armed: false }; }
    if (command.action === "SET_MODE") return setOperatorMode(command.payload.mode);
    if (command.action === "POLL") {
      if (typeof globalThis.A2_BRIDGE_POLL_NOW !== "function") throw new Error("supervisor_chat_poll_unavailable");
      return globalThis.A2_BRIDGE_POLL_NOW();
    }
    if (command.action === "CAPTURE") {
      if (typeof globalThis.A2_OPERATOR_CAPTURE_PERCEPTION !== "function") throw new Error("supervisor_chat_capture_unavailable");
      const frame = await globalThis.A2_OPERATOR_CAPTURE_PERCEPTION(command.platform);
      return { platform: command.platform, captured_at: frame?.captured_at || null, frame_token: frame?.frame_token || null };
    }
    if (command.action === "STOP_GENERATION") {
      if (typeof globalThis.A2_OPERATOR_STOP_GENERATION !== "function") throw new Error("supervisor_chat_stop_unavailable");
      return globalThis.A2_OPERATOR_STOP_GENERATION(command.platform);
    }
    if (command.action === "SCROLL") {
      if (typeof globalThis.A2_OPERATOR_SCROLL !== "function") throw new Error("supervisor_chat_scroll_unavailable");
      return globalThis.A2_OPERATOR_SCROLL(command.platform, Number(command.payload.delta_y));
    }
    if (command.action === "SEMANTIC_FOCUS") return semantic("FOCUS_SEMANTIC", command);
    if (command.action === "SEMANTIC_TYPE") return semantic("TYPE_SEMANTIC", command);
    if (command.action === "RESOLVE_PROMPT") return resolvePrompt(command);
    throw new Error("supervisor_chat_action_unreachable");
  }

  function latestAssistantText(row) {
    const messages = Array.isArray(row?.snapshot?.messages) ? row.snapshot.messages : [];
    const assistant = [...messages].reverse().find((message) => String(message?.role || "").toLowerCase() === "assistant");
    return assistant ? String(assistant.text || "") : "";
  }

  async function processResponse(incident, row = null) {
    const snapshotRow = row || (typeof globalThis.A2_SUPERVISOR_CHAT_SNAPSHOT === "function" ? await globalThis.A2_SUPERVISOR_CHAT_SNAPSHOT().catch(() => null) : null);
    const text = latestAssistantText(snapshotRow);
    let command = null;
    try { command = parseAction(text); }
    catch (error) {
      const receipt = { schema: "metaengine.a2-browser-supervisor.chat-action-receipt.v1", incident_id: incident?.incident_id || null, detected: true, ok: false, error_code: safeError(error), recorded_at: new Date().toISOString() };
      await chrome.storage.local.set({ [LAST_ACTION_KEY]: receipt });
      return receipt;
    }
    if (!command) {
      const receipt = { schema: "metaengine.a2-browser-supervisor.chat-action-receipt.v1", incident_id: incident?.incident_id || null, detected: false, ok: true, recorded_at: new Date().toISOString() };
      await chrome.storage.local.set({ [LAST_ACTION_KEY]: receipt });
      return receipt;
    }

    try {
      const result = await execute(command);
      const receipt = {
        schema: "metaengine.a2-browser-supervisor.chat-action-receipt.v1",
        incident_id: incident?.incident_id || null,
        detected: true,
        ok: true,
        action: command.action,
        platform: command.platform,
        authority_effect: ["ARM", "DISARM", "SET_SUPERVISOR_MODE", "SET_MODE", "STOP_GENERATION", "SCROLL", "SEMANTIC_FOCUS", "SEMANTIC_TYPE", "RESOLVE_PROMPT"].includes(command.action),
        result_meta: {
          armed: typeof result?.armed === "boolean" ? result.armed : null,
          supervisor_mode: result?.supervisor_mode || null,
          mode: result?.mode || null,
          captured_at: result?.captured_at || null,
          verification: result?.verification || null
        },
        recorded_at: new Date().toISOString()
      };
      await chrome.storage.local.set({ [LAST_ACTION_KEY]: receipt });
      if (typeof globalThis.A2_SUPERVISOR_POLL === "function") globalThis.A2_SUPERVISOR_POLL().catch(() => {});
      return receipt;
    } catch (error) {
      const receipt = {
        schema: "metaengine.a2-browser-supervisor.chat-action-receipt.v1",
        incident_id: incident?.incident_id || null,
        detected: true,
        ok: false,
        action: command.action,
        platform: command.platform,
        authority_effect: false,
        error_code: safeError(error),
        recorded_at: new Date().toISOString()
      };
      await chrome.storage.local.set({ [LAST_ACTION_KEY]: receipt });
      return receipt;
    }
  }

  globalThis.A2_SUPERVISOR_CHAT_PROCESS_RESPONSE = processResponse;
  globalThis.A2_SUPERVISOR_CHAT_PARSE_ACTION = parseAction;
})();