// Metadata-only ChatGPT authentication readback.
//
// P0 incident background (2026-09-17, v0.7.0-dev.35230443849.1): the
// self-update session-continuity restore replayed exact capsule URLs while the
// live user session had been logged out, so every restored /c/<conversation>
// tab was server-redirected to chatgpt.com/auth/login. The restore logic never
// looked at the post-redirect URL, replayed the capsule on every process start
// (7 -> 14 -> 21 -> 28 -> 32 tabs) and hit tab_capacity_exceeded while the
// process-level health monitors stayed green: PROCESS_HEALTHY is not
// USER_SESSION_HEALTHY.
//
// This module closes that observation gap with URL/registry metadata ONLY:
// no cookie values, no storage reads, no page text, no CDP authority. URLs and
// tab kinds are already part of every transport projection, so every consumer
// (restore loop, heartbeat qualification, operators) can observe the
// authenticated/redirected state without new authority surfaces.
//
// GLM agent platform (2026-09-19): the fleet runs on chat.z.ai, whose auth
// surface is /auth (live recon). The combined classifier below watches BOTH
// chat surfaces so the same logout amplifier can never repeat on the GLM
// platform; the legacy ChatGPT-only exports stay for the operator lane.

import { isAgentPlatformAuthRedirectUrl, isAgentPlatformUrl } from './browser-agent-platform.mjs';

export const CHATGPT_AUTH_READBACK_SCHEMA = 'metaengine.chatgpt-auth-readback.v1';
export const CHAT_AUTH_READBACK_SCHEMA = 'metaengine.chat-auth-readback.v2';

const CHATGPT_HOSTS = new Set(['chatgpt.com', 'www.chatgpt.com']);
const AUTH_REQUIRED_PATH_RE = /^\/auth(\/|$)/i;

