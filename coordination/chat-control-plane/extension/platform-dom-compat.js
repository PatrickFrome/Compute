(() => {
  "use strict";

  const CHATGPT_TRUSTED_SEND_MARK = "data-a2-chatgpt-trusted-send";
  let primeInFlight = "";
  let lastPrimedPrompt = "";
  let primeRetryTimer = null;

  function composerText(element) {
    if (!element) return "";
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      return String(element.value || "").replace(/\r\n/g, "\n").trim();
    }
    return String(element.innerText || element.textContent || "").replace(/\r\n/g, "\n").trim();
  }

  function isBridgeOwnedGptPrompt(prompt) {
    return prompt.startsWith("A2 CHAT BRIDGE — AUTONOMOUS CONTINUE")
      && prompt.includes("bridge_job_target=GPT")
      && prompt.includes("transport=WEB_CHAT_INTERACTIVE_REMOTE");
  }

  function schedulePrimeRetry() {
    if (primeRetryTimer) return;
    primeRetryTimer = setTimeout(() => {
      primeRetryTimer = null;
      reconcile();
    }, 450);
  }

  function maybePrimeChatgptComposer() {
    const composers = [...document.querySelectorAll("#prompt-textarea")];
    if (composers.length !== 1) return false;
    const prompt = composerText(composers[0]);
    if (!isBridgeOwnedGptPrompt(prompt)) {
      if (!prompt) lastPrimedPrompt = "";
      return false;
    }
    if (prompt === lastPrimedPrompt || prompt === primeInFlight) return true;

    primeInFlight = prompt;
    chrome.runtime.sendMessage({ type: "A2_CHATGPT_TRUSTED_PRIME", prompt })
      .then((response) => {
        if (response?.ok === true) {
          lastPrimedPrompt = prompt;
        } else {
          lastPrimedPrompt = "";
          schedulePrimeRetry();
        }
      })
      .catch(() => {
        lastPrimedPrompt = "";
        schedulePrimeRetry();
      })
      .finally(() => {
        if (primeInFlight === prompt) primeInFlight = "";
      });
    return true;
  }

  function installChatgptTrustedSendBridge() {
    const composers = [...document.querySelectorAll("#prompt-textarea")];
    if (composers.length !== 1) return false;
    const composer = composers[0];
    const form = composer.closest("form");
    if (!form) return false;

    const raw = [
      ...form.querySelectorAll("#composer-submit-button"),
      ...form.querySelectorAll("button[data-testid='send-button']"),
      ...form.querySelectorAll("button[data-testid='composer-submit-button']")
    ];
    const candidates = [...new Set(raw)];
    if (candidates.length !== 1) return false;
    const button = candidates[0];
    if (!(button instanceof HTMLButtonElement)) return false;
    if (!form.contains(button)) return false;
    if (button.getAttribute(CHATGPT_TRUSTED_SEND_MARK) === "1") return true;
    button.setAttribute(CHATGPT_TRUSTED_SEND_MARK, "1");

    button.addEventListener("click", (event) => {
      // Human clicks are already trusted and must pass through unchanged. The
      // bridge's synthetic click is stopped before ChatGPT sees it, then upgraded
      // to a scoped CDP mouse click by the service worker.
      if (event.isTrusted) return;
      const prompt = composerText(composer);
      if (!isBridgeOwnedGptPrompt(prompt)) return;
      if (button.disabled || button.getAttribute("aria-disabled") === "true") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      chrome.runtime.sendMessage({ type: "A2_CHATGPT_TRUSTED_CLICK", prompt }).catch(() => {});
    }, true);
    return true;
  }

  function markExactSendButton(selector) {
    const matches = [...document.querySelectorAll(selector)];
    if (matches.length !== 1) return false;
    const button = matches[0];
    if (!(button instanceof HTMLButtonElement)) return false;
    if (!button.getAttribute("data-testid")) {
      button.setAttribute("data-testid", "send-button");
    }
    return true;
  }

  function markBoundSubmitFallback(composerSelector) {
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
      maybePrimeChatgptComposer();
      if (!markExactSendButton("#composer-submit-button")) {
        markBoundSubmitFallback("#prompt-textarea");
      }
      installChatgptTrustedSendBridge();
    }
  }

  reconcile();
  const observer = new MutationObserver(() => reconcile());
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["disabled", "aria-disabled", "data-testid"]
  });
})();
