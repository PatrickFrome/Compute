(() => {
  "use strict";

  const CDP_VERSION = "1.3";
  const MAX_BODY_TEXT = 500000;
  const MAX_AX_NODES = 1600;
  const MAX_DOM_NODES = 2400;
  const MAX_NODE_TEXT = 1800;
  const cache = new Map();

  const normalize = (value) => String(value ?? "").replace(/\r\n?/g, "\n").trim();
  const clip = (value, max) => {
    const text = String(value ?? "");
    return text.length <= max ? text : `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]`;
  };

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

  async function sha256Bytes(bytes) {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function sha256Text(text) {
    return sha256Bytes(new TextEncoder().encode(String(text ?? "")));
  }

  async function resolvePinned(platform) {
    const stored = await chrome.storage.local.get(["chatgptUrl", "zaiUrl"]);
    const configured = platform === "CHATGPT" ? normUrl(stored.chatgptUrl || "") : platform === "GLM_ZAI" ? normUrl(stored.zaiUrl || "") : "";
    if (!configured) throw new Error(`perception_target_not_configured:${platform}`);
    const tabs = await chrome.tabs.query({});
    const matches = tabs.filter((tab) => Number.isInteger(tab?.id) && platformOf(tab.url || "") === platform && normUrl(tab.url || "") === configured);
    if (matches.length !== 1) throw new Error(matches.length ? `perception_duplicate_target_tabs:${platform}:${matches.length}` : `perception_target_tab_not_found:${platform}`);
    return matches[0];
  }

  async function send(tabId, method, params = {}) {
    return chrome.debugger.sendCommand({ tabId }, method, params);
  }

  async function attachExclusive(tabId) {
    const targets = await chrome.debugger.getTargets();
    const target = targets.find((item) => Number(item?.tabId) === Number(tabId));
    if (target?.attached) throw new Error("perception_debugger_target_busy");
    await chrome.debugger.attach({ tabId }, CDP_VERSION);
  }

  async function detach(tabId) {
    await chrome.debugger.detach({ tabId }).catch(() => {});
  }

  function axValue(value) {
    if (value == null) return null;
    if (typeof value !== "object") return value;
    if (Object.prototype.hasOwnProperty.call(value, "value")) return value.value;
    return null;
  }

  function compactAx(tree) {
    const nodes = Array.isArray(tree?.nodes) ? tree.nodes : [];
    return nodes.slice(0, MAX_AX_NODES).map((node) => ({
      node_id: node.nodeId || null,
      backend_dom_node_id: node.backendDOMNodeId || null,
      ignored: node.ignored === true,
      role: axValue(node.role),
      name: clip(axValue(node.name) || "", MAX_NODE_TEXT),
      description: clip(axValue(node.description) || "", 800),
      value: clip(axValue(node.value) || "", MAX_NODE_TEXT),
      properties: Array.isArray(node.properties)
        ? node.properties.slice(0, 24).map((property) => ({ name: property?.name || null, value: axValue(property?.value) }))
        : [],
      child_ids: Array.isArray(node.childIds) ? node.childIds.slice(0, 120) : []
    }));
  }

  function decodeAttributes(strings, encoded) {
    if (!Array.isArray(encoded)) return {};
    const out = {};
    for (let i = 0; i + 1 < encoded.length; i += 2) {
      const key = strings[encoded[i]];
      if (!["id", "class", "role", "aria-label", "aria-live", "aria-busy", "title", "data-testid", "contenteditable", "disabled"].includes(key)) continue;
      out[key] = clip(strings[encoded[i + 1]] || "", 800);
    }
    return out;
  }

  function compactDom(snapshot) {
    const strings = Array.isArray(snapshot?.strings) ? snapshot.strings : [];
    const records = [];
    const documents = Array.isArray(snapshot?.documents) ? snapshot.documents : [];
    for (let documentIndex = 0; documentIndex < documents.length && records.length < MAX_DOM_NODES; documentIndex += 1) {
      const document = documents[documentIndex] || {};
      const nodes = document.nodes || {};
      const layout = document.layout || {};
      const nodeIndexes = Array.isArray(layout.nodeIndex) ? layout.nodeIndex : [];
      for (let layoutIndex = 0; layoutIndex < nodeIndexes.length && records.length < MAX_DOM_NODES; layoutIndex += 1) {
        const nodeIndex = nodeIndexes[layoutIndex];
        const name = strings[nodes.nodeName?.[nodeIndex]] || "";
        const value = strings[nodes.nodeValue?.[nodeIndex]] || "";
        const attrs = decodeAttributes(strings, nodes.attributes?.[nodeIndex]);
        if (!normalize(value) && !Object.keys(attrs).length && !["BUTTON", "TEXTAREA", "INPUT", "A", "IMG", "IFRAME"].includes(name)) continue;
        records.push({
          document_index: documentIndex,
          node_index: nodeIndex,
          backend_node_id: nodes.backendNodeId?.[nodeIndex] || null,
          parent_index: nodes.parentIndex?.[nodeIndex] ?? null,
          node_name: name,
          node_value: clip(value, MAX_NODE_TEXT),
          attributes: attrs,
          bounds: Array.isArray(layout.bounds?.[layoutIndex]) ? layout.bounds[layoutIndex].slice(0, 4) : null
        });
      }
    }
    return {
      document_count: documents.length,
      string_count: strings.length,
      visible_records: records,
      visible_record_count: records.length,
      truncated: records.length >= MAX_DOM_NODES
    };
  }

  async function pageReadback(tabId) {
    const expression = `(() => {
      const active = document.activeElement;
      const rect = active instanceof Element ? active.getBoundingClientRect() : null;
      const bodyText = String(document.body?.innerText || '');
      const selection = String(getSelection?.()?.toString?.() || '');
      return {
        url: location.href,
        title: document.title,
        visibility_state: document.visibilityState,
        has_focus: document.hasFocus(),
        body_text: bodyText.slice(0, ${MAX_BODY_TEXT}),
        body_text_length: bodyText.length,
        body_text_truncated: bodyText.length > ${MAX_BODY_TEXT},
        selection_text: selection.slice(0, 20000),
        scroll: { x: scrollX, y: scrollY },
        viewport: { width: innerWidth, height: innerHeight, device_pixel_ratio: devicePixelRatio },
        active_element: active instanceof Element ? {
          tag: active.tagName,
          id: active.id || null,
          role: active.getAttribute('role'),
          aria_label: active.getAttribute('aria-label'),
          data_testid: active.getAttribute('data-testid'),
          contenteditable: active.getAttribute('contenteditable'),
          bounds: rect ? [rect.x, rect.y, rect.width, rect.height] : null
        } : null
      };
    })()`;
    const result = await send(tabId, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result?.exceptionDetails) throw new Error("perception_runtime_readback_failed");
    return result?.result?.value || null;
  }

  async function capture(platform) {
    const tab = await resolvePinned(platform);
    let attached = false;
    try {
      await attachExclusive(tab.id);
      attached = true;
      await Promise.all([
        send(tab.id, "Runtime.enable"),
        send(tab.id, "Page.enable"),
        send(tab.id, "Accessibility.enable")
      ]);
      const [readback, axRaw, domRaw, layout, screenshot] = await Promise.all([
        pageReadback(tab.id),
        send(tab.id, "Accessibility.getFullAXTree", { depth: 40 }),
        send(tab.id, "DOMSnapshot.captureSnapshot", { computedStyles: [], includePaintOrder: true, includeDOMRects: true }),
        send(tab.id, "Page.getLayoutMetrics"),
        send(tab.id, "Page.captureScreenshot", { format: "jpeg", quality: 78, fromSurface: true, captureBeyondViewport: false, optimizeForSpeed: true })
      ]);
      const screenshotBase64 = String(screenshot?.data || "");
      const binary = screenshotBase64 ? Uint8Array.from(atob(screenshotBase64), (c) => c.charCodeAt(0)) : new Uint8Array();
      const bodyText = String(readback?.body_text || "");
      const result = {
        schema: "metaengine.a2-browser-operator.perception.v1",
        platform,
        tab_id: tab.id,
        url: normUrl(tab.url || ""),
        captured_at: new Date().toISOString(),
        tainted_page_data: true,
        authority_effect: false,
        page: readback,
        accessibility: compactAx(axRaw),
        dom_snapshot: compactDom(domRaw),
        layout: {
          css_layout_viewport: layout?.cssLayoutViewport || null,
          css_visual_viewport: layout?.cssVisualViewport || null,
          content_size: layout?.contentSize || null
        },
        hashes: {
          body_text_sha256: await sha256Text(bodyText),
          screenshot_sha256: await sha256Bytes(binary)
        },
        screenshot: {
          mime: "image/jpeg",
          base64: screenshotBase64,
          bytes: binary.byteLength
        }
      };
      cache.set(platform, result);
      await chrome.storage.session.set({
        [`a2OperatorPerceptionMeta:${platform}`]: {
          schema: result.schema,
          platform,
          tab_id: result.tab_id,
          url: result.url,
          captured_at: result.captured_at,
          body_text_length: readback?.body_text_length || 0,
          body_text_truncated: readback?.body_text_truncated === true,
          ax_node_count: result.accessibility.length,
          dom_visible_record_count: result.dom_snapshot.visible_record_count,
          screenshot_bytes: result.screenshot.bytes,
          body_text_sha256: result.hashes.body_text_sha256,
          screenshot_sha256: result.hashes.screenshot_sha256,
          authority_effect: false
        }
      });
      return result;
    } finally {
      if (attached) await detach(tab.id);
    }
  }

  async function perceptionMeta() {
    const stored = await chrome.storage.session.get(["a2OperatorPerceptionMeta:CHATGPT", "a2OperatorPerceptionMeta:GLM_ZAI"]);
    return {
      CHATGPT: stored["a2OperatorPerceptionMeta:CHATGPT"] || null,
      GLM_ZAI: stored["a2OperatorPerceptionMeta:GLM_ZAI"] || null
    };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const type = String(message?.type || "");
    if (!["A2_OPERATOR_CAPTURE_PERCEPTION", "A2_OPERATOR_PERCEPTION_META"].includes(type)) return false;
    if (!trustedOperatorSender(sender)) {
      sendResponse({ ok: false, error: "operator_sender_not_trusted" });
      return false;
    }
    if (type === "A2_OPERATOR_PERCEPTION_META") {
      perceptionMeta().then((meta) => sendResponse({ ok: true, meta })).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
      return true;
    }
    const platform = String(message?.platform || "");
    if (!["CHATGPT", "GLM_ZAI"].includes(platform)) {
      sendResponse({ ok: false, error: "perception_platform_invalid" });
      return false;
    }
    capture(platform).then((perception) => sendResponse({ ok: true, perception })).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  });

  globalThis.A2_OPERATOR_CAPTURE_PERCEPTION = capture;
  globalThis.A2_OPERATOR_PERCEPTION_CACHE = cache;
})();
