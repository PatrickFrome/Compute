(() => {
  "use strict";

  const EXHAUSTION_PATTERN = /(?:you['’]?ve\s+reached\s+the\s+maximum\s+length\s+for\s+this\s+conversation|maximum\s+length\s+for\s+this\s+conversation|conversation\s+(?:has\s+)?reached\s+(?:its\s+)?maximum\s+length|start\s+a\s+new\s+chat\s+to\s+continue)/iu;
  const TURN_SELECTOR = "[data-testid^='conversation-turn-'], article[data-testid^='conversation-turn-']";

  function isChatGpt() {
    const host = String(location.hostname || "").toLowerCase();
    return host === "chatgpt.com" || host === "chat.openai.com";
  }

  function visible(element) {
    if (!(element instanceof HTMLElement)) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
  }

  function textOf(element) {
    return String(element?.innerText || element?.textContent || "").replace(/\s+/gu, " ").trim().slice(0, 2400);
  }

  function exhaustionStatus() {
    if (!isChatGpt()) return { ok: true, exhausted: false, reason: "not_chatgpt" };
    const selectors = [
      "[role='alert']", "[role='status']", "[data-testid*='error']", "[data-testid*='notice']",
      "[data-testid*='limit']", "main [class*='error']", "main [class*='notice']", "main [class*='limit']",
      "main p", "main button"
    ];
    const seen = new Set();
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (!(element instanceof HTMLElement) || seen.has(element) || !visible(element) || element.closest(TURN_SELECTOR)) continue;
        seen.add(element);
        const text = textOf(element);
        if (text && EXHAUSTION_PATTERN.test(text)) {
          return { ok: true, exhausted: true, reason: "conversation_length_limit", matched_text: text.slice(0, 500) };
        }
      }
    }
    return { ok: true, exhausted: false, reason: "not_detected" };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "A2_CHATGPT_EXHAUSTION_STATUS") return false;
    try { sendResponse(exhaustionStatus()); }
    catch (error) { sendResponse({ ok: false, exhausted: false, error: String(error?.message || error) }); }
    return false;
  });
})();
