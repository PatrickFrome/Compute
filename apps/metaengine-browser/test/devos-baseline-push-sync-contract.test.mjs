import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');

async function read(relative) {
  return fs.readFile(path.join(root, relative), 'utf8');
}

test('push baseline sync uses exact GitHub OIDC identity and no repository secret', async () => {
  const workflow = await read('.github/workflows/metaengine-devos-baseline-push-sync.yml');
  assert.match(workflow, /integration\/metaengine-development-os-v1/);
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /contents:\s*read/);
  assert.match(workflow, /AUDIENCE:\s*metaengine-h205f22-devos-baseline-sync/);
  assert.match(workflow, /metaengine-devos-baseline-push-sync-h205f22/);
  assert.match(workflow, /ACTIONS_ID_TOKEN_REQUEST_TOKEN/);
  assert.match(workflow, /ACTIONS_ID_TOKEN_REQUEST_URL/);
  assert.doesNotMatch(workflow, /secrets\./);
  assert.doesNotMatch(workflow, /SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ANON_KEY/);
  assert.match(workflow, /cancel-in-progress:\s*false/);
});

test('push sync endpoint pins repository ref workflow subject and GitHub-hosted push claims', async () => {
  const source = await read('supabase/functions/metaengine-devos-baseline-push-sync-h205f22/index.ts');
  assert.match(source, /createRemoteJWKSet/);
  assert.match(source, /jwtVerify/);
  assert.match(source, /https:\/\/token\.actions\.githubusercontent\.com/);
  assert.match(source, /metaengine-h205f22-devos-baseline-sync/);
  assert.match(source, /PatrickFrome\/Compute/);
  assert.match(source, /1341371143/);
  assert.match(source, /20597814/);
  assert.match(source, /refs\/heads\/integration\/metaengine-development-os-v1/);
  assert.match(source, /metaengine-devos-baseline-push-sync\.yml/);
  assert.match(source, /payload\.event_name !== "push"/);
  assert.match(source, /payload\.runner_environment !== "github-hosted"/);
  assert.match(source, /payload\.repository_visibility !== "public"/);
});

test('push sync candidate comes only from verified OIDC SHA and remains fast-forward CAS fenced', async () => {
  const source = await read('supabase/functions/metaengine-devos-baseline-push-sync-h205f22/index.ts');
  const candidateAt = source.indexOf('const candidate = String(payload.sha');
  const authorityAt = source.indexOf('const authority = await readAuthority()', candidateAt);
  const compareAt = source.indexOf('const compare = await githubCompare(expected, candidate)', authorityAt);
  const commitAt = source.indexOf('devos_roadmap_baseline_sync_commit_v1', compareAt);
  assert.ok(candidateAt >= 0, 'candidate must come from signed GitHub OIDC sha');
  assert.ok(authorityAt > candidateAt, 'current DB authority must be reread after OIDC verification');
  assert.ok(compareAt > authorityAt, 'fast-forward proof must compare current authority to OIDC candidate');
  assert.ok(commitAt > compareAt, 'CAS commit may happen only after compare proof');
  assert.match(source, /status !== "ahead"/);
  assert.match(source, /mergeBase !== expected/);
  assert.match(source, /baseSha !== expected/);
  assert.match(source, /headSha !== candidate/);
  assert.match(source, /p_expected_base:\s*expected/);
  assert.match(source, /p_next_base:\s*candidate/);
  assert.doesNotMatch(source, /await req\.json|input\.candidate|body\.candidate/);
  assert.match(source, /caller_candidate_ignored:\s*true/);
  assert.match(source, /polling_fallback_preserved:\s*true/);
});
