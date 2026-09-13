import { nativeBrowserCdpPool } from './browser-persistent-cdp-session.mjs';

export const BROWSER_VISUAL_KEYFRAME_CACHE_SCHEMA = 'metaengine.browser.visual-keyframe-cache.v1';

const SHA256_RE = /^[a-f0-9]{64}$/i;
const frameByWebContents = new WeakMap();

function clip(value, max = 240) {
  return value == null ? null : String(value).slice(0, max);
}

function currentIdentity(webContents) {
  try {
    return nativeBrowserCdpPool.identity(webContents, { require_ready: false, require_event_stream: false });
  } catch {
    return null;
  }
}

function exactTargetId(webContents) {
  try {
    return clip(webContents?.getOrCreateDevToolsTargetId?.(), 160) || `webcontents:${Number(webContents?.id) || 0}`;
  } catch {
    return `webcontents:${Number(webContents?.id) || 0}`;
  }
}

function validFrame(frame) {
  return frame
    && frame.schema === 'metaengine.native-browser.capture-thumbnail.v1'
    && Number.isSafeInteger(Number(frame.jpeg_bytes))
    && Number(frame.jpeg_bytes) > 0
    && Number(frame.jpeg_bytes) <= 150000
    && typeof frame.jpeg_base64 === 'string'
    && frame.jpeg_base64.length > 0
    && SHA256_RE.test(String(frame.sha256 || ''));
}

export async function rememberVisualKeyframe(webContents, frame) {
  if (!webContents || webContents.isDestroyed?.() === true) throw new Error('visual_keyframe_webcontents_unavailable');
  if (!validFrame(frame)) throw new Error('visual_keyframe_frame_invalid');
  let binding = currentIdentity(webContents);
  if (!binding) {
    try {
      await nativeBrowserCdpPool.ensure(webContents);
      binding = currentIdentity(webContents);
    } catch {}
  }
  const entry = Object.freeze({
    schema: BROWSER_VISUAL_KEYFRAME_CACHE_SCHEMA,
    web_contents_id: Number(webContents.id) || null,
    target_id: binding?.target_id || exactTargetId(webContents),
    binding_generation: Number(binding?.binding_generation || 0) || null,
    document_generation: Number(binding?.document_generation || 0) || null,
    url: clip(webContents.getURL?.() || frame.url || '', 1200),
    title: clip(webContents.getTitle?.() || frame.title || '', 240),
    captured_at: frame.captured_at || new Date().toISOString(),
    frame: Object.freeze({ ...frame }),
    exact_webcontents_identity: true,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
  frameByWebContents.set(webContents, entry);
  return visualKeyframeStatus(webContents);
}

export function visualKeyframeStatus(webContents) {
  const entry = webContents && frameByWebContents.get(webContents);
  if (!entry) return null;
  const current = currentIdentity(webContents);
  const currentUrl = clip(webContents?.getURL?.() || '', 1200);
  const sameTarget = current
    ? String(current.target_id || '') === String(entry.target_id || '')
    : exactTargetId(webContents) === entry.target_id;
  const generationComparable = current != null && entry.binding_generation != null && entry.document_generation != null;
  const sameGeneration = generationComparable
    ? Number(current.binding_generation) === Number(entry.binding_generation)
      && Number(current.document_generation) === Number(entry.document_generation)
    : false;
  const sameUrl = currentUrl === entry.url;
  return Object.freeze({
    schema: BROWSER_VISUAL_KEYFRAME_CACHE_SCHEMA,
    web_contents_id: entry.web_contents_id,
    target_id: entry.target_id,
    binding_generation: entry.binding_generation,
    document_generation: entry.document_generation,
    captured_at: entry.captured_at,
    url: entry.url,
    title: entry.title,
    jpeg_bytes: Number(entry.frame.jpeg_bytes || 0),
    sha256: String(entry.frame.sha256 || '').toLowerCase(),
    current_binding_observed: current != null,
    same_target: sameTarget,
    same_generation: sameGeneration,
    same_url: sameUrl,
    reusable: sameTarget && sameGeneration && sameUrl,
    exact_webcontents_identity: true,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

export function readVisualKeyframe(webContents, { allowStaleSameTarget = false } = {}) {
  const entry = webContents && frameByWebContents.get(webContents);
  if (!entry) return null;
  const status = visualKeyframeStatus(webContents);
  if (!status) return null;
  if (status.reusable !== true && !(allowStaleSameTarget === true && status.same_target === true && status.same_url === true)) {
    return null;
  }
  const now = new Date().toISOString();
  return Object.freeze({
    ...entry.frame,
    captured_at: now,
    keyframe_captured_at: entry.captured_at,
    capture_backend: 'LAST_VERIFIED_JPEG_KEYFRAME',
    detached_surface_fallback: true,
    visual_keyframe_cache_hit: true,
    visual_keyframe_same_document: status.same_generation === true,
    visual_keyframe_status: status,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

export function clearVisualKeyframe(webContents) {
  if (!webContents || typeof webContents !== 'object') return false;
  return frameByWebContents.delete(webContents);
}
