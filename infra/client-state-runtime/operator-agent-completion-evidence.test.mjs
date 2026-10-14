import test from 'node:test';
import assert from 'node:assert/strict';
import { qualifyClientAgentCompletion as qualify, readClientAgentCompletion as read } from './operator-agent-completion-evidence.mjs';

const NOW = Date.parse('2026-10-14T12:30:00Z');
const TASK = '11111111-1111-4111-8111-111111111111';
const RUN = '22222222-2222-4222-8222-222222222222';
const SOURCE = 'a'.repeat(40);
const RESULT = 'b'.repeat(64);
const CHECK = 'Client State Runtime Contracts';
const expected = () => ({
  task_id: TASK, run_id: RUN, owner_epoch: 7, lease_generation: 3,
  agent_id: 'agent_aaaaaaaa', source_sha: SOURCE, repository: 'PatrickFrome/Compute',
  pr_number: 1216, required_checks: [CHECK],
});
const task = () => ({
  schema: 'metaengine.operator.task-readback.v1', readback_source: 'OWN_POSTGRES',
  task_id: TASK, run_id: RUN, owner_epoch: 7, lease_generation: 3,
  agent_id: 'agent_aaaaaaaa', source_sha: SOURCE,
  authority_effect: false, state: 'COMPLETED', result_sha256: RESULT,
  result_ready_at: '2026-10-14T11:00:00Z', result_ready_expires_at: '2026-10-14T13:00:00Z',
  completed_at: '2026-10-14T11:30:00Z', observed_at: '2026-10-14T12:29:00Z',
  verifier: {
    schema: 'metaengine.operator.independent-verifier.v1', readback_source: 'OWN_POSTGRES',
    authority_effect: false, verdict: 'ACCEPT', role: 'CRITIC',
    agent_id: 'agent_bbbbbbbb', task_id: TASK, subject_result_sha256: RESULT,
    run_id: RUN, owner_epoch: 7, lease_generation: 3,
    verified_at: '2026-10-14T11:20:00Z',
  },
});
const pull_request = () => ({
  source: 'GITHUB_API', number: 1216, state: 'open',
  head: { sha: SOURCE, repo: { full_name: 'PatrickFrome/Compute' } },
  base: { repo: { full_name: 'PatrickFrome/Compute' } },
});
const checks = () => ({
  source: 'GITHUB_API', head_sha: SOURCE, total_count: 1, check_runs: [{
    name: CHECK, id: 181, head_sha: SOURCE, status: 'completed', conclusion: 'success',
    completed_at: '2026-10-14T12:15:00Z',
  }],
});
const fixture = () => ({
  expected: expected(), task: task(), pull_request: pull_request(),
  checks: checks(), observed_at_ms: NOW,
});

test('exact own-PG task + independent CRITIC + current GitHub PR/checks gives only zero-authority source evidence', () => {
  const result = qualify(fixture());
  assert.equal(result.state, 'SOURCE_EVIDENCE_READY');
  assert.equal(result.source_evidence_qualified, true);
  assert.equal(result.successful_completion, false);
  assert.equal(result.promotion_authorized, false);
  assert.equal(result.independent_live_attestation_verified, false);
  assert.equal(result.authority_effect, false);
  assert.equal(result.source_sha, SOURCE);
  assert.equal(result.github_check_count, 1);
});

