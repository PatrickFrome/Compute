// ChatGPT-only provider quarantine at the physical Browser command boundary.
//
// Legacy GLM/Z.ai state remains observable so historical receipts and existing
// tabs can be inspected or retired. It must never authorize a new page effect.
// This module is intentionally pure: no scheduler, retry or execution authority.

export const LEGACY_AGENT_PLATFORM = 'GLM_ZAI';
export const LEGACY_AGENT_HOST = 'chat.z.ai';

const LEGACY_PAGE_EFFECT_ACTIONS = new Set([
  'STOP_GENERATION',
  'SCROLL',
  'SEMANTIC_FOCUS',
  'SEMANTIC_TYPE',
  'TYPED_CLICK',
  'PRESS_KEY',
  'BACK',
  'FORWARD',
  'RELOAD',
]);

function hostOf(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'https:' ? url.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

export function isLegacyAgentProviderUrl(value) {
  return hostOf(value) === LEGACY_AGENT_HOST;
}

export function legacyProviderQuarantineDecision({
  action,
  platform = null,
  current_url = null,
  next_url = null,
} = {}) {
  const normalizedAction = String(action || '').trim().toUpperCase();
  const normalizedPlatform = String(platform || '').trim().toUpperCase();
  const currentLegacy = isLegacyAgentProviderUrl(current_url);
  const nextLegacy = isLegacyAgentProviderUrl(next_url);

  if ((normalizedAction === 'NEW_TAB' || normalizedAction === 'NAVIGATE') && nextLegacy) {
    return Object.freeze({
      allowed: false,
      reason: 'LEGACY_PROVIDER_NAVIGATION_DISABLED',
      legacy_read_compatibility: true,
      authority_effect: false,
    });
  }

  // Moving an already-open legacy tab onto a non-legacy URL is retirement,
  // not legacy-provider execution. Closing/selecting such a tab is likewise
  // intentionally left available to cleanup/reconciliation code.
  if (normalizedAction === 'NAVIGATE' && currentLegacy && next_url && !nextLegacy) {
    return Object.freeze({
      allowed: true,
      reason: null,
      retirement_cleanup: true,
      legacy_read_compatibility: true,
      authority_effect: false,
    });
  }

  if (
    LEGACY_PAGE_EFFECT_ACTIONS.has(normalizedAction)
    && (normalizedPlatform === LEGACY_AGENT_PLATFORM || currentLegacy)
  ) {
    return Object.freeze({
      allowed: false,
      reason: 'LEGACY_PROVIDER_EXECUTION_DISABLED',
      legacy_read_compatibility: true,
      authority_effect: false,
    });
  }

  return Object.freeze({
    allowed: true,
    reason: null,
    legacy_read_compatibility: currentLegacy || normalizedPlatform === LEGACY_AGENT_PLATFORM,
    authority_effect: false,
  });
}

export function assertLegacyProviderCommandAllowed(input) {
  const decision = legacyProviderQuarantineDecision(input);
  if (!decision.allowed) {
    const error = new Error(decision.reason);
    error.code = decision.reason;
    error.quarantine = decision;
    throw error;
  }
  return decision;
}
