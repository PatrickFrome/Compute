// Command-plane gate: RELOAD must never be used as recovery for a ChatGPT
// tab that sits on an auth-redirect surface.
//
// Operator verdict (P0, 2026-09-17): a RELOAD issued right after the first
// logout would re-enter the auth redirect on every tab it touches, multiply
// login-page tabs and burn the remaining tab budget. Until the one-shot
// continuity repair landed, RELOAD-after-logout was an unjustified risk, and
// even afterwards it remains a navigation-class effect with no recovery value
// on an auth page: the page is healthy, the SESSION is not, and only a human
// sign-in can change that.
//
// This module is the shared, side-effect-free predicate for BOTH command
// execution sites (selected-tab handleCommand path and the tab-scoped native
// supervisor path). It throws a typed error so the refusal is observable,
// classified fail-closed and never silently swallowed.

import { isChatGptAuthRedirectUrl } from './chatgpt-auth-readback.mjs';

export const RELOAD_AUTH_REDIRECT_FORBIDDEN = 'reload_auth_redirect_forbidden';

export function reloadBlockedByAuthRedirect({ action, url } = {}) {
  if (String(action || '').toUpperCase() !== 'RELOAD') return false;
  return isChatGptAuthRedirectUrl(url);
}

export function assertReloadAllowed({ action, url } = {}) {
  if (reloadBlockedByAuthRedirect({ action, url })) {
    const error = new Error(RELOAD_AUTH_REDIRECT_FORBIDDEN);
    error.code = RELOAD_AUTH_REDIRECT_FORBIDDEN;
    error.url = String(url || '').slice(0, 240);
    throw error;
  }
  return true;
}
