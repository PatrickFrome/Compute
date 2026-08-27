(() => {
  "use strict";

  const MAX_TEXT_CHARS = 120000;
  const DEFAULT_FRAME_MAX_AGE_MS = 30000;
  const RECEIPT_KEY = "a2OperatorLastSemanticActionV060";
  const ACTIONS = new Set(["FOCUS_SEMANTIC", "TYPE_SEMANTIC", "CLICK_SEMANTIC"]);
  const CLICKABLE_ROLES = new Set(["button", "checkbox", "radio", "switch", "tab", "menuitem"]);
  const EDITABLE_ROLES = new Set(["textbox", "searchbox", "combobox"]);
  const ALLOWED_ROLES = new Set([...CLICKABLE_ROLES, ...EDITABLE_ROLES]);

  const normalize = (value) => String(value ?? "").replace(/\r\n?/g, "\n").replace(/\s+/gu, " ").trim();
  const axValue = (value) => value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "value") ? value.value : value;

  function compat(path, fallback) {
    try { return globalThis.A2_COMPAT_GET?.(path, fallback) ?? fallback; }
    catch (_) { return fallback; }
  }
  function assertEnabled() {
    if (compat("kill_switches.operator_actions_disabled", false) === true) throw new Error("compat_kill_switch_operator_actions_disabled");
    if (compat("features.semantic_actions_enabled", true) !== true) throw new Error("compat_feature_semantic_actions_disabled");
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
  async function sha256Text(text) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text ?? "")));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  function attributesMap(node) {
    const attrs = Array.isArray(node?.attributes) ? node.attributes : [];
    const out = {};
    for (let i = 0; i + 1 < attrs.length; i += 2) out[String(attrs[i]).toLowerCase()] = String(attrs[i + 1] ?? "");
    return out;
  }
  function quadCenter(model) {
    const quad = model?.border || model?.content || model?.padding;
    if (!Array.isArray(quad) || quad.length < 8) throw new Error("semantic_target_box_unavailable");
    const xs = [quad[0], quad[2], quad[4], quad[6]].map(Number);
    const ys = [quad[1], quad[3], quad[5], quad[7]].map(Number);
    if ([...xs, ...ys].some((n) => !Number.isFinite(n))) throw new Error("semantic_target_box_invalid");
    return { x: xs.reduce((a, b) => a + b, 0) / 4, y: ys.reduce((a, b) => a + b, 0) / 4 };
  }

  async function resolvePinned(platform, exactTabId) {
    const stored = await chrome.storage.local.get(["chatgptUrl", "zaiUrl"]);
    const configured = platform === "CHATGPT" ? normUrl(stored.chatgptUrl || "") : platform === "GLM_ZAI" ? normUrl(stored.zaiUrl || "") : "";
    if (!configured) throw new Error(`semantic_target_not_configured:${platform}`);
    const tabs = await chrome.tabs.query({});
    const matches = tabs.filter((tab) => Number.isInteger(tab?.id) && platformOf(tab.url || "") === platform && normUrl(tab.url || "") === configured);
    if (matches.length !== 1) throw new Error(matches.length ? `semantic_duplicate_target_tabs:${platform}:${matches.length}` : `semantic_target_tab_not_found:${platform}`);
    if (Number(matches[0].id) !== Number(exactTabId)) throw new Error("semantic_tab_binding_mismatch");
    return matches[0];
  }

  function frameFor(platform, capturedAt, role, accessibleName) {
    const frame = globalThis.A2_OPERATOR_PERCEPTION_CACHE?.get?.(platform) || null;
    if (!frame) throw new Error("semantic_perception_frame_missing");
    if (!capturedAt || String(frame.captured_at || "") !== String(capturedAt)) throw new Error("semantic_perception_frame_mismatch");
    const age = Date.now() - Date.parse(frame.captured_at || "");
    if (!Number.isFinite(age) || age < 0 || age > frameMaxAgeMs()) throw new Error("semantic_perception_frame_expired");
    const roleKey = normalize(role).toLowerCase();
    const nameKey = normalize(accessibleName);
    if (!ALLOWED_ROLES.has(roleKey)) throw new Error("semantic_role_not_allowed");
    if (!nameKey || nameKey.length > 500) throw new Error("semantic_accessible_name_invalid");
    const matches = (Array.isArray(frame.accessibility) ? frame.accessibility : []).filter((node) =>
      node?.ignored !== true && Number.isInteger(Number(node?.backend_dom_node_id)) &&
      normalize(node?.role).toLowerCase() === roleKey && normalize(node?.name) === nameKey
    );
    if (matches.length !== 1) throw new Error(matches.length ? `semantic_cached_target_ambiguous:${matches.length}` : "semantic_cached_target_not_found");
    return { frame, role: roleKey, name: nameKey, backendNodeId: Number(matches[0].backend_dom_node_id) };
  }

  function assertNodeSafe(action, role, node) {
    const attrs = attributesMap(node);
    const nodeName = String(node?.nodeName || "").toUpperCase();
    const type = String(attrs.type || "").toLowerCase();
    if (Object.prototype.hasOwnProperty.call(attrs, "disabled") || String(attrs["aria-disabled"] || "").toLowerCase() === "true") throw new Error("semantic_target_disabled");
    if (type === "file") throw new Error("semantic_file_input_blocked");
    if (type === "password") throw new Error("semantic_password_input_blocked");
    if (action === "CLICK_SEMANTIC") {
      if (!CLICKABLE_ROLES.has(role)) throw new Error("semantic_click_role_not_allowed");
      if (nodeName === "A" || attrs.href || attrs.download !== undefined) throw new Error("semantic_navigation_or_download_blocked");
    }
    if (action === "TYPE_SEMANTIC") {
      if (!EDITABLE_ROLES.has(role)) throw new Error("semantic_type_role_not_allowed");
      const contentEditable = String(attrs.contenteditable || "").toLowerCase();
      const textControl = nodeName === "TEXTAREA" || nodeName === "INPUT" || contentEditable === "true" || contentEditable === "plaintext-only";
      if (!textControl) throw new Error("semantic_target_not_editable_dom");
    }
    return { attrs, nodeName, type };
  }

  async function focusByMouse(session, backendNodeId) {
    const box = await session.send("DOM.getBoxModel", { backendNodeId });
    const point = quadCenter(box?.model);
    const hit = await session.send("DOM.getNodeForLocation", {
      x: Math.max(0, Math.round(point.x)), y: Math.max(0, Math.round(point.y)),
      includeUserAgentShadowDOM: true, ignorePointerEventsNone: false
    });
    if (Number(hit?.backendNodeId) !== Number(backendNodeId)) throw new Error("semantic_target_hit_changed");
    await session.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1 });
    try {
      await session.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1 });
    } catch (error) {
      await session.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 0, y: 0, button: "left", buttons: 0, clickCount: 1 }).catch(() => {});
      throw new Error(`semantic_mouse_release_ambiguous:${String(error?.message || error)}`);
    }
    return point;
  }

  async function resolvedObject(session, backendNodeId) {
    const resolved = await session.send("DOM.resolveNode", { backendNodeId, objectGroup: "a2-semantic-action" });
    const objectId = String(resolved?.object?.objectId || "");
    if (!objectId) throw new Error("semantic_target_resolve_failed");
    return objectId;
  }

  async function inspectResolved(session, backendNodeId) {
    const objectId = await resolvedObject(session, backendNodeId);
    const result = await session.send("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: `function(){
        const el=this;
        const text=('value' in el ? el.value : (el.innerText || el.textContent || ''));
        const active=document.activeElement;
        return { text:String(text ?? ''), focused:active===el || !!el.contains?.(active), tag:String(el.tagName||''), type:String(el.getAttribute?.('type')||''), contenteditable:!!el.isContentEditable };
      }`,
      returnByValue: true,
      awaitPromise: true
    });
    return result?.result?.value || null;
  }

  async function validateLiveSemantic(session, role, name, expectedBackendNodeId) {
    await session.send("DOM.enable", { includeWhitespace: "none" });
    await session.send("Accessibility.enable");
    const document = await session.send("DOM.getDocument", { depth: 0, pierce: true });
    const rootNodeId = Number(document?.root?.nodeId || 0);
    if (!rootNodeId) throw new Error("semantic_dom_root_unavailable");
    const queried = await session.send("Accessibility.queryAXTree", { nodeId: rootNodeId, accessibleName: name, role });
    const matches = (Array.isArray(queried?.nodes) ? queried.nodes : []).filter((node) =>
      node?.ignored !== true && Number.isInteger(Number(node?.backendDOMNodeId)) &&
      normalize(axValue(node?.role)).toLowerCase() === role && normalize(axValue(node?.name)) === name
    );
    if (matches.length !== 1) throw new Error(matches.length ? `semantic_live_target_ambiguous:${matches.length}` : "semantic_live_target_not_found");
    const liveBackendNodeId = Number(matches[0].backendDOMNodeId);
    if (liveBackendNodeId !== Number(expectedBackendNodeId)) throw new Error("semantic_target_replaced_recapture_required");
    const described = await session.send("DOM.describeNode", { backendNodeId: liveBackendNodeId, depth: 0, pierce: true });
    if (!described?.node) throw new Error("semantic_target_describe_failed");
    return { backendNodeId: liveBackendNodeId, node: described.node };
  }

  async function persistReceipt({ action, platform, frame, role, name, backendNodeId, text, verification }) {
    const receipt = {
      schema: "metaengine.a2-browser-operator.semantic-action-receipt.v1",
      action,
      platform,
      tab_id: frame.tab_id,
      perception_captured_at: frame.captured_at,
      backend_node_id: backendNodeId,
      role,
      accessible_name_sha256: await sha256Text(name),
      text_sha256: text == null ? null : await sha256Text(text),
      text_length: text == null ? null : String(text).length,
      verification,
      recorded_at: new Date().toISOString(),
      tainted_page_data: true,
      authority_effect: false
    };
    await chrome.storage.session.set({ [RECEIPT_KEY]: receipt });
    return receipt;
  }

  async function run(message) {
    assertEnabled();
    const action = String(message?.action || "");
    const platform = String(message?.platform || "");
    if (!ACTIONS.has(action)) throw new Error("semantic_action_invalid");
    if (!["CHATGPT", "GLM_ZAI"].includes(platform)) throw new Error("semantic_platform_invalid");
    const target = frameFor(platform, message?.perception_captured_at, message?.role, message?.accessible_name);
    const tab = await resolvePinned(platform, target.frame.tab_id);
    if (normUrl(tab.url || "") !== target.frame.url) throw new Error("semantic_frame_url_changed");
    if (typeof globalThis.A2_DEBUGGER_RUN !== "function") throw new Error("semantic_debugger_broker_unavailable");

    return globalThis.A2_DEBUGGER_RUN(tab.id, `semantic:${action}:${platform}`, async (session) => {
      let axEnabled = false;
      let domEnabled = false;
      try {
        await session.send("Runtime.enable");
        const live = await validateLiveSemantic(session, target.role, target.name, target.backendNodeId);
        axEnabled = true;
        domEnabled = true;
        assertNodeSafe(action, target.role, live.node);
        const point = await focusByMouse(session, live.backendNodeId);
        const focused = await inspectResolved(session, live.backendNodeId);
        if (focused?.focused !== true) throw new Error("semantic_focus_verification_failed");

        if (action === "FOCUS_SEMANTIC") {
          const receipt = await persistReceipt({ action, platform, frame: target.frame, role: target.role, name: target.name, backendNodeId: live.backendNodeId, text: null, verification: "LIVE_AX_BACKEND_NODE_FOCUSED" });
          return { ok: true, action, platform, tab_id: tab.id, backend_node_id: live.backendNodeId, point, verification: receipt.verification, authority_effect: false };
        }

        if (action === "CLICK_SEMANTIC") {
          const receipt = await persistReceipt({ action, platform, frame: target.frame, role: target.role, name: target.name, backendNodeId: live.backendNodeId, text: null, verification: "LIVE_AX_BACKEND_NODE_CLICKED" });
          return { ok: true, action, platform, tab_id: tab.id, backend_node_id: live.backendNodeId, point, verification: receipt.verification, authority_effect: false };
        }

        const text = String(message?.text ?? "");
        if (!text || text.length > MAX_TEXT_CHARS) throw new Error("semantic_type_text_invalid");
        if (message?.replace_existing === true) {
          await session.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65 });
          await session.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65 });
        }
        await session.send("Input.insertText", { text });
        const after = await inspectResolved(session, live.backendNodeId);
        const expected = message?.replace_existing === true ? normalize(text) : null;
        if (expected != null && normalize(after?.text) !== expected) throw new Error("semantic_type_exact_readback_failed");
        const receipt = await persistReceipt({ action, platform, frame: target.frame, role: target.role, name: target.name, backendNodeId: live.backendNodeId, text, verification: message?.replace_existing === true ? "TRUSTED_TEXT_EXACT_READBACK" : "TRUSTED_TEXT_INSERTED_FOCUS_VERIFIED" });
        return { ok: true, action, platform, tab_id: tab.id, backend_node_id: live.backendNodeId, point, text_length: text.length, exact_readback: message?.replace_existing === true, verification: receipt.verification, authority_effect: false };
      } finally {
        if (axEnabled) await session.send("Accessibility.disable").catch(() => {});
        if (domEnabled) await session.send("DOM.disable").catch(() => {});
        await session.send("Runtime.releaseObjectGroup", { objectGroup: "a2-semantic-action" }).catch(() => {});
      }
    });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (String(message?.type || "") !== "A2_OPERATOR_SEMANTIC_ACTION") return false;
    if (!trustedOperatorSender(sender)) {
      sendResponse({ ok: false, error: "operator_sender_not_trusted" });
      return false;
    }
    run(message).then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  });

  globalThis.A2_OPERATOR_SEMANTIC_ACTION = run;
})();
