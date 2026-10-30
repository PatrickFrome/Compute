import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { CURRENT_SEAL_PATH, inspectCurrentSourceSeal, prepareCurrentSourceSeal } from '../scripts/current-source-seal.mjs';

test('new seal requires exact reviewed committed bytes and preserves historical identity and authority', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'current-source-seal-'));
  const root = path.join(temp, 'repo'); fs.mkdirSync(root);
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  const write = (file, bytes) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), bytes); };
  const commit = message => { git('add', '.'); git('-c', 'user.name=Source seal fixture', '-c', 'user.email=source-seal@invalid', 'commit', '--no-gpg-sign', '-qm', message); return git('rev-parse', 'HEAD'); };
  try {
    git('init', '-q'); git('config', 'core.autocrlf', 'true');
    write('.gitattributes', '*.mjs text eol=crlf\n');
    write('runtime.mjs', 'export const version = 1;\n');
    write('history.json', '{"immutable":true}\n');
    commit('historical source');
    const oldBlob = git('rev-parse', 'HEAD:runtime.mjs');
    const original = { schema: 'metaengine.client.critical-closure.v1', repository: 'PatrickFrome/Compute',
      current_tree_blobs: { 'runtime.mjs': oldBlob, 'history.json': git('rev-parse', 'HEAD:history.json') },
      current_source_candidate: { package_version: '0.7.0-dev.123.1', ci_qualification: false, installed_qualification: 'NOT_QUALIFIED' },
      previous_package_transitions: [{ frozen: true }], authority_effect: false, promotion_authorized: false };
    write(CURRENT_SEAL_PATH, JSON.stringify(original, null, 2) + '\n');
    write('runtime.mjs', 'export const version = 2;\n');
    write('new-producer.mjs', 'export const authority = false;\n');
    const sourceSha = commit('new reviewed source');
    fs.unlinkSync(path.join(root, 'runtime.mjs'));
    git('checkout', 'HEAD', '--', 'runtime.mjs');
    assert.ok(fs.readFileSync(path.join(root, 'runtime.mjs')).includes(Buffer.from('\r\n')),
      'positive control: exercise a physical CRLF checkout');
    assert.ok(!git('show', 'HEAD:runtime.mjs').includes('\r'), 'committed source stays canonical LF');
    assert.equal(git('status', '--porcelain'), '', git('diff'));
    const manifestBefore = fs.readFileSync(path.join(root, CURRENT_SEAL_PATH));
    const historyBefore = fs.readFileSync(path.join(root, 'history.json'));
    const { review, manifest } = inspectCurrentSourceSeal({ root, sourceSha, includePaths: ['new-producer.mjs'] });
    assert.deepEqual(review.changes.map(row => row.path), ['new-producer.mjs', 'runtime.mjs']);
    assert.equal(review.changes[1].previous_blob, oldBlob);
    assert.equal(review.changes[0].previous_blob, null);
    const { current_tree_blobs: ignoredOld, ...oldMetadata } = original;
    const { current_tree_blobs: ignoredNew, ...newMetadata } = manifest;
    assert.deepEqual(newMetadata, oldMetadata);
    const prepare = (reviewedDelta, outputDir = path.join(temp, 'candidate')) => prepareCurrentSourceSeal({ root, sourceSha, reviewedDelta, outputDir });
    for (const change of [
      { ...review, functional_source: 'f'.repeat(40) },
      { ...review, previous_manifest_blob: 'e'.repeat(40) },
      { ...review, changes: review.changes.slice(0, 1) },
      { ...review, changes: [...review.changes, review.changes[0]] },
      { ...review, changes: review.changes.map(row => ({ ...row, current_blob: 'd'.repeat(40) })) },
    ]) assert.throws(() => prepare(change));
    assert.equal(fs.existsSync(path.join(temp, 'candidate')), false);
    assert.throws(() => inspectCurrentSourceSeal({ root, sourceSha: 'f'.repeat(40) }), /exact_source_required/);
    assert.throws(() => inspectCurrentSourceSeal({ root, sourceSha, includePaths: [CURRENT_SEAL_PATH] }), /self_referencing/);
    assert.throws(() => inspectCurrentSourceSeal({ root, sourceSha, includePaths: ['../outside'] }), /invalid_or_self/);
    assert.throws(() => inspectCurrentSourceSeal({ root, sourceSha, includePaths: ['missing.mjs'] }), /missing_or_nonregular/);
    assert.throws(() => prepare(review, path.join(root, 'candidate')), /outside_checkout/);
    write('runtime.mjs', 'uncommitted tampering\n');
    assert.throws(() => prepare(review), /tracked_source_dirty/);
    git('checkout', '--', 'runtime.mjs');
    const receipt = prepare(review);
    const bytes = fs.readFileSync(path.join(temp, 'candidate', 'client-critical-closure.manifest.json'));
    assert.equal(receipt.current_manifest_sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
    assert.equal(receipt.authority_effect, false);
    assert.equal(receipt.qualification_promoted, false);
    assert.equal(receipt.validation, 'PENDING_FINAL_COMMIT_TESTS_AND_EXACT_HEAD_CI');
    assert.deepEqual(JSON.parse(bytes), manifest);
    assert.deepEqual(fs.readFileSync(path.join(root, CURRENT_SEAL_PATH)), manifestBefore);
    assert.deepEqual(fs.readFileSync(path.join(root, 'history.json')), historyBefore);
    assert.equal(git('status', '--porcelain'), '');
    assert.throws(() => prepare(review), /EEXIST/);
    assert.deepEqual(fs.readFileSync(path.join(temp, 'candidate', 'client-critical-closure.manifest.json')), bytes);
    fs.writeFileSync(path.join(root, CURRENT_SEAL_PATH), bytes);
    const sealedSha = commit('new seal commit without functional changes');
    const unchanged = inspectCurrentSourceSeal({ root, sourceSha: sealedSha });
    assert.deepEqual(unchanged.review.changes, []);
    assert.throws(() => prepareCurrentSourceSeal({ root, sourceSha: sealedSha,
      reviewedDelta: unchanged.review, outputDir: path.join(temp, 'duplicate-generation') }), /no_new_seal/);
    fs.unlinkSync(path.join(root, 'runtime.mjs'));
    const deletedSha = commit('negative deletion of sealed source');
    assert.throws(() => inspectCurrentSourceSeal({ root, sourceSha: deletedSha }), /missing_or_nonregular_source/);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
