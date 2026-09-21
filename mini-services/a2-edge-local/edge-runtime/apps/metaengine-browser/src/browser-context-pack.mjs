import crypto from 'node:crypto';

export const BROWSER_CONTEXT_PACK_SCHEMA = 'metaengine.browser-context-pack.v1';
export const BROWSER_CONTEXT_PACK_VERSION = '1.0.0';
export const BROWSER_CONTEXT_PACK_MAX_TABS = 8;
export const BROWSER_CONTEXT_PACK_MAX_SOURCE_TEXT = 8_000;
export const BROWSER_CONTEXT_PACK_MAX_TOTAL_TEXT = 32_000;

const TAB_ID_RE = /^tab_[0-9a-f-]{36}$/i;
const TARGET_ID_RE = /^webcontents:[1-9][0-9]*$/;

const clip = (value, max) => String(value ?? '').slice(0, max);
const sha256 = (value) => crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function stableSha256(value) {
  return sha256(JSON.stringify(stable(value)));
}

function normalizeTabIds(value) {
  if (!Array.isArray(value) || value.length < 1) throw new Error('browser_context_pack_explicit_selection_required');
  if (value.length > BROWSER_CONTEXT_PACK_MAX_TABS) throw new Error('browser_context_pack_selection_too_large');
  const rows = value.map((item) => String(item || '').trim());
  if (rows.some((item) => !TAB_ID_RE.test(item))) throw new Error('browser_context_pack_tab_id_invalid');
  if (new Set(rows).size !== rows.length) throw new Error('browser_context_pack_duplicate_tab_id');
  return Object.freeze(rows);
}

function normalizeTabSnapshot(value, expectedTabId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const tabId = String(value.tab_id || '');
  const targetId = String(value.target_id || '');
  const processIncarnationId = String(value.process_incarnation_id || '');
  const url = clip(value.url, 8_192);
  const title = clip(value.title, 512);
  const kind = clip(value.kind, 32);
  if (tabId !== expectedTabId || !TARGET_ID_RE.test(targetId) || !processIncarnationId || !url) return null;
  return deepFreeze({
    tab_id: tabId,
    target_id: targetId,
    process_incarnation_id: processIncarnationId,
    url,
    title,
    kind,
    authority_effect: false,
  });
}

