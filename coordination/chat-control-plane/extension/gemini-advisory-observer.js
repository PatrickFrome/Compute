(() => {
  "use strict";

  const PLATFORM = "GEMINI_GOOGLE";
  const HEARTBEAT_MS = 2500;
  const MAX_MESSAGE_CHARS = 120000;
  const MAX_HASH_CACHE = 256;
  let snapshotTimer = null;
  let lastSnapshotHash = "";
  const strongHashCache = new Map();

  const normalize = (value) => String(value ?? "").replace(/\r\n?/g, "\n").trim();

  function visible(element) {
    if (!(element instanceof HTMLElement)) return false;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function hashText(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  }

  async function sha256Text(text) {
    const key = String(text ?? "");
    if (strongHashCache.has(key)) return strongHashCache.get(key);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
    const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    strongHashCache.set(key, hex);
    if (strongHashCache.size > MAX_HASH_CACHE) strongHashCache.delete(strongHashCache.keys().next().value);
    return hex;
  }

  function composerCandidates() {
    const selectors = [
      "div.ql-editor[contenteditable='true']",
      "rich-textarea [contenteditable='true']",
      "[aria-label='Enter a prompt here']",
      "[contenteditable='true'][role='textbox']"
    ];
    const found = [];
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (visible(element) && !found.includes(element)) found.push(element);
      }
      if (found.length === 1) break;
    }
    return found;
  }

  function resolveComposer() {
    const found = composerCandidates();
    if (found.length === 1) return { composer: found[0], error: null };
    if (found.length > 1) return { composer: null, error: "composer_ambiguous" };
    return { composer: null, error: "composer_not_found" };
  }

  function composerText(element) {
    if (!element) return "";
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) return normalize(element.value);
    return normalize(element.innerText || element.textContent || "");
  }

  function orderedMessageNodes() {
    const rows = [];
    const seen = new Set();
    const add = (selector, role) => {
      for (const node of document.querySelectorAll(selector)) {
        if (!(node instanceof HTMLElement) || !visible(node) || seen.has(node)) continue;
        const text = normalize(node.innerText || node.textContent || "");
        if (!text) continue;
        seen.add(node);
        rows.push({ node, role, text });
      }
    };

    add("user-query, .query-text, .user-query, [data-message-author='user']", "user");
    add("model-response, message-content, .model-response-text, .response-content", "assistant");
    rows.sort((a, b) => {
      const position = a.node.compareDocumentPosition(b.node);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
    return rows;
  }

  function nodeKey(node, index) {
    return node.getAttribute("data-message-id")
      || node.getAttribute("data-test-id")
      || node.getAttribute("id")
      || `${PLATFORM}:turn:${index}`;
  }

  function extractMessages() {
    return orderedMessageNodes().map(({ node, role, text }, index) => ({
      index,
      role,
      text: text.slice(0, MAX_MESSAGE_CHARS),
      text_hash_local: hashText(text),
      dom_node_key: nodeKey(node, index),
      dom_testid: node.getAttribute("data-test-id") || null
    }));
  }

  function generationState() {
    const stop = [...document.querySelectorAll("button")]
      .filter(visible)
      .some((button) => /stop/i.test(`${button.getAttribute("aria-label") || ""} ${button.getAttribute("title") || ""}`));
    const busy = [...document.querySelectorAll("[aria-busy='true']")].some(visible);
    return { generating: stop || busy, generation_signal: stop ? "STOP_CONTROL" : (busy ? "ARIA_BUSY" : "NONE") };
  }

  function pageState() {
    const composerResolution = resolveComposer();
    const generation = generationState();
    const messages = extractMessages();
    return {
      schema: "metaengine.gemini-advisory-dom-snapshot.v1",
      platform: PLATFORM,
      advisory_only: true,
      authority_effect: false,
      url: location.href,
      title: document.title,
      captured_at: new Date().toISOString(),
      generating: generation.generating,
      generation_signal: generation.generation_signal,
      composer_present: Boolean(composerResolution.composer),
      composer_text: composerText(composerResolution.composer),
      dom_pair_error: composerResolution.error,
      message_count: messages.length,
      messages,
      visibility_state: document.visibilityState
    };
  }

  async function withStrongHashes(snapshot) {
    const messages = await Promise.all(snapshot.messages.map(async (message) => ({
      ...message,
      text_sha256: await sha256Text(message.text)
    })));
    return {
      ...snapshot,
      composer_sha256: await sha256Text(snapshot.composer_text || ""),
      messages
    };
  }

  async function emitSnapshot(force = false) {
    const raw = pageState();
    const signature = hashText(JSON.stringify({
      url: raw.url,
      generating: raw.generating,
      composer_present: raw.composer_present,
      composer_text: raw.composer_text,
      dom_pair_error: raw.dom_pair_error,
      messages: raw.messages.map((message) => [message.dom_node_key, message.role, message.text_hash_local])
    }));
    if (!force && signature === lastSnapshotHash) return;
    lastSnapshotHash = signature;
    try {
      await chrome.runtime.sendMessage({
        type: "A2_GEMINI_ADVISORY_SNAPSHOT",
        snapshot: await withStrongHashes(raw)
      });
    } catch (_) {}
  }

  function scheduleSnapshot() {
    if (snapshotTimer) return;
    snapshotTimer = setTimeout(() => {
      snapshotTimer = null;
      emitSnapshot(false);
    }, 150);
  }

  const observer = new MutationObserver(() => scheduleSnapshot());
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["disabled", "aria-disabled", "aria-busy", "aria-label"]
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "A2_GEMINI_ADVISORY_GET_SNAPSHOT") return false;
    withStrongHashes(pageState())
      .then((snapshot) => sendResponse({ ok: true, snapshot }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  });

  setInterval(() => emitSnapshot(true), HEARTBEAT_MS);
  emitSnapshot(true);
})();
