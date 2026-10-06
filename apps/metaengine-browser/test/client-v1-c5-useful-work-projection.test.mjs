import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const me2 = await readFile(
  new URL('../../me2-ui/src/components/me2/shell/me2-shell.tsx', import.meta.url),
  'utf8',
);
const preload = await readFile(new URL('../src/preload-shell.cjs', import.meta.url), 'utf8');
const main = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
const journal = await readFile(new URL('../src/client-goal-journal.mjs', import.meta.url), 'utf8');

test('primary Client bridge projects latest durable goal without adding useful-work mutation API', () => {
  assert.match(preload, /const latestClientGoal = \(\) => ipcRenderer\.invoke\('metaengine:client:latest-goal'\)/);
  assert.match(preload, /latestGoal: latestClientGoal/);
  assert.doesNotMatch(preload, /usefulWork(?:Submit|Accept|Promote|Retry)|useful-work-(?:submit|accept|promote|retry)/i);
  assert.doesNotMatch(preload, /metaengine:client:useful-work/);
});

test('main latest-goal path returns the durable journal projection and owns no submit fallback', () => {
  const latestStart = main.indexOf('async function latestClientGoal');
  const refreshStart = main.indexOf('async function refreshClientGoal', latestStart);
  assert.ok(latestStart >= 0 && refreshStart > latestStart);
  const latest = main.slice(latestStart, refreshStart);
  assert.match(latest, /journal\.latest\(\)/);
  assert.match(latest, /structuredClone\(latest\)/);
  assert.doesNotMatch(latest, /clientGoalSubmit\s*\(/);
  assert.doesNotMatch(latest, /submitClientGoal\s*\(/);
  assert.doesNotMatch(latest, /recordUsefulWorkProof\s*\(/);
});

test('durable journal includes useful-work proof only as zero-authority evidence', () => {
  assert.match(journal, /useful_work_proof: usefulWorkProof/);
  assert.match(journal, /clientUsefulWorkProofMatchesExecution/);
  assert.match(journal, /automatic_retry_allowed: false/);
  assert.match(journal, /authority_effect: false/);
});

test('task status distinguishes LIVE signed evidence from SYNTHETIC reference evidence', () => {
  assert.match(me2, /type ClientUsefulWorkProof = \{/);
  assert.match(me2, /evidence_class: "LIVE" \| "SYNTHETIC"/);
  assert.match(me2, /evidence_origin: "SIGNED_SUPERVISOR_READBACK" \| "CONTROLLED_FIXTURE"/);
  assert.match(me2, /client_c5_useful_work_verified: boolean/);
  assert.match(me2, /canonical_c2_promotion_authorized: false/);
  assert.match(me2, /usefulWork\?\.client_c5_useful_work_verified === true/);
  assert.match(me2, /usefulWork\.evidence_class === "LIVE"/);
  assert.match(me2, /usefulWork\.evidence_origin === "SIGNED_SUPERVISOR_READBACK"/);
  assert.match(me2, /"Live useful work verified"/);
  assert.match(me2, /"Reference evidence only · not live"/);
  assert.match(me2, /"Evidence only · not promoted"/);
});

test('product projection exposes only bounded artifact and provenance digest prefixes', () => {
  assert.match(me2, /client-useful-work-artifact-digest/);
  assert.match(me2, /client-useful-work-provenance-digest/);
  assert.match(me2, /value\.slice\(0, 12\)/);
  assert.match(me2, /artifact_sha256: string/);
  assert.match(me2, /provenance_sha256: string/);
  assert.doesNotMatch(me2, /usefulWork\?\.(?:patch|diff|stdout|stderr|model_output|page_content|repository_path|workspace_path)/);
});

test('task status does not turn Client evidence into canonical C2 promotion', () => {
  assert.match(me2, /data-testid="client-useful-work-canonical-boundary"/);
  assert.match(me2, /Canonical C2/);
  assert.doesNotMatch(me2, /Canonical C2[^\n]{0,160}(?:verified|complete|promoted)/i);
});
