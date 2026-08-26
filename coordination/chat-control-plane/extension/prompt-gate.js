(() => {
  "use strict";

  const MODES = new Set(["OBSERVE", "GATE_SEND"]);
  const MAX_DRAFT_CHARS = 120000;
  let mode = "OBSERVE";
  let heldIntentId = null;
  let allowOnce = null;

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
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
  }

  function composerCandidates() {
    const selectors = platform() === "CHATGPT"
      ? ["#prompt-textarea", "[data-testid='composer-text-input'] textarea", "[contenteditable='true'][data-lexical-editor='true']", "[role='textbox'][contenteditable='true']"]
      : ["#chat-input", "textarea.input-scroll", ".messageInputContainer textarea", "textarea"];
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
    const found = composerCandidates();
    return found.length === 1 ? found[0] : null;
  }

  function composerText(composer) {
    if (!composer) return "";
    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) return normalize(composer.value);
    return normalize(composer.innerText || composer.textContent || "");
  }

  function isBridgeOwnedDraft(draft) {
    return draft.startsWith("A2 CHAT BRIDGE — AUTONOMOUS CONTINUE") && draft.includes("transport=WEB_CHAT_INTERACTIVE_REMOTE");
  }

  function isStrongSendButton(button) {
    if (!(button instanceof HTMLButtonElement)) return false;
    if (platform() === "CHATGPT") {
      return button.matches("#composer-submit-button, button[data-testid='send-button'], button[data-testid='composer-submit-button']");
    }
    if (platform() === "GLM_ZAI") {
      return button.matches("#send-message-button, button.sendMessageButton");
    }
    return false;
  }

  function consumeAllowOnce(draft) {
    if (!allowOnce) return false;
    if (Date.now() > allowOnce.expiresAt) {
      allowOnce = null;
      return false;
    }
    if (normalize(draft) !== normalize(allowOnce.draft)) return false;
    allowOnce = null;
    return true;
  }

  async function sendIntent(eventType, composer, draft) {
    const response = await chrome.runtime.sendMessage({
      type: "A2_PROMPT_GATE_INTENT",
      event_type: eventType,
      platform: platform(),
      page_url: location.href,
      draft: draft.slice(0, MAX_DRAFT_CHARS)
    }).catch(() => null);
    if (response?.ok && response.intent_id) heldIntentId = String(response.intent_id);
  }

  function intercept(event, eventType) {
    if (mode !== "GATE_SEND" || event.isTrusted !== true) return false;
    const composer = resolveComposer();
    if (!composer) return false;
    const draft = composerText(composer);
    if (!draft || isBridgeOwnedDraft(draft) || consumeAllowOnce(draft)) return false;

    event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation();
    sendIntent(eventType, composer, draft);
    return true;
  }

  window.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
    const composer = resolveComposer();
    if (!composer || !(event.target === composer || composer.contains?.(event.target))) return;
    intercept(event, "TRUSTED_ENTER");
  }, true);

  window.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest("button") : null;
    if (!button || !isStrongSendButton(button)) return;
    intercept(event, "TRUSTED_SEND_CLICK");
  }, true);

  function setDraft(text) {
    const composer = resolveComposer();
    if (!composer) throw new Error("prompt_gate_composer_unavailable");
    const value = String(text ?? "").slice(0, MAX_DRAFT_CHARS);
    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
      const proto = composer instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (!setter) throw new Error("prompt_gate_native_value_setter_unavailable");
      setter.call(composer, value);
    } else if (composer.isContentEditable) {
      composer.focus();
      composer.textContent = value;
    } else {
      throw new Error("prompt_gate_unsupported_composer");
    }
    composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    composer.dispatchEvent(new Event("change", { bubbles: true }));
    const readback = composerText(composer);
    if (normalize(readback) !== normalize(value)) throw new Error("prompt_gate_rewrite_readback_mismatch");
    return readback;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "A2_PROMPT_GATE_CONFIG") {
      const next = String(message.mode || "OBSERVE");
      mode = MODES.has(next) ? next : "OBSERVE";
      sendResponse({ ok: true, mode });
      return false;
    }
    if (message?.type !== "A2_PROMPT_GATE_RESOLUTION") return false;
    try {
      if (heldIntentId && String(message.intent_id || "") !== heldIntentId) throw new Error("prompt_gate_intent_mismatch");
      const action = String(message.action || "CANCEL");
      if (action === "CANCEL") {
        heldIntentId = null;
        sendResponse({ ok: true, action });
        return false;
      }
      if (action === "ALLOW_ONCE") {
        const draft = normalize(String(message.draft || ""));
        if (!draft) throw new Error("prompt_gate_allow_empty");
        allowOnce = { draft, expiresAt: Date.now() + 8000 };
        heldIntentId = null;
        sendResponse({ ok: true, action, expires_in_ms: 8000 });
        return false;
      }
      if (action === "REWRITE_ALLOW_ONCE") {
        const rewritten = setDraft(String(message.draft || ""));
        allowOnce = { draft: rewritten, expiresAt: Date.now() + 8000 };
        heldIntentId = null;
        sendResponse({ ok: true, action, rewritten_length: rewritten.length, expires_in_ms: 8000 });
        return false;
      }
      throw new Error("prompt_gate_resolution_invalid");
    } catch (error) {
      sendResponse({ ok: false, error: String(error?.message || error) });
      return false;
    }
  });

  chrome.runtime.sendMessage({ type: "A2_PROMPT_GATE_READY", platform: platform(), page_url: location.href })
    .then((response) => { if (MODES.has(String(response?.mode || ""))) mode = String(response.mode); })
    .catch(() => {});
})();
