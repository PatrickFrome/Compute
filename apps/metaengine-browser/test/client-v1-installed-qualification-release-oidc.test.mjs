import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../../../supabase/functions/metaengine-client-installed-qualification-h205f22/index.ts', import.meta.url),
  'utf8',
);

test('installed qualification preserves exact PR OIDC binding', () => {
  assert.match(source, /eventName === "pull_request" && PR_SUBJECTS\.has\(subject\)/);
  assert.match(source, /repo:\$\{REPO\}:pull_request/);
  assert.match(source, /repo:PatrickFrome@\$\{OWNER_ID\}\/Compute@\$\{REPOSITORY_ID\}:pull_request/);
  assert.match(source, /String\(run\?\.event \|\| ""\) !== "pull_request"/);
  assert.match(source, /run_pr_head_binding_missing/);
});

test('installed qualification admits push only for the exact release branch and subject', () => {
  assert.match(source, /const RELEASE_BRANCH = "release\/self-update-ambiguity-live-v2"/);
  assert.match(source, /const RELEASE_REF = `refs\/heads\/\$\{RELEASE_BRANCH\}`/);
  assert.match(source, /eventName === "push"[\s\S]*?String\(payload\.ref \|\| ""\) === RELEASE_REF[\s\S]*?RELEASE_SUBJECTS\.has\(subject\)/);
  assert.match(source, /repo:\$\{REPO\}:ref:\$\{RELEASE_REF\}/);
  assert.match(source, /repo:PatrickFrome@\$\{OWNER_ID\}\/Compute@\$\{REPOSITORY_ID\}:ref:\$\{RELEASE_REF\}/);
  assert.match(source, /String\(run\?\.event \|\| ""\) !== "push"/);
  assert.match(source, /String\(run\?\.head_branch \|\| ""\) !== RELEASE_BRANCH/);
  assert.doesNotMatch(source, /eventName === "push"\s*&&\s*RELEASE_SUBJECTS\.has\(subject\)/,
    'release push must also require the exact OIDC ref claim');
});

test('installed qualification keeps workflow, repository, runner and exact-head fences', () => {
  assert.match(source, /const REPO = "PatrickFrome\/Compute"/);
  assert.match(source, /const WORKFLOW_PATH = "\.github\/workflows\/browser-windows-installed-chat-qualification\.yml"/);
  assert.match(source, /payload\.runner_environment !== "github-hosted"/);
  assert.match(source, /String\(run\?\.path \|\| ""\) !== WORKFLOW_PATH/);
  assert.match(source, /String\(run\?\.head_sha \|\| ""\)\.toLowerCase\(\) !== sourceHead/);
  assert.match(source, /run_attempt_drift/);
});
