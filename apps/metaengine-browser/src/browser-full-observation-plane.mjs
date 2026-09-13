export const BROWSER_FULL_OBSERVATION_SCHEMA = 'metaengine.browser.full-observation.v1';
export const BROWSER_VISUAL_KEYFRAME_SCHEMA = 'metaengine.browser.visual-keyframe.v1';

const TAB_ID_RE = /^tab_[0-9a-f-]{36}$/i;
const SHA256_RE = /^[a-f0-9]{64}$/i;
const DEFAULT_MAX_FRAMES = 32;
const DEFAULT_MIN_CAPTURE_INTERVAL_MS = 350;

function boundedInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function clip(value, max = 240) {
  return value == null ? null : String(value).slice(0, max);
}

function selectedTabId(state = {}) {
  const candidates = [
    state?.active_tab?.tab_id,
    state?.tabs?.selected_tab_id,
    state?.perception?.tab_id,
  ];
  for (const value of candidates) {
    const tabId = String(value || '');
    if (TAB_ID_RE.test(tabId)) return tabId;
  }
  return null;
}

function normalizeFrame(tabId, frame, reason, observedAt) {
  if (!TAB_ID_RE.test(String(tabId || ''))) throw new Error('full_observation_visual_tab_id_invalid');
  if (!frame || frame.schema !== 'metaengine.native-browser.capture-thumbnail.v1') {
    throw new Error('full_observation_visual_frame_invalid');
  }
  const jpegBytes = Number(frame.jpeg_bytes || 0);
  const jpegBase64 = String(frame.jpeg_base64 || '');
  const sha256 = String(frame.sha256 || '').toLowerCase();
  if (!Number.isSafeInteger(jpegBytes) || jpegBytes < 1 || jpegBytes > 150000) {
    throw new Error('full_observation_visual_size_invalid');
  }
  if (!jpegBase64 || jpegBase64.length > 2_000_000 || !SHA256_RE.test(sha256)) {
    throw new Error('full_observation_visual_payload_invalid');
  }
  return Object.freeze({
    schema: BROWSER_VISUAL_KEYFRAME_SCHEMA,
    tab_id: String(tabId),
    captured_at: frame.captured_at || observedAt,
    observed_at: observedAt,
    reason: clip(reason || 'EVENT', 96),
    url: clip(frame.url, 1200),
    title: clip(frame.title, 240),
    source_width: Number(frame.source_width || 0) || null,
    source_height: Number(frame.source_height || 0) || null,
    capture_backend: clip(frame.capture_backend, 80),
    detached_surface_fallback: frame.detached_surface_fallback === true,
    capture_from_surface: frame.capture_from_surface !== false,
    jpeg_bytes: jpegBytes,
    sha256,
    jpeg_base64: jpegBase64,
    exact_tab_identity: true,
    automatic_retry_allowed: false,
    control_authority: false,
    authority_effect: false,
  });
}

function publicFrame(frame, includeJpeg) {
  if (!frame) return null;
  const { jpeg_base64, ...metadata } = frame;
  return Object.freeze({
    ...metadata,
    ...(includeJpeg === true ? { jpeg_base64 } : { jpeg_included: false }),
    authority_effect: false,
  });
}

export class BrowserFullObservationPlane {
  #getState;
  #getProcessSnapshot;
  #getSemanticSnapshot;
  #captureView;
  #clock;
  #maxFrames;
  #minCaptureIntervalMs;
  #frames = new Map();
  #captureTimer = null;
  #capturePromise = null;
  #capturePending = false;
  #lastCaptureStartedMs = 0;
  #lastCaptureAt = null;
  #lastCaptureError = null;
  #lastCaptureReason = null;
  #captureCount = 0;

  constructor({
    getState,
    getProcessSnapshot,
    getSemanticSnapshot,
    captureView,
    clock = () => Date.now(),
    maxFrames = DEFAULT_MAX_FRAMES,
    minCaptureIntervalMs = DEFAULT_MIN_CAPTURE_INTERVAL_MS,
  } = {}) {
    if (typeof getState !== 'function') throw new Error('full_observation_state_provider_required');
    if (typeof getProcessSnapshot !== 'function') throw new Error('full_observation_process_provider_required');
    if (typeof getSemanticSnapshot !== 'function') throw new Error('full_observation_semantic_provider_required');
    if (typeof captureView !== 'function') throw new Error('full_observation_capture_provider_required');
    if (typeof clock !== 'function') throw new Error('full_observation_clock_required');
    this.#getState = getState;
    this.#getProcessSnapshot = getProcessSnapshot;
    this.#getSemanticSnapshot = getSemanticSnapshot;
    this.#captureView = captureView;
    this.#clock = clock;
    this.#maxFrames = boundedInt(maxFrames, DEFAULT_MAX_FRAMES, 1, 64);
    this.#minCaptureIntervalMs = boundedInt(minCaptureIntervalMs, DEFAULT_MIN_CAPTURE_INTERVAL_MS, 100, 5000);
  }

