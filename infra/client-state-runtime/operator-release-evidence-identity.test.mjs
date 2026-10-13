import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyReleaseEvidenceIdentity as verify, verifyReleaseEvidenceFile, hashRegularReleaseArtifact } from './operator-release-evidence-identity.mjs';

const SHA = 'a'.repeat(40);
const DIGEST = 'b'.repeat(64);
const NOW = Date.parse('2026-10-14T00:00:20.000Z');
const AT = '2026-10-14T00:00:19.000Z';
const policy = { nowMs: NOW };
function fixture() {
  return {
    expected: { git_sha: SHA, owner_id: 'owner-1', process_incarnation: 'pid-12.birth-77', observed_at: AT },
    source: { git_sha: SHA, observed_at: AT },
    build: { source_sha: SHA, artifact_sha256: DIGEST, observed_at: AT },
    package: { source_sha: SHA, artifact_sha256: DIGEST, observed_at: AT },
    runtime: { source_sha: SHA, artifact_sha256: DIGEST, owner_id: 'owner-1', process_incarnation: 'pid-12.birth-77', observed_at: AT },
    owner: { owner_id: 'owner-1', process_incarnation: 'pid-12.birth-77', observed_at: AT },
    artifact: { sha256: DIGEST, observed_at: AT },
  };
}
test('fully consistent independent claims can only produce non-authorizing MATCH', () => {
  const r = verify(fixture(), policy);
  assert.equal(r.state, 'MATCH');
  assert.deepEqual(r.reasons, []);
  assert.equal(r.release_ready, false);
  assert.equal(r.installed_runtime_proven, false);
  assert.equal(r.process_code_attested, false);
  assert.equal(r.authority_effect, false);
  assert.equal(r.remote_fallback_allowed, false);
  assert.equal(JSON.stringify(r).includes('owner-1'), false);
});

test('missing every witness or each mandatory field remains UNKNOWN, not READY', () => {
  assert.equal(verify({}, policy).state, 'UNKNOWN');
  for (const [label, value] of Object.entries(fixture())) {
    const f = fixture(); delete f[label];
    assert.equal(verify(f, policy).state, 'UNKNOWN', label);
    for (const field of Object.keys(value)) {
      const g = fixture(); delete g[label][field];
      assert.equal(verify(g, policy).state, 'UNKNOWN', label + '.' + field);
    }
  }
});

test('source Git, build/package/runtime source drift all fail closed', () => {
  for (const [label, key] of [['expected','git_sha'], ['source','git_sha'], ['build','source_sha'], ['package','source_sha'], ['runtime','source_sha']]) {
    const f = fixture(); f[label][key] = 'c'.repeat(40);
    assert.equal(verify(f, policy).state, 'BLOCKED', label);
  }
});

test('build/package/runtime/actual artifact digest mismatch fails closed', () => {
  for (const [label, key] of [['build','artifact_sha256'], ['package','artifact_sha256'], ['runtime','artifact_sha256'], ['artifact','sha256']]) {
    const f = fixture(); f[label][key] = 'c'.repeat(64);
    assert.deepEqual(verify(f, policy).reasons, ['ARTIFACT_DIGEST_MISMATCH'], label);
  }
});

test('independent runtime/owner incarnation and owner id collision are blocked', () => {
  for (const label of ['runtime', 'owner', 'expected']) {
    for (const field of ['process_incarnation', 'owner_id']) {
      const f = fixture(); f[label][field] = field === 'owner_id' ? 'other-owner' : 'pid-12.birth-78';
      assert.equal(verify(f, policy).state, 'BLOCKED', label + '.' + field);
    }
  }
});

test('every witness observed_at must equal the same fresh snapshot time', () => {
  for (const label of Object.keys(fixture())) {
    const f = fixture(); f[label].observed_at = '2026-10-14T00:00:18.000Z';
    assert.equal(verify(f, policy).state, 'BLOCKED', label);
  }
  const f = fixture(); Object.values(f).forEach(value => { value.observed_at = '2026-10-13T23:55:00.000Z'; });
  assert.ok(verify(f, policy).reasons.includes('OBSERVATION_OUTSIDE_FRESHNESS_WINDOW'));
  Object.values(f).forEach(value => { value.observed_at = '2026-10-14T00:00:26.000Z'; });
  assert.ok(verify(f, policy).reasons.includes('OBSERVATION_OUTSIDE_FRESHNESS_WINDOW'));
});

