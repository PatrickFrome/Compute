/**
 * Source-independent, inert oracle for normalized delivery event traces.
 * It does NOT connect to METAENGINE, perform ACKs, or prove production behavior.
 */
export function auditDeliveryTrace(events, { requireFinalPagination = true } = {}) {
  const issues = [];
  const messages = new Map();
  const deliveries = new Map();
  const readers = new Map();
  const effects = new Map();
  let duplicates = 0;
  let verifiedCompletions = 0;

  const report = (code, index, detail = '') => issues.push({ code, index, detail });
  const key = value => value === undefined ? null : value;
  for (let index = 0; index < events.length; index++) {
    const e = events[index];
    if (!e || typeof e !== 'object' || typeof e.type !== 'string') {
      report('BAD_EVENT', index);
      continue;
    }
    switch (e.type) {
      case 'produced': {
        if (!e.message_id || !e.producer_id) { report('BAD_PRODUCTION', index); break; }
        const existing = messages.get(e.message_id);
        if (existing && existing !== e.producer_id) report('PRODUCER_CONFLICT', index, e.message_id);
        messages.set(e.message_id, e.producer_id);
        break;
      }
      case 'pending_page': {
        if (!e.reader_id || typeof e.has_more !== 'boolean') { report('BAD_PAGE', index); break; }
        const prev = readers.get(e.reader_id);
        const pageKey = JSON.stringify(key(e.cursor_in));
        const pageSignature = JSON.stringify([key(e.cursor_out), e.has_more, e.message_ids ?? []]);
        const priorPage = prev?.seen.get(pageKey);
        if (priorPage !== undefined) {
          if (priorPage === pageSignature) duplicates++;
          else report('PAGE_REPLAY_CONFLICT', index, e.reader_id);
          break;
        }
        if (prev?.done) report('PAGE_AFTER_TERMINAL', index, e.reader_id);
        if (prev && key(e.cursor_in) !== prev.next) report('CURSOR_DISCONTINUITY', index, e.reader_id);
        if (!prev && key(e.cursor_in) !== null) report('UNPROVEN_INITIAL_CURSOR', index, e.reader_id);
        if (e.has_more && (typeof e.cursor_out !== 'string' || !e.cursor_out)) report('MISSING_NEXT_CURSOR', index, e.reader_id);
        if (e.has_more && e.cursor_out === key(e.cursor_in)) report('STUCK_CURSOR', index, e.reader_id);
        const seen = prev?.seen ?? new Map();
        seen.set(pageKey, pageSignature);
        readers.set(e.reader_id, { done: !e.has_more, next: e.has_more ? e.cursor_out : null, seen });
        break;
      }
      case 'caught_up': {
        const reader = readers.get(e.reader_id);
        if (!reader?.done) report('PREMATURE_CAUGHT_UP', index, e.reader_id);
        break;
      }
      case 'delivery': {
        if (!messages.has(e.message_id)) report('UNKNOWN_MESSAGE', index, e.message_id);
        if (!e.delivery_ref || !e.consumer_id) { report('BAD_DELIVERY', index); break; }
        const prior = deliveries.get(e.delivery_ref);
        if (prior) {
          if (prior.message_id !== e.message_id || prior.consumer_id !== e.consumer_id) {
            report('DELIVERY_REF_COLLISION', index, e.delivery_ref);
          } else duplicates++;
        } else {
          deliveries.set(e.delivery_ref, { message_id: e.message_id, consumer_id: e.consumer_id, readback: false, ack_uncertain: false });
        }
        break;
      }
      case 'ack_result': {
        const d = deliveries.get(e.delivery_ref);
        if (!d) { report('ACK_UNKNOWN_REF', index, e.delivery_ref); break; }
        if (!['ok', 'error', 'unknown'].includes(e.outcome)) report('BAD_ACK_OUTCOME', index, e.delivery_ref);
        if (e.outcome === 'unknown') d.ack_uncertain = true;
        // Even 'ok' is an ACK response, not durable readback evidence.
        break;
      }
      case 'ack_readback': {
        const d = deliveries.get(e.delivery_ref);
        if (!d) { report('READBACK_UNKNOWN_REF', index, e.delivery_ref); break; }
        if (e.durable === true) { d.readback = true; d.ack_uncertain = false; }
        else if (e.durable !== false) report('BAD_READBACK', index, e.delivery_ref);
        break;
      }
      case 'complete': {
        const d = deliveries.get(e.delivery_ref);
        if (!d) { report('COMPLETE_UNKNOWN_REF', index, e.delivery_ref); break; }
        if (!d.readback) { report('COMPLETE_WITHOUT_READBACK', index, e.delivery_ref); break; }
        if (!e.effect_key) { report('MISSING_IDEMPOTENCY_KEY', index, e.delivery_ref); break; }
        const effectId = `${d.consumer_id}\u0000${d.message_id}`;
        const previousKey = effects.get(effectId);
        if (previousKey && previousKey !== e.effect_key) report('NONIDEMPOTENT_CONFIRM', index, effectId);
        else if (previousKey) duplicates++;
        else { effects.set(effectId, e.effect_key); verifiedCompletions++; }
        break;
      }
      case 'restart': {
        // Restart alone cannot imply a durable ACK, caught-up page, or lost delivery.
        if (!e.consumer_id) report('BAD_RESTART', index);
        break;
      }
      default: report('UNKNOWN_EVENT_TYPE', index, e.type);
    }
  }
  if (requireFinalPagination) {
    for (const [readerId, state] of readers) {
      if (!state.done) report('INCOMPLETE_PAGE_SCAN', events.length, readerId);
    }
  }
  const uncertainRefs = [...deliveries].filter(([,d]) => d.ack_uncertain && !d.readback).map(([ref]) => ref);
  return {
    ok: issues.length === 0,
    issues,
    summary: { produced: messages.size, unique_deliveries: deliveries.size, duplicate_events: duplicates, verified_completions: verifiedCompletions, uncertain_refs: uncertainRefs },
  };
}
