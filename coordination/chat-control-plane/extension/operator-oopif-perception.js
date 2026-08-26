(() => {
  "use strict";

  const MAX_CHILD_FRAMES = 24;
  const MAX_BODY_CHARS = 60000;
  const MAX_AX_NODES = 320;
  const MAX_DOM_RECORDS = 600;
  const MAX_TEXT = 1600;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

  const clip = (value, max = MAX_TEXT) => {
    const text = String(value ?? "");
    return text.length <= max ? text : `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]`;
  };

  async function sha256Text(text) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text ?? "")));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function resolvePinned(platform) {
    const stored = await chrome.storage.local.get(["chatgptUrl", "zaiUrl"]);
    const configured = platform === "CHATGPT" ? normUrl(stored.chatgptUrl || "") : platform === "GLM_ZAI" ? normUrl(stored.zaiUrl || "") : "";
    if (!configured) throw new Error(`oopif_target_not_configured:${platform}`);
    const tabs = await chrome.tabs.query({});
    const matches = tabs.filter((tab) => Number.isInteger(tab?.id) && platformOf(tab.url || "") === platform && normUrl(tab.url || "") === configured);
    if (matches.length !== 1) throw new Error(matches.length ? `oopif_duplicate_target_tabs:${platform}:${matches.length}` : `oopif_target_not_found:${platform}`);
    return matches[0];
  }

  function axValue(value) {
    if (value == null) return null;
    if (typeof value !== "object") return value;
    return Object.prototype.hasOwnProperty.call(value, "value") ? value.value : null;
  }

  function compactAx(tree) {
    const nodes = Array.isArray(tree?.nodes) ? tree.nodes : [];
    return nodes.slice(0, MAX_AX_NODES).map((node) => ({
      backend_dom_node_id: node.backendDOMNodeId || null,
      ignored: node.ignored === true,
      role: axValue(node.role),
      name: clip(axValue(node.name) || ""),
      description: clip(axValue(node.description) || "", 600),
      value: clip(axValue(node.value) || "")
    }));
  }

  function decodeAttributes(strings, encoded) {
    if (!Array.isArray(encoded)) return {};
    const allowed = new Set(["id", "class", "role", "aria-label", "title", "data-testid", "contenteditable", "disabled"]);
    const out = {};
    for (let i = 0; i + 1 < encoded.length; i += 2) {
      const key = strings[encoded[i]];
      if (allowed.has(key)) out[key] = clip(strings[encoded[i + 1]] || "", 600);
    }
    return out;
  }

  function compactDom(snapshot) {
    const strings = Array.isArray(snapshot?.strings) ? snapshot.strings : [];
    const records = [];
    for (const document of Array.isArray(snapshot?.documents) ? snapshot.documents : []) {
      const nodes = document?.nodes || {}, layout = document?.layout || {};
      const indexes = Array.isArray(layout.nodeIndex) ? layout.nodeIndex : [];
      for (let li = 0; li < indexes.length && records.length < MAX_DOM_RECORDS; li += 1) {
        const ni = indexes[li];
        const name = strings[nodes.nodeName?.[ni]] || "";
        const value = strings[nodes.nodeValue?.[ni]] || "";
        const attributes = decodeAttributes(strings, nodes.attributes?.[ni]);
        if (!value.trim() && !Object.keys(attributes).length && !["BUTTON", "TEXTAREA", "INPUT", "A", "IMG"].includes(name)) continue;
        records.push({
          backend_node_id: nodes.backendNodeId?.[ni] || null,
          node_name: name,
          node_value: clip(value),
          attributes,
          bounds: Array.isArray(layout.bounds?.[li]) ? layout.bounds[li].slice(0, 4) : null
        });
      }
      if (records.length >= MAX_DOM_RECORDS) break;
    }
    return { records, record_count: records.length, truncated: records.length >= MAX_DOM_RECORDS };
  }

  const readbackExpression = `(() => {
    const bodyText=String(document.body?.innerText||'');
    return {
      url:location.href,title:document.title,visibility_state:document.visibilityState,
      body_text:bodyText.slice(0,${MAX_BODY_CHARS}),body_text_length:bodyText.length,
      body_text_truncated:bodyText.length>${MAX_BODY_CHARS},viewport:{width:innerWidth,height:innerHeight,device_pixel_ratio:devicePixelRatio}
    };
  })()`;

  async function captureChild(session, child) {
    const sessionId = String(child?.session_id || "");
    if (!sessionId) return null;
    let axEnabled = false;
    try {
      await session.sendChild(sessionId, "Runtime.enable");
      await session.sendChild(sessionId, "Accessibility.enable");
      axEnabled = true;
      const [readbackResult, axRaw, domRaw] = await Promise.all([
        session.sendChild(sessionId, "Runtime.evaluate", { expression: readbackExpression, returnByValue: true, awaitPromise: true }),
        session.sendChild(sessionId, "Accessibility.getFullAXTree", { depth: 28 }),
        session.sendChild(sessionId, "DOMSnapshot.captureSnapshot", { computedStyles: [], includePaintOrder: true, includeDOMRects: true })
      ]);
      const page = readbackResult?.result?.value || {};
      const bodyText = String(page.body_text || "");
      return {
        schema: "metaengine.a2-browser-operator.oopif-frame.v1",
        target_id: child.target_id || null,
        type: child.type || "iframe",
        url: page.url || child.url || null,
        title: page.title || "",
        visibility_state: page.visibility_state || null,
        body_text_excerpt: clip(bodyText, 12000),
        body_text_length: Number(page.body_text_length || 0),
        body_text_truncated: page.body_text_truncated === true,
        body_text_sha256: await sha256Text(bodyText),
        viewport: page.viewport || null,
        accessibility: compactAx(axRaw),
        dom_snapshot: compactDom(domRaw),
        tainted_page_data: true,
        authority_effect: false
      };
    } catch (error) {
      return { target_id: child.target_id || null, type: child.type || "iframe", url: child.url || null, error: String(error?.message || error), authority_effect: false };
    } finally {
      if (axEnabled) await session.sendChild(sessionId, "Accessibility.disable").catch(() => {});
    }
  }

  async function capture(platform) {
    const tab = await resolvePinned(platform);
    if (typeof globalThis.A2_DEBUGGER_RUN !== "function") throw new Error("oopif_debugger_broker_unavailable");
    return globalThis.A2_DEBUGGER_RUN(tab.id, `oopif-perception:${platform}`, async (session) => {
      if (typeof session.enableChildTargets !== "function" || typeof session.sendChild !== "function") throw new Error("oopif_flat_sessions_unavailable");
      let childTargetsEnabled = false;
      try {
        await session.enableChildTargets();
        childTargetsEnabled = true;
        await sleep(180);
        const children = session.childSessions().filter((child) => child?.type === "iframe").slice(0, MAX_CHILD_FRAMES);
        const frames = (await Promise.all(children.map((child) => captureChild(session, child)))).filter(Boolean);
        const capturedAt = new Date().toISOString();
        await chrome.storage.session.set({
          [`a2OperatorOopifMeta:${platform}`]: {
            schema: "metaengine.a2-browser-operator.oopif-meta.v1",
            platform, tab_id: tab.id, captured_at: capturedAt,
            child_frame_count: frames.length,
            child_error_count: frames.filter((frame) => frame?.error).length,
            authority_effect: false
          }
        });
        return {
          schema: "metaengine.a2-browser-operator.oopif-perception.v1",
          platform, tab_id: tab.id, url: normUrl(tab.url || ""), captured_at: capturedAt,
          child_frames: frames,
          child_frame_count: frames.length,
          tainted_page_data: true,
          authority_effect: false
        };
      } finally {
        if (childTargetsEnabled && typeof session.disableChildTargets === "function") await session.disableChildTargets().catch(() => {});
      }
    });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (String(message?.type || "") !== "A2_OPERATOR_CAPTURE_OOPIF") return false;
    if (!trustedOperatorSender(sender)) {
      sendResponse({ ok: false, error: "operator_sender_not_trusted" });
      return false;
    }
    const platform = String(message?.platform || "");
    if (!["CHATGPT", "GLM_ZAI"].includes(platform)) {
      sendResponse({ ok: false, error: "oopif_platform_invalid" });
      return false;
    }
    capture(platform).then((perception) => sendResponse({ ok: true, perception }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  });

  globalThis.A2_OPERATOR_CAPTURE_OOPIF = capture;
})();
