import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSkillPackageIdentity, revalidateSkillPackageIdentity, SKILL_PACKAGE_LIMITS } from '../skill-package-identity-v1.mjs';

function file(path, content, executable = false, type = 'file') {
  const bytes = content instanceof Uint8Array ? content : Buffer.from(content, 'utf8');
  return { path, bytes, executable, type };
}

function skillBytes(lineEnding = '\n') {
  return Buffer.from([
    '---',
    'name: package-test',
    'description: Verify raw and semantic identity separation.',
    '---',
    '## Workflow',
    '',
    'Read the selected resources.'
  ].join(lineEnding), 'utf8');
}

test('package identity content-addresses exact raw files while exposing no bodies or authority', () => {
  const identity = compileSkillPackageIdentity('package-test', [
    file('SKILL.md', skillBytes()),
    file('references/REF.md', 'Reference body.'),
    file('scripts/check.sh', '#!/bin/sh\necho inert\n', true),
    file('assets/blob.bin', new Uint8Array([0, 1, 2, 255]))
  ]);
  assert.equal(identity.file_count, 4);
  assert.equal(identity.resource_count, 3);
  assert.equal(identity.exact_raw_file_digests, true);
  assert.equal(identity.semantic_and_raw_identity_separate, true);
  assert.equal(identity.signature_verified, false);
  assert.equal(identity.provenance_verified, false);
  assert.equal(identity.trust_state, 'CONTENT_IDENTITY_ONLY');
  assert.equal(identity.content_embedded, false);
  assert.equal(identity.scripts_inert, true);
  assert.equal(identity.authority_effect, false);
  assert.equal(identity.execution_eligible, false);
  assert.equal(identity.script_execution_exposed, false);
  assert.ok(identity.package_manifest_digest.startsWith('sha256:'));
  assert.ok(identity.semantic_skill_fingerprint.startsWith('sha256:'));
  const serialized = JSON.stringify(identity);
  assert.equal(serialized.includes('Reference body'), false);
  assert.equal(serialized.includes('echo inert'), false);
});

test('canonical semantic fingerprint may survive line-ending changes while raw package identity rotates', () => {
  const lf = compileSkillPackageIdentity('package-test', [file('SKILL.md', skillBytes('\n'))]);
  const crlf = compileSkillPackageIdentity('package-test', [file('SKILL.md', skillBytes('\r\n'))]);
  assert.equal(lf.semantic_skill_fingerprint, crlf.semantic_skill_fingerprint);
  assert.notEqual(lf.files[0].raw_sha256, crlf.files[0].raw_sha256);
  assert.notEqual(lf.files[0].raw_bytes, crlf.files[0].raw_bytes);
  assert.notEqual(lf.package_manifest_digest, crlf.package_manifest_digest);
});

test('raw byte buffers are copied before hashing and caller mutation cannot rewrite returned identity', () => {
  const bytes = skillBytes();
  const before = compileSkillPackageIdentity('package-test', [file('SKILL.md', bytes)]);
  const originalDigest = before.files[0].raw_sha256;
  bytes[bytes.length - 1] ^= 1;
  assert.equal(before.files[0].raw_sha256, originalDigest);
  const after = compileSkillPackageIdentity('package-test', [file('SKILL.md', bytes)]);
  assert.notEqual(after.files[0].raw_sha256, originalDigest);
});

test('external package file fields are read exactly once', () => {
  const reads = { path: 0, type: 0, executable: 0, bytes: 0 };
  const stableBytes = skillBytes();
  const source = {
    get path() {
      reads.path += 1;
      return reads.path === 1 ? 'SKILL.md' : '../escape';
    },
    get type() {
      reads.type += 1;
      return reads.type === 1 ? 'file' : 'symlink';
    },
    get executable() {
      reads.executable += 1;
      return false;
    },
    get bytes() {
      reads.bytes += 1;
      return reads.bytes === 1 ? stableBytes : Buffer.from('mutated');
    }
  };
  const identity = compileSkillPackageIdentity('package-test', [source]);
  assert.equal(identity.file_count, 1);
  assert.deepEqual(reads, { path: 1, type: 1, executable: 1, bytes: 1 });
});

test('package paths, duplicate SKILL.md, symlinks and invalid UTF-8 fail closed', () => {
  const validSkill = file('SKILL.md', skillBytes());
  for (const path of ['../escape', '/absolute', 'references/nested/R.md', 'references\\R.md', 'other/R.md', 'references/.hidden']) {
    assert.throws(() => compileSkillPackageIdentity('package-test', [validSkill, file(path, 'x')]), /skill_package_(path|filename)_invalid/);
  }
  assert.throws(() => compileSkillPackageIdentity('package-test', [file('references/R.md', 'x')]), /skill_package_skill_file_missing/);
  assert.throws(() => compileSkillPackageIdentity('package-test', [file('SKILL.md', skillBytes()), file('SKILL.md', skillBytes())]), /skill_package_path_duplicate|skill_package_skill_file_duplicate/);
  assert.throws(() => compileSkillPackageIdentity('package-test', [file('SKILL.md', skillBytes(), false, 'symlink')]), /skill_package_file_type_invalid/);
  assert.throws(() => compileSkillPackageIdentity('package-test', [file('SKILL.md', new Uint8Array([0xff, 0xfe, 0xfd]))]), /skill_package_skill_utf8_invalid/);
});

test('package revalidation binds exact raw digest and semantic fingerprint', () => {
  const files = [file('SKILL.md', skillBytes()), file('references/R.md', 'stable')];
  const identity = compileSkillPackageIdentity('package-test', files);
  const verified = revalidateSkillPackageIdentity('package-test', files, {
    expectedPackageManifestDigest: identity.package_manifest_digest,
    expectedSemanticSkillFingerprint: identity.semantic_skill_fingerprint
  });
  assert.deepEqual(verified, identity);

  const changed = [file('SKILL.md', skillBytes()), file('references/R.md', 'changed')];
  assert.throws(() => revalidateSkillPackageIdentity('package-test', changed, {
    expectedPackageManifestDigest: identity.package_manifest_digest,
    expectedSemanticSkillFingerprint: identity.semantic_skill_fingerprint
  }), /skill_package_digest_stale/);
});

test('package file and byte budgets are hard limits', () => {
  const tooMany = [file('SKILL.md', skillBytes())];
  for (let index = 0; index < SKILL_PACKAGE_LIMITS.maxResourceFiles + 1; index += 1) {
    tooMany.push(file(`references/R${index}.md`, 'x'));
  }
  assert.throws(() => compileSkillPackageIdentity('package-test', tooMany), /skill_package_file_count_invalid|skill_package_resources_too_many/);
  assert.throws(() => compileSkillPackageIdentity('package-test', [
    file('SKILL.md', Buffer.alloc(SKILL_PACKAGE_LIMITS.maxFileBytes + 1, 0x61))
  ]), /skill_package_file_too_large/);
});