function issue(tabId, reason, detail = null) {
  return deepFreeze({
    tab_id: tabId,
    reason,
    detail: detail == null ? null : clip(detail, 240),
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

function frameMatchesBinding(frame, binding) {
  return frame?.authority_effect === false
    && frame?.semantic_input_values_exposed === false
    && String(frame?.target_id || '') === binding.target_id
    && String(frame?.process_incarnation_id || '') === binding.process_incarnation_id
    && clip(frame?.url, 8_192) === binding.url;
}

function sameExactBinding(before, after) {
  return Boolean(before && after)
    && before.tab_id === after.tab_id
    && before.target_id === after.target_id
    && before.process_incarnation_id === after.process_incarnation_id
    && before.url === after.url;
}

function sourceFrom(frame, binding, excerpt) {
  return deepFreeze({
    tab_id: binding.tab_id,
    target_id: binding.target_id,
    process_incarnation_id: binding.process_incarnation_id,
    captured_at: frame?.captured_at || null,
    title: clip(frame?.title || binding.title, 512),
    url: binding.url,
    kind: binding.kind,
    text_excerpt: excerpt,
    text_excerpt_sha256: sha256(excerpt),
    semantic_target_count: Array.isArray(frame?.semantic_targets) ? frame.semantic_targets.length : 0,
    viewport: frame?.viewport && typeof frame.viewport === 'object'
      ? {
          width: Number(frame.viewport.width || 0),
          height: Number(frame.viewport.height || 0),
          page_x: Number(frame.viewport.page_x || 0),
          page_y: Number(frame.viewport.page_y || 0),
          scale: Number(frame.viewport.scale || 1),
        }
      : null,
    web_content_trust: 'UNTRUSTED_DATA_ONLY',
    instruction_authority: false,
    semantic_input_values_exposed: false,
    page_data_authority: false,
    browser_actuation_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

/**
 * Capture an explicit, bounded set of live Browser tabs into a provenance-bearing
 * context pack. The injected callbacks must only observe current local Browser state.
 * This function performs one capture attempt per requested tab and never retries.
 * Web content is always data, never instruction or authority.
 */
export async function captureBrowserContextPack({
  tab_ids,
  observeTabBinding,
  captureFrame,
  now = () => new Date().toISOString(),
} = {}) {
  const requestedTabIds = normalizeTabIds(tab_ids);
  if (typeof observeTabBinding !== 'function') throw new Error('browser_context_pack_binding_observer_required');
  if (typeof captureFrame !== 'function') throw new Error('browser_context_pack_capture_required');

  const sources = [];
  const issues = [];
  let remainingText = BROWSER_CONTEXT_PACK_MAX_TOTAL_TEXT;

  for (const tabId of requestedTabIds) {
    let before;
    try {
      before = normalizeTabSnapshot(await observeTabBinding(tabId), tabId);
    } catch (error) {
      issues.push(issue(tabId, 'BINDING_OBSERVE_FAILED', error?.message || error));
      continue;
    }
    if (!before) {
      issues.push(issue(tabId, 'TAB_BINDING_NOT_LIVE'));
      continue;
    }

    let frame;
    try {
      frame = await captureFrame(before);
    } catch (error) {
      issues.push(issue(tabId, 'CAPTURE_FAILED', error?.message || error));
      continue;
    }

    if (frame?.semantic_input_values_exposed !== false) {
      issues.push(issue(tabId, 'SEMANTIC_INPUT_PRIVACY_CONTRACT_INVALID'));
      continue;
    }
    if (frame?.authority_effect !== false) {
      issues.push(issue(tabId, 'CAPTURE_AUTHORITY_CONTRACT_INVALID'));
      continue;
    }
    if (!frameMatchesBinding(frame, before)) {
      issues.push(issue(tabId, 'CAPTURE_BINDING_DRIFT'));
      continue;
    }

    let after;
    try {
      after = normalizeTabSnapshot(await observeTabBinding(tabId), tabId);
    } catch (error) {
      issues.push(issue(tabId, 'POST_CAPTURE_BINDING_OBSERVE_FAILED', error?.message || error));
      continue;
    }
    if (!sameExactBinding(before, after)) {
      issues.push(issue(tabId, 'POST_CAPTURE_BINDING_DRIFT'));
      continue;
    }

    const excerptLimit = Math.min(BROWSER_CONTEXT_PACK_MAX_SOURCE_TEXT, Math.max(0, remainingText));
    const excerpt = clip(frame?.text_excerpt, excerptLimit);
    remainingText -= excerpt.length;
    sources.push(sourceFrom(frame, before, excerpt));
  }

  const state = sources.length === requestedTabIds.length ? 'COMPLETE' : (sources.length > 0 ? 'PARTIAL' : 'EMPTY');
  const capturedAt = now();
  const hashBasis = {
    schema: BROWSER_CONTEXT_PACK_SCHEMA,
    version: BROWSER_CONTEXT_PACK_VERSION,
    state,
    scope: 'EXPLICIT_TAB_SELECTION',
    requested_tab_ids: requestedTabIds,
    sources,
    issues,
    web_content_trust: 'UNTRUSTED_DATA_ONLY',
    instruction_boundary: 'WEB_CONTENT_IS_DATA_NOT_INSTRUCTION',
  };
  const packSha256 = stableSha256(hashBasis);

  return deepFreeze({
    ...hashBasis,
    captured_at: capturedAt,
    pack_sha256: packSha256,
    semantic_input_values_exposed: false,
    page_data_authority: false,
    browser_actuation_authority: false,
    task_authority: false,
    scheduler_authority: false,
    release_authority: false,
    automatic_retry_allowed: false,
    second_polling_loop: false,
    authority_effect: false,
  });
}