  #remember(frame) {
    this.#frames.delete(frame.tab_id);
    this.#frames.set(frame.tab_id, frame);
    while (this.#frames.size > this.#maxFrames) {
      const oldest = this.#frames.keys().next().value;
      if (!oldest) break;
      this.#frames.delete(oldest);
    }
  }

  async captureSelected({ reason = 'EVENT', force = false } = {}) {
    if (this.#capturePromise) {
      this.#capturePending = true;
      return this.#capturePromise;
    }
    const nowMs = this.#clock();
    if (force !== true && nowMs - this.#lastCaptureStartedMs < this.#minCaptureIntervalMs) {
      this.scheduleVisualCapture(reason);
      return null;
    }
    this.#lastCaptureStartedMs = nowMs;
    this.#lastCaptureReason = clip(reason, 96);
    this.#capturePromise = (async () => {
      const state = await this.#getState();
      const tabId = selectedTabId(state);
      if (!tabId) return null;
      const frame = await this.#captureView(tabId);
      const observedAt = new Date(this.#clock()).toISOString();
      const normalized = normalizeFrame(tabId, frame, reason, observedAt);
      this.#remember(normalized);
      this.#captureCount += 1;
      this.#lastCaptureAt = normalized.captured_at || observedAt;
      this.#lastCaptureError = null;
      return publicFrame(normalized, true);
    })().catch((error) => {
      this.#lastCaptureError = clip(error?.message || error, 300);
      return null;
    }).finally(() => {
      this.#capturePromise = null;
      if (this.#capturePending) {
        this.#capturePending = false;
        this.scheduleVisualCapture('COALESCED_EVENT');
      }
    });
    return this.#capturePromise;
  }

  scheduleVisualCapture(reason = 'EVENT') {
    if (this.#capturePromise) {
      this.#capturePending = true;
      return true;
    }
    if (this.#captureTimer) return true;
    const elapsed = this.#clock() - this.#lastCaptureStartedMs;
    const delayMs = Math.max(0, this.#minCaptureIntervalMs - elapsed);
    this.#captureTimer = setTimeout(() => {
      this.#captureTimer = null;
      void this.captureSelected({ reason });
    }, delayMs);
    this.#captureTimer.unref?.();
    return true;
  }

  frame(tabIdRaw, { includeJpeg = false } = {}) {
    const tabId = String(tabIdRaw || '');
    const frame = TAB_ID_RE.test(tabId) ? this.#frames.get(tabId) : null;
    return publicFrame(frame, includeJpeg === true);
  }

  async fullSnapshot({
    includeJpeg = true,
    tabId = null,
    includeText = true,
    processEventLimit = 256,
    semanticEventLimit = 256,
  } = {}) {
    const state = await this.#getState();
    const selected = selectedTabId(state);
    const requestedTabId = TAB_ID_RE.test(String(tabId || '')) ? String(tabId) : selected;
    if (includeJpeg === true && requestedTabId && !this.#frames.has(requestedTabId)) {
      await this.captureSelected({ reason: 'FULL_OBSERVATION_REQUEST', force: true });
    }
    const process = this.#getProcessSnapshot({
      eventLimit: boundedInt(processEventLimit, 256, 0, 1024),
    });
    const semantic = this.#getSemanticSnapshot({
      includeText: includeText !== false,
      eventLimit: boundedInt(semanticEventLimit, 256, 0, 1024),
    });
    const frames = [...this.#frames.values()].map((row) => publicFrame(row, false));
    const requestedFrame = requestedTabId ? this.frame(requestedTabId, { includeJpeg }) : null;
    const shellSemanticTargets = Array.isArray(semantic?.targets)
      ? semantic.targets.filter((row) => String(row?.tab_id || '').startsWith('webcontents:')).length
      : 0;
    return Object.freeze({
      schema: BROWSER_FULL_OBSERVATION_SCHEMA,
      observed_at: new Date(this.#clock()).toISOString(),
      selected_tab_id: selected,
      requested_tab_id: requestedTabId,
      browser_state: structuredClone(state),
      process_plane: process ? structuredClone(process) : null,
      semantic_plane: semantic ? structuredClone(semantic) : null,
      visual: Object.freeze({
        keyframe_count: frames.length,
        frames,
        requested_frame: requestedFrame,
        jpeg_requested: includeJpeg === true,
        jpeg_available: requestedFrame?.jpeg_base64 != null,
        last_capture_at: this.#lastCaptureAt,
        last_capture_error: this.#lastCaptureError,
        last_capture_reason: this.#lastCaptureReason,
        capture_count: this.#captureCount,
        event_driven: true,
        min_capture_interval_ms: this.#minCaptureIntervalMs,
        detached_tabs_use_last_verified_keyframe: true,
        automatic_retry_allowed: false,
        authority_effect: false,
      }),
      shell_ui_semantic_targets: shellSemanticTargets,
      page_text_exposed: includeText !== false,
      input_values_exposed: false,
      secret_fields_exposed: false,
      raw_cdp_passthrough: false,
      control_authority: false,
      command_leasing: false,
      authority_effect: false,
    });
  }

  snapshot() {
    return Object.freeze({
      schema: 'metaengine.browser.full-observation-status.v1',
      keyframe_count: this.#frames.size,
      max_keyframes: this.#maxFrames,
      capture_in_flight: this.#capturePromise != null,
      capture_scheduled: this.#captureTimer != null,
      capture_pending: this.#capturePending,
      last_capture_at: this.#lastCaptureAt,
      last_capture_error: this.#lastCaptureError,
      last_capture_reason: this.#lastCaptureReason,
      capture_count: this.#captureCount,
      min_capture_interval_ms: this.#minCaptureIntervalMs,
      event_driven: true,
      page_text_available: true,
      jpeg_keyframes_available: true,
      shell_ui_semantics_available: true,
      input_values_exposed: false,
      secret_fields_exposed: false,
      raw_cdp_passthrough: false,
      second_scheduler: false,
      automatic_effect_retry_allowed: false,
      control_authority: false,
      command_leasing: false,
      authority_effect: false,
    });
  }

  stop() {
    if (this.#captureTimer) clearTimeout(this.#captureTimer);
    this.#captureTimer = null;
    this.#capturePending = false;
  }
}
