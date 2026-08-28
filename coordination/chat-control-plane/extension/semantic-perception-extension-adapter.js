(() => {
  "use strict";

  const META_PREFIX = "a2OperatorSemanticPerceptionMeta:";
  const MAX_AX_NODES = 2000;
  const MAX_DOM_RECORDS = 3000;
  const MAX_NODE_TEXT = 640;
  const ALLOWED_ATTRS = new Set(["id", "class", "role", "aria-label", "aria-live", "aria-busy", "title", "data-testid", "contenteditable", "disabled", "type"]);
  const cache = new Map();

  const clip = (value, max = MAX_NODE_TEXT) => {
    const text = String(value ?? "");
    return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
  };

  function trustedOperatorSender(sender) {
    const expected = chrome.runtime.getURL("sidepanel.html");
    return sender?.id === chrome.runtime.id && typeof sender?.url === "string" && sender.url.startsWith(expected);
  }

  function axValue(value) {
    if (value == null) return null;
    if (typeof value !== "object") return value;
    return Object.prototype.hasOwnProperty.call(value, "value") ? value.value : null;
  }

  function compactAccessibility(tree) {
    const nodes = Array.isArray(tree?.nodes) ? tree.nodes : [];
    return nodes.slice(0, MAX_AX_NODES).map((node) => ({
      node_id: node.nodeId || null,
      backend_dom_node_id: node.backendDOMNodeId || null,
      frame_id: node.frameId || null,
      ignored: node.ignored === true,
      role: axValue(node.role),
      name: clip(axValue(node.name) || "", 320),
      value: clip(axValue(node.value) || "", 320),
      properties: Array.isArray(node.properties)
        ? node.properties.slice(0, 32).map((property) => ({ name: property?.name || null, value: axValue(property?.value) }))
        : []
    }));
  }

  function decodeAttributes(strings, encoded) {
    const out = {};
    if (!Array.isArray(encoded)) return out;
    for (let index = 0; index + 1 < encoded.length; index += 2) {
      const key = strings[encoded[index]];
      if (!ALLOWED_ATTRS.has(key)) continue;
      out[key] = clip(strings[encoded[index + 1]] || "", 320);
    }
    return out;
  }

  function compactDomSnapshot(snapshot) {
    const strings = Array.isArray(snapshot?.strings) ? snapshot.strings : [];
    const records = [];
    const documents = Array.isArray(snapshot?.documents) ? snapshot.documents : [];
    for (let documentIndex = 0; documentIndex < documents.length && records.length < MAX_DOM_RECORDS; documentIndex += 1) {
      const document = documents[documentIndex] || {};
      const nodes = document.nodes || {};
      const layout = document.layout || {};
      const indexes = Array.isArray(layout.nodeIndex) ? layout.nodeIndex : [];
      for (let layoutIndex = 0; layoutIndex < indexes.length && records.length < MAX_DOM_RECORDS; layoutIndex += 1) {
        const nodeIndex = indexes[layoutIndex];
        const nodeName = strings[nodes.nodeName?.[nodeIndex]] || "";
        const nodeValue = strings[nodes.nodeValue?.[nodeIndex]] || "";
        const attributes = decodeAttributes(strings, nodes.attributes?.[nodeIndex]);
        if (!nodeValue && !Object.keys(attributes).length && !["BUTTON", "TEXTAREA", "INPUT", "SELECT", "OPTION", "A", "SUMMARY", "IFRAME"].includes(nodeName)) continue;
        records.push({
          document_index: documentIndex,
          node_index: nodeIndex,
          backend_node_id: nodes.backendNodeId?.[nodeIndex] || null,
          parent_index: nodes.parentIndex?.[nodeIndex] ?? null,
          node_name: nodeName,
          node_value: clip(nodeValue),
          attributes,
          bounds: Array.isArray(layout.bounds?.[layoutIndex]) ? layout.bounds[layoutIndex].slice(0, 4) : null
        });
      }
    }
    return {
      document_count: documents.length,
      visible_records: records,
      visible_record_count: records.length,
      truncated: records.length >= MAX_DOM_RECORDS
    };
  }

  async function resolveTarget(selector) {
    const registry = globalThis.A2_TARGET_REGISTRY;
    if (!registry?.resolveLiveTab) throw new Error("semantic_target_registry_unavailable");
    await Promise.resolve(registry.ready).catch(() => {});
    const resolved = await registry.resolveLiveTab(selector, { allowBind: true });
    if (!resolved?.target?.target_id || !Number.isInteger(Number(resolved?.tab?.id))) throw new Error("semantic_target_resolution_invalid");
    return resolved;
  }

  function documentEpoch(resolved, frameTree) {
    const frame = frameTree?.frameTree?.frame || frameTree?.frame || {};
    const nonce = resolved?.binding?.browser_session_nonce || "browser-session";
    return `${Number(resolved?.target?.conversation_epoch || 1)}:${nonce}:${String(frame.id || "no-frame")}:${String(frame.loaderId || "no-loader")}`;
  }

  async function persistMeta(frame, resolved) {
    await chrome.storage.session.set({
      [`${META_PREFIX}${frame.target_id}`]: {
        schema: "metaengine.a2-browser-operator.semantic-perception-meta.v1",
        target_id: frame.target_id,
        platform: resolved.target.platform,
        tab_id: Number(resolved.tab.id),
        conversation_epoch: Number(resolved.target.conversation_epoch || 0),
        document_epoch: frame.document_epoch,
        frame_id: frame.frame_id,
        captured_at: frame.captured_at,
        semantic_node_count: frame.nodes.length,
        source_node_count: frame.metrics?.source_node_count || 0,
        node_reduction_ratio: frame.metrics?.node_reduction_ratio || 0,
        ambiguity_count: frame.nodes.filter((node) => node.continuity === "AMBIGUOUS").length,
        tainted_page_data: true,
        authority_effect: false,
        semantic_authority: false
      }
    });
  }

  async function capture(selector, options = {}) {
    const resolved = await resolveTarget(selector);
    const targetId = resolved.target.target_id;
    if (typeof globalThis.A2_DEBUGGER_RUN !== "function") throw new Error("semantic_debugger_broker_unavailable");
    const compiler = globalThis.A2_SEMANTIC_PERCEPTION_COMPILER;
    if (!compiler?.compileFrame) throw new Error("semantic_compiler_unavailable");

    return globalThis.A2_DEBUGGER_RUN(Number(resolved.tab.id), `semantic-perception:${targetId}`, async (session) => {
      await session.send("Page.enable");
      let accessibilityEnabled = false;
      try {
        await session.send("Accessibility.enable");
        accessibilityEnabled = true;
        const [axRaw, domRaw, layout, frameTree] = await Promise.all([
          session.send("Accessibility.getFullAXTree", { depth: 40 }),
          session.send("DOMSnapshot.captureSnapshot", { computedStyles: [], includePaintOrder: true, includeDOMRects: true }),
          session.send("Page.getLayoutMetrics"),
          session.send("Page.getFrameTree")
        ]);
        const viewport = layout?.cssVisualViewport || layout?.cssLayoutViewport || {};
        const frame = compiler.compileFrame({
          target_id: targetId,
          context_id: "default",
          conversation_epoch: Number(resolved.target.conversation_epoch || 1),
          document_epoch: documentEpoch(resolved, frameTree),
          captured_at: new Date().toISOString(),
          page: { viewport: { width: Number(viewport.clientWidth || 0), height: Number(viewport.clientHeight || 0) } },
          accessibility: compactAccessibility(axRaw),
          dom_snapshot: compactDomSnapshot(domRaw),
          layout: {
            css_layout_viewport: layout?.cssLayoutViewport || null,
            css_visual_viewport: layout?.cssVisualViewport || null,
            content_size: layout?.cssContentSize || layout?.contentSize || null
          },
          source_hashes: {}
        }, {
          previous_frame: cache.get(targetId) || null,
          node_budget: options?.node_budget,
          task_terms: Array.isArray(options?.task_terms) ? options.task_terms : []
        });
        frame.platform = resolved.target.platform;
        frame.tab_id = Number(resolved.tab.id);
        frame.conversation_epoch = Number(resolved.target.conversation_epoch || 0);
        cache.set(targetId, frame);
        await persistMeta(frame, resolved);
        return frame;
      } finally {
        if (accessibilityEnabled) await session.send("Accessibility.disable").catch(() => {});
      }
    });
  }

  async function meta(targetId = null) {
    if (targetId) {
      const key = `${META_PREFIX}${String(targetId).toLowerCase()}`;
      const stored = await chrome.storage.session.get(key);
      return stored[key] || null;
    }
    const stored = await chrome.storage.session.get(null);
    return Object.fromEntries(Object.entries(stored || {}).filter(([key]) => key.startsWith(META_PREFIX)));
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const type = String(message?.type || "");
    if (!["A2_OPERATOR_CAPTURE_SEMANTIC_PERCEPTION", "A2_OPERATOR_SEMANTIC_PERCEPTION_META"].includes(type)) return false;
    if (!trustedOperatorSender(sender)) {
      sendResponse({ ok: false, error: "operator_sender_not_trusted" });
      return false;
    }
    if (type === "A2_OPERATOR_SEMANTIC_PERCEPTION_META") {
      meta(message?.target_id || null).then((value) => sendResponse({ ok: true, meta: value }))
        .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
      return true;
    }
    const selector = message?.target_id || message?.selector || message?.platform || "";
    if (!selector) {
      sendResponse({ ok: false, error: "semantic_target_selector_missing" });
      return false;
    }
    capture(selector, message?.options || {}).then((frame) => sendResponse({ ok: true, semantic_frame: frame }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  });

  globalThis.A2_OPERATOR_CAPTURE_SEMANTIC_PERCEPTION = capture;
  globalThis.A2_OPERATOR_SEMANTIC_PERCEPTION_CACHE = cache;
})();
