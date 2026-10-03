import assert from 'node:assert/strict';
import test from 'node:test';
import { assertInstalledQualificationPushBinding } from '../../../supabase/functions/metaengine-client-installed-qualification-h205f22/push-policy.mjs';

const sha = 'a'.repeat(40);
const repo = 'PatrickFrome/Compute';
const path = '.github/workflows/browser-windows-installed-chat-qualification.yml';
const physical = 'physical/build-slsa-provenance-v1';
const release = 'release/self-update-ambiguity-live-v2';
function fixture(branch = physical, immutable = true) {
  const ref = `refs/heads/${branch}`;
  return {
    payload: { event_name: 'push', ref, sub: `repo:${immutable ? 'PatrickFrome@20597814/Compute@1341371143' : repo}:ref:${ref}`,
      repository: repo, repository_id: '1341371143', repository_owner_id: '20597814', runner_environment: 'github-hosted',
      sha, workflow_sha: sha, workflow_ref: `${repo}/${path}@${ref}`, run_id: '37076381669', run_attempt: '1' },
    run: { id: 37076381669, event: 'push', head_branch: branch, head_sha: sha, path, repository: { full_name: repo }, run_attempt: 1 },
  };
}
for (const branch of [physical, release]) for (const immutable of [false, true]) {
  test(`exact ${branch} ${immutable ? 'immutable' : 'legacy'} subject is admitted without authority`, () => {
    const { payload, run } = fixture(branch, immutable);
    assert.deepEqual(assertInstalledQualificationPushBinding(payload, run, sha), {
      branch, ref: `refs/heads/${branch}`, source_head: sha, authority_effect: false,
    });
  });
}
for (const [name, mutate] of [
  ['other branch', x => { x.payload.ref = 'refs/heads/main'; }],
  ['branch prefix extension', x => { x.payload.ref += '-untrusted'; }],
  ['tag', x => { x.payload.ref = 'refs/tags/physical/build-slsa-provenance-v1'; }],
  ['pull request', x => { x.payload.event_name = 'pull_request'; }],
  ['cross-branch subject', x => { x.payload.sub = fixture(release).payload.sub; }],
  ['other repository', x => { x.payload.repository = 'other/Compute'; }],
  ['other repository ID', x => { x.payload.repository_id = '1341371144'; }],
  ['other owner', x => { x.payload.repository_owner_id = '20597815'; }],
  ['self-hosted runner', x => { x.payload.runner_environment = 'self-hosted'; }],
  ['source SHA', x => { x.payload.sha = 'b'.repeat(40); }],
  ['workflow SHA', x => { x.payload.workflow_sha = 'b'.repeat(40); }],
  ['missing workflow SHA', x => { delete x.payload.workflow_sha; }],
  ['workflow suffix', x => { x.payload.workflow_ref += '-evil'; }],
  ['other workflow', x => { x.payload.workflow_ref = x.payload.workflow_ref.replace('installed-chat', 'package'); }],
  ['other run', x => { x.run.id++; }],
  ['other run repository', x => { x.run.repository.full_name = 'other/Compute'; }],
  ['other run workflow', x => { x.run.path += '-evil'; }],
  ['other run event', x => { x.run.event = 'pull_request'; }],
  ['other run branch', x => { x.run.head_branch = release; }],
  ['other run SHA', x => { x.run.head_sha = 'b'.repeat(40); }],
  ['attempt drift', x => { x.run.run_attempt = 2; }],
  ['physical rerun', x => { x.payload.run_attempt = '2'; x.run.run_attempt = 2; }],
  ['invalid attempt', x => { x.payload.run_attempt = 'NaN'; }],
]) test(`${name} cannot approve an enrollment`, () => {
  const value = fixture(); mutate(value);
  assert.throws(() => assertInstalledQualificationPushBinding(value.payload, value.run, sha));
});
test('empty source SHA cannot satisfy the binding', () => {
  const { payload, run } = fixture();
  assert.throws(() => assertInstalledQualificationPushBinding(payload, run, ''));
});
