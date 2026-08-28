(() => {
  "use strict";

  const API_SCHEMA = "metaengine.a2-semantic-perception-compiler.v1";
  const FRAME_SCHEMA = "metaengine.a2-semantic-frame.v1";
  const DEFAULT_NODE_BUDGET = 80;
  const MAX_NODE_BUDGET = 200;
  const INTERACTIVE_ROLES = new Set([
    "button", "link", "textbox", "searchbox", "combobox", "checkbox", "radio", "switch",
    "menuitem", "menuitemcheckbox", "menuitemradio", "tab", "option", "slider", "spinbutton",
    "treeitem", "gridcell"
  ]);
  const EDITABLE_ROLES = new Set(["textbox", "searchbox", "combobox", "spinbutton"]);
  const CLICKABLE_TAGS = new Set(["BUTTON", "A", "SUMMARY", "OPTION"]);

  const clip = (value, max = 320) => {
    const text = String(value ?? "");
    return text.length <= max ? text : text.slice(0, Math.max(0, max - 1)) + "…";
  };

  const normText = (value) => String(value ?? "")
    .normalize?.("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase() || "";

  const stableHash = (value) => {
    const text = String(value ?? "");
    let h1 = 0x811c9dc5 >>> 0;
    let h2 = 0x9e3779b9 >>> 0;
    for (let i = 0; i < text.length; i += 1) {
      const code = text.charCodeAt(i);
      h1 ^= code;
      h1 = Math.imul(h1, 0x01000193) >>> 0;
      h2 ^= (code + ((i + 1) * 131)) >>> 0;
      h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
      h2 = (h2 ^ (h2 >>> 13)) >>> 0;
    }
    return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
  };

  const boolish = (value) => {
    if (value === true || value === 1) return true;
    const text = String(value ?? "").toLowerCase();
    return text === "true" || text === "1" || text === "yes" || text === "on";
  };

  const normalizedRole = (value) => normText(value).replace(/\s+/g, "") || "generic";

  function axProperties(node) {
    const out = {};
    for (const prop of Array.isArray(node?.properties) ? node.properties : []) {
      const key = normText(prop?.name).replace(/[^a-z0-9_-]/g, "");
      if (!key || Object.prototype.hasOwnProperty.call(out, key)) continue;
      const value = prop?.value;
      out[key] = typeof value === "string" ? clip(value, 160) : value;
    }
    return out;
  }

  function inferRole(dom) {
    const attrs = dom?.attributes || {};
    if (attrs.role) return normalizedRole(attrs.role);
    const tag = String(dom?.node_name || "").toUpperCase();
    if (tag === "BUTTON") return "button";
    if (tag === "A") return "link";
    if (tag === "TEXTAREA") return "textbox";
    if (tag === "SELECT") return "combobox";
    if (tag === "OPTION") return "option";
    if (tag === "INPUT") {
      const type = normText(attrs.type || "text");
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (["button", "submit", "reset"].includes(type)) return "button";
      if (type === "search") return "searchbox";
      return "textbox";
    }
    return "generic";
  }

  function domName(dom) {
    const attrs = dom?.attributes || {};
    return clip(attrs["aria-label"] || attrs.title || dom?.node_value || "", 320);
  }

  function boundsOf(dom) {
    const raw = Array.isArray(dom?.bounds) ? dom.bounds.slice(0, 4).map(Number) : null;
    if (!raw || raw.length !== 4 || raw.some((v) => !Number.isFinite(v))) return null;
    return raw;
  }

  function visibleInViewport(bounds, viewport) {
    if (!bounds || bounds[2] <= 0 || bounds[3] <= 0) return false;
    const width = Number(viewport?.width || viewport?.clientWidth || 0);
    const height = Number(viewport?.height || viewport?.clientHeight || 0);
    if (!(width > 0 && height > 0)) return true;
    const [x, y, w, h] = bounds;
    return x + w > 0 && y + h > 0 && x < width && y < height;
  }

  function center(bounds) {
    if (!bounds) return null;
    return [bounds[0] + bounds[2] / 2, bounds[1] + bounds[3] / 2];
  }

  function geometrySimilarity(a, b) {
    const ca = center(a), cb = center(b);
    if (!ca || !cb) return 0.5;
    const distance = Math.hypot(ca[0] - cb[0], ca[1] - cb[1]);
    if (distance <= 8) return 1;
    if (distance <= 32) return 0.9;
    if (distance <= 96) return 0.7;
    if (distance <= 256) return 0.45;
    return 0.1;
  }

  function taskBoost(candidate, taskTerms) {
    if (!taskTerms.length) return 0;
    const haystack = normText(`${candidate.name} ${candidate.value_summary} ${candidate.role}`);
    let score = 0;
    for (const term of taskTerms) if (term && haystack.includes(term)) score += 8;
    return Math.min(score, 24);
  }

  function relevance(candidate, viewport, taskTerms) {
    let score = 0;
    if (INTERACTIVE_ROLES.has(candidate.role)) score += 44;
    if (candidate.editable) score += 20;
    if (candidate.clickable) score += 14;
    if (candidate.focusable) score += 10;
    if (candidate.visible) score += 10;
    if (candidate.name) score += Math.min(10, 3 + Math.floor(candidate.name.length / 32));
    if (candidate.value_summary) score += 4;
    if (candidate.states.disabled === true) score -= 8;
    if (candidate.states.busy === true) score += 6;
    if (candidate.states.expanded != null || candidate.states.checked != null || candidate.states.selected != null) score += 5;
    score += taskBoost(candidate, taskTerms);
    if (!visibleInViewport(candidate.bounds, viewport)) score -= 4;
    return Math.max(0, Math.min(100, score));
  }

  function domKey(record) {
    return `${Number(record?.document_index ?? 0)}:${Number(record?.node_index ?? -1)}`;
  }

  function buildDomMaps(domRecords) {
    const byBackend = new Map();
    const byKey = new Map();
    for (const dom of domRecords) {
      byKey.set(domKey(dom), dom);
      if (dom?.backend_node_id != null) byBackend.set(String(dom.backend_node_id), dom);
    }
    return { byBackend, byKey };
  }

  function parentSignature(dom, domMaps) {
    if (!dom || dom.parent_index == null) return "root";
    const parent = domMaps.byKey.get(`${Number(dom.document_index ?? 0)}:${Number(dom.parent_index)}`);
    if (!parent) return `p:${Number(dom.parent_index)}`;
    const role = inferRole(parent);
    const nameFp = stableHash(normText(domName(parent)).slice(0, 160));
    const tag = String(parent.node_name || "").toUpperCase();
    return `${tag}:${role}:${nameFp.slice(0, 8)}`;
  }

  function candidateFromAx(ax, dom, domMaps, viewport, taskTerms) {
    const props = axProperties(ax);
    const role = normalizedRole(ax?.role || inferRole(dom));
    const attrs = dom?.attributes || {};
    const name = clip(ax?.name || domName(dom), 320);
    const value = clip(ax?.value || dom?.node_value || "", 240);
    const bounds = boundsOf(dom);
    const editable = EDITABLE_ROLES.has(role) || boolish(attrs.contenteditable) || props.editable === true;
    const clickable = INTERACTIVE_ROLES.has(role) || CLICKABLE_TAGS.has(String(dom?.node_name || "").toUpperCase()) || props.clickable === true;
    const focusable = clickable || editable || props.focusable === true;
    const candidate = {
      role,
      name,
      value_summary: value,
      states: {
        disabled: props.disabled === true || boolish(attrs.disabled),
        busy: props.busy === true,
        expanded: props.expanded ?? null,
        checked: props.checked ?? null,
        selected: props.selected ?? null,
        pressed: props.pressed ?? null,
        required: props.required === true,
        readonly: props.readonly === true || props.read_only === true
      },
      editable,
      clickable,
      focusable,
      visible: visibleInViewport(bounds, viewport),
      bounds,
      frame_path: String(ax?.frame_id || ax?.frameId || "root"),
      name_fingerprint: stableHash(normText(name)),
      parent_signature: parentSignature(dom, domMaps),
      source_rank: 0,
      source_kind: dom ? "AX_DOM" : "AX",
      source_order: Number(dom?.node_index ?? 0),
      binding_evidence: {
        backend_dom_node_id: ax?.backend_dom_node_id ?? ax?.backendDOMNodeId ?? dom?.backend_node_id ?? null,
        ax_node_id: ax?.node_id ?? ax?.nodeId ?? null,
        source_frame_id: ax?.frame_id ?? ax?.frameId ?? null
      }
    };
    candidate.relevance_score = relevance(candidate, viewport, taskTerms);
    return candidate;
  }

  function candidateFromDom(dom, domMaps, viewport, taskTerms) {
    const role = inferRole(dom);
    const attrs = dom?.attributes || {};
    const name = domName(dom);
    const bounds = boundsOf(dom);
    const tag = String(dom?.node_name || "").toUpperCase();
    const editable = EDITABLE_ROLES.has(role) || boolish(attrs.contenteditable);
    const clickable = INTERACTIVE_ROLES.has(role) || CLICKABLE_TAGS.has(tag);
    const candidate = {
      role,
      name,
      value_summary: clip(dom?.node_value || "", 240),
      states: {
        disabled: boolish(attrs.disabled), busy: false, expanded: null, checked: null,
        selected: null, pressed: null, required: false, readonly: false
      },
      editable,
      clickable,
      focusable: clickable || editable,
      visible: visibleInViewport(bounds, viewport),
      bounds,
      frame_path: `document:${Number(dom?.document_index ?? 0)}`,
      name_fingerprint: stableHash(normText(name)),
      parent_signature: parentSignature(dom, domMaps),
      source_rank: 1,
      source_kind: "DOM",
      source_order: Number(dom?.node_index ?? 0),
      binding_evidence: {
        backend_dom_node_id: dom?.backend_node_id ?? null,
        ax_node_id: null,
        source_frame_id: null
      }
    };
    candidate.relevance_score = relevance(candidate, viewport, taskTerms);
    return candidate;
  }

  function meaningful(candidate) {
    return candidate.role !== "generic" || candidate.name || candidate.value_summary || candidate.clickable || candidate.editable || candidate.focusable;
  }

  function buildCandidates(input, options) {
    const axNodes = Array.isArray(input?.accessibility) ? input.accessibility : [];
    const domRecords = Array.isArray(input?.dom_snapshot?.visible_records)
      ? input.dom_snapshot.visible_records
      : Array.isArray(input?.dom_records) ? input.dom_records : [];
    const viewport = input?.page?.viewport || input?.viewport || {};
    const taskTerms = (Array.isArray(options?.task_terms) ? options.task_terms : [])
      .map(normText).filter(Boolean).slice(0, 24);
    const domMaps = buildDomMaps(domRecords);
    const usedBackend = new Set();
    const candidates = [];

    for (const ax of axNodes) {
      if (ax?.ignored === true) continue;
      const backend = ax?.backend_dom_node_id ?? ax?.backendDOMNodeId ?? null;
      const dom = backend != null ? domMaps.byBackend.get(String(backend)) || null : null;
      if (backend != null) usedBackend.add(String(backend));
      const candidate = candidateFromAx(ax, dom, domMaps, viewport, taskTerms);
      if (meaningful(candidate)) candidates.push(candidate);
    }

    for (const dom of domRecords) {
      const backend = dom?.backend_node_id;
      if (backend != null && usedBackend.has(String(backend))) continue;
      const candidate = candidateFromDom(dom, domMaps, viewport, taskTerms);
      if (meaningful(candidate) && (candidate.clickable || candidate.editable || candidate.focusable || candidate.name)) candidates.push(candidate);
    }

    return { candidates, axCount: axNodes.length, domCount: domRecords.length };
  }

  function assignInitialIds(candidates, identity) {
    const duplicateCounters = new Map();
    const ordered = [...candidates].sort((a, b) => {
      if (a.source_rank !== b.source_rank) return a.source_rank - b.source_rank;
      if (a.source_order !== b.source_order) return a.source_order - b.source_order;
      return String(a.binding_evidence.backend_dom_node_id ?? "").localeCompare(String(b.binding_evidence.backend_dom_node_id ?? ""));
    });
    for (const candidate of ordered) {
      const structural = `${candidate.role}|${candidate.name_fingerprint}|${candidate.parent_signature}`;
      const ordinal = duplicateCounters.get(structural) || 0;
      duplicateCounters.set(structural, ordinal + 1);
      candidate.structural_fingerprint = stableHash(structural);
      const material = `${identity.target_id}|${identity.context_id}|${identity.document_epoch}|${structural}|${ordinal}`;
      candidate.semantic_id = `sem_${stableHash(material)}`;
      candidate.binding_epoch = 1;
      candidate.continuity = "NEW_NODE";
      candidate.binding_confidence = candidate.source_kind === "AX_DOM" ? 0.98 : candidate.source_kind === "AX" ? 0.84 : 0.72;
      candidate.ambiguous_with = [];
    }
    return ordered;
  }

  function structuralGroupKey(node) {
    if (node?.structural_fingerprint) return String(node.structural_fingerprint);
    return stableHash(`${normalizedRole(node?.role)}|${stableHash(normText(node?.name))}|root`);
  }

  function structuralGroupCounts(nodes) {
    const counts = new Map();
    for (const node of nodes) {
      const key = structuralGroupKey(node);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }

  function continuityScore(current, previous) {
    if (!current || !previous || current.role !== previous.role) return 0;
    let score = 0.45;
    if (normText(current.name) === normText(previous.name)) score += 0.25;
    if (structuralGroupKey(current) === structuralGroupKey(previous)) score += 0.15;
    score += 0.15 * geometrySimilarity(current.bounds, previous.bounds);
    return Math.min(1, score);
  }

  function applyContinuity(currentNodes, previousFrame, identity) {
    const previousNodes = Array.isArray(previousFrame?.nodes) ? previousFrame.nodes : [];
    if (!previousNodes.length || String(previousFrame?.target_id || "") !== identity.target_id || String(previousFrame?.context_id || "") !== identity.context_id) return currentNodes;
    const previousById = new Map(previousNodes.map((node) => [node.semantic_id, node]));
    const currentGroups = structuralGroupCounts(currentNodes);
    const previousGroups = structuralGroupCounts(previousNodes);
    const usedPrevious = new Set();

    for (const node of currentNodes) {
      const direct = previousById.get(node.semantic_id);
      if (!direct) continue;
      if (String(previousFrame?.document_epoch ?? "") !== String(identity.document_epoch)) continue;
      const sameBackend = direct.binding_evidence?.backend_dom_node_id != null &&
        String(direct.binding_evidence.backend_dom_node_id) === String(node.binding_evidence?.backend_dom_node_id ?? "");
      if (sameBackend) {
        usedPrevious.add(direct.semantic_id);
        node.continuity = "EXACT_BINDING";
        node.binding_epoch = Math.max(1, Number(direct.binding_epoch || 1));
        node.binding_confidence = Math.max(node.binding_confidence, 0.995);
        continue;
      }
      const groupKey = structuralGroupKey(node);
      if ((currentGroups.get(groupKey) || 0) > 1 || (previousGroups.get(groupKey) || 0) > 1) {
        node.continuity = "AMBIGUOUS";
        node.binding_confidence = Math.min(node.binding_confidence, 0.4);
        node.ambiguous_with = previousNodes
          .filter((candidate) => structuralGroupKey(candidate) === groupKey)
          .map((candidate) => candidate.semantic_id)
          .slice(0, 6);
        continue;
      }
      usedPrevious.add(direct.semantic_id);
      node.continuity = "STRUCTURAL_REBIND";
      node.binding_epoch = Math.max(1, Number(direct.binding_epoch || 1) + 1);
      node.binding_confidence = Math.min(node.binding_confidence, 0.9);
    }

    const unmatchedPrevious = previousNodes.filter((node) => !usedPrevious.has(node.semantic_id));
    for (const node of currentNodes.filter((item) => item.continuity === "NEW_NODE")) {
      if (String(previousFrame?.document_epoch ?? "") !== String(identity.document_epoch)) continue;
      const scored = unmatchedPrevious
        .map((candidate) => ({ candidate, score: continuityScore(node, candidate) }))
        .filter((row) => row.score >= 0.84)
        .sort((a, b) => b.score - a.score || String(a.candidate.semantic_id).localeCompare(String(b.candidate.semantic_id)));
      if (!scored.length) continue;
      const top = scored[0];
      const near = scored.filter((row) => top.score - row.score <= 0.035);
      if (near.length > 1) {
        node.continuity = "AMBIGUOUS";
        node.binding_confidence = Math.min(node.binding_confidence, 0.45);
        node.ambiguous_with = near.slice(0, 6).map((row) => row.candidate.semantic_id);
        continue;
      }
      node.semantic_id = top.candidate.semantic_id;
      node.continuity = "STRUCTURAL_REBIND";
      node.binding_epoch = Math.max(1, Number(top.candidate.binding_epoch || 1) + 1);
      node.binding_confidence = Math.min(0.93, Math.max(0.84, top.score));
      usedPrevious.add(top.candidate.semantic_id);
    }
    return currentNodes;
  }

  function publicNode(node) {
    return {
      semantic_id: node.semantic_id,
      role: node.role,
      name: node.name,
      value_summary: node.value_summary,
      states: node.states,
      editable: node.editable,
      clickable: node.clickable,
      focusable: node.focusable,
      visible: node.visible,
      bounds: node.bounds,
      frame_path: node.frame_path,
      relevance_score: node.relevance_score,
      confidence: Number(node.binding_confidence.toFixed(3)),
      continuity: node.continuity,
      binding_epoch: node.binding_epoch,
      structural_fingerprint: node.structural_fingerprint,
      binding_evidence: node.binding_evidence,
      ambiguous_with: node.ambiguous_with,
      tainted_page_data: true,
      authority_effect: false
    };
  }

  function nodeComparable(node) {
    return JSON.stringify({
      role: node.role, name: node.name, value_summary: node.value_summary, states: node.states,
      editable: node.editable, clickable: node.clickable, focusable: node.focusable, visible: node.visible,
      bounds: node.bounds, continuity: node.continuity, binding_epoch: node.binding_epoch,
      backend: node.binding_evidence?.backend_dom_node_id ?? null
    });
  }

  function diffFrames(previousFrame, currentAllNodes, selectedIds) {
    const previousNodes = Array.isArray(previousFrame?.nodes) ? previousFrame.nodes : [];
    if (!previousNodes.length) return currentAllNodes.filter((node) => selectedIds.has(node.semantic_id)).map((node) => ({ type: "ADDED", semantic_id: node.semantic_id }));
    const currentById = new Map(currentAllNodes.map((node) => [node.semantic_id, node]));
    const previousById = new Map(previousNodes.map((node) => [node.semantic_id, node]));
    const changes = [];

    for (const previous of previousNodes) {
      const current = currentById.get(previous.semantic_id);
      if (!current) {
        changes.push({ type: "REMOVED", semantic_id: previous.semantic_id });
        continue;
      }
      if (!selectedIds.has(previous.semantic_id)) {
        changes.push({ type: "EVICTED_FROM_WORKING_SET", semantic_id: previous.semantic_id });
        continue;
      }
      if (current.continuity === "STRUCTURAL_REBIND") changes.push({ type: "REBIND", semantic_id: current.semantic_id, binding_epoch: current.binding_epoch });
      if (nodeComparable(previous) !== nodeComparable(current)) changes.push({ type: "UPDATED", semantic_id: current.semantic_id });
    }
    for (const current of currentAllNodes) {
      if (!selectedIds.has(current.semantic_id)) continue;
      if (!previousById.has(current.semantic_id)) changes.push({ type: "ADDED", semantic_id: current.semantic_id });
    }
    return changes.slice(0, 240);
  }

  function estimateBytes(value) {
    try { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
    catch (_) { return JSON.stringify(value).length; }
  }

  function compileFrame(input = {}, options = {}) {
    const targetId = String(input.target_id || "").trim().toLowerCase();
    const contextId = String(input.context_id || "context_default").trim().toLowerCase();
    if (!targetId) throw new Error("semantic_target_id_required");
    if (!contextId) throw new Error("semantic_context_id_required");
    const documentEpoch = input.document_epoch ?? input.conversation_epoch ?? 1;
    const nodeBudget = Math.max(1, Math.min(MAX_NODE_BUDGET, Math.floor(Number(options.node_budget || DEFAULT_NODE_BUDGET))));
    const identity = { target_id: targetId, context_id: contextId, document_epoch: documentEpoch };
    const built = buildCandidates(input, options);
    let allNodes = applyContinuity(assignInitialIds(built.candidates, identity), options.previous_frame || null, identity);

    allNodes.sort((a, b) => b.relevance_score - a.relevance_score || a.source_rank - b.source_rank || a.source_order - b.source_order || a.semantic_id.localeCompare(b.semantic_id));
    const selected = allNodes.slice(0, nodeBudget);
    const selectedIds = new Set(selected.map((node) => node.semantic_id));
    const changes = diffFrames(options.previous_frame || null, allNodes, selectedIds);
    const rawBytes = estimateBytes({ accessibility: input.accessibility || [], dom_snapshot: input.dom_snapshot || null, page: input.page || null, layout: input.layout || null });
    const frame = {
      schema: FRAME_SCHEMA,
      compiler_schema: API_SCHEMA,
      frame_id: `sf_${stableHash(`${targetId}|${contextId}|${documentEpoch}|${input.captured_at || ""}|${selected.map((node) => node.semantic_id).join(",")}`)}`,
      target_id: targetId,
      context_id: contextId,
      document_epoch: documentEpoch,
      captured_at: String(input.captured_at || new Date().toISOString()),
      source_hashes: input.source_hashes || input.hashes || {},
      tainted_page_data: true,
      authority_effect: false,
      semantic_authority: false,
      binding_requires_live_revalidation: true,
      nodes: selected.map(publicNode),
      changes,
      truncation: {
        node_budget: nodeBudget,
        candidate_count: allNodes.length,
        selected_count: selected.length,
        dropped_count: Math.max(0, allNodes.length - selected.length),
        truncated: allNodes.length > selected.length,
        source_ax_count: built.axCount,
        source_dom_count: built.domCount
      },
      metrics: {
        raw_observation_bytes_estimate: rawBytes,
        semantic_node_count: selected.length,
        source_node_count: built.axCount + built.domCount,
        node_reduction_ratio: built.axCount + built.domCount > 0 ? Number((1 - (selected.length / (built.axCount + built.domCount))).toFixed(4)) : 0
      }
    };
    frame.metrics.semantic_frame_bytes = estimateBytes(frame);
    return frame;
  }

  globalThis.A2_SEMANTIC_PERCEPTION_COMPILER = Object.freeze({
    schema: API_SCHEMA,
    frame_schema: FRAME_SCHEMA,
    compileFrame,
    stableHash
  });
})();
