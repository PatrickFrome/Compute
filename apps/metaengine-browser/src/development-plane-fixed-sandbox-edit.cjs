'use strict';
// W80: a single fixed source repair in a disposable, locked Git worktree.
// No raw shell, arbitrary patch/path, network, self-declared proof or LIVE claim.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { constants } = require('node:fs');

const SCHEMA = 'metaengine.development-plane.fixed-sandbox-source-edit.w80.v1';
const BEFORE = 'export const sum=(a,b)=>a-b;\n';
const AFTER = 'export const sum=(a,b)=>a+b;\n';
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLAIM_FIELDS = Object.freeze([
  'schema','task_id','run_id','effect_id','source_sha','workspace_id',
  'lease_generation','owner_generation','owner_epoch','owner_pid',
  'owner_birth','issued_at_ms','expires_at_ms','worktree_sha256',
  'relative_path','preimage_sha256','postimage_sha256',
]);
const same = (a,b) => process.platform === 'win32'
  ? a.toLowerCase() === b.toLowerCase() : a === b;
const denied = reason => { throw new Error('fixed_sandbox_source_edit_' + reason); };
function canonicalClaim(claim) {
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)
      || Object.keys(claim).length !== CLAIM_FIELDS.length
      || !CLAIM_FIELDS.every(key => Object.hasOwn(claim,key))) denied('claim_shape');
  return JSON.stringify(CLAIM_FIELDS.map(k => claim[k]));
}
function safeString(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 256;
}
async function verifyDisposableLockedWorktree(root) {
  const realRoot = await fs.realpath(root);
  const tmp = await fs.realpath(os.tmpdir());
  const parent = path.dirname(realRoot);
  if (path.basename(realRoot) !== 'unique-git'
      || !/^metaengine-w56-own-pg17-[A-Za-z0-9_-]+$/.test(path.basename(parent))
      || !same(path.dirname(parent),tmp)) denied('non_disposable_root');
  if ((await fs.lstat(realRoot)).isSymbolicLink()
      || (await fs.lstat(parent)).isSymbolicLink()) denied('root_reparse');
  const marker = path.join(realRoot,'.git');
  const markerStat = await fs.lstat(marker);
  if (!markerStat.isFile() || markerStat.isSymbolicLink()) denied('git_marker_invalid');
  const text = (await fs.readFile(marker,'utf8')).trim();
  if (!text.startsWith('gitdir: ') || text.length > 600) denied('git_marker_invalid');
  const gitDir = await fs.realpath(path.resolve(realRoot,text.slice(8)));
  const expectedParent = await fs.realpath(path.join(parent,'repo.git','worktrees'));
  if (!same(path.dirname(gitDir),expectedParent)) denied('foreign_gitdir');
  const lock = await fs.lstat(path.join(gitDir,'locked'));
  if (!lock.isFile() || lock.isSymbolicLink()) denied('worktree_unlocked');
  const head = (await fs.readFile(path.join(gitDir,'HEAD'),'utf8')).trim();
  if (!HEX40.test(head)) denied('head_not_detached');
  return {realRoot, head, gitDir};
}
function verifySignedClaim(payload, pinnedPublicKey) {
  if (!safeString(pinnedPublicKey)) denied('trusted_key_absent');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || Object.keys(payload).sort().join(',') !== 'claim,signature') denied('payload_shape');
  const claim = payload.claim;
  const bytes = Buffer.from(canonicalClaim(claim),'utf8');
  const sig = payload.signature;
  if (typeof sig !== 'string' || sig.length > 192 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(sig)) denied('signature_shape');
  let verified = false;
  try {
    const key = crypto.createPublicKey(pinnedPublicKey);
    if (key.asymmetricKeyType !== 'ed25519') denied('key_type');
    verified = crypto.verify(null,bytes,key,Buffer.from(sig,'base64'));
  } catch { denied('signature_invalid'); }
  if (!verified) denied('signature_invalid');
  if (claim.schema !== SCHEMA || !UUID.test(claim.task_id)
      || !UUID.test(claim.run_id) || !UUID.test(claim.effect_id)
      || !UUID.test(claim.workspace_id) || !HEX40.test(claim.source_sha)
      || !HEX64.test(claim.worktree_sha256)
      || claim.relative_path !== 'calc.mjs'
      || claim.preimage_sha256 !== sha256(BEFORE)
      || claim.postimage_sha256 !== sha256(AFTER)
      || !Number.isSafeInteger(claim.lease_generation) || claim.lease_generation < 1
      || !Number.isSafeInteger(claim.owner_generation) || claim.owner_generation < 1
      || !Number.isSafeInteger(claim.owner_epoch) || claim.owner_epoch < 1
      || !Number.isSafeInteger(claim.owner_pid) || claim.owner_pid < 1
      || !safeString(claim.owner_birth)
      || !Number.isSafeInteger(claim.issued_at_ms)
      || !Number.isSafeInteger(claim.expires_at_ms)) denied('claim_binding');
  const now = Date.now();
  if (claim.issued_at_ms > now + 1000 || claim.expires_at_ms < now
      || claim.expires_at_ms <= claim.issued_at_ms
      || claim.expires_at_ms - claim.issued_at_ms > 15000) denied('lease_expired');
  return claim;
}
function identicalFile(a,b) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size
    && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}
