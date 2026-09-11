const CHATGPT_URL_RE = /^https:\/\/(?:www\.)?chatgpt\.com\/(?:c\/[a-z0-9-]+.*)?$/i;
const THROTTLE_HEADLINE_RE = /(?:слишком\s+много\s+запросов|too\s+many\s+requests|requests?\s+too\s+frequently)/i;
const THROTTLE_CONTEXT_RE = /(?:доступ\s+к\s+вашим\s+диалогам\s+временно\s+ограничен|подождите\s+несколько\s+минут|temporarily\s+(?:limited|restricted)|wait\s+(?:a\s+few|several)\s+minutes)/i;
const ACK_RE = /^(?:понятно|got\s+it|ok|okay)$/i;

function targets(frame, role) {
  return (Array.isArray(frame?.semantic_targets) ? frame.semantic_targets : [])
    .filter((row) => String(row?.role || '').toLowerCase() === role);
}

export function classifyChatGptServiceThrottle(frame) {
  const url = String(frame?.url || '');
  if (!CHATGPT_URL_RE.test(url)) return null;
  const text = String(frame?.text_excerpt || '').slice(0, 16_000);
  if (!THROTTLE_HEADLINE_RE.test(text) || !THROTTLE_CONTEXT_RE.test(text)) return null;
  const buttons = targets(frame, 'button');
  const hasAck = buttons.some((row) => ACK_RE.test(String(row?.name || '').trim()));
  const hasComposer = targets(frame, 'textbox').length > 0;
  // Exact server throttle language is not enough by itself because a user may quote
  // those words in a conversation. Require either the bounded acknowledgement dialog
  // control or the absence of a composer on the captured ChatGPT surface.
  if (!hasAck && hasComposer) return null;
  return Object.freeze({
    state: 'THROTTLED',
    reason: 'CHATGPT_RATE_LIMIT_DIALOG',
    acknowledgement_present: hasAck,
    composer_present: hasComposer,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

export function chatGptServiceAvailableReadback(frame) {
  const url = String(frame?.url || '');
  if (!CHATGPT_URL_RE.test(url)) return false;
  if (classifyChatGptServiceThrottle(frame)) return false;
  return targets(frame, 'textbox').length === 1;
}

export class ChatGptServiceThrottleGate {
  #active = null;
  #clock;

  constructor({ clock = () => Date.now() } = {}) {
    this.#clock = clock;
  }

  observe(tabId, frame) {
    const throttle = classifyChatGptServiceThrottle(frame);
    if (throttle) {
      const now = Number(this.#clock());
      const firstObservedAt = this.#active?.first_observed_at || new Date(now).toISOString();
      this.#active = {
        schema: 'metaengine.chatgpt-service-throttle.v1',
        state: 'THROTTLED',
        reason: throttle.reason,
        source_tab_id: String(tabId || frame?.tab_id || ''),
        first_observed_at: firstObservedAt,
        last_observed_at: new Date(now).toISOString(),
        automatic_retry_allowed: false,
        authority_effect: false,
      };
      return this.snapshot();
    }
    if (this.#active && chatGptServiceAvailableReadback(frame)) this.#active = null;
    return this.snapshot();
  }

  active() { return this.#active != null; }

  snapshot() {
    if (this.#active) return structuredClone(this.#active);
    return {
      schema: 'metaengine.chatgpt-service-throttle.v1',
      state: 'AVAILABLE',
      reason: null,
      source_tab_id: null,
      first_observed_at: null,
      last_observed_at: null,
      automatic_retry_allowed: false,
      authority_effect: false,
    };
  }
}
