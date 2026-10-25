import {createHash, createPublicKey} from 'node:crypto';
import {
  NATIVE_CODING_PROVIDER_SCHEMA, NATIVE_CODING_JOB_SCHEMA, NATIVE_CODING_TRUST_NAMESPACE,
  nativeCodingDeviceKeyFingerprint, nativeCodingProofSigningBytes,
  verifyNativeCodingProviderDescriptor, verifyNativeCodingJobProof, validateNativeCodingProofPayload,
} from './native-coding-transport-proof.mjs';

export const NATIVE_CODING_HOST_ISSUER_SCHEMA = 'metaengine.native-coding.host-issuer.v1';
const OBSERVATION_SCHEMA = 'metaengine.native-coding.host-observation.v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const AGENT = /^agent_[a-z0-9-]{8,64}$/;
const SOURCE = Object.freeze({
  permit:'PROTECTED_OPERATOR_PERMIT_READBACK', image:'INSTALLED_IMAGE_NATIVE_VERIFIER',
  host:'OS_PROCESS_INVENTORY', postgres:'ATTACHED_OWN_POSTGRES_READBACK',
  worktree:'NATIVE_FILESYSTEM_AND_GIT_READBACK', sandbox:'OS_SANDBOX_CANARY_READBACK',
  lease:'W30_OWN_PG_LIVE_LEASE', worker:'OS_PROCESS_INVENTORY', subject:'PROTECTED_NATIVE_CODING_RECEIPT',
});
const error = reason => {throw new Error(`native_coding_issuer_${reason}`);};
function plain(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype,null].includes(Object.getPrototypeOf(value))) error(`${name}_invalid`);
}
function exactFields(value, fields, name) {
  plain(value,name);
  if (Object.keys(value).sort().join('\0') !== [...fields].sort().join('\0')) error(`${name}_fields_invalid`);
}
function match(value, pattern, name) {if (typeof value !== 'string' || !pattern.test(value)) error(`${name}_invalid`);}
function equal(left, right, name) {
  if (right === undefined || !nativeCodingProofSigningBytes(left).equals(nativeCodingProofSigningBytes(right))) error(`${name}_changed`);
}
function iso(value, name) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) error(`${name}_invalid`);
  return Date.parse(value);
}
function stableDigest(value) {return createHash('sha256').update(nativeCodingProofSigningBytes(value)).digest('hex');}

