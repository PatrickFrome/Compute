(() => {
  "use strict";

  const HEARTBEAT_MS = 2500;
  const MAX_MESSAGE_CHARS = 120000;
  const GLM_PROCESSING_MUTATION_WINDOW_MS = 1800;
  let snapshotTimer = null;
  let lastSnapshotHash = "";
  let lastMutationAt = Date.now();
  let lastGlmAppMutationAt = 0;
  let lastGlmStreamMutationAt = 0;

  const normalize = (value) => String(value ?? "").replace(/\r\n?/g, "\n").trim();

  function platform() {
    const host = location.hostname.toLowerCase();
    if (host === "chatgpt.com" || host === "chat.openai.com") return "CHATGPT";
    if (host === "chat.z.ai") return "GLM_ZAI";
    return "UNKNOWN";
  }

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

  function inferRole(node) {
    const explicit = node.querySelector?.("[data-message-author-role]")?.getAttribute("data-message-author-role")
      || node.getAttribute?.("data-message-author-role")
      || node.getAttribute?.("data-role")
      || node.dataset?.role;
    if (explicit) {
      const role = String(explicit).toLowerCase();
      if (role.includes("user")) return "user";
      if (role.includes("assistant")) return "assistant";
      if (role.includes("system")) return "system";
    }
    const label = `${node.getAttribute?.("aria-label") || ""} ${node.className || ""}`.toLowerCase();
    if (/\buser\b|\byou\b/.test(label)) return "user";
    if (/assistant|chatgpt|glm|model/.test(label)) return "assistant";
    return "unknown";
  }

  function structuredMessageNodes() {
    const selectors = platform() === "CHATGPT"
      ? ["[data-testid^='conversation-turn-']", "article[data-testid^='conversation-turn-']", "article"]
      : ["[data-message-author-role]", "[data-role='user']", "[data-role='assistant']", "[class*='message']", "article"];
    for (const selector of selectors) {
      const nodes = [...document.querySelectorAll(selector)].filter(visible);
      if (nodes.length) return nodes;
    }
    return [];
  }

  function extractMessages() {
    const output = [];
    const seen = new Set();
    for (const node of structuredMessageNodes()) {
      const text = normalize(node.innerText || node.textContent || "");
      if (!text) continue;
      const role = inferRole(node);
      const key = `${role}:${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      output.push({
        index: output.length,
        role,
        text: text.slice(0, MAX_MESSAGE_CHARS),
        text_hash_local: hashText(text),
        dom_testid: node.getAttribute?.("data-testid") || null,
        author_role_attr: node.querySelector?.("[data-message-author-role]")?.getAttribute("data-message-author-role") || null
      });
    }
    return output;
  }

  function composerCandidates() {
    const selectors = platform() === "CHATGPT"
      ? ["#prompt-textarea", "textarea#prompt-textarea", "[data-testid='composer-text-input'] textarea", "[contenteditable='true'][data-lexical-editor='true']", "form textarea", "[role='textbox'][contenteditable='true']"]
      : ["#chat-input", "textarea.input-scroll", ".messageInputContainer textarea", "textarea", "[contenteditable='true'][data-lexical-editor='true']", "[role='textbox'][contenteditable='true']"];
    const found = [];
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (visible(element) && !found.includes(element)) found.push(element);
      }
      if (platform() === "GLM_ZAI" && selector === "#chat-input" && found.length) break;
    }
    return found;
  }

  function resolveComposer() {
    const composers = composerCandidates();
    if (composers.length === 1) return { composer: composers[0], error: null };
    if (composers.length > 1) return { composer: null, error: "composer_ambiguous" };
    return { composer: null, error: "composer_not_found" };
  }

  function composerText(element) {
    if (!element) return "";
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) return normalize(element.value);
    return normalize(element.innerText || element.textContent || "");
  }

  function semanticFields(button) {
    return [button.getAttribute("aria-label"), button.getAttribute("title"), button.textContent]
      .map((value) => normalize(value).toLowerCase()).filter(Boolean);
  }

  function buttonMatches(button, kind) {
    const patterns = kind === "stop"
      ? [/^(stop|stop generating|stop generation)$/i, /^(остановить|остановить генерацию)$/iu, /^(停止|停止生成)$/u]
      : [/^(send|send message|send prompt|submit)$/i, /^(отправить|отправить сообщение)$/iu, /^(发送|发送消息)$/u];
    return semanticFields(button).some((field) => patterns.some((pattern) => pattern.test(field)));
  }

  function semanticButtons(kind) {
    const ids = kind === "stop" ? ["stop-button", "composer-stop-button"] : ["send-button", "composer-submit-button"];
    const strong = [];
    if (platform() === "GLM_ZAI" && kind === "send") {
      for (const selector of ["#send-message-button", "button.sendMessageButton"]) {
        for (const button of document.querySelectorAll(selector)) if (visible(button) && !strong.includes(button)) strong.push(button);
      }
      if (strong.length) return strong;
    }
    for (const id of ids) {
      for (const button of document.querySelectorAll(`button[data-testid='${id}']`)) {
        if (visible(button) && !strong.includes(button)) strong.push(button);
      }
    }
    if (strong.length) return strong;
    return [...document.querySelectorAll("button")].filter(visible).filter((button) => buttonMatches(button, kind));
  }

  function glmProcessingActive() {
    if (platform() !== "GLM_ZAI") return false;
    const composer = resolveComposer().composer;
    if (composer && composerText(composer) !== "") return false;
    const sends = semanticButtons("send");
    const blocked = sends.length === 0 || sends.every((button) => button.disabled || button.getAttribute("aria-disabled") === "true");
    if (!blocked) return false;
    const latest = Math.max(lastGlmStreamMutationAt, lastGlmAppMutationAt);
    return latest > 0 && Date.now() - latest <= GLM_PROCESSING_MUTATION_WINDOW_MS;
  }

  function pageState() {
    const composerResolution = resolveComposer();
    const composer = composerResolution.composer;
    const messages = extractMessages();
    const stopDetected = semanticButtons("stop").length > 0;
    const processing = glmProcessingActive();
    return {
      schema: "metaengine.chat-dom-snapshot.v2",
      platform: platform(),
      url: location.href,
      title: document.title,
      captured_at: new Date().toISOString(),
      generating: stopDetected || processing,
      processing_active: processing,
      generation_signal: stopDetected ? "STOP_CONTROL" : (processing ? "GLM_DOM_MUTATION" : "NONE"),
      composer_present: Boolean(composer),
      composer_text: composerText(composer),
      dom_pair_error: composerResolution.error,
      message_count: messages.length,
      messages,
      last_mutation_at_ms: lastMutationAt,
      last_glm_app_mutation_at_ms: lastGlmAppMutationAt,
      last_glm_stream_mutation_at_ms: lastGlmStreamMutationAt,
      visibility_state: document.visibilityState
    };
  }

  async function emitSnapshot(force = false) {
    const snapshot = pageState();
    const signature = hashText(JSON.stringify({
      url: snapshot.url,
      generating: snapshot.generating,
      processing_active: snapshot.processing_active,
      composer_present: snapshot.composer_present,
      composer_text: snapshot.composer_text,
      dom_pair_error: snapshot.dom_pair_error,
      messages: snapshot.messages.map((message) => [message.role, message.text_hash_local])
    }));
    if (!force && signature === lastSnapshotHash) return;
    lastSnapshotHash = signature;
    try { await chrome.runtime.sendMessage({ type: "CHAT_SNAPSHOT", snapshot }); } catch (_) {}
  }

  function scheduleSnapshot() {
    if (snapshotTimer) return;
    snapshotTimer = setTimeout(() => {
      snapshotTimer = null;
      emitSnapshot(false);
    }, 150);
  }

  const observer = new MutationObserver((mutations) => {
    const now = Date.now();
    lastMutationAt = now;
    if (platform() === "GLM_ZAI") {
      for (const mutation of mutations) {
        const element = mutation.target instanceof Element ? mutation.target : mutation.target?.parentElement;
        if (!(element instanceof Element)) continue;
        if (element.closest("section[aria-live='polite'], [role='region'][aria-live='polite']")) lastGlmStreamMutationAt = now;
        if (element.closest("#app")) lastGlmAppMutationAt = now;
      }
    }
    scheduleSnapshot();
  });

  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["disabled", "aria-disabled", "data-testid", "aria-busy"]
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "GET_CHAT_SNAPSHOT") return false;
    sendResponse({ ok: true, snapshot: pageState() });
    return false;
  });

  setInterval(() => emitSnapshot(true), HEARTBEAT_MS);
  emitSnapshot(true);
})();