const cases = [
  ['unbound source', a => { a.expected.source_sha = ''; }, 'EXPECTED_BINDING_INVALID'],
  ['duplicate required checks', a => { a.expected.required_checks.push(CHECK); }, 'EXPECTED_BINDING_INVALID'],
  ['unscoped run', a => { a.expected.run_id = ''; }, 'EXPECTED_BINDING_INVALID'],
  ['wrong PG owner epoch', a => { a.task.owner_epoch++; }, 'OWN_PG_TASK_READBACK_INVALID'],
  ['wrong PG run', a => { a.task.run_id = '33333333-3333-4333-8333-333333333333'; }, 'OWN_PG_TASK_READBACK_INVALID'],
  ['wrong task generation', a => { a.task.lease_generation++; }, 'OWN_PG_TASK_READBACK_INVALID'],
  ['wrong task source SHA', a => { a.task.source_sha = 'c'.repeat(40); }, 'OWN_PG_TASK_READBACK_INVALID'],
  ['model-only task object', a => { a.task.readback_source = 'WORKER_TEXT'; }, 'OWN_PG_TASK_READBACK_INVALID'],
  ['forged authority flag', a => { a.task.authority_effect = true; }, 'OWN_PG_TASK_READBACK_INVALID'],
  ['stale own PG', a => { a.task.observed_at = '2026-10-14T11:00:00Z'; }, 'OWN_PG_TASK_READBACK_STALE'],
  ['future own PG', a => { a.task.observed_at = '2026-10-14T12:31:00Z'; }, 'OWN_PG_TASK_READBACK_STALE'],
  ['unknown result-ready deadline', a => { delete a.task.result_ready_expires_at; }, 'RESULT_READY_WINDOW_INVALID'],
  ['excessive ready horizon', a => { a.task.result_ready_expires_at = '2026-10-16T11:00:01Z'; }, 'RESULT_READY_WINDOW_INVALID'],
  ['expired ready evidence', a => { a.task.result_ready_expires_at = '2026-10-14T12:00:00Z'; }, 'RESULT_READY_EXPIRED'],
  ['ready is not accepted', a => { a.task.state = 'RESULT_READY'; }, 'INDEPENDENT_ACCEPTANCE_PENDING'],
  ['running is not accepted', a => { a.task.state = 'RUNNING'; }, 'TASK_NOT_COMPLETED'],
  ['ambiguous outcome', a => { a.task.state = 'AMBIGUOUS'; }, 'TASK_EFFECT_AMBIGUOUS'],
  ['failed task', a => { a.task.state = 'FAILED'; }, 'TASK_NOT_SUCCESSFUL'],
  ['completion after expiry', a => { a.task.completed_at = '2026-10-14T13:01:00Z'; }, 'COMPLETION_RECEIPT_INVALID'],
  ['missing result digest', a => { a.task.result_sha256 = ''; }, 'COMPLETION_RECEIPT_INVALID'],
  ['self verification', a => { a.task.verifier.agent_id = a.task.agent_id; }, 'INDEPENDENT_VERIFIER_NOT_PROVEN'],
  ['unbound verifier digest', a => { a.task.verifier.subject_result_sha256 = 'c'.repeat(64); }, 'INDEPENDENT_VERIFIER_NOT_PROVEN'],
  ['unbound verifier run', a => { a.task.verifier.run_id = '33333333-3333-4333-8333-333333333333'; }, 'INDEPENDENT_VERIFIER_NOT_PROVEN'],
  ['worker verifier provenance', a => { a.task.verifier.readback_source = 'MODEL'; }, 'INDEPENDENT_VERIFIER_NOT_PROVEN'],
  ['negative critic verdict', a => { a.task.verifier.verdict = 'REJECT'; }, 'INDEPENDENT_VERIFIER_NOT_PROVEN'],
  ['verifier later than completed receipt', a => { a.task.verifier.verified_at = '2026-10-14T12:00:00Z'; }, 'INDEPENDENT_VERIFIER_NOT_PROVEN'],
  ['PR number substitution', a => { a.pull_request.number = 1256; }, 'GITHUB_PR_IDENTITY_UNPROVEN'],
  ['PR head drift', a => { a.pull_request.head.sha = 'f'.repeat(40); }, 'GITHUB_PR_IDENTITY_UNPROVEN'],
  ['forked PR', a => { a.pull_request.head.repo.full_name = 'Other/Fork'; }, 'GITHUB_PR_IDENTITY_UNPROVEN'],
  ['non-GitHub PR', a => { a.pull_request.source = 'WORKER_REPORT'; }, 'GITHUB_PR_IDENTITY_UNPROVEN'],
  ['wrong GitHub checks SHA', a => { a.checks.head_sha = 'f'.repeat(40); }, 'GITHUB_CHECK_READBACK_INVALID'],
  ['partial GitHub checks page', a => { a.checks.total_count = 12; }, 'GITHUB_CHECK_READBACK_INVALID'],
  ['duplicate green checks', a => { a.checks.check_runs.push({ ...a.checks.check_runs[0], id: 182 }); a.checks.total_count = 2; }, 'GITHUB_CHECK_MISSING_OR_DUPLICATE'],
  ['CI SHA mismatch', a => { a.checks.check_runs[0].head_sha = 'c'.repeat(40); }, 'GITHUB_CHECK_NOT_EXACT_GREEN'],
  ['CI failure', a => { a.checks.check_runs[0].conclusion = 'failure'; }, 'GITHUB_CHECK_NOT_EXACT_GREEN'],
  ['CI skipped', a => { a.checks.check_runs[0].conclusion = 'skipped'; }, 'GITHUB_CHECK_NOT_EXACT_GREEN'],
  ['CI still running', a => { a.checks.check_runs[0].status = 'in_progress'; }, 'GITHUB_CHECK_NOT_EXACT_GREEN'],
  ['future CI completion', a => { a.checks.check_runs[0].completed_at = '2026-10-14T13:00:00Z'; }, 'GITHUB_CHECK_NOT_EXACT_GREEN'],
];
for (const [name, mutate, reason] of cases) {
  test('fail closed: ' + name, () => {
    const a = fixture(); mutate(a);
    const result = qualify(a);
    assert.equal(result.reason, reason, name);
    assert.equal(result.source_evidence_qualified, false);
    assert.equal(result.successful_completion, false);
    assert.equal(result.authority_effect, false);
  });
}

