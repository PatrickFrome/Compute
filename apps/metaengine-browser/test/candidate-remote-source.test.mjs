import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createCandidateCapsule } = require('../src/candidate-capsule.cjs');
const {
  gitExecutableCandidates,
  probeGitWithCandidates,
  proveRemoteSourceBinding,
  verifyCandidateCapsuleRemoteBound,
} = require('../src/candidate-remote-source.cjs');

const SOURCE = Object.freeze({
  repository: 'PatrickFrome/Compute',
  head: 'a'.repeat(40),
  ref: 'refs/heads/work/browser-provenance-test',
});

function capsule() {
  return createCandidateCapsule({
    source_head: SOURCE.head,
    sequence: 1,
    previous_candidate_id: null,
    intent: 'Prove exact candidate source exists on the authoritative remote ref.',
    components: [{
      path: 'apps/metaengine-browser/src/candidate-remote-source.cjs',
      change: 'CREATE',
      digest: `sha256:${'1'.repeat(64)}`,
    }],
    verification_plan: [{ id: 'REMOTE_SOURCE_BINDING', required: true }],
    evidence: [],
  }, SOURCE);
}

function runner({ url = 'https://github.com/PatrickFrome/Compute.git', head = SOURCE.head, ref = SOURCE.ref, rows = null } = {}) {
  const calls = [];
  const runGit = (_cwd, args) => {
    calls.push([...args]);
    if (args[0] === 'remote' && args[1] === 'get-url') return url;
    if (args[0] === 'ls-remote') return rows ?? `${head}\t${ref}`;
    throw new Error(`unexpected_git:${args.join(':')}`);
  };
  return { runGit, calls };
}

test('remote-bound verification requires exact authoritative GitHub branch head', () => {
  const { runGit, calls } = runner();
  const receipt = verifyCandidateCapsuleRemoteBound(capsule(), SOURCE, { cwd: '/tmp/repo', runGit });
  assert.equal(receipt.ok, true);
  assert.equal(receipt.source_current, true);
  assert.equal(receipt.source_current_scope, 'AUTHORITATIVE_REMOTE_REF');
  assert.equal(receipt.remote_source_verified, true);
  assert.equal(receipt.remote_source_ref, SOURCE.ref);
  assert.equal(receipt.remote_repository, SOURCE.repository);
  assert.equal(receipt.remote_mutates_refs, false);
  assert.equal(receipt.remote_mutates_worktree, false);
  assert.equal(receipt.authority_effect, false);
  assert.deepEqual(calls, [
    ['remote', 'get-url', 'origin'],
    ['ls-remote', '--heads', 'origin', SOURCE.ref],
  ]);
});

test('digest-valid local-only candidate fails closed when remote branch points elsewhere', () => {
  const { runGit } = runner({ head: 'b'.repeat(40) });
  assert.throws(
    () => verifyCandidateCapsuleRemoteBound(capsule(), SOURCE, { runGit }),
    /candidate_remote_head_mismatch/,
  );
});

test('remote repository identity is bound and credentials/alternate hosts cannot be substituted', () => {
  const wrong = runner({ url: 'https://github.com/OtherOwner/OtherRepo.git' });
  assert.throws(() => proveRemoteSourceBinding(SOURCE, { runGit: wrong.runGit }), /remote_repository_mismatch/);

  const credentialUrl = runner({ url: 'https://token@example.invalid/PatrickFrome/Compute.git' });
  assert.throws(() => proveRemoteSourceBinding(SOURCE, { runGit: credentialUrl.runGit }), /remote_url_untrusted/);
});

test('missing or ambiguous branch output cannot become remote provenance', () => {
  const missing = runner({ rows: '' });
  assert.throws(() => proveRemoteSourceBinding(SOURCE, { runGit: missing.runGit }), /remote_ref_missing/);

  const ambiguous = runner({ rows: `${SOURCE.head}\t${SOURCE.ref}\n${'b'.repeat(40)}\t${SOURCE.ref}` });
  assert.throws(() => proveRemoteSourceBinding(SOURCE, { runGit: ambiguous.runGit }), /remote_ref_ambiguous/);
});

test('source ref must be an exact refs/heads branch and remote name is bounded', () => {
  const { runGit } = runner();
  assert.throws(() => proveRemoteSourceBinding({ ...SOURCE, ref: 'refs/tags/v1' }, { runGit }), /remote_ref_invalid/);
  assert.throws(() => proveRemoteSourceBinding(SOURCE, { remote: 'origin;rm -rf', runGit }), /remote_name_invalid/);
});

test('Windows Git discovery retries only executable-not-found and reaches standard Git installation', () => {
  const env = { ProgramFiles: 'C:\\Program Files' };
  const calls = [];
  const execFile = (executable) => {
    calls.push(executable);
    if (executable === 'C:\\Program Files\\Git\\cmd\\git.exe') return 'ok\n';
    const error = new Error(`spawnSync ${executable} ENOENT`);
    error.code = 'ENOENT';
    throw error;
  };

  const output = probeGitWithCandidates('C:\\repo', ['--version'], { platform: 'win32', env, execFile });
  assert.equal(output, 'ok');
  assert.deepEqual(calls, ['git', 'git.exe', 'C:\\Program Files\\Git\\cmd\\git.exe']);
  assert.deepEqual(gitExecutableCandidates({ platform: 'linux', env }), ['git']);
});

test('Git discovery fails closed on any non-ENOENT probe error', () => {
  const calls = [];
  const execFile = (executable) => {
    calls.push(executable);
    const error = new Error('permission denied');
    error.code = 'EACCES';
    throw error;
  };

  assert.throws(
    () => probeGitWithCandidates('C:\\repo', ['--version'], { platform: 'win32', env: { ProgramFiles: 'C:\\Program Files' }, execFile }),
    /candidate_remote_probe_failed:permission denied/,
  );
  assert.deepEqual(calls, ['git']);
});