// All dependencies are private native closures installed by main composition;
// none is supplied through a renderer message, agent output or JSON flag. This
// factory is intentionally inert until that composition supplies real OS/PG/
// artifact/ACL readers. A unit-test closure is not native runtime evidence.
export function createNativeCodingHostIssuer({
  identity, readPermit, readInstalledImage, readNativeHost, readPostgres, readWorktree,
  readSandbox, readLiveLease, readNativeWorker, readCriticSubject, clock = () => Date.now(),
} = {}) {
  if (!identity || typeof identity.snapshot !== 'function' || typeof identity.signNativeCodingProof !== 'function') error('existing_identity_required');
  for (const [name, reader] of Object.entries({readPermit,readInstalledImage,readNativeHost,readPostgres,readWorktree,readSandbox,readLiveLease,readNativeWorker,readCriticSubject})) {
    if (typeof reader !== 'function') error(`${name}_required`);
  }
  if (typeof clock !== 'function') error('clock_required');
  let closed = false;
  async function observation(kind, reader, request, observedTimes) {
    const result = await reader(Object.freeze(structuredClone(request)));
    exactFields(result, ['schema','source','observed_at','value'], `${kind}_observation`);
    const time = clock();
    const observed = iso(result.observed_at, `${kind}_observed_at`);
    if (!Number.isSafeInteger(time) || observed < time - 30_000 || observed > time + 5000
        || result.schema !== OBSERVATION_SCHEMA || result.source !== SOURCE[kind]) error(`${kind}_observation_untrusted`);
    plain(result.value, `${kind}_value`);
    observedTimes.push(observed);
    return structuredClone(result.value);
  }
  function snapshotIdentity() {
    const state = identity.snapshot();
    if (!state || state.enrolled !== true || state.profile !== 'A2_DEVICE_HTTP_SIGNATURE_V1') error('existing_enrolled_identity_required');
    match(state.device_id, UUID, 'device_id');
    match(state.client_id, UUID, 'client_id');
    match(state.key_fingerprint_sha256,HASH,'device_key_fingerprint');
    let publicKey;
    try {publicKey=createPublicKey({key:state.public_jwk,format:'jwk'});} catch {error('public_jwk_invalid');}
    if (nativeCodingDeviceKeyFingerprint(publicKey) !== state.key_fingerprint_sha256) error('device_fingerprint_mismatch');
    return {device_id:state.device_id, client_id:state.client_id, key_fingerprint_sha256:state.key_fingerprint_sha256,
      public_jwk:structuredClone(state.public_jwk), publicKey};
  }
  function parseRequest(request, job) {
    exactFields(request, job ? ['provider_id','agent_id','task_id','lease_generation','run_id','prompt_sha256'] : ['provider_id','agent_id'], 'request');
    match(request.provider_id,UUID,'provider_id'); match(request.agent_id,AGENT,'agent_id');
    if (job) {
      match(request.task_id,UUID,'task_id'); match(request.run_id,UUID,'run_id'); match(request.prompt_sha256,HASH,'prompt_sha256');
      if (!Number.isSafeInteger(request.lease_generation) || request.lease_generation < 1) error('lease_generation_invalid');
    }
    return Object.freeze(structuredClone(request));
  }
  async function collect(request, job) {
    if (closed) error('closed');
    const started=clock();
    const observedTimes=[];
    const observedRead=(kind,reader,query)=>observation(kind,reader,query,observedTimes);
    const enrolled=snapshotIdentity();
    const permit=await observedRead('permit',readPermit,request);
    exactFields(permit, ['schema','trust_namespace','permit_id','goal_id','goal_sha256','owner_epoch','user_sid',
      'device_id','device_key_fingerprint_sha256','workspace_id','project_id','provider_id','agent_id','role',
      'agent_generation_epoch','physical_slot_budget','artifact','postgres','worktree','issued_at','expires_at',
      'revoked','storage_evidence_sha256','record_sha256'], 'permit');
    if (permit.schema !== 'metaengine.native-coding.operator-permit.v1' || permit.trust_namespace !== NATIVE_CODING_TRUST_NAMESPACE
        || permit.revoked !== false || iso(permit.issued_at,'permit_issued_at') > clock() + 5000
        || iso(permit.expires_at,'permit_expires_at') <= clock()) error('operator_permit_unavailable');
    match(permit.storage_evidence_sha256,HASH,'permit_storage_evidence'); match(permit.record_sha256,HASH,'permit_record');
    if (permit.provider_id !== request.provider_id || permit.agent_id !== request.agent_id || permit.device_id !== enrolled.device_id
        || permit.device_key_fingerprint_sha256 !== enrolled.key_fingerprint_sha256) error('permit_identity_mismatch');
    const query=Object.freeze({...request, permit_id:permit.permit_id, project_id:permit.project_id,
      workspace_id:permit.workspace_id, worktree_path:permit.worktree?.path, role:permit.role});
    // These five read-only observations depend on the same immutable permit,
    // not on each other. Bound their concurrency so cold Windows readers do
    // not consume one another's freshness window. Every timestamp is still
    // checked again at completion, and the complete scope is reread after sign.
    const [artifact,host,pg,worktree,sandbox]=await Promise.all([
      observedRead('image',readInstalledImage,query),
      observedRead('host',readNativeHost,query),
      observedRead('postgres',readPostgres,query),
      observedRead('worktree',readWorktree,query),
      observedRead('sandbox',readSandbox,query),
    ]);
    exactFields(host,['host_process','user_sid'],'host');
    exactFields(pg,['postgres','workspace_id','project_id'],'postgres');
    equal(artifact,permit.artifact,'installed_artifact'); equal(pg.postgres,permit.postgres,'own_postgres');
    equal(worktree,permit.worktree,'managed_worktree');
    if (host.user_sid !== permit.user_sid || pg.workspace_id !== permit.workspace_id || pg.project_id !== permit.project_id) error('native_scope_mismatch');
    let lease=null,worker=null,subject=null;
    if (job) {
      lease=await observedRead('lease',readLiveLease,query);
      exactFields(lease,['task_id','agent_id','lease_generation','agent_generation_epoch','role','workspace_id','project_id',
        'provider_id','target_id','base_sha','prompt_sha256','expires_at','state','verification_subject'],'lease');
      if (lease.task_id !== request.task_id || lease.agent_id !== request.agent_id || lease.lease_generation !== request.lease_generation
          || lease.agent_generation_epoch !== permit.agent_generation_epoch || lease.role !== permit.role
          || lease.workspace_id !== permit.workspace_id || lease.project_id !== permit.project_id
          || lease.provider_id !== permit.provider_id || lease.target_id !== `codex-cli:${permit.provider_id}`
          || lease.base_sha !== permit.worktree.base_sha || lease.prompt_sha256 !== request.prompt_sha256 || !['LEASED','RUNNING'].includes(lease.state)
          || iso(lease.expires_at,'lease_expires_at') <= clock()) error('live_w30_lease_mismatch');
      worker=await observedRead('worker',readNativeWorker,query);
      exactFields(worker,['run_id','worker_process','job_id','prompt_sha256'],'worker');
      if (worker.run_id !== request.run_id || worker.prompt_sha256 !== request.prompt_sha256) error('worker_binding_mismatch');
      if (permit.role === 'CRITIC') {
        subject=await observedRead('subject',readCriticSubject,{...query,verification_subject:structuredClone(lease.verification_subject)});
        exactFields(subject,['run_id','result_sha256','git_artifact_sha256','source_head','agent_id','worker_process'],'subject');
        exactFields(lease.verification_subject,['run_id','result_sha256','git_artifact_sha256','source_head'],'lease_subject');
        if (['run_id','result_sha256','git_artifact_sha256','source_head'].some(key=>subject[key] !== lease.verification_subject[key])) error('critic_subject_mismatch');
        if (worktree.base_sha !== subject.source_head) error('critic_source_head_mismatch');
      } else if (lease.verification_subject !== null) error('implementer_subject_invalid');
    }
    const finished=clock();
    if (closed) error('closed');
    if (finished < started || observedTimes.some(value=>value < finished-30_000 || value > finished+5000)) error('readback_window_exceeded');
    return {enrolled,permit,artifact,host,pg,worktree,sandbox,lease,worker,subject};
  }
  function bindingDigest(readback) {
    const {enrolled,...rest}=readback;
    return stableDigest({...rest,enrolled:{device_id:enrolled.device_id,client_id:enrolled.client_id,key_fingerprint_sha256:enrolled.key_fingerprint_sha256}});
  }
  async function issue(input, job) {
    const request=parseRequest(input,job);
    const before=await collect(request,job);
    const {enrolled,permit,artifact,host,pg,worktree,sandbox,lease,worker,subject}=before;
    const now=clock();
    if (!Number.isSafeInteger(now) || now < 0) error('clock_invalid');
    const expires=Math.min(Date.parse(permit.expires_at), now+(job ? 20*60_000 : 60_000), job ? Date.parse(lease.expires_at) : Infinity);
    const payload={
      schema:job ? NATIVE_CODING_JOB_SCHEMA : NATIVE_CODING_PROVIDER_SCHEMA,
      trust_namespace:NATIVE_CODING_TRUST_NAMESPACE,issuer:'NATIVE_HOST',audience:'METAENGINE_NATIVE_SUPERVISOR',provider:'CODEX_CLI',
      provider_id:permit.provider_id,target_id:`codex-cli:${permit.provider_id}`,permit_id:permit.permit_id,
      goal_id:permit.goal_id,goal_sha256:permit.goal_sha256,owner_epoch:permit.owner_epoch,user_sid:permit.user_sid,
      device_id:enrolled.device_id,device_key_fingerprint_sha256:enrolled.key_fingerprint_sha256,
      workspace_id:permit.workspace_id,project_id:permit.project_id,agent_id:permit.agent_id,role:permit.role,
      agent_generation_epoch:permit.agent_generation_epoch,artifact,host_process:host.host_process,postgres:pg.postgres,worktree,sandbox,
      proven_at:new Date(now).toISOString(),expires_at:new Date(expires).toISOString(),
      automatic_retry_allowed:false,production_qualified:false,authority_effect:false,
      ...(job ? {run_id:request.run_id,task_id:lease.task_id,lease_generation:lease.lease_generation,lease_expires_at:lease.expires_at,
        worker_process:worker.worker_process,job_id:worker.job_id,prompt_sha256:worker.prompt_sha256,subject}
        : {state:'READY',physical_slot_budget:permit.physical_slot_budget}),
    };
    const expected=structuredClone(payload);
    validateNativeCodingProofPayload(payload,{expected,now});
    const signed=await identity.signNativeCodingProof(payload,{expected,now});
    const after=await collect(request,job);
    if (bindingDigest(before) !== bindingDigest(after)) error('scope_changed_during_sign');
    if (closed) error('closed');
    const check=job ? verifyNativeCodingJobProof : verifyNativeCodingProviderDescriptor;
    check(signed,{publicKey:enrolled.publicKey,expected,now:clock()});
    return signed;
  }
  return Object.freeze({schema:NATIVE_CODING_HOST_ISSUER_SCHEMA,trust_namespace:NATIVE_CODING_TRUST_NAMESPACE,
    issueProvider:request=>issue(request,false),issueJob:request=>issue(request,true),close:()=>{closed=true;}});
}
