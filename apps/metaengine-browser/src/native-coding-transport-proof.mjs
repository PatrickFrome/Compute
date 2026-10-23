import { createHash, createPublicKey, verify } from 'node:crypto';
import path from 'node:path';

// Deny-only verifier. This module does not mint capabilities, enroll a key,
// acquire leases, start a process or attest a sandbox. The caller must obtain
// the pinned key and `expected` from private native/own-PG readbacks.
export const NATIVE_CODING_PROVIDER_SCHEMA = 'metaengine.codex-cli.transport-proof.v1';
export const NATIVE_CODING_JOB_SCHEMA = 'metaengine.codex-cli.job-proof.v1';
export const NATIVE_CODING_TRUST_NAMESPACE = 'LOCAL_OPERATOR_QA';
const PURPOSE = 'METAENGINE_NATIVE_CODING_PROOF_V1\n';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const SHA = /^[0-9a-f]{40}$/;
const AGENT = /^agent_[a-z0-9-]{8,64}$/;
const SID = /^S-1-\d+(?:-\d+){1,15}$/;
const ROLES = new Set(['IMPLEMENTER', 'CRITIC']);
const BACKENDS = new Set(['WINDOWS_RESTRICTED_TOKEN', 'WINDOWS_APPCONTAINER', 'CODEX_WINDOWS_ELEVATED']);

