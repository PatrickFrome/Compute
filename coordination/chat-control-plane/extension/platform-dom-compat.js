(() => {
  "use strict";

  function markExactSendButton(selector) {
    const matches = [...document.querySelectorAll(selector)];
    if (matches.length !== 1) return false;
    const button = matches[0];
    if (!(button instanceof HTMLButtonElement)) return false;
    if (!button.getAttribute("data-testid")) button.setAttribute("data-testid", "send-button");
    return true;
  }

  function markBoundSubmitFallback(composerSelector) {
    const composers = [...document.querySelectorAll(composerSelector)];
    if (composers.length !== 1) return false;
    const composer = composers[0];
    const form = composer.closest("form");
    if (!form) return false;
    const candidates = [...form.querySelectorAll("button[type='submit']")]
      .filter((button) => !button.matches("[data-autothink], [data-active]"));
    if (candidates.length !== 1) return false;
    const button = candidates[0];
    if (!button.getAttribute("data-testid")) button.setAttribute("data-testid", "send-button");
    return true;
  }

  function reconcile() {
    const host = location.hostname.toLowerCase();
    if (host === "chat.z.ai") {
      if (!markExactSendButton("#send-message-button") && !markExactSendButton("button.sendMessageButton")) {
        markBoundSubmitFallback("#chat-input");
      }
      return;
    }
    if (host === "chatgpt.com" || host === "chat.openai.com") {
      if (!markExactSendButton("#composer-submit-button")) markBoundSubmitFallback("#prompt-textarea");
    }
  }

  reconcile();
  const observer = new MutationObserver(() => reconcile());
  observer.observe(document.documentElement, { subtree: true, childList: true });
})();
