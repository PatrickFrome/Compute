(() => {
  "use strict";

  const CDP_VERSION = "1.3";
  const MAX_PROMPT_CHARS = 120000;
  const ATOMIC_LONG_PROMPT_THRESHOLD = 32000;
  const inFlightTabs = new Set();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const normalize = (value) => String(value ?? "").replace(/\r\n/g, "\n").trim();

  function target(tabId) { return { tabId }; }
  async function send(tabId, method, params = {}) { return chrome.debugger.sendCommand(target(tabId), method, params); }

  async function evaluate(tabId, expression) {
    const result = await send(tabId, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result?.exceptionDetails) throw new Error("chatgpt_cdp_evaluate_failed");
    return result?.result?.value;
  }

  function validateBridgePrompt(prompt) {
    const text = String(prompt || "");
    if (!text.trim() || text.length > MAX_PROMPT_CHARS) throw new Error("chatgpt_cdp_prompt_invalid");
    if (!text.startsWith("A2 CHAT BRIDGE — AUTONOMOUS CONTINUE")) throw new Error("chatgpt_cdp_prompt_not_bridge_owned");
    if (!text.includes("bridge_job_target=GPT") || !text.includes("transport=WEB_CHAT_INTERACTIVE_REMOTE")) {
      throw new Error("chatgpt_cdp_prompt_scope_mismatch");
    }
    return text;
  }

  async function ensureArmed() {
    const { armed } = await chrome.storage.local.get("armed");
    if (armed !== true) throw new Error("chatgpt_cdp_not_armed");
  }

  async function ensurePinnedChatgptTab(tabId) {
    const tab = await chrome.tabs.get(tabId);
    const url = new URL(String(tab?.url || ""));
    if (!["chatgpt.com", "chat.openai.com"].includes(url.hostname.toLowerCase())) throw new Error("chatgpt_cdp_target_host_mismatch");
    if (!url.pathname.startsWith("/c/")) throw new Error("chatgpt_cdp_target_not_conversation");
  }

  async function inspectComposer(tabId) {
    return evaluate(tabId, `(() => {
      const visible = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
      };
      const composers = [...document.querySelectorAll('#prompt-textarea')].filter(visible);
      if (composers.length !== 1) return { ok:false, error:'composer_count', count:composers.length };
      const composer = composers[0];
      const form = composer.closest('form');
      if (!form) return { ok:false, error:'composer_form_missing' };
      const text = String(composer.innerText || composer.textContent || '').replace(/\\r\\n/g, '\\n').trim();
      return { ok:true, text };
    })()`);
  }

  async function focusComposer(tabId) {
    const result = await evaluate(tabId, `(() => {
      const el = document.querySelector('#prompt-textarea');
      if (!(el instanceof HTMLElement)) return false;
      el.focus();
      return document.activeElement === el || el.contains(document.activeElement);
    })()`);
    if (result !== true) throw new Error("chatgpt_cdp_focus_failed");
  }

  async function clearComposerTrusted(tabId) {
    await send(tabId, "Input.dispatchKeyEvent", { type: "rawKeyDown", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65 });
    await send(tabId, "Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65 });
    await send(tabId, "Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
    await send(tabId, "Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
  }

  async function insertComposerAtomic(tabId, text) {
    const result = await evaluate(tabId, `(() => {
      const text = ${JSON.stringify(text)};
      const visible = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
      };
      const composers = [...document.querySelectorAll('#prompt-textarea')].filter(visible);
      if (composers.length !== 1) return { ok:false, error:'composer_count' };
      const composer = composers[0];
      composer.focus();
      if (!(document.activeElement === composer || composer.contains(document.activeElement))) return { ok:false, error:'focus_failed' };
      const inserted = document.execCommand('insertText', false, text);
      return { ok: inserted === true };
    })()`);
    if (!result?.ok) throw new Error(`chatgpt_cdp_atomic_insert_${result?.error || "failed"}`);
  }

  async function insertComposerTrusted(tabId, text) {
    if (text.length > ATOMIC_LONG_PROMPT_THRESHOLD) {
      await insertComposerAtomic(tabId, text);
      return "ATOMIC_EXEC_COMMAND";
    }
    await send(tabId, "Input.insertText", { text });
    return "CDP_INPUT_INSERT_TEXT";
  }

  async function inspectSend(tabId, expectedText) {
    return evaluate(tabId, `(() => {
      const expected = ${JSON.stringify(expectedText)};
      const norm = (v) => String(v ?? '').replace(/\\r\\n/g, '\\n').trim();
      const visible = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
      };
      const composers = [...document.querySelectorAll('#prompt-textarea')].filter(visible);
      if (composers.length !== 1) return { ok:false, error:'composer_count', count:composers.length };
      const composer = composers[0];
      const form = composer.closest('form');
      if (!form) return { ok:false, error:'composer_form_missing' };
      const text = norm(composer.innerText || composer.textContent || '');
      if (text !== norm(expected)) return { ok:false, error:'composer_readback_mismatch' };
      const raw = [
        ...form.querySelectorAll('#composer-submit-button'),
        ...form.querySelectorAll("button[data-testid='send-button']"),
        ...form.querySelectorAll("button[data-testid='composer-submit-button']")
      ];
      const buttons = [...new Set(raw)].filter(visible);
      if (buttons.length !== 1) return { ok:false, error:'send_count', count:buttons.length };
      const button = buttons[0];
      if (!(button instanceof HTMLButtonElement)) return { ok:false, error:'send_not_button' };
      if (button.disabled || button.getAttribute('aria-disabled') === 'true') return { ok:false, error:'send_disabled' };
      const rect = button.getBoundingClientRect();
      return { ok:true, x:rect.left + rect.width / 2, y:rect.top + rect.height / 2 };
    })()`);
  }

  async function withDebugger(tabId, operation) {
    if (inFlightTabs.has(tabId)) throw new Error("chatgpt_cdp_tab_busy");
    inFlightTabs.add(tabId);
    let attached = false;
    try {
      await ensureArmed();
      await ensurePinnedChatgptTab(tabId);
      await chrome.debugger.attach(target(tabId), CDP_VERSION);
      attached = true;
      return await operation();
    } finally {
      if (attached) { try { await chrome.debugger.detach(target(tabId)); } catch (_) {} }
      inFlightTabs.delete(tabId);
    }
  }

  async function trustedPrime(tabId, prompt) {
    const text = validateBridgePrompt(prompt);
    return withDebugger(tabId, async () => {
      const before = await inspectComposer(tabId);
      if (!before?.ok) throw new Error(`chatgpt_cdp_${before?.error || "composer_inspect_failed"}`);
      const beforeText = normalize(before.text);
      if (beforeText !== "" && beforeText !== normalize(text)) throw new Error("chatgpt_cdp_composer_not_empty");

      await focusComposer(tabId);
      await clearComposerTrusted(tabId);
      await sleep(80);
      const insertionMode = await insertComposerTrusted(tabId, text);
      await sleep(text.length > ATOMIC_LONG_PROMPT_THRESHOLD ? 500 : 220);

      const after = await inspectComposer(tabId);
      if (!after?.ok || normalize(after.text) !== normalize(text)) throw new Error("chatgpt_cdp_prime_readback_mismatch");
      return { ok: true, phase: "PRIMED", insertion_mode: insertionMode };
    });
  }

  async function trustedClick(tabId, prompt) {
    const text = validateBridgePrompt(prompt);
    return withDebugger(tabId, async () => {
      const sendState = await inspectSend(tabId, text);
      if (!sendState?.ok) throw new Error(`chatgpt_cdp_${sendState?.error || "send_inspect_failed"}`);
      await send(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x: sendState.x, y: sendState.y });
      await send(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", x: sendState.x, y: sendState.y, button: "left", clickCount: 1 });
      await send(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", x: sendState.x, y: sendState.y, button: "left", clickCount: 1 });
      return { ok: true, phase: "CLICKED" };
    });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!["A2_CHATGPT_TRUSTED_PRIME", "A2_CHATGPT_TRUSTED_CLICK"].includes(message?.type)) return false;
    const tabId = sender.tab?.id;
    if (!Number.isInteger(tabId)) {
      sendResponse({ ok: false, error: "chatgpt_cdp_sender_tab_missing" });
      return false;
    }
    const action = message.type === "A2_CHATGPT_TRUSTED_PRIME" ? trustedPrime : trustedClick;
    action(tabId, message.prompt)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  });
})();
