(() => {
  "use strict";

  const DEFAULT_FRAME_MAX_AGE_MS = 30000;
  const CLICKABLE_ROLES = new Set(["button", "checkbox", "radio", "switch", "tab", "menuitem"]);
  const ACTION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

  const normalize = (value) => String(value ?? "").replace(/\r\n?/g, "\n").replace(/\s+/gu, " ").trim();
  const axValue = (value) => value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "value") ? value.value : value;

  function compat(path, fallback) {
    try { return globalThis.A2_COMPAT_GET?.(path, fallback) ?? fallback; }
    catch (_) { return fallback; }
  }

  function frameMaxAgeMs() {
    const value = Number(compat("timeouts.frame_max_age_ms", DEFAULT_FRAME_MAX_AGE_MS));
    return Number.isInteger(value) && value >= 5000 && value <= 120000 ? value : DEFAULT_FRAME_MAX_AGE_MS;
  }

  function trustedOperatorSender(sender) {
    const expected = chrome.runtime.getURL("sidepanel.html");
    return sender?.id === chrome.runtime.id && typeof sender?.url === "string" && sender.url.startsWith(expected);
  }

  function platformOf(value) {
    try {
      const host = new URL(String(value || "")).hostname.toLowerCase();
      if (host === "chatgpt.com" || host === "chat.openai.com") return "CHATGPT";
      if (host === "chat.z.ai") return "GLM_ZAI";
    } catch (_) {}
    return "UNKNOWN";
  }

  function normUrl(value) {
    try {
      const url = new URL(String(value || ""));
      url.hash = "";
      url.search = "";
      url.pathname = url.pathname.replace(/\/+$/, "") || "/";
      return `${url.origin}${url.pathname}`;
    } catch (_) { return ""; }
  }

  function attributesMap(node) {
    const attrs = Array.isArray(node?.attributes) ? node.attributes : [];
    const out = {};
    for (let i = 0; i + 1 < attrs.length; i += 2) out[String(attrs[i]).toLowerCase()] = String(attrs[i + 1] ?? "");
    return out;
  }

  function quadCenter(model) {
    const quad = model?.border || model?.content || model?.padding;
    if (!Array.isArray(quad) || quad.length < 8) throw new Error("typed_click_target_box_unavailable");
    const xs = [quad[0], quad[2], quad[4], quad[6]].map(Number);
    const ys = [quad[1], quad[3], quad[5], quad[7]].map(Number);
    if ([...xs, ...ys].some((n) => !Number.isFinite(n))) throw new Error("typed_click_target_box_invalid");
    return { x: xs.reduce((a, b) => a + b, 0) / 4, y: ys.reduce((a, b) => a + b, 0) / 4 };
  }

  function typed(actionId, outcome, reasonCode, physicalDispatchStarted) {
    return Object.freeze({
      action_id: actionId,
      outcome,
      reason_code: reasonCode,
      physical_dispatch_started: physicalDispatchStarted === true,
      automatic_retry_allowed: false,
      authority_effect: false,
      actuation_eligible: false,
    });
  }

  function reason(error, fallback) {
    const raw = String(error?.message || error || fallback || "typed_click_failed");
    const token = raw.split(":", 1)[0].replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 96);
    return token || String(fallback || "typed_click_failed");
  }

  function snapshotRequest(message) {
    const actionIdRaw = message?.action_id;
    const platformRaw = message?.platform;
    const capturedAtRaw = message?.perception_captured_at;
    const roleRaw = message?.role;
    const nameRaw = message?.accessible_name;
    return Object.freeze({
      actionId: String(actionIdRaw ?? ""),
      platform: String(platformRaw ?? ""),
      capturedAt: String(capturedAtRaw ?? ""),
      role: String(roleRaw ?? ""),
      name: String(nameRaw ?? ""),
    });
  }

  function assertEnabled() {
    if (compat("kill_switches.operator_actions_disabled", false) === true) throw new Error("compat_kill_switch_operator_actions_disabled");
    if (compat("features.semantic_actions_enabled", true) !== true) throw new Error("compat_feature_semantic_actions_disabled");
  }

  function frameFor(request) {
    const frame = globalThis.A2_OPERATOR_PERCEPTION_CACHE?.get?.(request.platform) || null;
    if (!frame) throw new Error("typed_click_perception_frame_missing");
    const frameCapturedAt = String(frame.captured_at || "");
    const frameTabId = Number(frame.tab_id);
    const frameUrl = String(frame.url || "");
    const accessibility = Array.isArray(frame.accessibility) ? frame.accessibility.slice() : [];
    if (!request.capturedAt || frameCapturedAt !== request.capturedAt) throw new Error("typed_click_perception_frame_mismatch");
    const age = Date.now() - Date.parse(frameCapturedAt);
    if (!Number.isFinite(age) || age < 0 || age > frameMaxAgeMs()) throw new Error("typed_click_perception_frame_expired");
    const role = normalize(request.role).toLowerCase();
    const name = normalize(request.name);
    if (!CLICKABLE_ROLES.has(role)) throw new Error("typed_click_role_not_allowed");
    if (!name || name.length > 500) throw new Error("typed_click_accessible_name_invalid");
    const matches = accessibility.filter((node) =>
      node?.ignored !== true && Number.isInteger(Number(node?.backend_dom_node_id)) &&
      normalize(node?.role).toLowerCase() === role && normalize(node?.name) === name
    );
    if (matches.length !== 1) throw new Error(matches.length ? "typed_click_cached_target_ambiguous" : "typed_click_cached_target_not_found");
    return Object.freeze({
      tabId: frameTabId,
      url: frameUrl,
      role,
      name,
      backendNodeId: Number(matches[0].backend_dom_node_id),
    });
  }

  async function resolvePinned(platform, exactTabId) {
    const stored = await chrome.storage.local.get(["chatgptUrl", "zaiUrl"]);
    const configured = platform === "CHATGPT" ? normUrl(stored.chatgptUrl || "") : platform === "GLM_ZAI" ? normUrl(stored.zaiUrl || "") : "";
    if (!configured) throw new Error("typed_click_target_not_configured");
    const tabs = await chrome.tabs.query({});
    const matches = tabs.filter((tab) => Number.isInteger(tab?.id) && platformOf(tab.url || "") === platform && normUrl(tab.url || "") === configured);
    if (matches.length !== 1) throw new Error(matches.length ? "typed_click_duplicate_target_tabs" : "typed_click_target_tab_not_found");
    if (Number(matches[0].id) !== Number(exactTabId)) throw new Error("typed_click_tab_binding_mismatch");
    return Object.freeze({ id: Number(matches[0].id), url: String(matches[0].url || "") });
  }

  function assertNodeSafe(role, node) {
    const attrs = attributesMap(node);
    const nodeName = String(node?.nodeName || "").toUpperCase();
    const type = String(attrs.type || "").toLowerCase();
    if (Object.prototype.hasOwnProperty.call(attrs, "disabled") || String(attrs["aria-disabled"] || "").toLowerCase() === "true") throw new Error("typed_click_target_disabled");
    if (type === "file") throw new Error("typed_click_file_input_blocked");
    if (type === "password") throw new Error("typed_click_password_input_blocked");
    if (!CLICKABLE_ROLES.has(role)) throw new Error("typed_click_role_not_allowed");
    if (nodeName === "A" || attrs.href || attrs.download !== undefined) throw new Error("typed_click_navigation_or_download_blocked");
  }

  async function validateLive(session, role, name, expectedBackendNodeId) {
    const document = await session.send("DOM.getDocument", { depth: 0, pierce: true });
    const rootNodeId = Number(document?.root?.nodeId || 0);
    if (!rootNodeId) throw new Error("typed_click_dom_root_unavailable");
    const queried = await session.send("Accessibility.queryAXTree", { nodeId: rootNodeId, accessibleName: name, role });
    const matches = (Array.isArray(queried?.nodes) ? queried.nodes : []).filter((node) =>
      node?.ignored !== true && Number.isInteger(Number(node?.backendDOMNodeId)) &&
      normalize(axValue(node?.role)).toLowerCase() === role && normalize(axValue(node?.name)) === name
    );
    if (matches.length !== 1) throw new Error(matches.length ? "typed_click_live_target_ambiguous" : "typed_click_live_target_not_found");
    const backendNodeId = Number(matches[0].backendDOMNodeId);
    if (backendNodeId !== Number(expectedBackendNodeId)) throw new Error("typed_click_target_replaced_recapture_required");
    const described = await session.send("DOM.describeNode", { backendNodeId, depth: 0, pierce: true });
    if (!described?.node) throw new Error("typed_click_target_describe_failed");
    return { backendNodeId, node: described.node };
  }

  async function preparePoint(session, backendNodeId) {
    await session.send("DOM.scrollIntoViewIfNeeded", { backendNodeId }).catch(() => {});
    const box = await session.send("DOM.getBoxModel", { backendNodeId });
    const point = quadCenter(box?.model);
    const hit = await session.send("DOM.getNodeForLocation", {
      x: Math.max(0, Math.round(point.x)),
      y: Math.max(0, Math.round(point.y)),
      includeUserAgentShadowDOM: true,
      ignorePointerEventsNone: false,
    });
    if (Number(hit?.backendNodeId) !== Number(backendNodeId)) throw new Error("typed_click_target_hit_changed");
    return point;
  }

  async function run(message) {
    const request = snapshotRequest(message);
    let physicalDispatchStarted = false;
    if (!ACTION_ID.test(request.actionId)) return typed(request.actionId, "NO_EFFECT", "typed_click_action_id_invalid", false);

    try {
      assertEnabled();
      if (!["CHATGPT", "GLM_ZAI"].includes(request.platform)) throw new Error("typed_click_platform_invalid");
      const target = frameFor(request);
      const tab = await resolvePinned(request.platform, target.tabId);
      if (normUrl(tab.url) !== target.url) throw new Error("typed_click_frame_url_changed");
      if (typeof globalThis.A2_DEBUGGER_RUN !== "function") throw new Error("typed_click_debugger_broker_unavailable");

      return await globalThis.A2_DEBUGGER_RUN(tab.id, `typed-click:${request.actionId}`, async (session) => {
        let axEnabled = false;
        let domEnabled = false;
        try {
          await session.send("DOM.enable", { includeWhitespace: "none" });
          domEnabled = true;
          await session.send("Accessibility.enable");
          axEnabled = true;
          const live = await validateLive(session, target.role, target.name, target.backendNodeId);
          assertNodeSafe(target.role, live.node);
          const point = await preparePoint(session, live.backendNodeId);

          physicalDispatchStarted = true;
          try {
            await session.send("Input.dispatchMouseEvent", {
              type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1,
            });
          } catch (error) {
            return typed(request.actionId, "AMBIGUOUS", `typed_click_press_${reason(error, "failed")}`, true);
          }

          try {
            await session.send("Input.dispatchMouseEvent", {
              type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1,
            });
          } catch (error) {
            return typed(request.actionId, "AMBIGUOUS", `typed_click_release_${reason(error, "failed")}`, true);
          }

          return typed(request.actionId, "COMMITTED", "typed_click_press_release_acknowledged", true);
        } finally {
          if (axEnabled) await session.send("Accessibility.disable").catch(() => {});
          if (domEnabled) await session.send("DOM.disable").catch(() => {});
        }
      });
    } catch (error) {
      return typed(
        request.actionId,
        physicalDispatchStarted ? "AMBIGUOUS" : "NO_EFFECT",
        physicalDispatchStarted ? `typed_click_post_dispatch_${reason(error, "failed")}` : reason(error, "typed_click_pre_dispatch_failed"),
        physicalDispatchStarted,
      );
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "A2_OPERATOR_TYPED_CLICK_V1") return undefined;
    if (!trustedOperatorSender(sender)) {
      sendResponse({ ok: false, error: "operator_sender_not_trusted" });
      return false;
    }
    run(message).then((result) => sendResponse({ ok: true, result })).catch(() => {
      sendResponse({ ok: false, error: "typed_click_internal_failure" });
    });
    return true;
  });

  globalThis.A2_OPERATOR_TYPED_CLICK_V1 = run;
})();
