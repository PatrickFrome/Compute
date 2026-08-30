const patterns = Object.freeze({
  STOP: Object.freeze([
    /^stop$/i,
    /^stop generating$/i,
    /^stop response$/i,
    /^stop answering$/i,
    /^остановить$/i,
    /^остановить создание$/i,
    /^остановить ответ$/i,
    /^остановить генерацию$/i,
  ]),
  CONTINUE: Object.freeze([
    /^continue$/i,
    /^continue generating$/i,
    /^continue response$/i,
    /^продолжить$/i,
    /^продолжить создание$/i,
    /^продолжить ответ$/i,
    /^продолжить генерацию$/i,
  ]),
  SEND: Object.freeze([
    /^send$/i,
    /^send prompt$/i,
    /^send message$/i,
    /^отправить$/i,
    /^отправить промпт$/i,
    /^отправить сообщение$/i,
  ]),
  RETRY: Object.freeze([
    /^retry$/i,
    /^try again$/i,
    /^regenerate$/i,
    /^regenerate response$/i,
    /^создать заново$/i,
    /^повторить$/i,
    /^повторить ответ$/i,
  ]),
});

export const CHATGPT_UI_CONTROL_VOCABULARY_VERSION = '1.0.0-dev.1';

export function chatGptControlMatches(kind, name) {
  const rows = patterns[String(kind || '').toUpperCase()] || [];
  const value = String(name || '').trim();
  return Boolean(value) && rows.some((re) => re.test(value));
}

export function chatGptControlCount(frame, kind) {
  return (frame?.semantic_targets || []).filter((row) =>
    String(row?.role || '').toLowerCase() === 'button' && chatGptControlMatches(kind, row?.name)
  ).length;
}

export function uniqueChatGptControl(frame, kind) {
  const rows = (frame?.semantic_targets || []).filter((row) =>
    String(row?.role || '').toLowerCase() === 'button' && chatGptControlMatches(kind, row?.name)
  );
  return rows.length === 1 ? structuredClone(rows[0]) : null;
}

export function chatGptUiControlVocabulary() {
  return Object.freeze({
    schema: 'metaengine.chatgpt-ui-control-vocabulary.v1',
    version: CHATGPT_UI_CONTROL_VOCABULARY_VERSION,
    kinds: Object.keys(patterns),
    exact_semantic_fallback_required_for_unknown_labels: true,
    page_text_has_authority: false,
    authority_effect: false,
  });
}
