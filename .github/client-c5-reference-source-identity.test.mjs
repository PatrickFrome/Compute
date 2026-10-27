import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('workflows/client-v1-c5-reference-useful-work.yml', import.meta.url), 'utf8');
const self = '.github/client-c5-reference-source-identity.test.mjs';
const candidateExpression = '${{ github.event.pull_request.head.sha || github.sha }}';

function step(source, name) {
  const start = source.indexOf('      - name: ' + name + '\n');
  assert.ok(start >= 0, 'missing step: ' + name);
  const end = source.indexOf('\n      - name:', start + 1);
  return source.slice(start, end < 0 ? source.length : end);
}

function assertCandidateIdentity(source) {
  const environment = /^env:\n((?:  .*\n)+)/m.exec(source);
  assert.ok(environment?.[1].includes('  CANDIDATE_HEAD: ' + candidateExpression + '\n'),
    'PR head takes precedence, with github.sha only as the non-PR fallback');
  assert.equal(source.split(candidateExpression).length - 1, 1, 'resolve the candidate once for both jobs');
  assert.equal((source.match(/^\s+CANDIDATE_HEAD:/gm) || []).length, 1, 'steps must not shadow the candidate');
  assert.doesNotMatch(source, /\$(?:GITHUB_SHA|\{GITHUB_SHA\})|\$\{\{ github\.sha \}\}/, 'merge SHA must not replace candidate identity');
  for (const name of ['Checkout exact candidate head', 'Checkout exact verifier head']) {
    const checkout = step(source, name);
    assert.match(checkout, /^          ref: \$\{\{ env\.CANDIDATE_HEAD \}\}$/m);
    assert.match(checkout, /^          fetch-depth: 1$/m);
    assert.match(checkout, /^          persist-credentials: false$/m);
  }
  for (const name of ['Prove exact candidate head', 'Prove verifier exact head',
    'Prove host checkout remained unchanged', 'Prove verifier checkout remained unchanged']) {
    assert.ok(step(source, name).includes('test "$(git rev-parse HEAD)" = "$CANDIDATE_HEAD"'), name);
  }
  for (const name of ['Execute isolated-copy reference useful-work producer',
    'Independently verify useful-work material and synthetic non-promotion']) {
    assert.match(step(source, name), /--head "\$CANDIDATE_HEAD"/);
  }
  for (const kind of ['producer', 'verification']) {
    assert.ok(source.includes('name: client-c5-reference-' + kind + '-${{ env.CANDIDATE_HEAD }}'));
  }
}

test('C5 checkout, production, independent verification and artifact labels share exact candidate identity', () => {
  assertCandidateIdentity(workflow);
});

test('C5 identity guard rejects PR merge-SHA regressions at each consumer', () => {
  const consumers = [
    [candidateExpression, '${{ github.sha }}'],
    ['ref: ${{ env.CANDIDATE_HEAD }}', 'ref: ${{ github.sha }}'],
    ['--head "$CANDIDATE_HEAD"', '--head "$GITHUB_SHA"'],
    ['test "$(git rev-parse HEAD)" = "$CANDIDATE_HEAD"', 'test "$(git rev-parse HEAD)" = "$GITHUB_SHA"'],
    ['name: client-c5-reference-producer-${{ env.CANDIDATE_HEAD }}', 'name: client-c5-reference-producer-${{ github.sha }}'],
    ['name: client-c5-reference-verification-${{ env.CANDIDATE_HEAD }}', 'name: client-c5-reference-verification-${{ github.sha }}'],
  ];
  for (const [before, after] of consumers) {
    let position = workflow.indexOf(before);
    assert.ok(position >= 0, before);
    while (position >= 0) {
      const changed = workflow.slice(0, position) + after + workflow.slice(position + before.length);
      assert.throws(() => assertCandidateIdentity(changed), { code: 'ERR_ASSERTION' });
      position = workflow.indexOf(before, position + before.length);
    }
  }
});

test('C5 keeps independent immutable evidence verification and both unchanged-host checks', () => {
  assert.match(workflow, /independent-verifier:\n    needs: \[reference-producer\]/);
  assert.match(workflow, /artifact-ids: \$\{\{ needs\.reference-producer\.outputs\.artifact_id \}\}/);
  assert.match(workflow, /digest-mismatch: error/);
  assert.match(step(workflow, 'Prove verifier exact head'), /test -n "\$\{\{ needs\.reference-producer\.outputs\.artifact_digest \}\}"/);
  assert.doesNotMatch(workflow, /continue-on-error|\|\|\s*(?:true|:)/);
  for (const name of ['Prove host checkout remained unchanged', 'Prove verifier checkout remained unchanged']) {
    assert.ok(step(workflow, name).includes('test -z "$(git status --porcelain=v1 --untracked-files=all)"'));
  }
  assert.match(step(workflow, 'Prove checked-in reference baseline is intentionally red'), /test "\$rc" -ne 0/);
  assert.match(step(workflow, 'Re-run fail-closed Client C5 contract'), /node --test test\/client-v1-c5-useful-work-proof\.test\.mjs/);
});

test('C5 identity guard runs before producing evidence and is included in both trigger path lists', () => {
  const guard = workflow.indexOf('run: node --test ' + self);
  assert.ok(guard >= 0 && guard < workflow.indexOf('      - name: Execute isolated-copy reference useful-work producer'));
  for (const event of ['push', 'pull_request']) {
    const start = workflow.indexOf('  ' + event + ':\n');
    assert.ok(start >= 0);
    const tail = workflow.slice(start), end = tail.search(/\n {2}\S/);
    assert.ok(tail.slice(0, end < 0 ? tail.length : end).includes("      - '" + self + "'"));
  }
});
