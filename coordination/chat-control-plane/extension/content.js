(() => {
  "use strict";

  const HEARTBEAT_MS = 2500;
  const SEND_VERIFY_TIMEOUT_MS = 12000;
  const SEND_BUTTON_WAIT_MS = 6000;
  const MAX_MESSAGE_CHARS = 120000;
  const seenCommands = new Set();
  let snapshotTimer = null;
  let lastSnapshotHash = "";
  let lastMutationAt = Date.now();

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const normalize = (value) => String(value ?? "").replace(/\r\n/g, "\n").trim();

  function platform() {
    const host = location.hostname.toLowerCase();
    if (host === "chatgpt.com" || host === "chat.openai.com") return "CHATGPT";
    if (host === "chat.z.ai" || host.endsWith(".z.ai")) return "GLM_ZAI";
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
    // FNV-1a is used only for local change detection, never as cryptographic evidence.
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
      ? [
          "[data-testid^='conversation-turn-']",
          "article[data-testid^='conversation-turn-']",
          "article"
        ]
      : [
          "[data-message-author-role]",
          "[data-role='user']",
          "[data-role='assistant']",
          "[class*='message']",
          "article"
        ];

    for (const selector of selectors) {
      const nodes = [...document.querySelectorAll(selector)].filter(visible);
      if (nodes.length >= 1) return nodes;
    }
    return [];
  }

  function extractMessages() {
    const nodes = structuredMessageNodes();
    const output = [];
    const seen = new Set();
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
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
      ? [
          "#prompt-textarea",
          "textarea#prompt-textarea",
          "[data-testid='composer-text-input'] textarea",
          "[contenteditable='true'][data-lexical-editor='true']",
          "form textarea",
          "[role='textbox'][contenteditable='true']"
        ]
      : [
          "textarea",
          "[contenteditable='true'][data-lexical-editor='true']",
          "[role='textbox'][contenteditable='true']"
        ];
    const found = [];
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (visible(el) && !found.includes(el)) found.push(el);
      }
    }
    return found;
  }

  function getComposer() {
    const candidates = composerCandidates();
    if (!candidates.length) return null;
    // Prefer the lowest visible composer in the viewport.
    return candidates.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)[0];
  }

  function composerText(el) {
    if (!el) return "";
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return normalize(el.value);
    return normalize(el.innerText || el.textContent || "");
  }

  function buttonBySemantics(kind) {
    const isSend = kind === "send";
    const testids = isSend
      ? ["send-button", "composer-submit-button"]
      : ["stop-button", "composer-stop-button"];
    for (const id of testids) {
      const el = document.querySelector(`button[data-testid='${id}']`);
      if (visible(el)) return el;
    }

    const terms = isSend
      ? ["send", "отправ", "submit", "发送", "发送消息"]
      : ["stop", "останов", "停止", "停止生成"];
    for (const button of document.querySelectorAll("button")) {
      if (!visible(button)) continue;
      const semantic = `${button.getAttribute("aria-label") || ""} ${button.getAttribute("title") || ""} ${button.textContent || ""}`.toLowerCase();
      if (terms.some((term) => semantic.includes(term))) return button;
    }
    return null;
  }

  function generating() {
    const stop = buttonBySemantics("stop");
    return Boolean(stop && !stop.disabled);
  }

  function pageState() {
    const composer = getComposer();
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
      message_count: messages.length,
      messages,
      last_mutation_at_ms: lastMutationAt,
      visibility_state: document.visibilityState
    };
  }

  function nativeSetValue(element, value) {
    const proto = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : element instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : null;
    const descriptor = proto && Object.getOwnPropertyDescriptor(proto, "value");
    if (!descriptor?.set) throw new Error("native value setter unavailable");
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
    try {
      inserted = document.execCommand("insertText", false, value);
    } catch (_) {
      inserted = false;
    }
    if (!inserted) {
      element.textContent = value;
      element.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: value
      }));
    }
  }

  async function writeComposerExact(text) {
    const composer = getComposer();
    if (!composer) throw new Error("composer_not_found");
    composer.focus();
    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
      nativeSetValue(composer, text);
    } else if (composer.isContentEditable || composer.getAttribute("contenteditable") === "true") {
      setContentEditable(composer, text);
    } else {
      throw new Error("composer_not_editable");
    }
    await sleep(80);
    const readback = composerText(composer);
    if (readback !== normalize(text)) {
      throw new Error(`composer_readback_mismatch:${hashText(readback)}:${hashText(normalize(text))}`);
    }
    return composer;
  }

  async function waitForEnabledSend() {
    const deadline = Date.now() + SEND_BUTTON_WAIT_MS;
    while (Date.now() < deadline) {
      const button = buttonBySemantics("send");
      if (button && !button.disabled && button.getAttribute("aria-disabled") !== "true") return button;
      await sleep(100);
    }
    throw new Error("send_button_not_enabled");
  }

  async function verifySend(before, expectedText) {
    const deadline = Date.now() + SEND_VERIFY_TIMEOUT_MS;
    const expected = normalize(expectedText);
    while (Date.now() < deadline) {
      const current = pageState();
      const composer = getComposer();
      const cleared = composer ? composerText(composer) === "" : false;
      const userMessages = current.messages.filter((m) => m.role === "user");
      const exactUserTurn = userMessages.some((m) => normalize(m.text) === expected);
      const countAdvanced = current.message_count > before.message_count;
      if (exactUserTurn || (cleared && countAdvanced)) {
        return {
          verified: true,
          exact_user_turn_seen: exactUserTurn,
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
    if (seenCommands.has(commandId)) {
      return { status: "DUPLICATE_IGNORED", command_id: commandId };
    }
    if (generating() && command.allow_while_generating !== true) {
      throw new Error("chat_is_generating");
    }

    const before = pageState();
    await writeComposerExact(text);
    const sendButton = await waitForEnabledSend();
    // Requirement: invoke the actual visible Send button, not Enter-key synthesis.
    sendButton.click();
    const verification = await verifySend(before, text);
    seenCommands.add(commandId);
    return {
      status: "SENT_AND_DOM_VERIFIED",
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
      messages: snapshot.messages.map((m) => [m.role, m.text_hash_local])
    }));
    if (!force && signature === lastSnapshotHash) return;
    lastSnapshotHash = signature;
    try {
      await chrome.runtime.sendMessage({ type: "CHAT_SNAPSHOT", snapshot });
    } catch (_) {
      // Background may be restarting; next heartbeat retries.
    }
  }

  function scheduleSnapshot() {
    if (snapshotTimer) return;
    snapshotTimer = setTimeout(() => {
      snapshotTimer = null;
      emitSnapshot(false);
    }, 180);
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
      executeSend(message.command)
        .then((result) => sendResponse({ ok: true, result }))
        .catch((error) => sendResponse({
          ok: false,
          error: String(error?.message || error),
          snapshot: pageState()
        }));
      return true;
    }
    return false;
  });

  setInterval(() => emitSnapshot(true), HEARTBEAT_MS);
  emitSnapshot(true);
})();
