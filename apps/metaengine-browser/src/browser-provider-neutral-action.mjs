import crypto from 'node:crypto';

const ACTIONS = new Set(['SEMANTIC_FOCUS', 'TYPED_CLICK', 'SEMANTIC_TYPE', 'SCROLL']);
const SEMANTIC_ACTIONS = new Set(['SEMANTIC_FOCUS', 'TYPED_CLICK', 'SEMANTIC_TYPE']);
const SAFE_ROLES = new Set(['textbox','searchbox','combobox','button','checkbox','radio','switch','tab','menuitem','link']);
const MAX_FANOUT = 128;
const MAX_TEXT = 120000;
const clip = (value, max) => String(value ?? '').slice(0, max);
const sha256 = (value) => crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');

function requiredString(value, name, max = 240) {
  const out = clip(value, max).trim();
  if (!out) throw new Error(`provider_neutral_${name}_required`);
  return out;
}

function requiredGeneration(value, name) {
  const out = Number(value);
  if (!Number.isSafeInteger(out) || out < 1) throw new Error(`provider_neutral_${name}_invalid`);
  return out;
}

function normalizePayload(action, payload = {}) {
  if (SEMANTIC_ACTIONS.has(action)) {
    const role = requiredString(payload.role, 'role', 80).toLowerCase();
    if (!SAFE_ROLES.has(role)) throw new Error('provider_neutral_role_unsupported');
    const accessibleName = requiredString(payload.accessible_name, 'accessible_name', 240);
    const normalized = { role, accessible_name: accessibleName };
    if (action === 'SEMANTIC_TYPE') {
      const text = String(payload.text ?? '');
      if (!text || text.length > MAX_TEXT) throw new Error('provider_neutral_text_invalid');
      normalized.text = text;
      normalized.replace_existing = payload.replace_existing !== false;
      normalized.submit_after_type = payload.submit_after_type === true;
    }
    return normalized;
  }
  const deltaY = Number(payload.delta_y || 0);
  if (!Number.isFinite(deltaY) || !deltaY || Math.abs(deltaY) > 4000) {
    throw new Error('provider_neutral_scroll_delta_invalid');
  }
  return { delta_y: deltaY };
}

export function normalizeProviderNeutralAction(input = {}) {
  const action = requiredString(input.action, 'action', 80).toUpperCase();
  if (!ACTIONS.has(action)) throw new Error('provider_neutral_action_unsupported');
  const actionId = requiredString(input.action_id, 'action_id', 160);
  const payload = normalizePayload(action, input.payload);
  const digestInput = JSON.stringify({ schema: 'metaengine.browser.provider-neutral-action.v1', action, action_id: actionId, payload });
  return Object.freeze({
    schema: 'metaengine.browser.provider-neutral-action.v1',
    action_id: actionId,
    action,
    payload: Object.freeze(payload),
    action_digest: sha256(digestInput),
    provider: null,
    provider_specific_selector: null,
    authority_effect: false,
    scheduler_authority: false,
    lease_authority: false,
    automatic_retry_allowed: false,
  });
}

function normalizeBinding(binding = {}) {
  return Object.freeze({
    agent_id: requiredString(binding.agent_id, 'agent_id', 160),
    tab_id: requiredString(binding.tab_id, 'tab_id', 160),
    target_id: requiredString(binding.target_id, 'target_id', 240),
    agent_generation: requiredGeneration(binding.agent_generation, 'agent_generation'),
    lease_generation: requiredGeneration(binding.lease_generation, 'lease_generation'),
    binding_generation: requiredGeneration(binding.binding_generation, 'binding_generation'),
  });
}

function bindingKey(binding) {
  return [binding.agent_id, binding.tab_id, binding.target_id, binding.agent_generation, binding.lease_generation, binding.binding_generation].join('\u0000');
}

export function fanoutProviderNeutralAction(actionInput, targetBindings = [], { maxTargets = MAX_FANOUT } = {}) {
  const action = normalizeProviderNeutralAction(actionInput);
  const limit = Math.max(1, Math.min(MAX_FANOUT, Number(maxTargets) || MAX_FANOUT));
  if (!Array.isArray(targetBindings) || targetBindings.length < 1) throw new Error('provider_neutral_targets_required');
  if (targetBindings.length > limit) throw new Error(`provider_neutral_fanout_limit:${limit}`);
  const seen = new Set();
  return Object.freeze(targetBindings.map((raw, fanoutIndex) => {
    const target_binding = normalizeBinding(raw);
    const key = bindingKey(target_binding);
    if (seen.has(key)) throw new Error('provider_neutral_duplicate_target_binding');
    seen.add(key);
    return Object.freeze({
      schema: 'metaengine.browser.provider-neutral-fanout-item.v1',
      action_id: action.action_id,
      action_digest: action.action_digest,
      fanout_index: fanoutIndex,
      target_binding,
      action,
      provider: null,
      authority_effect: false,
      scheduler_authority: false,
      lease_authority: false,
      automatic_retry_allowed: false,
    });
  }));
}

export function durableProviderNeutralActionRef(actionInput) {
  const action = normalizeProviderNeutralAction(actionInput);
  return Object.freeze({
    schema: 'metaengine.browser.provider-neutral-action-ref.v1',
    action_id: action.action_id,
    action: action.action,
    action_digest: action.action_digest,
    payload_persisted: false,
    authority_effect: false,
  });
}

export function providerNeutralActionSnapshot() {
  return Object.freeze({
    schema: 'metaengine.browser.provider-neutral-action-contract.v1',
    supported_actions: Object.freeze([...ACTIONS]),
    max_fanout: MAX_FANOUT,
    exact_target_generation_fencing: true,
    provider_neutral: true,
    provider_specific_selectors_allowed: false,
    durable_payload_persistence: false,
    authority_effect: false,
    scheduler_authority: false,
    lease_authority: false,
    effect_execution_authority: false,
    automatic_retry_allowed: false,
  });
}