test('malformed shapes, uppercase hashes, invalid dates, unsafe or coercive inputs are blocked', () => {
  for (const change of [
    f => { f.runtime = []; },
    f => { f.build.source_sha = 'A'.repeat(40); },
    f => { f.package.artifact_sha256 = 'g'.repeat(64); },
    f => { f.expected.observed_at = '2026-02-30T00:00:00.000Z'; },
    f => { f.owner.process_incarnation = { toString: () => 'pid-12.birth-77' }; },
    f => { f.artifact.sha256 = DIGEST + '\nsecret'; },
  ]) {
    const f = fixture(); change(f); assert.equal(verify(f, policy).state, 'BLOCKED');
  }
  const access = fixture(); Object.defineProperty(access.owner, 'owner_id', { get() { throw Error('secret'); } });
  assert.deepEqual(verify(access, policy).reasons, ['WITNESS_ACCESS_FAILED']);
  assert.equal(verify(fixture(), { nowMs: NaN }).state, 'BLOCKED');
  assert.equal(verify(null, policy).state, 'BLOCKED');
});

test('conflict takes precedence over missing evidence and response never leaks raw keys', () => {
  const f = fixture(); delete f.owner; f.runtime.artifact_sha256 = 'c'.repeat(64);
  const r = verify(f, policy);
  assert.equal(r.state, 'BLOCKED');
  assert.equal(JSON.stringify(r).includes('pid-12'), false);
});

test('real local bytes are hashed and checked against the claimed SHA; no shell or network', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'w11-artifact-'));
  try {
    const path = join(dir, 'candidate.bin');
    const bytes = Buffer.from('release fixture bytes, not an executable');
    const digest = createHash('sha256').update(bytes).digest('hex');
    await writeFile(path, bytes);
    assert.equal(await hashRegularReleaseArtifact(path), digest);
    const f = fixture();
    for (const entry of [f.build, f.package, f.runtime]) entry.artifact_sha256 = digest;
    f.artifact.sha256 = digest;
    assert.equal((await verifyReleaseEvidenceFile({ artifactPath: path, witnesses: f }, policy)).state, 'MATCH');
    f.artifact.sha256 = '0'.repeat(64); // contradictory manifest cannot be overwritten.
    assert.equal((await verifyReleaseEvidenceFile({ artifactPath: path, witnesses: f }, policy)).state, 'BLOCKED');
    f.artifact.sha256 = digest;
    await writeFile(path, Buffer.from('tampered bytes'));
    assert.deepEqual((await verifyReleaseEvidenceFile({ artifactPath: path, witnesses: f }, policy)).reasons, ['ARTIFACT_DIGEST_MISMATCH']);
    const alias = join(dir, 'alias.bin');
    try {
      await symlink(path, alias);
      assert.equal((await verifyReleaseEvidenceFile({ artifactPath: alias, witnesses: f }, policy)).state, 'BLOCKED');
    } catch (error) {
      if (process.platform !== 'win32' || error.code !== 'EPERM') throw error;
    }
    assert.equal((await verifyReleaseEvidenceFile({ witnesses: f }, policy)).state, 'UNKNOWN');
    assert.equal((await verifyReleaseEvidenceFile({ artifactPath: 'relative.bin', witnesses: f }, policy)).state, 'BLOCKED');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('present conflicting witnesses fail closed even without expected anchor', () => {
  const f = fixture(); delete f.expected; f.runtime.source_sha = 'c'.repeat(40);
  assert.equal(verify(f, policy).state, 'BLOCKED');
  const g = fixture(); delete g.expected; g.owner.process_incarnation = 'different-birth';
  assert.equal(verify(g, policy).state, 'BLOCKED');
});
