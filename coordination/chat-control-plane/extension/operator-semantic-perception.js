(() => {
  "use strict";

  const MAX_AX_NODES = 3000;
  const MAX_DOM_RECORDS = 4000;
  const MAX_TEXT = 640;
  const CONTEXT_ID = "extension_default";
  const cache = new Map();
  const ALLOWED_ATTRIBUTES = new Set(["id","class","role","aria-label","aria-live","aria-busy","title","data-testid","contenteditable","disabled"]);

  const clip = (value, max = MAX_TEXT) => {
    const text = String(value ?? "").replace(/\r\n?/g, "\n").trim();
    return text.length <= max ? text : text.slice(0, max);
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

  function compactAx(raw) {
    const nodes = Array.isArray(raw?.nodes) ? raw.nodes : [];
    return nodes.slice(0, MAX_AX_NODES).map((node) => ({
      node_id: node.nodeId || null,
      backend_dom_node_id: node.backendDOMNodeId ?? null,
      frame_id: node.frameId || null,
      ignored: node.ignored === true,
      role: axValue(node.role),
      name: clip(axValue(node.name) || ""),
      description: clip(axValue(node.description) || "", 320),
      value: clip(axValue(node.value) || ""),
      properties: Array.isArray(node.properties)
        ? node.properties.slice(0, 32).map((row) => ({ name: row?.name || null, value: axValue(row?.value) }))
        : []
    }));
  }

  function decodeAttributes(strings, encoded) {
    if (!Array.isArray(encoded)) return {};
    const out = {};
    for (let i = 0; i + 1 < encoded.length; i += 2) {
      const key = strings[encoded[i]];
      if (!ALLOWED_ATTRIBUTES.has(key)) continue;
      out[key] = clip(strings[encoded[i + 1]] || "", 320);
    }
    return out;
  }

  function compactDom(snapshot) {
    const strings = Array.isArray(snapshot?.strings) ? snapshot.strings : [];
    const documents = Array.isArray(snapshot?.documents) ? snapshot.documents : [];
    const records = [];
    for (let documentIndex = 0; documentIndex < documents.length && records.length < MAX_DOM_RECORDS; documentIndex += 1) {
      const document = documents[documentIndex] || {};
      const nodes = document.nodes || {};
      const layout = document.layout || {};
      const nodeIndexes = Array.isArray(layout.nodeIndex) ? layout.nodeIndex : [];
      for (let layoutIndex = 0; layoutIndex < nodeIndexes.length && records.length < MAX_DOM_RECORDS; layoutIndex += 1) {
        const nodeIndex = nodeIndexes[layoutIndex];
        const nodeName = strings[nodes.nodeName?.[nodeIndex]] || "";
        const nodeValue = strings[nodes.nodeValue?.[nodeIndex]] || "";
        const attrs = decodeAttributes(strings, nodes.attributes?.[nodeIndex]);
        if (!clip(nodeValue) && !Object.keys(attrs).length && !["BUTTON","TEXTAREA","INPUT","SELECT","OPTION","A","IMG","IFRAME","SUMMARY"].includes(nodeName)) continue;
        records.push({
          document_index: documentIndex,
          node_index: nodeIndex,
          backend_node_id: nodes.backendNodeId?.[nodeIndex] ?? null,
          parent_index: nodes.parentIndex?.[nodeIndex] ?? null,
          node_name: nodeName,
          node_value: clip(nodeValue),
          attributes: attrs,
          bounds: Array.isArray(layout.bounds?.[layoutIndex]) ? layout.bounds[layoutIndex].slice(0, 4) : null
        });
      }
    }
    return records;
  }

  async function sha256(value) {
    const bytes = new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function mainFrame(frameTree) {
    const frame = frameTree?.frameTree?.frame || null;
    if (!frame?.id) throw new Error("semantic_main_frame_unavailable");
    return frame;
  }

  async function capture(selector, options = {}) {
    const registry = globalThis.A2_TARGET_REGISTRY;
    const compiler = globalThis.A2_SEMANTIC_PERCEPTION;
    if (!registry?.resolveLiveTab) throw new Error("semantic_target_registry_unavailable");
    if (typeof compiler?.compileSemanticFrame !== "function") throw new Error("semantic_compiler_unavailable");
    if (typeof globalThis.A2_DEBUGGER_RUN !== "function") throw new Error("semantic_debugger_broker_unavailable");

    const resolved = await registry.resolveLiveTab(selector, { allowBind: true });
    const target = resolved?.target;
    const tab = resolved?.tab;
    if (!target?.target_id || !Number.isInteger(Number(tab?.id))) throw new Error("semantic_target_resolution_failed");
    const binding = resolved?.binding || await registry.getBinding(target.target_id);
    if (!binding || Number(binding.tab_id) !== Number(tab.id)) throw new Error("semantic_target_tab_binding_mismatch");
    if (Number(binding.conversation_epoch || 0) !== Number(target.conversation_epoch || 0)) throw new Error("semantic_target_epoch_binding_mismatch");

    return globalThis.A2_DEBUGGER_RUN(Number(tab.id), `semantic-perception:${target.target_id}`, async (session) => {
      let accessibilityEnabled = false;
      try {
        await session.send("Page.enable");
        await session.send("Accessibility.enable");
        accessibilityEnabled = true;
        const [frameTree, axRaw, domRaw, layout] = await Promise.all([
          session.send("Page.getFrameTree"),
          session.send("Accessibility.getFullAXTree", { depth: 40 }),
          session.send("DOMSnapshot.captureSnapshot", { computedStyles: [], includePaintOrder: false, includeDOMRects: true }),
          session.send("Page.getLayoutMetrics")
        ]);
        const frame = mainFrame(frameTree);
        const accessibility = compactAx(axRaw);
        const domRecords = compactDom(domRaw);
        const documentEpoch = `${frame.id}:${frame.loaderId || "loader-unavailable"}`;
        const raw = {
          frame_id: `extension_${crypto.randomUUID()}`,
          target_id: target.target_id,
          context_id: CONTEXT_ID,
          document_epoch: documentEpoch,
          captured_at: new Date().toISOString(),
          source_hashes: {
            ax_sha256: await sha256(accessibility),
            dom_sha256: await sha256(domRecords),
            document_loader_id: frame.loaderId || null,
            main_frame_id: frame.id
          },
          viewport: layout?.cssVisualViewport || layout?.cssLayoutViewport || null,
          accessibility,
          dom_snapshot: { visible_records: domRecords }
        };
        const previousFrame = cache.get(target.target_id) || null;
        const semantic = compiler.compileSemanticFrame(raw, {
          previousFrame,
          maxNodes: options.max_nodes ?? options.maxNodes ?? 60,
          taskText: clip(options.task_text ?? options.taskText ?? "", 4000)
        });
        semantic.adapter = {
          surface: "A2_CHROME_EXTENSION",
          transport: "CHROME_DEBUGGER_CDP",
          page_script_evaluation: false,
          raw_cdp_exposed: false,
          source_frame_url_sha256: await sha256(frame.url || "")
        };
        semantic.target = {
          target_id: target.target_id,
          platform: target.platform,
          conversation_epoch: target.conversation_epoch,
          context_id: CONTEXT_ID
        };
        cache.set(target.target_id, semantic);
        await chrome.storage.session.set({
          [`a2SemanticPerceptionMeta:${target.target_id}`]: {
            schema: semantic.schema,
            target_id: target.target_id,
            context_id: CONTEXT_ID,
            conversation_epoch: target.conversation_epoch,
            document_epoch: semantic.document_epoch,
            captured_at: semantic.captured_at,
            emitted_node_count: semantic.nodes.length,
            ambiguous_nodes: semantic.metrics?.ambiguous_nodes || 0,
            raw_observation_bytes: semantic.metrics?.raw_observation_bytes || 0,
            semantic_frame_bytes: semantic.metrics?.semantic_frame_bytes || 0,
            tainted_page_data: true,
            authority_effect: false,
            page_script_evaluation: false
          }
        });
        return semantic;
      } finally {
        if (accessibilityEnabled) await session.send("Accessibility.disable").catch(() => {});
      }
    });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const type = String(message?.type || "");
    if (!["A2_OPERATOR_SEMANTIC_CAPTURE", "A2_OPERATOR_SEMANTIC_PREVIEW"].includes(type)) return false;
    if (!trustedOperatorSender(sender)) {
      sendResponse({ ok: false, error: "semantic_operator_sender_not_trusted" });
      return false;
    }
    const selector = message?.target_id || message?.selector || message?.platform || "";
    if (!selector) {
      sendResponse({ ok: false, error: "semantic_target_selector_missing" });
      return false;
    }
    if (type === "A2_OPERATOR_SEMANTIC_PREVIEW") {
      const targetId = String(message?.target_id || "").toLowerCase();
      const cached = targetId ? cache.get(targetId) : null;
      if (!cached) { sendResponse({ ok: false, error: "semantic_perception_cache_empty" }); return false; }
      sendResponse({ ok: true, semantic: cached });
      return false;
    }
    capture(selector, message?.options || {}).then((semantic) => sendResponse({ ok: true, semantic }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  });

  globalThis.A2_OPERATOR_SEMANTIC_CAPTURE = capture;
  globalThis.A2_OPERATOR_SEMANTIC_CACHE = cache;
})();
