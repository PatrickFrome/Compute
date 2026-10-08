import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const EVIDENCE_ARCHIVE_SCHEMA = 'metaengine.client-state.evidence-archive.v1';
const HASH = /^[a-f0-9]{64}$/;
const MEDIA_TYPES = new Set(['application/json', 'application/sql', 'application/octet-stream', 'text/plain']);
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

export function canonicalEvidenceJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalEvidenceJson).join(',')}]`;
  if (value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalEvidenceJson(value[key])}`).join(',')}}`;
  }
  throw new Error('evidence_json_value_invalid');
}

function exactKeys(value, keys, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code);
  if (Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')) throw new Error(code);
}

function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)) throw new Error('evidence_timestamp_invalid');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString().replace('.000Z', 'Z') !== value.replace('.000Z', 'Z')) throw new Error('evidence_timestamp_invalid');
  return date.toISOString();
}

function sourceIdentity(value) {
  exactKeys(value, ['repository', 'commit', 'treeSha256', 'dirty', 'provider', 'instance', 'acquiredAt'], 'evidence_source_shape_invalid');
  if (typeof value.repository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.repository)) throw new Error('evidence_repository_invalid');
  if (typeof value.commit !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.commit)) throw new Error('evidence_commit_invalid');
  if (typeof value.treeSha256 !== 'string' || !HASH.test(value.treeSha256)) throw new Error('evidence_tree_digest_invalid');
  if (typeof value.dirty !== 'boolean') throw new Error('evidence_dirty_flag_invalid');
  if (typeof value.provider !== 'string' || !/^[A-Z][A-Z0-9_]{1,63}$/.test(value.provider)) throw new Error('evidence_provider_invalid');
  if (typeof value.instance !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.instance)) throw new Error('evidence_instance_invalid');
  return { ...value, acquiredAt: timestamp(value.acquiredAt) };
}

function verificationClaims(value, digest) {
  if (value === undefined) return { method: 'NONE', result: 'UNVERIFIED', verifierId: null, verifiedAt: null, independent: false, subjectSha256: digest };
  exactKeys(value, ['method', 'result', 'verifierId', 'verifiedAt', 'independent', 'subjectSha256'], 'evidence_verification_shape_invalid');
  if (typeof value.method !== 'string' || !/^[A-Z][A-Z0-9_]{1,63}$/.test(value.method) || !['PASS', 'FAIL', 'UNVERIFIED'].includes(value.result)) throw new Error('evidence_verification_invalid');
  if (typeof value.independent !== 'boolean' || value.subjectSha256 !== digest) throw new Error('evidence_verification_subject_mismatch');
  if (value.result === 'UNVERIFIED') {
    if (value.independent !== false || value.verifierId !== null || value.verifiedAt !== null) throw new Error('evidence_unverified_claim_invalid');
    return { ...value };
  }
  if (typeof value.verifierId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.verifierId)) throw new Error('evidence_verifier_invalid');
  return { ...value, verifiedAt: timestamp(value.verifiedAt) };
}

function validateReceipt(receipt, evidenceId) {
  exactKeys(receipt, ['schema', 'evidence_id', 'receipt_sha256', 'kind', 'object', 'source', 'verification_claims', 'data_policy', 'authority_effect', 'promotion_authorized'], 'evidence_receipt_shape_invalid');
  if (receipt.schema !== EVIDENCE_ARCHIVE_SCHEMA || receipt.evidence_id !== evidenceId || !HASH.test(receipt.receipt_sha256)) throw new Error('evidence_receipt_identity_invalid');
  if (typeof receipt.kind !== 'string' || !/^[A-Z][A-Z0-9_]{1,95}$/.test(receipt.kind)) throw new Error('evidence_kind_invalid');
  exactKeys(receipt.object, ['sha256', 'bytes', 'media_type'], 'evidence_object_shape_invalid');
  if (!HASH.test(receipt.object.sha256) || !Number.isSafeInteger(receipt.object.bytes) || receipt.object.bytes < 0 || !MEDIA_TYPES.has(receipt.object.media_type)) throw new Error('evidence_object_invalid');
  sourceIdentity(receipt.source);
  verificationClaims(receipt.verification_claims, receipt.object.sha256);
  exactKeys(receipt.data_policy, ['classification', 'remote_export_allowed'], 'evidence_policy_invalid');
  if (receipt.data_policy.classification !== 'LOCAL_PRIVATE' || receipt.data_policy.remote_export_allowed !== false || receipt.authority_effect !== false || receipt.promotion_authorized !== false) throw new Error('evidence_authority_or_export_forbidden');
  const { evidence_id, receipt_sha256, ...core } = receipt;
  const expected = sha256(canonicalEvidenceJson(core));
  if (receipt_sha256 !== expected || evidence_id !== `evidence_sha256_${expected}`) throw new Error('evidence_receipt_digest_mismatch');
}

async function regularFile(file, maxBytes = Infinity) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('evidence_file_type_invalid');
  if (stat.size > maxBytes) throw new Error('evidence_object_too_large');
  const bytes = await fs.readFile(file);
  if (bytes.length > maxBytes) throw new Error('evidence_object_too_large');
  return bytes;
}

async function immutableWrite(file, bytes) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  const handle = await fs.open(temporary, 'wx', 0o600);
  try {
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    // A hard link publishes completed bytes without replacing an existing object.
    try { await fs.link(temporary, file); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    if (!(await regularFile(file)).equals(bytes)) throw new Error('evidence_immutable_collision');
  } finally {
    await fs.unlink(temporary);
  }
}

export async function createEvidenceArchive({ root, maxObjectBytes = 64 * 1024 * 1024 }) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('evidence_archive_absolute_root_required');
  if (!Number.isSafeInteger(maxObjectBytes) || maxObjectBytes < 1 || maxObjectBytes > 512 * 1024 * 1024) throw new Error('evidence_object_limit_invalid');
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const archiveRoot = await fs.realpath(root);
  const directories = { objects: path.join(archiveRoot, 'objects'), receipts: path.join(archiveRoot, 'receipts') };
  async function checkDirectories() {
    for (const directory of Object.values(directories)) {
      await fs.mkdir(directory, { mode: 0o700 }).catch((error) => { if (error.code !== 'EEXIST') throw error; });
      const stat = await fs.lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(directory) !== directory) throw new Error('evidence_archive_directory_invalid');
    }
  }
  await checkDirectories();

  async function get(evidenceId) {
    if (!/^evidence_sha256_[a-f0-9]{64}$/.test(evidenceId)) throw new Error('evidence_id_invalid');
    await checkDirectories();
    const receipt = JSON.parse((await regularFile(path.join(directories.receipts, `${evidenceId}.json`), 32768)).toString('utf8'));
    validateReceipt(receipt, evidenceId);
    if (receipt.object.bytes > maxObjectBytes) throw new Error('evidence_object_too_large');
    const bytes = await regularFile(path.join(directories.objects, `${receipt.object.sha256}.bin`), maxObjectBytes);
    if (bytes.length !== receipt.object.bytes || sha256(bytes) !== receipt.object.sha256) throw new Error('evidence_object_digest_mismatch');
    return { receipt, bytes, integrity: { receipt_digest_verified: true, object_digest_verified: true, source_bound: true, source_authenticity_attested: false, semantic_truth_verified: false, authority_effect: false } };
  }

  async function put({ kind, content, mediaType = 'application/json', source, verification }) {
    if (typeof kind !== 'string' || !/^[A-Z][A-Z0-9_]{1,95}$/.test(kind)) throw new Error('evidence_kind_invalid');
    if (!MEDIA_TYPES.has(mediaType)) throw new Error('evidence_media_type_invalid');
    const bytes = Buffer.isBuffer(content) ? Buffer.from(content) : content instanceof Uint8Array ? Buffer.from(content) : typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(canonicalEvidenceJson(content), 'utf8');
    if (bytes.length > maxObjectBytes) throw new Error('evidence_object_too_large');
    const digest = sha256(bytes);
    const core = {
      schema: EVIDENCE_ARCHIVE_SCHEMA, kind,
      object: { sha256: digest, bytes: bytes.length, media_type: mediaType },
      source: sourceIdentity(source), verification_claims: verificationClaims(verification, digest),
      data_policy: { classification: 'LOCAL_PRIVATE', remote_export_allowed: false },
      authority_effect: false, promotion_authorized: false,
    };
    const receiptDigest = sha256(canonicalEvidenceJson(core));
    const receipt = { ...core, evidence_id: `evidence_sha256_${receiptDigest}`, receipt_sha256: receiptDigest };
    await checkDirectories();
    await immutableWrite(path.join(directories.objects, `${digest}.bin`), bytes);
    await immutableWrite(path.join(directories.receipts, `${receipt.evidence_id}.json`), Buffer.from(canonicalEvidenceJson(receipt) + '\n'));
    return (await get(receipt.evidence_id)).receipt;
  }

  async function list({ limit = 100 } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('evidence_list_limit_invalid');
    await checkDirectories();
    const names = (await fs.readdir(directories.receipts)).filter((name) => /^evidence_sha256_[a-f0-9]{64}\.json$/.test(name)).sort().slice(0, limit);
    const receipts = [];
    for (const name of names) receipts.push((await get(name.slice(0, -5))).receipt);
    return receipts;
  }

  return Object.freeze({ root: archiveRoot, put, get, list, remoteExportAllowed: false });
}
