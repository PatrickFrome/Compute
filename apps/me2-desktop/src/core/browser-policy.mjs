/**
 * Browser policy — the security contract of every WebContentsView.
 * Deny-by-default permissions, navigation allowlist, no popped-out windows,
 * hardened webRequest. Pure decision functions are unit-tested; the electron
 * session wiring is injected.
 */
import { FLEET } from '../shared/me2-constants.mjs';

/** Navigation decision (pure). */
export function resolveNavigation({ url, mainOrigin, trusted = false } = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { allow: false, reason: 'url_unparseable' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { allow: false, reason: 'scheme_denied' };
  }
  if (parsed.username || parsed.password) return { allow: false, reason: 'credentials_denied' };
  if (mainOrigin && parsed.origin === mainOrigin) return { allow: true };
  if (trusted) return { allow: false, reason: 'control_origin_only' };
  if (parsed.origin === FLEET.ORIGIN) return { allow: true };
  // localhost planes are MAIN-origin assets behind the gateway, never direct nav targets
  if (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') return { allow: false, reason: 'loopback_denied' };
  return { allow: false, reason: 'origin_not_allowed' };
}

const DENIED_PERMISSIONS = new Set([
  'media',
  'geolocation',
  'notifications',
  'midi',
  'midiSysex',
  'pointerLock',
  'fullscreen',
  'openExternal',
  'display-capture',
  'backgroundSync',
  'speech',
]);

/** Permission decision (pure). */
export function resolvePermission(permission) {
  return DENIED_PERMISSIONS.has(permission) ? 'deny' : 'deny';
}

/** Wire a WebContentsView with the policy (electron injected; testable via fakes). */
export function applyPolicy({ webContents, mainOrigin, onBlocked = () => {}, setWindowOpenHandler, session, trusted = false }) {
  setWindowOpenHandler(({ url }) => {
    const verdict = resolveNavigation({ url, mainOrigin, trusted });
    if (!verdict.allow) onBlocked({ kind: 'window-open', url, reason: verdict.reason });
    return { action: 'deny' }; // Every native tab must belong to the registry.
  });
  const guardNavigation = (event, url) => {
    const verdict = resolveNavigation({ url, mainOrigin, trusted });
    if (!verdict.allow) {
      event.preventDefault();
      onBlocked({ kind: 'navigate', url, reason: verdict.reason });
    }
  };
  webContents.on('will-navigate', guardNavigation);
  webContents.on('will-redirect', guardNavigation);
  if (session?.setPermissionCheckHandler) session.setPermissionCheckHandler(() => false);
  if (session?.setPermissionRequestHandler) {
    session.setPermissionRequestHandler((_wc, permission, callback) => callback(resolvePermission(permission) === 'allow'));
  }
  return { hardened: true };
}