test('readback adapter invokes exact bounded native-own-PG and GitHub identities, no arbitrary URLs or effects', async () => {
  const calls = [];
  const result = await read({
    expected: expected(), observed_at_ms: NOW,
    readOwnTask: async args => { calls.push(['pg', args]); return task(); },
    readGitHubPull: async args => { calls.push(['pr', args]); return pull_request(); },
    readGitHubChecks: async args => { calls.push(['checks', args]); return checks(); },
  });
  assert.equal(result.state, 'SOURCE_EVIDENCE_READY');
  assert.deepEqual(calls.map(x => x[0]), ['pg', 'pr', 'checks']);
  assert.deepEqual(calls[1][1], { repository: 'PatrickFrome/Compute', pr_number: 1216 });
  assert.deepEqual(calls[2][1], { repository: 'PatrickFrome/Compute', sha: SOURCE });
  assert.doesNotMatch(JSON.stringify(result), /prompt|secret|token|sql|https?:\/\//i);
});

test('readback adapter never hits GitHub when own-PG result is expired', async () => {
  const old = task(); old.result_ready_expires_at = '2026-10-14T12:00:00Z';
  const result = await read({
    expected: expected(), observed_at_ms: NOW,
    readOwnTask: async () => old,
    readGitHubPull: async () => { throw new Error('unexpected'); },
    readGitHubChecks: async () => { throw new Error('unexpected'); },
  });
  assert.equal(result.state, 'EXPIRED');
});

test('unavailable independent reader and failures stay UNKNOWN', async () => {
  assert.equal((await read({ expected: expected() })).state, 'UNKNOWN');
  const r = await read({
    expected: expected(), observed_at_ms: NOW,
    readOwnTask: async () => { throw new Error('private DB connection string'); },
    readGitHubPull: async () => pull_request(),
    readGitHubChecks: async () => checks(),
  });
  assert.equal(r.reason, 'SOURCE_READBACK_FAILED');
  assert.doesNotMatch(JSON.stringify(r), /private DB/);
});
