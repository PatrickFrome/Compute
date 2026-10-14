import test from 'node:test';
import assert from 'node:assert/strict';
import { readBoundClientAgentCompletion as read, W39_PROJECT_SQL, W39_FLEET_SQL,
  W39_TASK_SQL, W39_CRITIC_SQL, W39_WORKSPACE_SQL } from './operator-agent-completion-bound-w39.mjs';

const NOW = Date.parse('2026-10-14T12:30:00Z');
const TASK = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const WORKSPACE = '33333333-3333-4333-8333-333333333333';
const DEVICE = '44444444-4444-4444-8444-444444444444';
const SOURCE = 'a'.repeat(40);
const BASE = 'c'.repeat(40); // base commit != PR head (not interchangeable)
const CLAIM = 'b'.repeat(64);
const SUMMARY = 'd'.repeat(64);
const CHECK = 'Client State Runtime Contracts';
const ISO = x => new Date(x).toISOString();
const expected = () => ({
  task_id: TASK, run_id: PROJECT, owner_epoch: 7, lease_generation: 3,
  agent_id: 'agent_aaaaaaaa', source_sha: SOURCE,
  repository: 'PatrickFrome/Compute', pr_number: 1259, required_checks: [CHECK],
});
const owner = (now = NOW) => ({
  schema: 'metaengine.operator.trusted-owner.v1', source: 'TRUSTED_OWNER_READBACK',
  verified: true, project_id: PROJECT, workspace_id: WORKSPACE, device_id: DEVICE,
  owner_id: 'native-owner-one', client_id: 'native-owner-one',
  admin_grant_epoch: 7, owner_generation: 21, process_incarnation: 'owner-run-21',
  observed_at: ISO(now - 1_000), heartbeat_at: ISO(now - 1_000), event_after_seq: 0,
});
const project = () => ({
  schema: 'metaengine.devos.project-snapshot.v1', found: true, authority_effect: false,
  project_id: PROJECT, coordination_workspace_id: WORKSPACE, last_seq: 8,
  selected_task: { task_id: TASK, state: 'COMPLETED', agent_id: 'agent_aaaaaaaa',
    lease_generation: 3, base_sha: BASE, coordination_workspace_id: WORKSPACE },
});
const fleet = () => ({ authority_effect: false, active_tasks: [], active_claims: [] });
const workspace = () => ({
  schema: 'metaengine.devos.workspace-binding-snapshot.v1', state: 'AVAILABLE',
  authority_effect: false, coordination_workspace_id: WORKSPACE,
  bindings: [{
    task_id: TASK, lease_generation: 3, agent_id: 'agent_aaaaaaaa',
    base_sha: BASE, repo_id: 'PatrickFrome/Compute',
    coordination_workspace_id: WORKSPACE, last_verified_head_sha: SOURCE,
    workspace_generation: 2, claim_id: 17, state: 'FROZEN', dirty_hold: false,
    ambiguity_code: null, authority_effect: false, automatic_retry_allowed: false,
    updated_at: ISO(NOW - 15*60_000),
  }],
});
const task = () => ({
  task_id: TASK, workspace_id: WORKSPACE, state: 'COMPLETED', lease_generation: 3,
  lease_agent_id: 'agent_aaaaaaaa', base_sha: BASE,
  claim_sha256: CLAIM, result_sha256: SUMMARY,
  result_summary_sha256: SUMMARY, bound_ready: true, completion_ready: true,
  ready_at: ISO(NOW - 90 * 60_000), finished_at: ISO(NOW - 10 * 60_000),
  ready_seq: 2, completed_seq: 7, observed_at: ISO(NOW - 60_000),
});
const critic = () => ({
  task_id: '55555555-5555-4555-8555-555555555555', role: 'CRITIC',
  state: 'COMPLETED', lease_agent_id: 'agent_bbbbbbbb', lease_generation: 2,
  subject_task_id: TASK, subject_sha256: CLAIM, accepted_subject_sha256: CLAIM,
  disposition: 'ACCEPT', bound_accept: true, critic_seq: 5,
  finished_at: ISO(NOW - 25 * 60_000),
});
const pull = () => ({
  source: 'GITHUB_API', number: 1259, state: 'open',
  head: { sha: SOURCE, repo: { full_name: 'PatrickFrome/Compute' } },
  base: { repo: { full_name: 'PatrickFrome/Compute' } },
});
const checks = () => ({
  source: 'GITHUB_API', head_sha: SOURCE, total_count: 1, check_runs: [
    { id: 155, name: CHECK, head_sha: SOURCE, status: 'completed',
      conclusion: 'success', completed_at: ISO(NOW - 2 * 60_000) },
  ],
});
function scenario(now = NOW) {
  const data = { project: project(), fleet: fleet(), workspace: workspace(), tasks: [task()], critics: [critic()] };
  const calls = [];
  const api = {
    expected: expected(), owner: owner(now), observed_at_ms: now,
    withOwnerReadbackTransaction: async cb => cb({ unsafe: async (sql, params) => {
      calls.push({sql, params});
      if (sql === W39_PROJECT_SQL) return [{snapshot: data.project}];
      if (sql === W39_FLEET_SQL) return [{snapshot: data.fleet}];
      if (sql === W39_WORKSPACE_SQL) return [{snapshot: data.workspace}];
      if (sql === W39_TASK_SQL) return data.tasks;
      if (sql === W39_CRITIC_SQL) return data.critics;
      throw Error('arbitrary_sql_denied');
    }}),
    readGitHubPull: async selector => { calls.push({pr: selector}); return pull(); },
    readGitHubChecks: async selector => { calls.push({checks: selector}); return checks(); },
  };
  return { data, api, calls };
}
test('end-to-end: actual P0 project + W30 DevOS snapshot + digest-bound independent child + W31 current GitHub checks', async () => {
  const {api,calls} = scenario();
  const result = await read(api);
  assert.equal(result.state, 'SOURCE_EVIDENCE_READY', JSON.stringify(result));
  assert.equal(result.source_evidence_qualified, true);
  assert.equal(result.verified, false);
  assert.equal(result.owner_accepted, false);
  assert.equal(result.successful_completion, false);
  assert.equal(result.independent_live_attestation_verified, false);
  assert.equal(result.authority_effect, false);
  assert.deepEqual(calls.slice(0,5).map(c => c.sql),
    [W39_PROJECT_SQL,W39_FLEET_SQL,W39_WORKSPACE_SQL,W39_TASK_SQL,W39_CRITIC_SQL]);
  assert.deepEqual(calls[0].params, [WORKSPACE,TASK,DEVICE,'native-owner-one',7]);
  assert.deepEqual(calls[1].params,[WORKSPACE]);
  assert.deepEqual(calls[2].params,[WORKSPACE]);
  assert.deepEqual(calls[3].params,[PROJECT,TASK,WORKSPACE,DEVICE,'native-owner-one',7]);
  assert.deepEqual(calls[4].params,[PROJECT,TASK]);
  assert.deepEqual(calls[5].pr,{repository:'PatrickFrome/Compute',pr_number:1259});
  assert.deepEqual(calls[6].checks,{repository:'PatrickFrome/Compute',sha:SOURCE});
  assert.equal(result.result_sha256,CLAIM);
  assert.doesNotMatch(JSON.stringify(result),/secret|objective|prompt|token|https?:\/\//i);
});
test('base sha is not fabricated into PR head identity', async () => {
  const {api, data} = scenario();
  data.workspace.bindings[0].last_verified_head_sha = BASE;
  const result = await read(api);
  assert.equal(result.state,'UNKNOWN');
});
const negatives = [
  ['lost own-PG project readback', s => {s.data.project = null;}],
  ['wrong run', s => {s.data.project.project_id = DEVICE;}],
  ['wrong Owner epoch', s => {s.api.owner.admin_grant_epoch++;}],
  ['missing Owner heartbeat', s => {s.api.owner.heartbeat_at = ISO(NOW - 60_000);}],
  ['Owner reincarnation absent', s => {s.api.owner.process_incarnation = '';}],
  ['lease transfer in project reader', s => {s.data.project.selected_task.lease_generation = 4;}],
  ['lease transfer in result reader', s => {s.data.tasks[0].lease_generation = 4;}],
  ['lease transfer in W30 snapshot', s => {s.data.fleet.active_claims = [{task_id: TASK,lease_generation:4,state:'ACTIVE'}];}],
  ['reincarnated active task', s => {s.data.fleet.active_tasks = [{task_id:TASK,state:'RUNNING',lease_generation:4}];}],
  ['duplicate subject rows', s => {s.data.tasks.push(task());}],
  ['lost result row', s => {s.data.tasks = [];}],
  ['subject digest changes', s => {s.data.critics[0].subject_sha256 = 'e'.repeat(64);}],
  ['stale critic accepted digest', s => {s.data.critics[0].accepted_subject_sha256 = 'e'.repeat(64);}],
  ['critic is implementer', s => {s.data.critics[0].lease_agent_id = 'agent_aaaaaaaa';}],
  ['false critic SQL proof', s => {s.data.critics[0].bound_accept = false;}],
  ['critic disposition reject despite proof flag', s => {s.data.critics[0].disposition = 'REJECT';}],
  ['false subject SQL proof', s => {s.data.tasks[0].bound_ready = false;}],
  ['false completion guard', s => {s.data.tasks[0].completion_ready = false;}],
  ['duplicate CRITIC receipts', s => {s.data.critics.push({...critic(),task_id:DEVICE});}],
  ['unknown branch source SHA', s => {s.data.workspace.bindings[0].last_verified_head_sha = null;}],
  ['dirty workspace', s => {s.data.workspace.bindings[0].dirty_hold = true;}],
  ['ambiguous workspace', s => {s.data.workspace.bindings[0].ambiguity_code = 'DRIFT';}],
  ['duplicate workspace binding', s => {s.data.workspace.bindings.push({...s.data.workspace.bindings[0]});}],
  ['workspace generation changes', s => {s.data.workspace.bindings[0].lease_generation = 4;}],
  ['invalid result summary digest', s => {s.data.tasks[0].result_summary_sha256 = 'e'.repeat(64);}],
  ['READY seq after critic', s => {s.data.critics[0].critic_seq = 1;}],
  ['critic seq after subject completed', s => {s.data.critics[0].critic_seq = 8;}],
  ['completed event ahead of project cursor', s => {s.data.tasks[0].completed_seq = 9;}],
  ['completed event precedes READY', s => {s.data.tasks[0].completed_seq = 1;}],
  ['absent event seq', s => {s.data.tasks[0].ready_seq = null;}],
  ['stale own-PG observed clock', s => {s.data.tasks[0].observed_at = ISO(NOW-600_000);}],
  ['post RESULT_READY expiry', s => {s.data.tasks[0].ready_at = ISO(NOW - 25*3_600_000); s.data.tasks[0].finished_at=ISO(NOW-24.5*3_600_000); s.data.critics[0].finished_at=ISO(NOW-24.7*3_600_000);}],
  ['completion outside TTL', s => {s.data.tasks[0].finished_at=ISO(NOW + 60_000);}],
  ['fleet snapshot false effect authority', s => {s.data.fleet.authority_effect = true;}],
  ['project snapshot false effect authority', s => {s.data.project.authority_effect = true;}],
];
for (const [name, mutate] of negatives) test('fail closed without GitHub: '+name, async () => {
  const s = scenario(); mutate(s);
  const result = await read(s.api);
  if (name === 'post RESULT_READY expiry') {
    assert.equal(result.state, 'EXPIRED');
    assert.equal(result.reason, 'RESULT_READY_EXPIRED');
  }
  assert.equal(result.source_evidence_qualified,false,name);
  assert.equal(result.successful_completion,false,name);
  assert.equal(result.authority_effect,false,name);
  assert.equal(s.calls.some(c=>c.pr||c.checks),false,name);
});
test('exact GitHub PR/head drift is review-required, never verified', async () => {
  const s = scenario();
  s.api.readGitHubPull = async () => ({...pull(), head:{sha:'f'.repeat(40),repo:{full_name:'PatrickFrome/Compute'}}});
  const result = await read(s.api);
  assert.equal(result.state,'PENDING');
  assert.equal(result.reason,'GITHUB_PR_IDENTITY_UNPROVEN');
  assert.equal(result.source_evidence_qualified,false);
});
test('out-of-order or incomplete CI checks cannot qualify', async () => {
  const s = scenario();
  s.api.readGitHubChecks = async () => ({...checks(),check_runs:[{...checks().check_runs[0], completed_at: ISO(NOW+1000)}]});
  const r = await read(s.api);
  assert.equal(r.reason,'GITHUB_CHECK_NOT_EXACT_GREEN');
});
test('missing read-only transaction capability and SQL failure are UNKNOWN', async () => {
  const s=scenario(); s.api.withOwnerReadbackTransaction = null;
  assert.equal((await read(s.api)).reason,'READERS_UNBOUND');
  s.api.withOwnerReadbackTransaction = async () => {throw Error('SECRET=NEVER_LEAK');};
  assert.equal((await read(s.api)).reason,'SOURCE_READBACK_FAILED');
  assert.doesNotMatch(JSON.stringify(await read(s.api)),/SECRET/);
});
test('selectors contain no dynamic URL, SQL, page/model action or effect authority', async () => {
  const s=scenario();
  s.api.expected.repository='https://evil.example/a';
  const r=await read(s.api);
  assert.equal(r.source_evidence_qualified,false);
  assert.equal(s.calls.some(x=>x.pr||x.checks),false);
  for (const sql of [W39_PROJECT_SQL,W39_FLEET_SQL,W39_WORKSPACE_SQL,W39_TASK_SQL,W39_CRITIC_SQL])
    assert.match(sql,/^SELECT /);
  assert.match(W39_PROJECT_SQL,/NULL::uuid/); // project_snapshot accepts either task OR project, not both
  assert.match(W39_TASK_SQL,/result_sha256'=t.result_sha256/);
  assert.match(W39_CRITIC_SQL,/result_sha256'=v.result_sha256/);
  assert.doesNotMatch([W39_PROJECT_SQL,W39_FLEET_SQL,W39_WORKSPACE_SQL,W39_TASK_SQL,W39_CRITIC_SQL].join('\n'),/INSERT |UPDATE |DELETE |DROP |COPY |CREATE |ALTER |SELECT \*|https?:\/\//i);
});
