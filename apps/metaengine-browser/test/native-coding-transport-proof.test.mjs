import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync, sign} from 'node:crypto';
import {
  NATIVE_CODING_PROVIDER_SCHEMA, NATIVE_CODING_JOB_SCHEMA,
  nativeCodingProofSigningBytes, nativeCodingDeviceKeyFingerprint, verifyNativeCodingProviderDescriptor, verifyNativeCodingJobProof,
} from '../src/native-coding-transport-proof.mjs';

// Generated keys and identities belong only to these verifier tests. They are
// never installed, enrolled, emitted as runtime evidence or used by an issuer.
const keys = generateKeyPairSync('ec', {namedCurve:'prime256v1'});
const otherKeys = generateKeyPairSync('ec', {namedCurve:'prime256v1'});
const now = Date.parse('2026-10-22T04:00:00.000Z');
const uuid = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const hash = n => String(n).repeat(64);
const iso = delta => new Date(now + delta).toISOString();
function processIdentity(pid, delta) {
  return {pid, created_at:iso(delta), process_incarnation_id:`pid:${pid}:created_100ns:${BigInt(now + delta) * 10000n + 116444736000000000n}`};
}
function fixture(role = 'IMPLEMENTER', job = false) {
  const payload = {
    schema:job ? NATIVE_CODING_JOB_SCHEMA : NATIVE_CODING_PROVIDER_SCHEMA,
    trust_namespace:'LOCAL_OPERATOR_QA', issuer:'NATIVE_HOST', audience:'METAENGINE_NATIVE_SUPERVISOR', provider:'CODEX_CLI',
    provider_id:uuid(1), target_id:`codex-cli:${uuid(1)}`, permit_id:uuid(2), goal_id:uuid(3), goal_sha256:hash('a'),
    owner_epoch:7, user_sid:'S-1-5-21-123-456-789-1001', device_id:uuid(4), device_key_fingerprint_sha256:nativeCodingDeviceKeyFingerprint(keys.publicKey),
    workspace_id:uuid(5), project_id:uuid(6), agent_id:'agent_native-implementer', role, agent_generation_epoch:4,
    artifact:{installed_exe_sha256:hash('c'), installed_asar_sha256:hash('d'), runtime_bundle_sha256:hash('e'), source_sha:'f'.repeat(40), cli_executable_sha256:hash('1')},
    host_process:processIdentity(9101, -120_000),
    postgres:{system_identifier:'7521123456789012345', postmaster:processIdentity(8056, -240_000), data_directory_identity_sha256:hash('2')},
    worktree:{path:'C:\\METAENGINE\\managed-worktree', root_identity_sha256:hash('3'), base_sha:'a'.repeat(40)},
    sandbox:{backend:'WINDOWS_RESTRICTED_TOKEN', mode:role === 'CRITIC' ? 'read-only' : 'workspace-write', evidence_sha256:hash('4'), outside_write_denied:true, worktree_write_denied:role === 'CRITIC'},
    proven_at:iso(-1000), expires_at:iso(30_000), automatic_retry_allowed:false, production_qualified:false, authority_effect:false,
  };
  if (job) Object.assign(payload, {
    run_id:uuid(7), task_id:uuid(8), lease_generation:9, lease_expires_at:iso(60_000),
    worker_process:processIdentity(9102, -5000), job_id:uuid(9), prompt_sha256:hash('5'),
    subject:role === 'CRITIC' ? {run_id:uuid(10), result_sha256:hash('6'), git_artifact_sha256:hash('7'), source_head:'a'.repeat(40), agent_id:'agent_native-author', worker_process:processIdentity(9200, -10_000)} : null,
  });
  else Object.assign(payload, {state:'READY', physical_slot_budget:2});
  return {payload, expected:structuredClone(payload)};
}
function envelope(payload, pair = keys) {
  return {algorithm:'ES256', issuer_key_fingerprint_sha256:nativeCodingDeviceKeyFingerprint(pair.publicKey),
    payload, signature:sign('sha256', nativeCodingProofSigningBytes(payload), {key:pair.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url')};
}
function verifyFixture({payload, expected}, pair = keys) {
  return (payload.schema === NATIVE_CODING_JOB_SCHEMA ? verifyNativeCodingJobProof : verifyNativeCodingProviderDescriptor)(envelope(payload, pair), {publicKey:keys.publicKey, expected, now});
}

test('exact host-observed provider and independently bounded job verify without granting authority', () => {
  for (const role of ['IMPLEMENTER', 'CRITIC']) for (const job of [false, true]) {
    const input = fixture(role, job);
    const out = verifyFixture(input);
    assert.deepEqual(out, input.payload);
    assert.equal(out.authority_effect, false);
    assert.equal(out.production_qualified, false);
    assert.equal(Object.isFrozen(out.worktree), true);
    assert.notEqual(out, input.payload);
  }
});

test('self-signed renderer issuer cannot substitute a pinned native key', () => {
  assert.throws(() => verifyFixture(fixture(), otherKeys), /pinned_key_mismatch/);
});
test('valid signature cannot replace independent native expected readbacks', () => {
  const {payload} = fixture();
  assert.throws(() => verifyNativeCodingProviderDescriptor(envelope(payload), {publicKey:keys.publicKey, now}), /expected_native_readback_invalid/);
});
test('tampered signed payload is rejected before interpreting claims', () => {
  const {payload, expected} = fixture();
  const proof = envelope(payload);
  proof.payload.owner_epoch++;
  assert.throws(() => verifyNativeCodingProviderDescriptor(proof, {publicKey:keys.publicKey, expected, now}), /signature_invalid/);
});
test('signer must be the same enrolled device represented in the payload', () => {
  const input=fixture();input.payload.device_key_fingerprint_sha256=hash('0');input.expected.device_key_fingerprint_sha256=hash('0');
  assert.throws(()=>verifyFixture(input),/device_signing_key_mismatch/);
});
test('proof material is bounded before signing or signature verification',()=>{
  assert.throws(()=>nativeCodingProofSigningBytes({value:'a'.repeat(8193)}),/json_budget_exceeded/);
  const recursive={};recursive.child=recursive;
  assert.throws(()=>nativeCodingProofSigningBytes(recursive),/json_budget_exceeded/);
  assert.throws(()=>nativeCodingProofSigningBytes(Array(65).fill(0)),/json_budget_exceeded/);
});

for (const [name, mutate, reason] of [
  ['production reclassification', p => {p.trust_namespace='PRODUCTION';}, /scope_invalid/],
  ['production flag', p => {p.production_qualified=true;}, /authority_flags_invalid/],
  ['retry permission', p => {p.automatic_retry_allowed=true;}, /authority_flags_invalid/],
  ['effect permission', p => {p.authority_effect=true;}, /authority_flags_invalid/],
  ['renderer issuer', p => {p.issuer='RENDERER';}, /scope_invalid/],
  ['browser target masquerade', p => {p.target_id='webcontents:21';}, /provider_target_invalid/],
  ['changed runtime', p => {p.artifact.runtime_bundle_sha256=hash('7');}, /artifact_binding_mismatch/],
  ['changed Owner epoch', p => {p.owner_epoch++;}, /owner_epoch_binding_mismatch/],
  ['changed Windows user', p => {p.user_sid='S-1-5-21-123-456-789-1002';}, /user_sid_binding_mismatch/],
  ['changed own-PG cluster', p => {p.postgres.system_identifier='7521123456789012346';}, /postgres_binding_mismatch/],
  ['reused host PID', p => {p.host_process=processIdentity(9101,-60_000);}, /host_process_binding_mismatch/],
  ['swapped worktree root', p => {p.worktree.root_identity_sha256=hash('8');}, /worktree_binding_mismatch/],
  ['changed project', p => {p.project_id=uuid(17);}, /project_id_binding_mismatch/],
  ['unsigned extra privilege', p => {p.arbitrary_eval=true;}, /provider_fields_invalid/],
  ['Job Object called sandbox', p => {p.sandbox.backend='WINDOWS_JOB_OBJECT';}, /sandbox_backend_invalid/],
  ['CLI flag called isolation', p => {p.sandbox.outside_write_denied=false;}, /sandbox_canary_invalid/],
  ['expired evidence', p => {p.expires_at=iso(-1);}, /time_window_invalid/],
  ['future evidence', p => {p.proven_at=iso(6000);}, /time_window_invalid/],
  ['stale evidence', p => {p.proven_at=iso(-61_000);}, /time_window_invalid/],
  ['escaping worktree path', p => {p.worktree.path='C:\\METAENGINE\\..\\outside';}, /worktree_path_invalid/],
  ['NTFS alternate data stream', p => {p.worktree.path='C:\\METAENGINE\\folder:stream';}, /worktree_path_invalid/],
  ['Win32 dot alias', p => {p.worktree.path='C:\\METAENGINE.\\worktree';}, /worktree_path_invalid/],
  ['Win32 device path', p => {p.worktree.path='C:\\METAENGINE\\NUL';}, /worktree_path_invalid/],
  ['native host born after proof', p => {p.host_process=processIdentity(9101,0);}, /native_birth_after_proof/],
  ['unbounded physical fanout', p => {p.physical_slot_budget=Infinity;}, /json_invalid|physical_slot_budget_invalid/],
]) test(`signed provider rejects ${name}`, () => {
  const input = fixture(); mutate(input.payload);
  assert.throws(() => verifyFixture(input), reason);
});

test('native permit expiry bounds independently signed proof expiry', () => {
  const input = fixture(); input.expected.expires_at=iso(20_000);
  assert.throws(() => verifyFixture(input), /permit_expiry_exceeded/);
});
test('inconsistent kernel birth cannot match a PID only', () => {
  const input = fixture(); input.payload.host_process.process_incarnation_id=processIdentity(9101,-30_000).process_incarnation_id;
  assert.throws(() => verifyFixture(input), /host_process_birth_mismatch/);
});
test('logical-agent identity is independent from the bounded physical slot budget', () => {
  for (let i=0;i<100;i++) {
    const input = fixture(); input.payload.agent_id=`agent_logical-${String(i).padStart(8,'0')}`;
    input.expected.agent_id=input.payload.agent_id;
    assert.equal(verifyFixture(input).physical_slot_budget, 2);
  }
});

for (const [name, mutate, reason] of [
  ['lease generation mismatch', p => {p.lease_generation++;}, /lease_generation_binding_mismatch/],
  ['task mismatch', p => {p.task_id=uuid(30);}, /task_id_binding_mismatch/],
  ['expired lease', p => {p.lease_expires_at=iso(-1);}, /lease_expired/],
  ['PID reuse', p => {p.worker_process=processIdentity(9102,-4000);}, /worker_process_binding_mismatch/],
  ['changed prompt', p => {p.prompt_sha256=hash('9');}, /prompt_sha256_binding_mismatch/],
  ['missing native job binding', p => {delete p.job_id;}, /job_fields_invalid/],
  ['self-Critic agent', p => {p.subject.agent_id=p.agent_id;}, /critic_not_independent/],
  ['same worker incarnation as Critic', p => {p.subject.worker_process=p.worker_process;}, /critic_not_independent/],
  ['same run as Critic', p => {p.subject.run_id=p.run_id;}, /critic_not_independent/],
  ['Critic write sandbox', p => {p.sandbox.mode='workspace-write';}, /sandbox_mode_invalid/],
  ['worker born after proof', p => {p.worker_process=processIdentity(9102,0);}, /worker_birth_time_invalid/],
  ['changed reviewed Git artifact', p => {p.subject.git_artifact_sha256=hash('0');}, /subject_binding_mismatch/],
  ['changed reviewed source HEAD', p => {p.subject.source_head='b'.repeat(40);}, /subject_binding_mismatch/],
]) test(`signed job rejects ${name}`, () => {
  const input = fixture('CRITIC', true); mutate(input.payload);
  assert.throws(() => verifyFixture(input), reason);
});