function fail(reason) { throw new Error(`native_coding_proof_${reason}`); }
function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${name}_invalid`);
  return value;
}
function keys(value, fields, name) {
  object(value, name);
  if (Object.keys(value).sort().join('\0') !== [...fields].sort().join('\0')) fail(`${name}_fields_invalid`);
}
function text(value, pattern, name) {
  if (typeof value !== 'string' || !pattern.test(value)) fail(`${name}_invalid`);
}
function positive(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) fail(`${name}_invalid`);
}
function timestamp(value, name) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
      || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail(`${name}_invalid`);
  return Date.parse(value);
}
function canonical(value, depth = 0) {
  if (depth > 16 || (typeof value === 'string' && value.length > 8192)) fail('json_budget_exceeded');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (Array.isArray(value)) {
    if (value.length > 64) fail('json_budget_exceeded');
    return `[${value.map(child => canonical(child,depth+1)).join(',')}]`;
  }
  object(value, 'json');
  if (Object.keys(value).length > 64 || Object.keys(value).some(key=>key.length>160)) fail('json_budget_exceeded');
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key],depth+1)}`).join(',')}}`;
}
export function nativeCodingProofSigningBytes(payload) {
  const bytes=Buffer.from(PURPOSE + canonical(payload), 'utf8');
  if (bytes.length > 65536) fail('json_budget_exceeded');
  return bytes;
}
function equal(actual, expected, name) {
  if (expected === undefined || canonical(actual) !== canonical(expected)) fail(`${name}_binding_mismatch`);
}
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function localPath(value) {
  if (typeof value !== 'string' || !/^[A-Za-z]:\\/.test(value)
      || /[\x00-\x1f]/.test(value) || path.win32.normalize(value) !== value
      || /[<>:"|?*]/.test(value.slice(3))
      || value.slice(3).split('\\').some(segment => /[. ]$/.test(segment)
        || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment))
      || path.win32.parse(value).root === value || value.endsWith('\\')) fail('worktree_path_invalid');
}
function processIdentity(value, name) {
  keys(value, ['pid', 'created_at', 'process_incarnation_id'], name);
  positive(value.pid, `${name}_pid`);
  const created = timestamp(value.created_at, `${name}_created_at`);
  text(value.process_incarnation_id, /^pid:[1-9]\d*:created_100ns:[1-9]\d*$/, `${name}_birth`);
  const match = /^pid:(\d+):created_100ns:(\d+)$/.exec(value.process_incarnation_id);
  if (Number(match[1]) !== value.pid
      || (BigInt(match[2]) - 116444736000000000n) / 10000n !== BigInt(created)) fail(`${name}_birth_mismatch`);
}
function sandbox(value, role) {
  keys(value, ['backend', 'mode', 'evidence_sha256', 'outside_write_denied', 'worktree_write_denied'], 'sandbox');
  if (!BACKENDS.has(value.backend)) fail('sandbox_backend_invalid');
  if (value.mode !== (role === 'CRITIC' ? 'read-only' : 'workspace-write')) fail('sandbox_mode_invalid');
  text(value.evidence_sha256, HASH, 'sandbox_evidence');
  if (value.outside_write_denied !== true || value.worktree_write_denied !== (role === 'CRITIC')) fail('sandbox_canary_invalid');
}
function signedPayload(envelope, publicKey) {
  keys(envelope, ['algorithm', 'issuer_key_fingerprint_sha256', 'payload', 'signature'], 'envelope');
  if (envelope.algorithm !== 'ES256') fail('algorithm_invalid');
  let key;
  try { key = publicKey?.type === 'public' ? publicKey : createPublicKey(publicKey); }
  catch { fail('pinned_public_key_invalid'); }
  const fingerprint = nativeCodingDeviceKeyFingerprint(key);
  if (envelope.issuer_key_fingerprint_sha256 !== fingerprint) fail('pinned_key_mismatch');
  text(envelope.signature, /^[A-Za-z0-9_-]{86}$/, 'signature');
  const signature = Buffer.from(envelope.signature, 'base64url');
  if (signature.length !== 64 || signature.toString('base64url') !== envelope.signature
      || !verify('sha256', nativeCodingProofSigningBytes(envelope.payload), {key, dsaEncoding:'ieee-p1363'}, signature)) fail('signature_invalid');
  if (envelope.payload.device_key_fingerprint_sha256 !== fingerprint) fail('device_signing_key_mismatch');
  return structuredClone(envelope.payload);
}
export function nativeCodingDeviceKeyFingerprint(publicKey) {
  let key;
  try { key = publicKey?.type === 'public' ? publicKey : createPublicKey(publicKey); }
  catch { fail('pinned_public_key_invalid'); }
  if (key.type !== 'public' || key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') fail('pinned_public_key_invalid');
  const raw = key.export({format:'jwk'});
  // Byte-for-byte fingerprint convention of SupervisorDeviceIdentity.
  const jwk = {crv:raw.crv, ext:true, key_ops:['verify'], kty:raw.kty, x:raw.x, y:raw.y};
  return createHash('sha256').update(JSON.stringify(jwk)).digest('hex');
}
const COMMON = [
  'schema', 'trust_namespace', 'issuer', 'audience', 'provider', 'provider_id', 'target_id',
  'permit_id', 'goal_id', 'goal_sha256', 'owner_epoch', 'user_sid', 'device_id', 'device_key_fingerprint_sha256',
  'workspace_id', 'project_id', 'agent_id', 'role', 'agent_generation_epoch',
  'artifact', 'host_process', 'postgres', 'worktree', 'sandbox', 'proven_at', 'expires_at',
  'automatic_retry_allowed', 'production_qualified', 'authority_effect',
];
function common(payload, expected, now, maxAgeMs) {
  object(expected, 'expected_native_readback');
  if (!Number.isSafeInteger(now) || now < 0) fail('clock_invalid');
  if (payload.trust_namespace !== NATIVE_CODING_TRUST_NAMESPACE || payload.issuer !== 'NATIVE_HOST'
      || payload.audience !== 'METAENGINE_NATIVE_SUPERVISOR' || payload.provider !== 'CODEX_CLI') fail('scope_invalid');
  for (const field of ['provider_id', 'permit_id', 'goal_id', 'device_id', 'workspace_id', 'project_id']) text(payload[field], UUID, field);
  text(payload.goal_sha256, HASH, 'goal_sha256');
  text(payload.device_key_fingerprint_sha256, HASH, 'device_key');
  text(payload.user_sid, SID, 'user_sid');
  text(payload.agent_id, AGENT, 'agent_id');
  positive(payload.owner_epoch, 'owner_epoch');
  positive(payload.agent_generation_epoch, 'agent_generation_epoch');
  if (!ROLES.has(payload.role) || payload.target_id !== `codex-cli:${payload.provider_id}`) fail('provider_target_invalid');
  if (payload.automatic_retry_allowed !== false || payload.production_qualified !== false || payload.authority_effect !== false) fail('authority_flags_invalid');
  keys(payload.artifact, ['installed_exe_sha256', 'installed_asar_sha256', 'runtime_bundle_sha256', 'source_sha', 'cli_executable_sha256'], 'artifact');
  for (const field of Object.keys(payload.artifact)) text(payload.artifact[field], field === 'source_sha' ? SHA : HASH, `artifact_${field}`);
  processIdentity(payload.host_process, 'host_process');
  keys(payload.postgres, ['system_identifier', 'postmaster', 'data_directory_identity_sha256'], 'postgres');
  text(payload.postgres.system_identifier, /^[1-9]\d{0,19}$/, 'postgres_system_identifier');
  if (BigInt(payload.postgres.system_identifier) > 18446744073709551615n) fail('postgres_system_identifier_invalid');
  text(payload.postgres.data_directory_identity_sha256, HASH, 'postgres_data_directory_identity');
  processIdentity(payload.postgres.postmaster, 'postmaster');
  keys(payload.worktree, ['path', 'root_identity_sha256', 'base_sha'], 'worktree');
  localPath(payload.worktree.path);
  text(payload.worktree.root_identity_sha256, HASH, 'worktree_root_identity');
  text(payload.worktree.base_sha, SHA, 'worktree_base');
  sandbox(payload.sandbox, payload.role);
  const proven = timestamp(payload.proven_at, 'proven_at');
  const expires = timestamp(payload.expires_at, 'expires_at');
  if (proven > now + 5000 || proven < now - maxAgeMs || expires <= now || expires <= proven || expires - proven > maxAgeMs) fail('time_window_invalid');
  if (Date.parse(payload.host_process.created_at) > proven || Date.parse(payload.postgres.postmaster.created_at) > proven) fail('native_birth_after_proof');
  // All authority-bearing fields must match independently obtained host/DB
  // observations. A self-signed renderer payload cannot choose its own scope.
  for (const field of COMMON.filter(key => !['schema', 'issuer', 'audience', 'provider', 'proven_at', 'expires_at'].includes(key))) {
    equal(payload[field], expected[field], field);
  }
  if (expires > timestamp(expected.expires_at, 'expected_expiry')) fail('permit_expiry_exceeded');
}

export function verifyNativeCodingProviderDescriptor(envelope, {publicKey, expected, now = Date.now()} = {}) {
  const payload = signedPayload(envelope, publicKey);
  return validateProvider(payload, {expected, now});
}
function validateProvider(payload, {expected, now}) {
  keys(payload, [...COMMON, 'state', 'physical_slot_budget'], 'provider');
  if (payload.schema !== NATIVE_CODING_PROVIDER_SCHEMA || payload.state !== 'READY') fail('provider_schema_invalid');
  positive(payload.physical_slot_budget, 'physical_slot_budget');
  if (payload.physical_slot_budget > 64) fail('physical_slot_budget_invalid');
  common(payload, expected, now, 60_000);
  equal(payload.physical_slot_budget, expected.physical_slot_budget, 'physical_slot_budget');
  return freeze(payload);
}

export function verifyNativeCodingJobProof(envelope, {publicKey, expected, now = Date.now()} = {}) {
  const payload = signedPayload(envelope, publicKey);
  return validateJob(payload, {expected, now});
}
function validateJob(payload, {expected, now}) {
  keys(payload, [...COMMON, 'run_id', 'task_id', 'lease_generation', 'lease_expires_at', 'worker_process', 'job_id', 'prompt_sha256', 'subject'], 'job');
  if (payload.schema !== NATIVE_CODING_JOB_SCHEMA) fail('job_schema_invalid');
  for (const field of ['run_id', 'task_id', 'job_id']) text(payload[field], UUID, field);
  positive(payload.lease_generation, 'lease_generation');
  text(payload.prompt_sha256, HASH, 'prompt_sha256');
  processIdentity(payload.worker_process, 'worker_process');
  if (payload.worker_process.pid === payload.host_process.pid) fail('worker_host_identity_collision');
  if (payload.role === 'CRITIC') {
    keys(payload.subject, ['run_id', 'result_sha256', 'git_artifact_sha256', 'source_head', 'agent_id', 'worker_process'], 'subject');
    text(payload.subject.run_id, UUID, 'subject_run_id');
    text(payload.subject.result_sha256, HASH, 'subject_result');
    text(payload.subject.git_artifact_sha256, HASH, 'subject_git_artifact');
    text(payload.subject.source_head, SHA, 'subject_source_head');
    text(payload.subject.agent_id, AGENT, 'subject_agent');
    processIdentity(payload.subject.worker_process, 'subject_process');
    if (payload.subject.agent_id === payload.agent_id || payload.subject.run_id === payload.run_id
        || payload.subject.worker_process.process_incarnation_id === payload.worker_process.process_incarnation_id) fail('critic_not_independent');
  } else if (payload.subject !== null) fail('implementer_subject_invalid');
  common(payload, expected, now, 20 * 60_000);
  const leaseExpires = timestamp(payload.lease_expires_at, 'lease_expires_at');
  if (Date.parse(payload.expires_at) > leaseExpires || leaseExpires <= now) fail('lease_expired');
  if (Date.parse(payload.worker_process.created_at) > Date.parse(payload.proven_at)
      || Date.parse(payload.worker_process.created_at) < Date.parse(payload.host_process.created_at)) fail('worker_birth_time_invalid');
  for (const field of ['run_id', 'task_id', 'lease_generation', 'lease_expires_at', 'worker_process', 'job_id', 'prompt_sha256', 'subject']) equal(payload[field], expected[field], field);
  return freeze(payload);
}

// Shape/binding validation for the purpose-limited native device signer. It
// validates no signature and must never be used as an admission verifier.
export function validateNativeCodingProofPayload(value, {expected, now = Date.now()} = {}) {
  object(value, 'payload');
  const payload = structuredClone(value);
  if (payload.schema === NATIVE_CODING_PROVIDER_SCHEMA) return validateProvider(payload, {expected, now});
  if (payload.schema === NATIVE_CODING_JOB_SCHEMA) return validateJob(payload, {expected, now});
  fail('schema_invalid');
}
