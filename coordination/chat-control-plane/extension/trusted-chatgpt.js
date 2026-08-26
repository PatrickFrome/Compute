(() => {
  "use strict";

  const CDP_VERSION = "1.3";
  const MAX_PROMPT_CHARS = 120000;
  const SEND_READY_TIMEOUT_MS = 3000;
  const SEND_READY_POLL_MS = 50;
  const inFlightTabs = new Set();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const canonicalVisible = (value) => String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/\s+/gu, " ")
    .trim();

  function target(tabId) { return { tabId }; }
  async function send(tabId, method, params = {}) {
    return chrome.debugger.sendCommand(target(tabId), method, params);
  }

  async function evaluate(tabId, expression) {
    const result = await send(tabId, "Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
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
    if (!["chatgpt.com", "chat.openai.com"].includes(url.hostname.toLowerCase())) {
      throw new Error("chatgpt_cdp_target_host_mismatch");
    }
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
      return { ok:true, text:String(composer.innerText || composer.textContent || '') };
    })()`);
  }

  async function focusComposer(tabId) {
    const result = await evaluate(tabId, `(() => {
      const composers = [...document.querySelectorAll('#prompt-textarea')];
      if (composers.length !== 1) return false;
      const el = composers[0];
      if (!(el instanceof HTMLElement)) return false;
      el.focus();
      return document.activeElement === el || el.contains(document.activeElement);
    })()`);
    if (result !== true) throw new Error("chatgpt_cdp_focus_failed");
  }

  async function inspectReadySend(tabId, expectedText) {
    return evaluate(tabId, `(() => {
      const expected = ${JSON.stringify(expectedText)};
      const canon = (v) => String(v ?? '')
        .replace(/\\r\\n?/g, '\\n')
        .replace(/\u00a0/g, ' ')
        .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
        .replace(/\s+/gu, ' ')
        .trim();
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
      const text = composer.innerText || composer.textContent || '';
      if (canon(text) !== canon(expected)) return { ok:false, error:'composer_readback_pending' };
      const raw = [
        ...form.querySelectorAll('#composer-submit-button'),
        ...form.querySelectorAll("button[data-testid='send-button']"),
        ...form.querySelectorAll("button[data-testid='composer-submit-button']")
      ];
      const buttons = [...new Set(raw)].filter(visible);
      if (buttons.length === 0) return { ok:false, error:'send_pending', count:0 };
      if (buttons.length !== 1) return { ok:false, error:'send_ambiguous', count:buttons.length };
      const button = buttons[0];
      if (!(button instanceof HTMLButtonElement)) return { ok:false, error:'send_not_button' };
      if (button.disabled || button.getAttribute('aria-disabled') === 'true') return { ok:false, error:'send_pending', count:1 };
      const rect = button.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      if (!hit || !(hit === button || button.contains(hit))) return { ok:false, error:'send_obscured' };
      return { ok:true, x, y };
    })()`);
  }

  async function waitForReadySend(tabId, text) {
    const deadline = Date.now() + SEND_READY_TIMEOUT_MS;
    let lastError = "send_not_ready";
    while (Date.now() < deadline) {
      const state = await inspectReadySend(tabId, text);
      if (state?.ok) return state;
      lastError = String(state?.error || lastError);
      if (["composer_count", "composer_form_missing", "send_ambiguous", "send_not_button", "send_obscured"].includes(lastError)) {
        throw new Error(`chatgpt_cdp_${lastError}`);
      }
      await sleep(SEND_READY_POLL_MS);
    }
    throw new Error(`chatgpt_cdp_${lastError}`);
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
      if (attached) {
        try { await chrome.debugger.detach(target(tabId)); } catch (_) {}
      }
      inFlightTabs.delete(tabId);
    }
  }

  async function trustedSend(tabId, prompt) {
    const text = validateBridgePrompt(prompt);
    return withDebugger(tabId, async () => {
      const before = await inspectComposer(tabId);
      if (!before?.ok) throw new Error(`chatgpt_cdp_${before?.error || "composer_inspect_failed"}`);
      if (canonicalVisible(before.text) !== "") throw new Error("chatgpt_cdp_composer_not_empty");

      await focusComposer(tabId);
      await send(tabId, "Input.insertText", { text });
      const sendState = await waitForReadySend(tabId, text);

      await send(tabId, "Input.dispatchMouseEvent", {
        type: "mouseMoved", x: sendState.x, y: sendState.y, pointerType: "mouse"
      });
      await send(tabId, "Input.dispatchMouseEvent", {
        type: "mousePressed", x: sendState.x, y: sendState.y,
        button: "left", buttons: 1, clickCount: 1, pointerType: "mouse"
      });
      await send(tabId, "Input.dispatchMouseEvent", {
        type: "mouseReleased", x: sendState.x, y: sendState.y,
        button: "left", buttons: 0, clickCount: 1, pointerType: "mouse"
      });
      return { ok: true, phase: "TRUSTED_SEND_DISPATCHED" };
    });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "A2_CHATGPT_TRUSTED_SEND") return false;
    const tabId = sender.tab?.id;
    if (!Number.isInteger(tabId)) {
      sendResponse({ ok: false, error: "chatgpt_cdp_sender_tab_missing" });
      return false;
    }
    trustedSend(tabId, message.prompt)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  });
})();
