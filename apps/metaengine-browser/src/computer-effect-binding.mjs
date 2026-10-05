import {
  computerTargetIdentityDigest,
  normalizeComputerTargetIdentity,
} from './computer-authority-plane.mjs';

export const NATIVE_COMPUTER_EFFECT_BINDING_SCHEMA = 'metaengine.native-supervisor.computer-effect-binding.v1';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_RE = /^[A-Za-z0-9._:-]{16,160}$/;
const AGENT_ID_RE = /^agent_[a-z0-9-]{8,64}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;

const clean = (value) => String(value ?? '').trim();

function requireUuid(value, code) {
  const text = clean(value).toLowerCase();
  if (!UUID_RE.test(text)) throw new Error(code);
  return text;
}

export function buildNativeComputerEffectBinding({
  command,
  clientId,
  observedTarget,
  observedAt = new Date().toISOString(),
} = {}) {
  if (clean(command?.action).toUpperCase() !== 'COMPUTER_ACTION') {
    throw new Error('native_computer_effect_binding_action_invalid');
  }
  const commandId = requireUuid(command?.command_id, 'native_computer_effect_binding_command_id_invalid');
  const client = requireUuid(clientId, 'native_computer_effect_binding_client_id_invalid');
  const idempotencyKey = clean(command?.idempotency_key);
  if (!IDEMPOTENCY_RE.test(idempotencyKey)) throw new Error('native_computer_effect_binding_idempotency_invalid');

  const agentId = clean(command?.payload?.agent_id).toLowerCase();
  if (!AGENT_ID_RE.test(agentId)) throw new Error('native_computer_effect_binding_agent_id_invalid');
  const computerAction = clean(command?.payload?.action).toUpperCase();
  if (!computerAction) throw new Error('native_computer_effect_binding_subaction_invalid');

  const target = normalizeComputerTargetIdentity(observedTarget);
  const targetDigest = computerTargetIdentityDigest(target);
  const payloadTarget = normalizeComputerTargetIdentity(command?.payload?.target);
  const payloadDigest = computerTargetIdentityDigest(payloadTarget);
  if (payloadDigest !== targetDigest) throw new Error('native_computer_effect_binding_target_drift');
  const declaredDigest = clean(command?.payload?.target_identity_sha256).toLowerCase();
  if (!SHA256_RE.test(declaredDigest) || declaredDigest !== targetDigest) {
    throw new Error('native_computer_effect_binding_target_digest_mismatch');
  }

  const expiresText = clean(command?.expires_at);
  const expiresAt = Date.parse(expiresText);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('native_computer_effect_binding_command_expired');
  const observed = new Date(observedAt);
  if (!Number.isFinite(observed.getTime())) throw new Error('native_computer_effect_binding_observed_at_invalid');

  return Object.freeze({
    schema: NATIVE_COMPUTER_EFFECT_BINDING_SCHEMA,
    command_id: commandId,
    idempotency_key: idempotencyKey,
    action: 'COMPUTER_ACTION',
    computer_action: computerAction,
    client_id: client,
    agent_id: agentId,
    target_identity_sha256: targetDigest,
    target,
    command_expires_at: expiresText,
    observed_at: observed.toISOString(),
    page_data_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

export function assertNativeComputerEffectBindingMatches({
  command,
  binding,
  clientId,
  observedTarget,
  now = Date.now(),
} = {}) {
  if (!binding || binding.schema !== NATIVE_COMPUTER_EFFECT_BINDING_SCHEMA || binding.authority_effect !== false) {
    throw new Error('native_computer_effect_binding_missing_or_invalid');
  }
  if (binding.page_data_authority !== false || binding.automatic_retry_allowed !== false) {
    throw new Error('native_computer_effect_binding_safety_flags_invalid');
  }
  const expected = buildNativeComputerEffectBinding({
    command,
    clientId,
    observedTarget,
    observedAt: binding.observed_at,
  });
  const keys = [
    'schema','command_id','idempotency_key','action','computer_action','client_id',
    'agent_id','target_identity_sha256','command_expires_at','observed_at',
    'page_data_authority','automatic_retry_allowed','authority_effect',
  ];
  for (const key of keys) {
    if (binding[key] !== expected[key]) throw new Error(`native_computer_effect_binding_${key}_mismatch`);
  }
  if (JSON.stringify(binding.target) !== JSON.stringify(expected.target)) {
    throw new Error('native_computer_effect_binding_target_mismatch');
  }
  if (Date.parse(binding.command_expires_at) <= Number(now)) throw new Error('native_computer_effect_binding_expired_before_effect');
  return Object.freeze(structuredClone(binding));
}
