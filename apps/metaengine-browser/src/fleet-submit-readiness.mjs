import { chatGptControlCount } from './chatgpt-ui-controls.mjs';

const COMPOSER_NAMES = new Set(['Чат с ChatGPT', 'Chat with ChatGPT', 'Message ChatGPT']);
const CHATGPT_RATE_LIMIT_RE = /(?:too many requests|rate[ -]?limit(?:ed|ing)?|please wait (?:a few|several) minutes|try again (?:in a few minutes|later)|слишком много запросов|подождите (?:несколько|пару) минут|повторите попытку позже)/iu;
export const CHATGPT_RATE_LIMIT_BACKOFF_MS = 60_000;

function exact(frame, role, names) {
  const rows = (frame?.semantic_targets || []).filter((row) => {
    const rowRole = String(row?.role || '').toLowerCase();
    const rowName = String(row?.name || '');
    return rowRole === role && names.has(rowName);
  });
  return rows.length === 1 ? structuredClone(rows[0]) : null;
}

export function detectChatGptRateLimitBackpressure(frame) {
  const text = String(frame?.text_excerpt || '');
  const semantic = (frame?.semantic_targets || [])
    .filter((row) => ['alert','status','dialog','statictext','paragraph'].includes(String(row?.role || '').toLowerCase()))
    .map((row) => String(row?.name || ''))
    .join('\n');
  const observed = `${text}\n${semantic}`.slice(0, 24000);
  if (!CHATGPT_RATE_LIMIT_RE.test(observed)) return null;
  return Object.freeze({
    state: 'CHATGPT_RATE_LIMIT_BACKPRESSURE',
    retry_after_ms: CHATGPT_RATE_LIMIT_BACKOFF_MS,
    denial_only: true,
    physical_effect_attempted: false,
    effect_barrier_crossed: false,
    automatic_retry_allowed: false,
    page_data_authority: false,
    authority_effect: false,
  });
}

export function evaluateFleetSubmitReadiness({
  frame,
  expected_tab_id,
  observed_tab_id,
  expected_target_id,
  observed_target_id,
  selected_tab_id,
} = {}) {
  const expectedTab = String(expected_tab_id || '');
  const observedTab = String(observed_tab_id || '');
  const expectedTarget = String(expected_target_id || '').toLowerCase();
  const observedTarget = String(observed_target_id || '').toLowerCase();
  const selectedTab = String(selected_tab_id || '');

  if (!expectedTab || observedTab !== expectedTab || selectedTab !== expectedTab) {
    return Object.freeze({ ready: false, reason: 'TAB_NOT_FOREGROUND_EXACT', authority_effect: false });
  }
  if (!expectedTarget || observedTarget !== expectedTarget) {
    return Object.freeze({ ready: false, reason: 'TARGET_INCARNATION_MISMATCH', authority_effect: false });
  }
  if (chatGptControlCount(frame, 'STOP') > 0) {
    return Object.freeze({ ready: false, reason: 'GENERATION_ALREADY_ACTIVE', authority_effect: false });
  }
  const rateLimit = detectChatGptRateLimitBackpressure(frame);
  if (rateLimit) {
    return Object.freeze({ ready: false, reason: rateLimit.state, ...rateLimit });
  }
  const width = Number(frame?.viewport?.width || 0);
  const height = Number(frame?.viewport?.height || 0);
  if (!(width > 0 && height > 0)) {
    return Object.freeze({ ready: false, reason: 'VIEWPORT_NOT_RENDERABLE', authority_effect: false });
  }
  const composer = exact(frame, 'textbox', COMPOSER_NAMES);
  if (!composer) {
    return Object.freeze({ ready: false, reason: 'COMPOSER_NOT_UNIQUE', authority_effect: false });
  }
  if (chatGptControlCount(frame, 'SEND') !== 1) {
    return Object.freeze({ ready: false, reason: 'SEND_CONTROL_NOT_UNIQUE', authority_effect: false });
  }
  const send = (frame?.semantic_targets || []).find((row) => String(row?.role || '').toLowerCase() === 'button' && chatGptControlCount({ semantic_targets: [row] }, 'SEND') === 1);
  if (!send) return Object.freeze({ ready: false, reason: 'SEND_CONTROL_NOT_UNIQUE', authority_effect: false });

  return Object.freeze({
    ready: true,
    reason: 'READY_FOR_TWO_PHASE_SEND',
    composer,
    send_control: structuredClone(send),
    viewport: Object.freeze({ width, height }),
    submit_strategy: 'TYPE_WITHOUT_SUBMIT_THEN_TYPED_CLICK_SEND',
    automatic_retry_allowed: false,
    page_data_authority: false,
    authority_effect: false,
  });
}
