export const BOUNDED_NAVIGATION_SCHEMA = 'metaengine.browser.bounded-navigation.v1';
export const DEFAULT_NAVIGATION_TIMEOUT_MS = 15_000;
export const MAX_NAVIGATION_TIMEOUT_MS = 60_000;

const clip = (value, max) => String(value ?? '').slice(0, max);

function boundedTimeout(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_NAVIGATION_TIMEOUT_MS;
  return Math.max(250, Math.min(MAX_NAVIGATION_TIMEOUT_MS, Math.trunc(parsed)));
}

function currentUrl(webContents) {
  try { return clip(webContents?.getURL?.() || '', 4096); } catch { return ''; }
}

function receipt({ state, reason, requestedUrl, preUrl, postUrl, startedMs, stopped = false, errorCode = null }) {
  return Object.freeze({
    schema: BOUNDED_NAVIGATION_SCHEMA,
    state,
    reason,
    requested_url: requestedUrl,
    pre_url: preUrl,
    post_url: postUrl,
    duration_ms: Math.max(0, Date.now() - startedMs),
    stopped,
    error_code: Number.isFinite(Number(errorCode)) ? Number(errorCode) : null,
    automatic_retry_allowed: false,
    authority_effect: state === 'CONFIRMED',
  });
}

export async function boundedNavigation(webContents, requestedUrl, { timeout_ms, signal } = {}) {
  if (!webContents || webContents.isDestroyed?.()) throw new Error('bounded_navigation_webcontents_unavailable');
  const url = clip(requestedUrl, 4096);
  if (!url) throw new Error('bounded_navigation_url_required');
  const timeoutMs = boundedTimeout(timeout_ms);
  const startedMs = Date.now();
  const preUrl = currentUrl(webContents);

  let settled = false;
  let timer = null;
  let abortListener = null;
  let resolveTerminal;
  const terminal = new Promise((resolve) => { resolveTerminal = resolve; });

  const listeners = [];
  const on = (event, handler) => {
    webContents.on?.(event, handler);
    listeners.push([event, handler]);
  };
  const cleanup = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (abortListener && signal?.removeEventListener) signal.removeEventListener('abort', abortListener);
    abortListener = null;
    for (const [event, handler] of listeners) webContents.removeListener?.(event, handler);
    listeners.length = 0;
  };
  const finish = (value) => {
    if (settled) return;
    settled = true;
    cleanup();
    resolveTerminal(value);
  };
  const stop = () => {
    try { webContents.stop?.(); return true; } catch { return false; }
  };

  on('did-finish-load', () => finish(receipt({
    state: 'CONFIRMED', reason: 'DID_FINISH_LOAD', requestedUrl: url,
    preUrl, postUrl: currentUrl(webContents), startedMs,
  })));
  on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
    const postUrl = currentUrl(webContents);
    const unchanged = !postUrl || postUrl === preUrl;
    finish(receipt({
      state: unchanged ? 'FAILED' : 'AMBIGUOUS',
      reason: `DID_FAIL_LOAD:${clip(errorDescription || validatedUrl || 'UNKNOWN', 160)}`,
      requestedUrl: url, preUrl, postUrl, startedMs, errorCode,
    }));
  });
  on('render-process-gone', (_event, details) => finish(receipt({
    state: 'AMBIGUOUS', reason: `RENDER_PROCESS_GONE:${clip(details?.reason || 'UNKNOWN', 80)}`,
    requestedUrl: url, preUrl, postUrl: currentUrl(webContents), startedMs,
  })));
  on('destroyed', () => finish(receipt({
    state: 'AMBIGUOUS', reason: 'WEB_CONTENTS_DESTROYED', requestedUrl: url,
    preUrl, postUrl: currentUrl(webContents), startedMs,
  })));

  timer = setTimeout(() => {
    const stopped = stop();
    finish(receipt({
      state: 'AMBIGUOUS', reason: 'DEADLINE_EXCEEDED', requestedUrl: url,
      preUrl, postUrl: currentUrl(webContents), startedMs, stopped,
    }));
  }, timeoutMs);
  timer.unref?.();

  if (signal?.addEventListener) {
    abortListener = () => {
      const postBeforeStop = currentUrl(webContents);
      const stopped = stop();
      finish(receipt({
        state: postBeforeStop === preUrl ? 'CANCELLED' : 'AMBIGUOUS',
        reason: 'ABORTED', requestedUrl: url, preUrl,
        postUrl: currentUrl(webContents), startedMs, stopped,
      }));
    };
    if (signal.aborted) abortListener();
    else signal.addEventListener('abort', abortListener, { once: true });
  }

  if (!settled) {
    try {
      const load = webContents.loadURL(url);
      Promise.resolve(load).then(() => {
        if (!settled) finish(receipt({
          state: 'CONFIRMED', reason: 'LOAD_URL_RESOLVED', requestedUrl: url,
          preUrl, postUrl: currentUrl(webContents), startedMs,
        }));
      }, (error) => {
        if (settled) return;
        const postUrl = currentUrl(webContents);
        finish(receipt({
          state: !postUrl || postUrl === preUrl ? 'FAILED' : 'AMBIGUOUS',
          reason: `LOAD_URL_REJECTED:${clip(error?.message || error || 'UNKNOWN', 160)}`,
          requestedUrl: url, preUrl, postUrl, startedMs,
        }));
      });
    } catch (error) {
      finish(receipt({
        state: 'FAILED', reason: `LOAD_URL_THROW:${clip(error?.message || error || 'UNKNOWN', 160)}`,
        requestedUrl: url, preUrl, postUrl: currentUrl(webContents), startedMs,
      }));
    }
  }

  return terminal;
}
