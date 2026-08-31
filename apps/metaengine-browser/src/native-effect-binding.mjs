const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TAB_RE = /^tab_[0-9a-f-]{36}$/i;
const TARGET_RE = /^webcontents:[1-9][0-9]*$/;
const IDEMPOTENCY_RE = /^[A-Za-z0-9._:-]{16,160}$/;

export const NATIVE_EFFECT_BINDING_SCHEMA = 'metaengine.native-supervisor.effect-binding.v1';
export const NATIVE_TAB_EFFECT_ACTIONS = Object.freeze([
  'STOP_GENERATION',
  'SCROLL',
  'SEMANTIC_FOCUS',
  'SEMANTIC_TYPE',
  'TYPED_CLICK',
]);

const TAB_EFFECT_SET = new Set(NATIVE_TAB_EFFECT_ACTIONS);
const clean = (value) => String(value ?? '').trim();

export function nativeActionRequiresEffectBinding(action) {
  return TAB_EFFECT_SET.has(clean(action).toUpperCase());
}

function requireUuid(value, code) {
  const text = clean(value).toLowerCase();
  if (!UUID_RE.test(text)) throw new Error(code);
  return text;
}

function requireTab(value) {
  const text = clean(value);
  if (!TAB_RE.test(text)) throw new Error('native_effect_binding_tab_id_invalid');
  return text;
}

function requireTarget(value) {
  const text = clean(value).toLowerCase();
  if (!TARGET_RE.test(text)) throw new Error('native_effect_binding_target_id_invalid');
  return text;
}

export function buildNativeEffectBinding({ command, clientId, processIncarnationId, tabId, targetId, observedAt = new Date().toISOString() } = {}) {
  const action = clean(command?.action).toUpperCase();
  if (!nativeActionRequiresEffectBinding(action)) throw new Error('native_effect_binding_action_not_tab_effect');
  const commandId = requireUuid(command?.command_id, 'native_effect_binding_command_id_invalid');
  const idempotencyKey = clean(command?.idempotency_key);
  if (!IDEMPOTENCY_RE.test(idempotencyKey)) throw new Error('native_effect_binding_idempotency_key_invalid');
  const client = requireUuid(clientId, 'native_effect_binding_client_id_invalid');
  const processId = requireUuid(processIncarnationId, 'native_effect_binding_process_incarnation_invalid');
  const exactTab = requireTab(tabId);
  const payloadTab = clean(command?.payload?.tab_id);
  if (!payloadTab || payloadTab !== exactTab) throw new Error('native_effect_binding_explicit_tab_required');
  const target = requireTarget(targetId);
  const expiresText = clean(command?.expires_at);
  const expiresAt = Date.parse(expiresText);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('native_effect_binding_command_expired');
  const observed = new Date(observedAt);
  if (!Number.isFinite(observed.getTime())) throw new Error('native_effect_binding_observed_at_invalid');
  return Object.freeze({
    schema: NATIVE_EFFECT_BINDING_SCHEMA,
    command_id: commandId,
    idempotency_key: idempotencyKey,
    action,
    client_id: client,
    process_incarnation_id: processId,
    tab_id: exactTab,
    target_id: target,
    command_expires_at: expiresText,
    observed_at: observed.toISOString(),
    page_data_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

export function assertNativeEffectBindingMatches({ command, binding, clientId, processIncarnationId, tabId, targetId, now = Date.now() } = {}) {
  if (!binding || binding.schema !== NATIVE_EFFECT_BINDING_SCHEMA || binding.authority_effect !== false) {
    throw new Error('native_effect_binding_missing_or_invalid');
  }
  if (binding.page_data_authority !== false || binding.automatic_retry_allowed !== false) {
    throw new Error('native_effect_binding_safety_flags_invalid');
  }
  const expected = buildNativeEffectBinding({
    command,
    clientId,
    processIncarnationId,
    tabId,
    targetId,
    observedAt: binding.observed_at,
  });
  for (const key of ['command_id','idempotency_key','action','client_id','process_incarnation_id','tab_id','target_id','command_expires_at']) {
    if (binding[key] !== expected[key]) throw new Error(`native_effect_binding_${key}_mismatch`);
  }
  if (Date.parse(binding.command_expires_at) <= Number(now)) throw new Error('native_effect_binding_expired_before_effect');
  return Object.freeze(structuredClone(binding));
}
