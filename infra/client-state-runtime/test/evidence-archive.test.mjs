import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createEvidenceArchive } from '../evidence-archive.mjs';

const source = {
  repository: 'PatrickFrome/Compute', commit: 'a'.repeat(40), treeSha256: 'b'.repeat(64),
  dirty: true, provider: 'CLIENT_POSTGRES', instance: 'client-state-01', acquiredAt: '2026-10-07T20:00:00Z',
};

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'compute-evidence-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return createEvidenceArchive({ root, ...options });
}

test('receipt binds bytes, exact source, and claims without conferring authority', async (t) => {
  const archive = await fixture(t);
  const receipt = await archive.put({ kind: 'RESTORE_PROBE', content: { rows: 81, ok: true }, source });
  const readback = await archive.get(receipt.evidence_id);
  assert.equal(readback.bytes.toString(), '{"ok":true,"rows":81}');
  assert.deepEqual(receipt.data_policy, { classification: 'LOCAL_PRIVATE', remote_export_allowed: false });
  assert.equal(receipt.promotion_authorized, false);
  assert.equal(receipt.verification_claims.result, 'UNVERIFIED');
  assert.equal(readback.integrity.source_bound, true);
  assert.equal(readback.integrity.source_authenticity_attested, false);
  assert.equal(readback.integrity.semantic_truth_verified, false);
  const same = await archive.put({ kind: 'RESTORE_PROBE', content: { ok: true, rows: 81 }, source });
  const another = await archive.put({ kind: 'RESTORE_PROBE', content: { rows: 81, ok: true }, source: { ...source, instance: 'client-state-02' } });
  assert.equal(same.evidence_id, receipt.evidence_id);
  assert.notEqual(another.evidence_id, receipt.evidence_id);
  assert.equal(another.object.sha256, receipt.object.sha256);
  assert.equal((await archive.list()).length, 2);
});

test('concurrent writers publish a single complete immutable object and receipt', async (t) => {
  const archive = await fixture(t);
  const receipts = await Promise.all(Array.from({ length: 12 }, () => archive.put({ kind: 'LOCAL_ROWS', content: Buffer.alloc(65536, 17), source, mediaType: 'application/octet-stream' })));
  assert.equal(new Set(receipts.map((value) => value.evidence_id)).size, 1);
  assert.equal((await archive.get(receipts[0].evidence_id)).bytes.length, 65536);
  assert.equal((await fs.readdir(path.join(archive.root, 'objects'))).length, 1);
  assert.equal((await fs.readdir(path.join(archive.root, 'receipts'))).length, 1);
});

test('object and source-manifest tampering fail readback instead of becoming new evidence', async (t) => {
  const archive = await fixture(t);
  const receipt = await archive.put({ kind: 'DATABASE_DUMP', content: 'private rows', source, mediaType: 'application/sql' });
  const objectFile = path.join(archive.root, 'objects', `${receipt.object.sha256}.bin`);
  await fs.writeFile(objectFile, 'altered rows');
  await assert.rejects(archive.get(receipt.evidence_id), /evidence_object_digest_mismatch/);
  await assert.rejects(archive.put({ kind: 'DATABASE_DUMP', content: 'private rows', source, mediaType: 'application/sql' }), /evidence_immutable_collision/);
  const receiptFile = path.join(archive.root, 'receipts', `${receipt.evidence_id}.json`);
  await fs.writeFile(receiptFile, JSON.stringify({ ...receipt, source: { ...receipt.source, commit: 'c'.repeat(40) } }));
  await assert.rejects(archive.get(receipt.evidence_id), /evidence_receipt_digest_mismatch/);
});

test('claims must refer to exact bytes; integrity never turns caller claims into attestation', async (t) => {
  const archive = await fixture(t);
  const content = 'checked payload';
  const verification = { method: 'RESTORE_ROW_COUNTS', result: 'PASS', verifierId: 'local-checker', verifiedAt: '2026-10-07T20:01:00Z', independent: false, subjectSha256: crypto.createHash('sha256').update(content).digest('hex') };
  const receipt = await archive.put({ kind: 'RESTORE_PROBE', content, source, verification, mediaType: 'text/plain' });
  const readback = await archive.get(receipt.evidence_id);
  assert.equal(receipt.verification_claims.result, 'PASS');
  assert.equal(readback.integrity.source_authenticity_attested, false);
  assert.equal(readback.integrity.semantic_truth_verified, false);
  await assert.rejects(archive.put({ kind: 'RESTORE_PROBE', content: 'different', source, verification }), /evidence_verification_subject_mismatch/);
});

test('rejects paths, credential-shaped source metadata, invalid JSON and object overflow', async (t) => {
  const archive = await fixture(t, { maxObjectBytes: 8 });
  await assert.rejects(archive.get('../../private'), /evidence_id_invalid/);
  await assert.rejects(archive.put({ kind: '../DUMP', content: '', source }), /evidence_kind_invalid/);
  await assert.rejects(archive.put({ kind: 'DUMP', content: '', source: { ...source, token: 'private' } }), /evidence_source_shape_invalid/);
  await assert.rejects(archive.put({ kind: 'DUMP', content: '', source: { ...source, repository: 'https://user:secret@example.com/repo' } }), /evidence_repository_invalid/);
  await assert.rejects(archive.put({ kind: 'DUMP', content: '', source: { ...source, repository: [source.repository] } }), /evidence_repository_invalid/);
  await assert.rejects(archive.put({ kind: 'DUMP', content: { invalid: undefined }, source }), /evidence_json_value_invalid/);
  await assert.rejects(archive.put({ kind: 'DUMP', content: '123456789', source }), /evidence_object_too_large/);
});

test('archive refuses replacement of its object directory with a junction', async (t) => {
  const archive = await fixture(t);
  const external = await fs.mkdtemp(path.join(os.tmpdir(), 'compute-evidence-external-'));
  t.after(() => fs.rm(external, { recursive: true, force: true }));
  await fs.rmdir(path.join(archive.root, 'objects'));
  await fs.symlink(external, path.join(archive.root, 'objects'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(archive.put({ kind: 'DUMP', content: 'private', source }), /evidence_archive_directory_invalid/);
  assert.deepEqual(await fs.readdir(external), []);
});
