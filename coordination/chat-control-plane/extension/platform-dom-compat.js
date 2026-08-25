(() => {
  "use strict";

  const CHATGPT_SUBMIT_FALLBACK_MARK = "data-a2-chatgpt-submit-fallback";
  const CHATGPT_FALLBACK_DELAY_MS = 900;

  function composerText(element) {
    if (!element) return "";
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      return String(element.value || "").replace(/\r\n/g, "\n").trim();
    }
    return String(element.innerText || element.textContent || "").replace(/\r\n/g, "\n").trim();
  }

  function chatgptGenerating() {
    return Boolean(document.querySelector(
      "button[data-testid='stop-button'], button[data-testid='composer-stop-button']"
    ));
  }

  function installChatgptSubmitFallback(button) {
    if (!(button instanceof HTMLButtonElement)) return false;
    if (button.getAttribute(CHATGPT_SUBMIT_FALLBACK_MARK) === "1") return true;
    button.setAttribute(CHATGPT_SUBMIT_FALLBACK_MARK, "1");

    button.addEventListener("click", () => {
      const composer = document.querySelector("#prompt-textarea");
      if (!(composer instanceof HTMLElement)) return;
      const form = composer.closest("form");
      if (!form || !form.contains(button)) return;
      const before = composerText(composer);
      if (!before) return;

      setTimeout(() => {
        if (!composer.isConnected || !form.isConnected || !button.isConnected) return;
        if (composerText(composer) !== before) return;
        if (chatgptGenerating()) return;
        if (button.disabled || button.getAttribute("aria-disabled") === "true") return;
        if (typeof form.requestSubmit !== "function") return;

        try {
          // ChatGPT can ignore HTMLElement.click() from an isolated-world content
          // script even though the exact visible Send control was resolved. Use
          // the already-bound composer form as the narrowly scoped native submit
          // fallback only when the synthetic click produced no observable state
          // change during the grace period.
          if (button.type === "submit") form.requestSubmit(button);
          else form.requestSubmit();
        } catch (_) {
          // Fail closed. The primary adapter's DOM verification will report the
          // unchanged composer instead of attempting any broader interaction.
        }
      }, CHATGPT_FALLBACK_DELAY_MS);
    });
    return true;
  }

  function markExactSendButton(selector, installChatgptFallback = false) {
    const matches = [...document.querySelectorAll(selector)];
    if (matches.length !== 1) return false;
    const button = matches[0];
    if (!(button instanceof HTMLButtonElement)) return false;
    if (!button.getAttribute("data-testid")) {
      button.setAttribute("data-testid", "send-button");
    }
    if (installChatgptFallback) installChatgptSubmitFallback(button);
    return true;
  }

  function markBoundSubmitFallback(composerSelector, installChatgptFallback = false) {
    const composers = [...document.querySelectorAll(composerSelector)];
    if (composers.length !== 1) return false;
    const composer = composers[0];
    const form = composer.closest("form");
    if (!form) return false;
    const candidates = [...form.querySelectorAll("button[type='submit']")];
    if (candidates.length !== 1) return false;
    const button = candidates[0];
    if (!button.getAttribute("data-testid")) {
      button.setAttribute("data-testid", "send-button");
    }
    if (installChatgptFallback) installChatgptSubmitFallback(button);
    return true;
  }

  function reconcile() {
    const host = location.hostname.toLowerCase();
    if (host === "chat.z.ai") {
      if (!markExactSendButton("#send-message-button")) {
        markBoundSubmitFallback("#chat-input");
      }
      return;
    }
    if (host === "chatgpt.com" || host === "chat.openai.com") {
      if (!markExactSendButton("#composer-submit-button", true)) {
        markBoundSubmitFallback("#prompt-textarea", true);
      }
    }
  }

  reconcile();
  const observer = new MutationObserver(() => reconcile());
  observer.observe(document.documentElement, { subtree: true, childList: true });
})();