async function executeFixedSandboxSourceEdit(payload, {root, pinnedPublicKey} = {}) {
  // Registration comes ONLY from the trusted worker bootstrap, not REQUEST JSON.
  const claim = verifySignedClaim(payload,pinnedPublicKey);
  const {realRoot,head,gitDir} = await verifyDisposableLockedWorktree(root);
  if (head !== claim.source_sha || sha256(realRoot) !== claim.worktree_sha256)
    denied('source_or_worktree_changed');
  const dest = path.join(realRoot,'calc.mjs');
  const st = await fs.lstat(dest);
  if (!st.isFile() || st.isSymbolicLink() || st.size > 4096) denied('file_type_or_size');
  const realDest = await fs.realpath(dest);
  if (!same(realDest,dest)) denied('file_alias');
  const handle = await fs.open(dest,constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  let data, stat;
  try {
    stat = await handle.stat();
    if (!identicalFile(st,stat)) denied('file_changed');
    data = await handle.readFile();
  } finally { await handle.close(); }
  if (data.length !== Buffer.byteLength(BEFORE) || sha256(data) !== claim.preimage_sha256
      || data.toString('utf8') !== BEFORE) denied('stale_preimage');
  if (Date.now() > claim.expires_at_ms) denied('lease_expired');
  // This fixed repair is single-use for the generated worktree, including
  // across independent workers and process restart. An in-memory effect Set
  // forgets an ambiguous attempt on restart and cannot serialize two workers.
  // Reserve before the source write; never remove the marker on an error.
  const attemptFile = path.join(gitDir,'metaengine-w80-source-edit-attempt.json');
  let attempt;
  try {
    attempt = await fs.open(attemptFile,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW || 0),0o600);
  } catch (error) {
    if (error.code === 'EEXIST') denied('duplicate_or_ambiguous');
    throw error;
  }
  try {
    await attempt.writeFile(JSON.stringify({schema:SCHEMA,state:'ATTEMPTED',
      effect_id:claim.effect_id,claim_sha256:sha256(canonicalClaim(claim)),
      automatic_retry_allowed:false}), 'utf8');
    await attempt.sync();
  } finally { await attempt.close(); }
  // Atomic replacement with a generated exclusive temporary file under the same
  // directly-pinned directory. Never follow untrusted relative parents.
  const tmpName = path.join(realRoot,'.w80-' + crypto.randomUUID() + '.tmp');
  let moved = false;
  try {
    const newFile = await fs.open(tmpName,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW || 0),0o600);
    try { await newFile.writeFile(AFTER,'utf8'); await newFile.sync(); }
    finally { await newFile.close(); }
    if (!identicalFile(st,await fs.lstat(dest))
        || !same(await fs.realpath(realRoot),realRoot)
        || (await verifyDisposableLockedWorktree(realRoot)).head !== claim.source_sha
        || Date.now() > claim.expires_at_ms) denied('precommit_fence_changed');
    // This is the one OS effect. Unknown or failed rename is not retried.
    await fs.rename(tmpName,dest); moved = true;
    if (sha256(await fs.readFile(dest)) !== claim.postimage_sha256)
      denied('postimage_unverified');
    return Object.freeze({schema:SCHEMA,state:'SOURCE_EDIT_APPLIED_STAGING',
      origin:'SYNTHETIC/STAGING',source_edit_performed:true,
      task_id:claim.task_id,run_id:claim.run_id,effect_id:claim.effect_id,
      source_sha:claim.source_sha,lease_generation:claim.lease_generation,
      owner_generation:claim.owner_generation,owner_epoch:claim.owner_epoch,
      relative_path:'calc.mjs',preimage_sha256:claim.preimage_sha256,
      postimage_sha256:claim.postimage_sha256,
      live_completion_verified:false,automatic_retry_allowed:false,
      promotion_authorized:false,authority_effect:false});
  } finally {
    if (!moved) await fs.rm(tmpName,{force:true}).catch(()=>{});
  }
}
module.exports = {SCHEMA,BEFORE,AFTER,CLAIM_FIELDS,sha256,
  executeFixedSandboxSourceEdit,verifyDisposableLockedWorktree};
