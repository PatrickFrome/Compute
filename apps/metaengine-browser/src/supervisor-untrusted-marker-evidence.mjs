// A ChatGPT DOM text excerpt is not a trusted Send receipt.
// This projection may guide inspection, but must never settle an unknown effect.
export function classifyUntrustedWakeMarker({frame, marker} = {}) {
  const validMarker = typeof marker === 'string' && /^wake_[a-z0-9-]{1,160}$/i.test(marker);
  const text = typeof frame?.text_excerpt === 'string' ? frame.text_excerpt : '';
  const observed = validMarker && text.includes(marker);
  return Object.freeze({
    schema:'metaengine.supervisor.untrusted-marker-readback.v1',
    marker_seen:observed,
    state:observed ? 'PAGE_MARKER_UNVERIFIED' : 'NO_POSITIVE_SEND_READBACK',
    send_effect_proven:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  });
}

export function classifyUntrustedRolloverMarker({frame, attemptId} = {}) {
  const valid = typeof attemptId === 'string' && /^[a-zA-Z0-9._:-]{1,160}$/.test(attemptId);
  const text = typeof frame?.text_excerpt === 'string' ? frame.text_excerpt : '';
  const observed = valid && text.includes(attemptId);
  return Object.freeze({
    schema:'metaengine.supervisor.untrusted-marker-readback.v1',
    marker_seen:observed,
    state:observed ? 'PAGE_MARKER_UNVERIFIED' : 'NO_POSITIVE_SEND_READBACK',
    send_effect_proven:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  });
}
