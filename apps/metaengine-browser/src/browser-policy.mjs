const CHATGPT_HOSTS = new Set(['chatgpt.com', 'www.chatgpt.com', 'chat.openai.com']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const BLOCKED_PROTOCOLS = new Set(['javascript:', 'data:', 'file:', 'chrome:', 'chrome-extension:', 'devtools:', 'metaengine:']);

export function parseUserUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return new URL('https://chatgpt.com/');
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) return new URL(raw);
  if (/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(raw)) return new URL(`http://${raw}`);
  return new URL(`https://${raw}`);
}

export function classifyRemoteUrl(input) {
  let url;
  try { url = input instanceof URL ? input : parseUserUrl(input); }
  catch { return { allowed: false, reason: 'URL_INVALID', url: null, kind: 'BLOCKED' }; }
  if (BLOCKED_PROTOCOLS.has(url.protocol)) return { allowed: false, reason: 'PRIVILEGED_SCHEME', url, kind: 'BLOCKED' };
  if (url.protocol === 'about:' && url.href === 'about:blank') return { allowed: true, reason: null, url, kind: 'BLANK' };
  if (url.protocol === 'https:') return { allowed: true, reason: null, url, kind: CHATGPT_HOSTS.has(url.hostname.toLowerCase()) ? 'CHATGPT' : 'USER_WEB' };
  if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) return { allowed: true, reason: null, url, kind: 'LOCAL_DEV' };
  return { allowed: false, reason: 'NETWORK_SCHEME_NOT_ALLOWED', url, kind: 'BLOCKED' };
}

export function isChatGptUrl(input) {
  const x = classifyRemoteUrl(input);
  return x.allowed && x.kind === 'CHATGPT';
}

export function navigationDecision(input) {
  const x = classifyRemoteUrl(input);
  return Object.freeze({ allow: x.allowed, reason: x.reason, normalized_url: x.url?.href || null, kind: x.kind });
}

export function newWindowDecision(input) {
  const decision = navigationDecision(input);
  return Object.freeze({ ...decision, disposition: decision.allow ? 'OPEN_AS_MANAGED_TAB' : 'DENY' });
}

export const REMOTE_WEB_PREFERENCES = Object.freeze({
  nodeIntegration: false,
  nodeIntegrationInSubFrames: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  safeDialogs: true,
  spellcheck: true,
});

export const SECURITY_POLICY = Object.freeze({
  user_space_partition: 'persist:metaengine-user-v1',
  remote_code_has_node: false,
  remote_preload_present: false,
  arbitrary_permission_grants: false,
  downloads_enabled: false,
  cookie_transfer_to_compute_space: false,
  raw_cdp_exposed: false,
  page_data_authority: false,
});
