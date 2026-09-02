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
  assert.match(workflow, /\[\[ "\$\{GITHUB_SHA\}" =~ \^\[0-9a-f\]\{40\}\$ \]\]/);
  assert.doesNotMatch(workflow, /test "\$\{GITHUB_SHA\}" =~/);
  assert.doesNotMatch(workflow, /secrets\./);
  assert.doesNotMatch(workflow, /SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ANON_KEY/);
  assert.match(workflow, /cancel-in-progress:\s*false/);
});

test('push baseline sync preserves bounded HTTP failure readback without exposing credentials', async () => {
  const workflow = await read('.github/workflows/metaengine-devos-baseline-push-sync.yml');
  assert.match(workflow, /-o "\$response_file" -w '%\{http_code\}'/);
  assert.match(workflow, /HTTP_STATUS="\$http_status"/);
  assert.match(workflow, /push_sync_http_\$\{status\}:\$\{diagnostic\}/);
  assert.match(workflow, /String\(row\.diagnostic \|\| row\.reason \|\| row\.error \|\| 'unknown'\)\.slice\(0, 240\)/);
  const postBlock = workflow.slice(workflow.indexOf('http_status="$(curl'));
  assert.doesNotMatch(postBlock, /--fail-with-body/);
});

test('push sync endpoint pins repository ref workflow subject and GitHub-hosted push claims', async () => {
  const source = await read('supabase/functions/metaengine-devos-baseline-push-sync-h205f22/index.ts');
  assert.match(source, /createRemoteJWKSet/);
  assert.match(source, /jwtVerify/);
  assert.match(source, /https:\/\/token\.actions\.githubusercontent\.com/);
  assert.match(source, /metaengine-h205f22-devos-baseline-sync/);
  assert.match(source, /const REPO = "PatrickFrome\/Compute"/);
  assert.match(source, /const REPOSITORY_ID = "1341371143"/);
  assert.match(source, /const OWNER_ID = "20597814"/);
  assert.match(source, /const REF = "refs\/heads\/integration\/metaengine-development-os-v1"/);
  assert.match(source, /const SUBJECT = "repo:PatrickFrome@20597814\/Compute@1341371143:ref:refs\/heads\/integration\/metaengine-development-os-v1"/);
  assert.match(source, /const WORKFLOW_REF = "PatrickFrome\/Compute\/\.github\/workflows\/metaengine-devos-baseline-push-sync\.yml@refs\/heads\/integration\/metaengine-development-os-v1"/);
  assert.match(source, /payload\.ref !== REF/);
  assert.match(source, /payload\.sub !== SUBJECT/);
  assert.match(source, /payload\.workflow_ref !== WORKFLOW_REF/);
  assert.match(source, /payload\.event_name !== "push"/);
  assert.match(source, /payload\.runner_environment !== "github-hosted"/);
  assert.match(source, /payload\.repository_visibility !== "public"/);
});

test('push sync uses the proven direct DB transport and never service-role REST JWT auth', async () => {
  const source = await read('supabase/functions/metaengine-devos-baseline-push-sync-h205f22/index.ts');
  assert.match(source, /import postgres from "npm:postgres@\^3"/);
  assert.match(source, /SUPABASE_DB_URL/);
  assert.match(source, /select public\.devos_roadmap_baseline_sync_read_v1\(\) as result/);
  assert.match(source, /select public\.devos_roadmap_baseline_sync_commit_v1\(/);
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(source, /\/rest\/v1\/rpc\//);
});

test('push sync candidate comes only from verified OIDC SHA and remains fast-forward CAS fenced', async () => {
  const source = await read('supabase/functions/metaengine-devos-baseline-push-sync-h205f22/index.ts');
  const candidateAt = source.indexOf('const candidate = String(payload.sha');
  const authorityAt = source.indexOf('const authority = await readAuthority()', candidateAt);
  const compareAt = source.indexOf('const compare = await githubCompare(expected, candidate)', authorityAt);
  const dispatchAt = source.indexOf('return await commitAdvance(expected, candidate, compare', compareAt);
  const proofGuardAt = source.indexOf('if (status !== "ahead" || mergeBase !== expected || baseSha !== expected || headSha !== candidate)');
  const casAt = source.indexOf('select public.devos_roadmap_baseline_sync_commit_v1(', proofGuardAt);
  assert.ok(candidateAt >= 0, 'candidate must come from signed GitHub OIDC sha');
  assert.ok(authorityAt > candidateAt, 'current DB authority must be reread after OIDC verification');
  assert.ok(compareAt > authorityAt, 'fast-forward proof must compare current authority to OIDC candidate');
  assert.ok(dispatchAt > compareAt, 'compare result must be passed into the proof-fenced commit path');
  assert.ok(proofGuardAt >= 0, 'commit path must validate GitHub compare proof');
  assert.ok(casAt > proofGuardAt, 'CAS RPC may happen only after exact fast-forward proof guard');
  assert.match(source, /status !== "ahead"/);
  assert.match(source, /mergeBase !== expected/);
  assert.match(source, /baseSha !== expected/);
  assert.match(source, /headSha !== candidate/);
  assert.match(source, /\$\{expected\}::text/);
  assert.match(source, /\$\{candidate\}::text/);
  assert.doesNotMatch(source, /await req\.json|input\.candidate|body\.candidate/);
  assert.match(source, /caller_candidate_ignored:\s*true/);
  assert.match(source, /polling_fallback_preserved:\s*true/);
});
