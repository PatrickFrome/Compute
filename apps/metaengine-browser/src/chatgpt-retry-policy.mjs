export const CHATGPT_RETRY_POLICY_VERSION = '1.1.0';

export const REQUEST_EFFECT_CLASS = Object.freeze({
  READ_ONLY: 'READ_ONLY',
  IDEMPOTENT_WRITE: 'IDEMPOTENT_WRITE',
  EFFECTFUL: 'EFFECTFUL',
  UNKNOWN: 'UNKNOWN',
});

const HARD_CONVERSATION_FAILURES = new Set([
  'RENDERER_GONE',
  'LOAD_FAILED',
  'CONVERSATION_DEAD',
]);

const SOFT_REQUEST_FAILURES = new Set([
  'REQUEST_FAILED',
  'SERVER_ERROR',
]);

function normEffectClass(value) {
  const v = String(value || 'UNKNOWN').toUpperCase();
  return REQUEST_EFFECT_CLASS[v] || REQUEST_EFFECT_CLASS.UNKNOWN;
}

function finiteAge(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function retryAction({ sameConversationUsable, sameChatAttempt, maxSameChatAttempts }) {
  if (sameConversationUsable && sameChatAttempt < maxSameChatAttempts) {
    return 'STOP_AND_RETRY_SAME_CONVERSATION';
  }
  return 'NEW_CONVERSATION_RETRY';
}

function retryResult(reason, retryContext) {
  return {
    action: retryAction(retryContext),
    reason,
    retry_allowed: true,
    authority_effect: false,
  };
}

export function classifyRetryDecision(input = {}) {
  const effectClass = normEffectClass(input.effect_class);
  const ageMs = finiteAge(input.silence_age_ms);
  const attempt = Math.max(0, Number(input.retry_attempt || 0));
  const maxAttempts = Math.max(0, Number(input.max_retry_attempts ?? 2));
  const sameChatAttempt = Math.max(0, Number(input.same_chat_retry_attempt || 0));
  const maxSameChatAttempts = Math.max(0, Number(input.max_same_chat_retry_attempts ?? 1));
  const sameConversationUsable = input.same_conversation_usable !== false;
  const externalProgress = input.external_progress === true;
  const externalCompleted = input.external_completed === true;
  const networkActive = input.network_active === true;
  const uiProgress = input.ui_progress === true;
  const explicitContinue = input.explicit_continue === true;
  const terminalFailure = String(input.terminal_failure || '').toUpperCase();
  const effectCheck = String(input.effect_check || 'UNKNOWN').toUpperCase();
  const requestAccepted = input.request_accepted !== false;
  const retryContext = { sameConversationUsable, sameChatAttempt, maxSameChatAttempts };

  if (externalCompleted) {
    return { action: 'WAIT_FOR_RENDER', reason: 'EXECUTION_COMPLETED_PRESENTATION_PENDING', retry_allowed: false, authority_effect: false };
  }

  if (externalProgress || networkActive || uiProgress) {
    return { action: 'WAIT', reason: 'POSITIVE_LIVENESS_EVIDENCE', retry_allowed: false, authority_effect: false };
  }

  if (explicitContinue) {
    return { action: 'CONTINUE_EXISTING', reason: 'EXPLICIT_CONTINUATION_CONTROL', retry_allowed: false, authority_effect: false };
  }

  if (attempt >= maxAttempts) {
    return { action: 'ESCALATE', reason: 'RETRY_BUDGET_EXHAUSTED', retry_allowed: false, authority_effect: false };
  }

  if (HARD_CONVERSATION_FAILURES.has(terminalFailure)) {
    if (effectClass === REQUEST_EFFECT_CLASS.READ_ONLY || effectClass === REQUEST_EFFECT_CLASS.IDEMPOTENT_WRITE) {
      return retryResult(`TERMINAL_${terminalFailure}`, {
        ...retryContext,
        sameConversationUsable: false,
      });
    }
    if (effectCheck === 'NO_EFFECT') {
      return retryResult(`TERMINAL_${terminalFailure}_NO_EFFECT_PROVEN`, {
        ...retryContext,
        sameConversationUsable: false,
      });
    }
    if (effectCheck === 'EFFECT_OBSERVED' || effectCheck === 'COMMITTED') {
      return { action: 'WAIT_FOR_RESULT_RECONCILIATION', reason: 'EFFECT_ALREADY_OBSERVED', retry_allowed: false, authority_effect: false };
    }
    return { action: 'CHECK_EFFECT', reason: 'TERMINAL_FAILURE_EFFECT_UNKNOWN', retry_allowed: false, authority_effect: false };
  }

  if (SOFT_REQUEST_FAILURES.has(terminalFailure)) {
    if (effectClass === REQUEST_EFFECT_CLASS.READ_ONLY || effectClass === REQUEST_EFFECT_CLASS.IDEMPOTENT_WRITE) {
      return retryResult(`TERMINAL_${terminalFailure}`, retryContext);
    }
    if (effectCheck === 'NO_EFFECT') {
      return retryResult(`TERMINAL_${terminalFailure}_NO_EFFECT_PROVEN`, retryContext);
    }
    if (effectCheck === 'EFFECT_OBSERVED' || effectCheck === 'COMMITTED') {
      return { action: 'WAIT_FOR_RESULT_RECONCILIATION', reason: 'EFFECT_ALREADY_OBSERVED', retry_allowed: false, authority_effect: false };
    }
    return { action: 'CHECK_EFFECT', reason: 'TERMINAL_FAILURE_EFFECT_UNKNOWN', retry_allowed: false, authority_effect: false };
  }

  const aggressiveMs = effectClass === REQUEST_EFFECT_CLASS.READ_ONLY ? 90_000
    : effectClass === REQUEST_EFFECT_CLASS.IDEMPOTENT_WRITE ? 150_000
      : 240_000;

  if (requestAccepted && ageMs >= aggressiveMs) {
    if (effectClass === REQUEST_EFFECT_CLASS.READ_ONLY) {
      return retryResult('SILENT_READ_ONLY_TIMEOUT', retryContext);
    }
    if (effectClass === REQUEST_EFFECT_CLASS.IDEMPOTENT_WRITE) {
      return retryResult('SILENT_IDEMPOTENT_TIMEOUT', retryContext);
    }
    if (effectCheck === 'NO_EFFECT') {
      return retryResult('SILENT_EFFECTFUL_NO_EFFECT_PROVEN', retryContext);
    }
    if (effectCheck === 'EFFECT_OBSERVED' || effectCheck === 'COMMITTED') {
      return { action: 'WAIT_FOR_RESULT_RECONCILIATION', reason: 'SILENT_BUT_EFFECT_OBSERVED', retry_allowed: false, authority_effect: false };
    }
    return { action: 'CHECK_EFFECT', reason: 'SILENT_EFFECTFUL_EFFECT_UNKNOWN', retry_allowed: false, authority_effect: false };
  }

  return { action: 'WAIT', reason: 'INSUFFICIENT_FAILURE_EVIDENCE', retry_allowed: false, authority_effect: false };
}
