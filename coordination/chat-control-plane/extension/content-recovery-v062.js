(() => {
  "use strict";

  const EXHAUSTION_CANONICAL_PHRASE = "maximum length for this conversation";
  const EXHAUSTION_PATTERN = /(?:you['’]?ve\s+reached\s+the\s+maximum\s+length\s+for\s+this\s+conversation|maximum\s+length\s+for\s+this\s+conversation|conversation\s+(?:has\s+)?reached\s+(?:its\s+)?maximum\s+length|start\s+a\s+new\s+chat\s+to\s+continue|вы\s+достигли\s+максимальн(?:ой|ую)\s+длин(?:ы|у)\s+(?:этого|данного|текущего)?\s*(?:разговора|чата)|достигнута\s+максимальная\s+длина\s+(?:этого|данного|текущего)?\s*(?:разговора|чата)|(?:разговор|чат)\s+достиг\s+максимальной\s+длины|начните\s+новый\s+чат[,]?\s+чтобы\s+продолжить)/iu;
  const TURN_SELECTOR = "[data-testid^='conversation-turn-'], article[data-testid^='conversation-turn-']";
  const TURN_NOTICE_MAX_CHARS = 700;

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

  function textOf(element, max = 2400) {
    return String(element?.innerText || element?.textContent || "").replace(/\s+/gu, " ").trim().slice(0, max);
  }

  function matchingNotice(element, reason) {
    if (!(element instanceof HTMLElement) || !visible(element)) return null;
    const text = textOf(element);
    if (!text || !EXHAUSTION_PATTERN.test(text)) return null;
    return { ok: true, exhausted: true, reason, canonical_phrase: EXHAUSTION_CANONICAL_PHRASE, matched_text: text.slice(0, 500) };
  }

  function lastTurnNotice() {
    const turns = [...document.querySelectorAll(TURN_SELECTOR)].filter((element) => element instanceof HTMLElement && visible(element));
    const last = turns[turns.length - 1];
    if (!last) return null;

    const noticeSelectors = ["[role='alert']", "[role='status']", "[data-testid*='error']", "[data-testid*='notice']", "[data-testid*='limit']"];
    for (const selector of noticeSelectors) {
      for (const element of last.querySelectorAll(selector)) {
        const match = matchingNotice(element, "conversation_length_limit_turn_notice");
        if (match) return match;
      }
    }

    const compact = textOf(last, TURN_NOTICE_MAX_CHARS + 1);
    if (compact && compact.length <= TURN_NOTICE_MAX_CHARS && EXHAUSTION_PATTERN.test(compact)) {
      return { ok: true, exhausted: true, reason: "conversation_length_limit_short_turn", canonical_phrase: EXHAUSTION_CANONICAL_PHRASE, matched_text: compact.slice(0, 500) };
    }
    return null;
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
        const match = matchingNotice(element, "conversation_length_limit");
        if (match) return match;
      }
    }
    return lastTurnNotice() || { ok: true, exhausted: false, reason: "not_detected" };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "A2_CHATGPT_EXHAUSTION_STATUS") return false;
    try { sendResponse(exhaustionStatus()); }
    catch (error) { sendResponse({ ok: false, exhausted: false, error: String(error?.message || error) }); }
    return false;
  });
})();