function hostnameOf(value) {
  try {
    return new URL(String(value || '')).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function pathnameOf(value) {
  try {
    return new URL(String(value || '')).pathname;
  } catch {
    return null;
  }
}

// True when the URL is a ChatGPT auth-redirect surface (login/signup/auth
// callback). These pages are the deterministic post-logout destination of
// every /c/<conversation> URL and of the chatgpt.com root.
export function isChatGptAuthRedirectUrl(value) {
  const hostname = hostnameOf(value);
  if (!hostname || !CHATGPT_HOSTS.has(hostname)) return false;
  const pathname = pathnameOf(value);
  return pathname != null && AUTH_REQUIRED_PATH_RE.test(pathname);
}

// True for any chatgpt.com surface (root, conversation, auth, settings...).
export function isChatGptUrl(value) {
  const hostname = hostnameOf(value);
  return Boolean(hostname) && CHATGPT_HOSTS.has(hostname);
}

// Single-URL classification:
//   AUTH_REQUIRED  — auth-redirect surface (metadata evidence of a logged-out
//                    or challenged session)
//   AUTHENTICATED  — a signed-in surface (conversation or root) — metadata
//                    cannot prove an unexpired session, but a /c/ page that
//                    STAYS on /c/ is the strongest URL-level continuity signal
//   NOT_CHATGPT    — not a ChatGPT surface at all
export function classifyChatGptAuthUrl(value) {
  if (!isChatGptUrl(value)) return 'NOT_CHATGPT';
  return isChatGptAuthRedirectUrl(value) ? 'AUTH_REQUIRED' : 'AUTHENTICATED';
}

// Registry-snapshot classification. `tabs` is the tab list from a state
// snapshot ({ url, kind, ... } rows). Returns bounded, metadata-only evidence.
export function classifyChatGptAuthReadbackFromTabs(tabs) {
  const rows = Array.isArray(tabs) ? tabs : [];
  let chatgptTabs = 0;
  let authRequiredTabs = 0;
  let authenticatedTabs = 0;
  const samples = [];
  for (const tab of rows) {
    const url = String(tab?.url || '');
    if (!isChatGptUrl(url)) continue;
    chatgptTabs += 1;
    if (isChatGptAuthRedirectUrl(url)) {
      authRequiredTabs += 1;
      if (samples.length < 4) samples.push(url.slice(0, 240));
    } else {
      authenticatedTabs += 1;
    }
  }
  let authState = 'UNKNOWN';
  if (chatgptTabs === 0) authState = 'NO_CHATGPT_TABS';
  else if (authRequiredTabs > 0) authState = 'AUTH_REQUIRED';
  else if (authenticatedTabs > 0) authState = 'AUTHENTICATED';
  return Object.freeze({
    schema: CHATGPT_AUTH_READBACK_SCHEMA,
    auth_state: authState,
    chatgpt_tab_count: chatgptTabs,
    auth_redirect_tab_count: authRequiredTabs,
    authenticated_tab_count: authenticatedTabs,
    auth_redirect_url_samples: Object.freeze(samples),
    metadata_only: true,
    cookie_values_read: false,
    authority_effect: false,
  });
}

// Pre/post comparison for successor qualification (Qualification V2).
//   CONTINUED        — pre was AUTHENTICATED and post still is
//   LOST             — pre was AUTHENTICATED but post is AUTH_REQUIRED
//   NOT_APPLICABLE   — no ChatGPT tabs existed before the update
//   UNKNOWN          — pre state could not be established
export function compareUserSessionContinuity({ preAuthState, postAuthState } = {}) {
  const pre = String(preAuthState || '').toUpperCase();
  const post = String(postAuthState || '').toUpperCase();
  if (pre === 'NO_CHATGPT_TABS') return 'NOT_APPLICABLE';
  if (pre === 'AUTHENTICATED' && post === 'AUTHENTICATED') return 'CONTINUED';
  if (pre === 'AUTHENTICATED' && post === 'AUTH_REQUIRED') return 'LOST';
  return 'UNKNOWN';
}

// Single-URL classification across BOTH chat platforms:
//   AUTH_REQUIRED / AUTHENTICATED / NOT_CHAT (no monitored chat surface).
export function classifyChatAuthUrl(value) {
  if (isAgentPlatformUrl(value)) {
    return isAgentPlatformAuthRedirectUrl(value) ? 'AUTH_REQUIRED' : 'AUTHENTICATED';
  }
  if (isChatGptUrl(value)) {
    return isChatGptAuthRedirectUrl(value) ? 'AUTH_REQUIRED' : 'AUTHENTICATED';
  }
  return 'NOT_CHAT';
}

// True for any monitored chat surface: the GLM agent platform (chat.z.ai) or
// the legacy ChatGPT operator lane.
export function isChatSurfaceUrl(value) {
  return isChatGptUrl(value) || isAgentPlatformUrl(value);
}

// True when the URL is an auth-redirect surface on ANY monitored chat
// platform (chatgpt.com/auth/... or chat.z.ai/auth...).
export function isChatAuthRedirectUrl(value) {
  return isChatGptAuthRedirectUrl(value) || isAgentPlatformAuthRedirectUrl(value);
}

// Registry-snapshot classification across BOTH chat platforms. Same metadata
// rules as the ChatGPT-only classifier: AUTH_REQUIRED wins over AUTHENTICATED
// (one redirected tab is terminal evidence of a lost session on that
// platform), and the per-platform counts stay observable for operators.
export function classifyChatAuthReadbackFromTabs(tabs) {
  const rows = Array.isArray(tabs) ? tabs : [];
  let chatgptTabs = 0;
  let chatgptAuthRequired = 0;
  let chatgptAuthenticated = 0;
  let agentPlatformTabs = 0;
  let agentPlatformAuthRequired = 0;
  let agentPlatformAuthenticated = 0;
  const samples = [];
  for (const tab of rows) {
    const url = String(tab?.url || '');
    if (isAgentPlatformUrl(url)) {
      agentPlatformTabs += 1;
      if (isAgentPlatformAuthRedirectUrl(url)) {
        agentPlatformAuthRequired += 1;
        if (samples.length < 4) samples.push(url.slice(0, 240));
      } else {
        agentPlatformAuthenticated += 1;
      }
      continue;
    }
    if (isChatGptUrl(url)) {
      chatgptTabs += 1;
      if (isChatGptAuthRedirectUrl(url)) {
        chatgptAuthRequired += 1;
        if (samples.length < 4) samples.push(url.slice(0, 240));
      } else {
        chatgptAuthenticated += 1;
      }
    }
  }
  let authState = 'UNKNOWN';
  if (chatgptTabs === 0 && agentPlatformTabs === 0) authState = 'NO_CHAT_TABS';
  else if (chatgptAuthRequired > 0 || agentPlatformAuthRequired > 0) authState = 'AUTH_REQUIRED';
  else if (chatgptAuthenticated > 0 || agentPlatformAuthenticated > 0) authState = 'AUTHENTICATED';
  return Object.freeze({
    schema: CHAT_AUTH_READBACK_SCHEMA,
    auth_state: authState,
    chat_surface_tab_count: chatgptTabs + agentPlatformTabs,
    auth_redirect_tab_count: chatgptAuthRequired + agentPlatformAuthRequired,
    authenticated_tab_count: chatgptAuthenticated + agentPlatformAuthenticated,
    chatgpt_tab_count: chatgptTabs,
    chatgpt_auth_redirect_tab_count: chatgptAuthRequired,
    chatgpt_authenticated_tab_count: chatgptAuthenticated,
    agent_platform_tab_count: agentPlatformTabs,
    agent_platform_auth_redirect_tab_count: agentPlatformAuthRequired,
    agent_platform_authenticated_tab_count: agentPlatformAuthenticated,
    auth_redirect_url_samples: Object.freeze(samples),
    metadata_only: true,
    cookie_values_read: false,
    authority_effect: false,
  });
}

// Tab-cardinality continuity (Qualification V2): the successor must not hold
// materially more tabs than the capsule recorded. The 2026-09-17 incident
// grew 7 -> 32 through exact-URL replay; that amplification is exactly what
// this check makes un-qualifiable. Bounded slack absorbs legitimate additions
// (bootstrap root, user action during the restore window).
export function checkTabCardinalityContinuity({ preTabCount, postTabCount, slack = 2 } = {}) {
  // null/undefined counts are UNKNOWN, never zero (Number(null) === 0 would
  // otherwise turn a missing observation into a "0 -> N amplification").
  if (preTabCount == null || postTabCount == null) {
    return Object.freeze({
      state: 'UNKNOWN', pre_tab_count: null, post_tab_count: null,
      slack: Math.max(0, Math.min(8, Number(slack))), authority_effect: false,
    });
  }
  const pre = Number(preTabCount);
  const post = Number(postTabCount);
  const slackValue = Math.max(0, Math.min(8, Number(slack)));
  if (!Number.isSafeInteger(pre) || pre < 0 || !Number.isSafeInteger(post) || post < 0) {
    return Object.freeze({
      state: 'UNKNOWN', pre_tab_count: null, post_tab_count: null, slack: slackValue, authority_effect: false,
    });
  }
  return Object.freeze({
    state: post <= pre + slackValue ? 'CONTINUOUS' : 'VIOLATED',
    pre_tab_count: pre,
    post_tab_count: post,
    slack: slackValue,
    authority_effect: false,
  });
}
