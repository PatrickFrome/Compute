const CHATGPT_CONVERSATION_RE = /^https:\/\/(?:www\.)?chatgpt\.com\/c\/[a-z0-9-]+(?:[/?#].*)?$/i;
const ATTEMPT_RE = /^rollover_[a-z0-9-]{8,160}$/i;
const CORRUPTION_REASON = 'ROLLOVER_ERROR:keepalive_supervisor_conversation_invalid';

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function matchPartiallyAppliedRolloverTranscript({ keepalive, frame } = {}) {
  if (!keepalive || String(keepalive.state || '') !== 'ROLLOVER_AMBIGUOUS') return { matched: false, reason: 'STATE_NOT_AMBIGUOUS' };
  if (keepalive.rollover_attempt != null) return { matched: false, reason: 'DURABLE_ATTEMPT_PRESENT' };
  if (String(keepalive.rollover_reason || '') !== CORRUPTION_REASON) return { matched: false, reason: 'CORRUPTION_SIGNATURE_MISMATCH' };
  if (Number(keepalive.cycle_seq) !== 0) return { matched: false, reason: 'PARTIAL_BIND_CYCLE_MISMATCH' };

  const epoch = Number(keepalive.supervisor_epoch);
  if (!Number.isSafeInteger(epoch) || epoch < 2) return { matched: false, reason: 'PARTIAL_BIND_EPOCH_INVALID' };
  const previous = String(keepalive.conversation_url || '').trim();
  const successor = String(frame?.url || '').trim();
  if (!CHATGPT_CONVERSATION_RE.test(previous)) return { matched: false, reason: 'PREDECESSOR_URL_INVALID' };
  if (!CHATGPT_CONVERSATION_RE.test(successor) || successor === previous) return { matched: false, reason: 'SUCCESSOR_URL_INVALID' };

  const pattern = new RegExp([
    '(?:^|\\n)METAENGINE_SUPERVISOR_ROLLOVER_V1',
    'supervisor_id=METAENGINE_SUPERVISOR',
    `supervisor_epoch=${epoch}`,
    `previous_conversation=${escapeRegex(previous)}`,
    'rollover_attempt_id=(rollover_[a-z0-9-]{8,160})',
    'integration_line=integration/metaengine-development-os-v1',
    'legacy_convergence_line=integration/compute-unified-v1(?:\\n|$)',
  ].join('\\n'), 'gmi');
  const matches = [...String(frame?.text_excerpt || '').replace(/\r\n/g, '\n').matchAll(pattern)];
  if (matches.length !== 1) return { matched: false, reason: matches.length > 1 ? 'TRANSCRIPT_PROOF_NOT_UNIQUE_IN_FRAME' : 'TRANSCRIPT_PROOF_MISSING' };
  const rolloverAttemptId = String(matches[0][1] || '');
  if (!ATTEMPT_RE.test(rolloverAttemptId)) return { matched: false, reason: 'ROLLOVER_ATTEMPT_ID_INVALID' };
  return Object.freeze({
    matched: true,
    proof: 'EXACT_PARTIAL_BIND_ROLLOVER_TRANSCRIPT_V1',
    supervisor_epoch: epoch,
    previous_conversation: previous,
    successor_conversation: successor,
    rollover_attempt_id: rolloverAttemptId,
    authority_effect: false,
  });
}
