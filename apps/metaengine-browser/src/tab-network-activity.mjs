export const TAB_NETWORK_ACTIVITY_VERSION = '1.0.0';

const TRACKED_TYPES = new Set(['xhr','other']);
const ALLOWED_HOST_SUFFIXES = ['chatgpt.com','openai.com'];

function nowIso(clock) { return new Date(clock()).toISOString(); }
function hostAllowed(url) {
  try {
    const host = new URL(String(url || '')).hostname.toLowerCase();
    return ALLOWED_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  } catch { return false; }
}
function requestKey(details) { return `${Number(details?.webContentsId || 0)}:${Number(details?.id || 0)}`; }

export class TabNetworkActivityRegistry {
  #clock; #requests = new Map(); #rows = new Map(); #listenersInstalled = false;

  constructor({ clock = () => Date.now() } = {}) { this.#clock = clock; }

  #row(webContentsId) {
    const id = Number(webContentsId || 0);
    if (!Number.isInteger(id) || id <= 0) return null;
    if (!this.#rows.has(id)) {
      this.#rows.set(id, {
        webcontents_id: id,
        inflight_tracked: 0,
        last_request_started_at: null,
        last_request_completed_at: null,
        last_request_error_at: null,
        last_activity_at: null,
        completed_count: 0,
        error_count: 0,
        authority_effect: false,
      });
    }
    return this.#rows.get(id);
  }

  #eligible(details) {
    return Number.isInteger(Number(details?.webContentsId))
      && Number(details.webContentsId) > 0
      && TRACKED_TYPES.has(String(details?.resourceType || '').toLowerCase())
      && hostAllowed(details?.url);
  }

  onBeforeRequest(details) {
    if (!this.#eligible(details)) return;
    const row = this.#row(details.webContentsId);
    const key = requestKey(details);
    if (!this.#requests.has(key)) {
      this.#requests.set(key, { webcontents_id: row.webcontents_id, started_ms: this.#clock() });
      row.inflight_tracked += 1;
    }
    row.last_request_started_at = nowIso(this.#clock);
    row.last_activity_at = row.last_request_started_at;
  }

  #finish(details, isError) {
    const key = requestKey(details);
    const existing = this.#requests.get(key);
    if (!existing) return;
    this.#requests.delete(key);
    const row = this.#row(existing.webcontents_id);
    row.inflight_tracked = Math.max(0, row.inflight_tracked - 1);
    row.last_activity_at = nowIso(this.#clock);
    if (isError) {
      row.last_request_error_at = row.last_activity_at;
      row.error_count += 1;
    } else {
      row.last_request_completed_at = row.last_activity_at;
      row.completed_count += 1;
    }
  }

  onCompleted(details) { this.#finish(details, false); }
  onErrorOccurred(details) { this.#finish(details, true); }

  attach(webRequest) {
    if (this.#listenersInstalled) return this.snapshot();
    if (!webRequest?.onBeforeRequest || !webRequest?.onCompleted || !webRequest?.onErrorOccurred) throw new Error('tab_network_webrequest_required');
    const filter = { urls: ['https://chatgpt.com/*','https://*.chatgpt.com/*','https://openai.com/*','https://*.openai.com/*'] };
    webRequest.onBeforeRequest(filter, (details, callback) => {
      this.onBeforeRequest(details);
      if (typeof callback === 'function') callback({ cancel: false });
    });
    webRequest.onCompleted(filter, (details) => this.onCompleted(details));
    webRequest.onErrorOccurred(filter, (details) => this.onErrorOccurred(details));
    this.#listenersInstalled = true;
    return this.snapshot();
  }

  get(webContentsId) {
    const row = this.#rows.get(Number(webContentsId || 0));
    return row ? structuredClone(row) : null;
  }

  remove(webContentsId) {
    const id = Number(webContentsId || 0);
    this.#rows.delete(id);
    for (const [key, req] of this.#requests) if (req.webcontents_id === id) this.#requests.delete(key);
  }

  snapshot() {
    return {
      schema: 'metaengine.tab-network-activity.snapshot.v1',
      version: TAB_NETWORK_ACTIVITY_VERSION,
      tabs: [...this.#rows.values()].map((row) => structuredClone(row)),
      tracked_request_bodies: false,
      tracked_request_headers: false,
      tracked_request_urls: false,
      authority_effect: false,
    };
  }
}
