(() => {
  "use strict";

  const HEARTBEAT_MS = 2500;
  const SEND_VERIFY_TIMEOUT_MS = 12000;
  const SEND_BUTTON_WAIT_MS = 6000;
  const MAX_MESSAGE_CHARS = 120000;
  const SEEN_COMMANDS_STORAGE_KEY = "a2-chat-bridge:seen-commands";
  const seenCommands = new Set(loadSeenCommands());
  let snapshotTimer = null;
  let lastSnapshotHash = "";
  let lastMutationAt = Date.now();

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const normalize = (value) => String(value ?? "").replace(/\r\n/g, "\n").trim();
  const canonicalVisible = (value) => String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/\s+/gu, " ")
    .trim();

  function textMatchesExpected(actual, expected) {
    if (platform() === "CHATGPT") return canonicalVisible(actual) === canonicalVisible(expected);
    return normalize(actual) === normalize(expected);
  }

  function loadSeenCommands() {
    try {
      const raw = JSON.parse(sessionStorage.getItem(SEEN_COMMANDS_STORAGE_KEY) || "[]");
      return Array.isArray(raw) ? raw.filter((id) => typeof id === "string") : [];
    } catch (_) {
      return [];
    }
  }

  function rememberCommand(commandId) {
    seenCommands.add(commandId);
    try {
      sessionStorage.setItem(SEEN_COMMANDS_STORAGE_KEY, JSON.stringify([...seenCommands].slice(-200)));
    } catch (_) {}
  }

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
      const role = explicit.toLowerCase();
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
      : ["textarea", "[contenteditable='true'][data-lexical-editor='true']", "[role='textbox'][contenteditable='true']"];
    const found = [];
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (visible(el) && !found.includes(el)) found.push(el);
      }
    }
    return found;
  }

  function sharedContainer(el, button) {
    if (!(el instanceof HTMLElement) || !(button instanceof HTMLElement)) return false;
    let node = el.parentElement;
    for (let depth = 0; depth < 8 && node; depth += 1) {
      if (node.contains(button)) return true;
      node = node.parentElement;
    }
    return false;
  }

  function semanticFields(button) {
    return [button.getAttribute("aria-label"), button.getAttribute("title"), button.textContent]
      .map((value) => normalize(value).toLowerCase()).filter(Boolean);
  }

  function matchesButtonSemantics(button, kind) {
    const patterns = kind === "send"
      ? [/^(send|send message|send prompt|submit)$/i, /^(отправить|отправить сообщение)$/iu, /^(发送|发送消息)$/u]
      : [/^(stop|stop generating|stop generation)$/i, /^(остановить|остановить генерацию)$/iu, /^(停止|停止生成)$/u];
    return semanticFields(button).some((field) => patterns.some((pattern) => pattern.test(field)));
  }

  function semanticButtonCandidates(kind) {
    const testids = kind === "send"
      ? ["send-button", "composer-submit-button"]
      : ["stop-button", "composer-stop-button"];
    const strong = [];
    for (const id of testids) {
      for (const el of document.querySelectorAll(`button[data-testid='${id}']`)) {
        if (visible(el) && !strong.includes(el)) strong.push(el);
      }
    }
    if (strong.length) return strong;
    return [...document.querySelectorAll("button")].filter(visible).filter((button) => matchesButtonSemantics(button, kind));
  }

  function resolveComposer() {
    const composers = composerCandidates();
    if (composers.length === 1) return { composer: composers[0], error: null };
    if (composers.length > 1) return { composer: null, error: "composer_ambiguous" };
    return { composer: null, error: "composer_not_found" };
  }

  function resolveComposerSendPair() {
    const composerResolution = resolveComposer();
    if (composerResolution.error) return { composer: null, send: null, error: composerResolution.error };
    const composer = composerResolution.composer;
    const sendButtons = semanticButtonCandidates("send");
    const matching = sendButtons.filter((send) => sharedContainer(composer, send));
    if (matching.length === 1) return { composer, send: matching[0], error: null };
    if (matching.length > 1) return { composer: null, send: null, error: "composer_send_pair_ambiguous" };
    if (!sendButtons.length) return { composer, send: null, error: "send_button_not_found" };
    return { composer, send: null, error: "composer_send_pair_not_found" };
  }

  function getComposer() { return resolveComposer().composer; }

  function composerText(el) {
    if (!el) return "";
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return normalize(el.value);
    return normalize(el.innerText || el.textContent || "");
  }

  function generating() { return semanticButtonCandidates("stop").length > 0; }

  function pageState() {
    const composerResolution = resolveComposer();
    const composer = composerResolution.composer;
    const messages = extractMessages();
    return {
      schema: "metaengine.chat-dom-snapshot.v1",
      platform: platform(),
      url: location.href,
      title: document.title,
      captured_at: new Date().toISOString(),
      generating: generating(),
      composer_present: Boolean(composer),
      composer_text: composerText(composer),
      dom_pair_error: composerResolution.error,
      message_count: messages.length,
      messages,
      last_mutation_at_ms: lastMutationAt,
      visibility_state: document.visibilityState
    };
  }

  function nativeSetValue(element, value) {
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : element instanceof HTMLInputElement ? HTMLInputElement.prototype : null;
    const descriptor = proto && Object.getOwnPropertyDescriptor(proto, "value");
    if (!descriptor?.set) throw new Error("native_value_setter_unavailable");
    descriptor.set.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setContentEditable(element, value) {
    element.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    let inserted = false;
    try { inserted = document.execCommand("insertText", false, value); } catch (_) { inserted = false; }
    if (!inserted) {
      element.textContent = value;
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    }
  }

  async function writeComposerExact(text) {
    const resolution = resolveComposer();
    if (resolution.error) throw new Error(resolution.error);
    const composer = resolution.composer;
    composer.focus();
    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) nativeSetValue(composer, text);
    else if (composer.isContentEditable || composer.getAttribute("contenteditable") === "true") setContentEditable(composer, text);
    else throw new Error("composer_not_editable");
    await sleep(80);
    if (composerText(composer) !== normalize(text)) throw new Error("composer_readback_mismatch");
    return composer;
  }

  async function callTrustedChatgpt(type, text) {
    const response = await chrome.runtime.sendMessage({ type, prompt: text });
    if (response?.ok === true) return response;
    const safe = String(response?.error || "unknown").replace(/[^a-z0-9_:-]/gi, "_").slice(0, 120);
    if (type === "A2_CHATGPT_TRUSTED_PRIME") throw new Error(`chatgpt_trusted_prime_failed:${safe}`);
    throw new Error(`chatgpt_trusted_click_failed:${safe}`);
  }

  async function waitForEnabledSend(expectedText) {
    const deadline = Date.now() + SEND_BUTTON_WAIT_MS;
    while (Date.now() < deadline) {
      const pair = resolveComposerSendPair();
      if (pair.error === "composer_send_pair_ambiguous") throw new Error(pair.error);
      if (!pair.error && textMatchesExpected(composerText(pair.composer), expectedText) && !pair.send.disabled && pair.send.getAttribute("aria-disabled") !== "true") return pair.send;
      await sleep(100);
    }
    throw new Error("send_button_not_enabled_or_pair_unresolved");
  }

  async function verifySend(before, expectedText) {
    const deadline = Date.now() + SEND_VERIFY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const current = pageState();
      const composer = getComposer();
      const cleared = composer ? composerText(composer) === "" : false;
      const exactUserTurn = current.messages.filter((m) => m.role === "user").some((m) => textMatchesExpected(m.text, expectedText));
      const countAdvanced = current.message_count > before.message_count;
      if (exactUserTurn || (cleared && countAdvanced)) {
        return {
          verified: true,
          exact_user_turn_seen: exactUserTurn,
          verification_strength: exactUserTurn ? "EXACT_USER_TURN" : "CLEARED_AND_COUNT_ADVANCED",
          composer_cleared: cleared,
          message_count_before: before.message_count,
          message_count_after: current.message_count,
          after_snapshot: current
        };
      }
      await sleep(120);
    }
    throw new Error("send_click_not_observed_in_dom");
  }

  async function executeSend(command) {
    const commandId = String(command.command_id || "");
    const text = String(command.prompt || "");
    if (!commandId || !text.trim()) throw new Error("invalid_send_command");
    if (seenCommands.has(commandId)) return { status: "DUPLICATE_IGNORED", command_id: commandId };
    if (generating() && command.allow_while_generating !== true) throw new Error("chat_is_generating");

    const before = pageState();
    const composer = getComposer();
    if (!composer) throw new Error("composer_not_found");

    if (platform() === "CHATGPT") {
      if (composerText(composer) !== "") throw new Error("chatgpt_composer_not_empty_before_prime");
      await callTrustedChatgpt("A2_CHATGPT_TRUSTED_PRIME", text);
      const sendButton = await waitForEnabledSend(text);
      if (!sendButton) throw new Error("send_button_not_found");
      await callTrustedChatgpt("A2_CHATGPT_TRUSTED_CLICK", text);
    } else {
      await writeComposerExact(text);
      const sendButton = await waitForEnabledSend(text);
      sendButton.click();
    }

    const verification = await verifySend(before, text);
    rememberCommand(commandId);
    return {
      status: verification.exact_user_turn_seen === true ? "SENT_AND_DOM_VERIFIED" : "SENT_WEAK_DOM_VERIFIED",
      command_id: commandId,
      clicked_send_button: true,
      prompt_hash_local: hashText(normalize(text)),
      verification
    };
  }

  async function emitSnapshot(force = false) {
    const snapshot = pageState();
    const signature = hashText(JSON.stringify({
      url: snapshot.url,
      generating: snapshot.generating,
      composer_present: snapshot.composer_present,
      composer_text: snapshot.composer_text,
      dom_pair_error: snapshot.dom_pair_error,
      messages: snapshot.messages.map((m) => [m.role, m.text_hash_local])
    }));
    if (!force && signature === lastSnapshotHash) return;
    lastSnapshotHash = signature;
    try { await chrome.runtime.sendMessage({ type: "CHAT_SNAPSHOT", snapshot }); } catch (_) {}
  }

  function scheduleSnapshot() {
    if (snapshotTimer) return;
    snapshotTimer = setTimeout(() => { snapshotTimer = null; emitSnapshot(false); }, 180);
  }

  const observer = new MutationObserver(() => {
    lastMutationAt = Date.now();
    scheduleSnapshot();
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["disabled", "aria-disabled", "data-testid"]
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "GET_CHAT_SNAPSHOT") {
      sendResponse({ ok: true, snapshot: pageState() });
      return false;
    }
    if (message?.type === "EXECUTE_CHAT_SEND") {
      executeSend(message.command || {})
        .then((result) => sendResponse({ ok: true, result }))
        .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
      return true;
    }
    return false;
  });

  setInterval(() => emitSnapshot(true), HEARTBEAT_MS);
  emitSnapshot(true);
})();
