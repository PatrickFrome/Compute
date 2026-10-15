import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { createDevosSupervisorRoutes } from '../../apps/metaengine-browser/supabase/a2-browser-native-supervisor-v1/devos-routes.mjs';
import { inspectStagingLease, sealStagingCheckpoint, inspectStagingRestart,
  inspectLiveCompletionForStaging } from './client-serial-loop-staging-w48.mjs';

const ID = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const WS = ID(93), TASK = ID(94), NEXT = ID(95);
const AGENT = 'agent_implementer0001';
const CONTROL = Object.freeze({
  schema: 'metaengine.devos.environment-state.v1', state: 'OPEN',
  authoritative: true, authority_effect: false, continuous_service_allowed: true,
  workspace_id: WS, generation_floor: 8, refill_enabled: true,
  supervisor_admission_enabled: true,
});
const GRAPH = Object.freeze({ task_id: TASK, state: 'READY', role: 'IMPLEMENTER',
  priority: 100, authority_effect: false,
  task_spec: { fleet_coordination_v1: { version: 1, role: 'IMPLEMENTER',
    resource: 'BROWSER', slots: 1, dependencies: [] } },
});
const SNAPSHOT = () => ({ active_tasks: [GRAPH], active_claims: [], completed_tasks: [],
  recent_events: [], authority_effect: false });
const hash = b => createHash('sha256').update(b).digest('hex');
const status = (file, cwd, args = []) => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // child is an independent disposable verification process
  const r = spawnSync(process.execPath, [...args, file], { cwd, encoding: 'utf8', env });
  return r.status;
};
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

async function cycle({ control = CONTROL, generation = 3 } = {}) {
  const calls = [];
  const routes = createDevosSupervisorRoutes({
    workspaceId: WS, readRuntimeControl: async () => control,
    rpc: async name => {
      calls.push(name);
      if (name === 'devos_fleet_snapshot_v1') return SNAPSHOT();
      if (name === 'devos_fleet_reconcile_v1') return { authority_effect: false };
      if (name === 'devos_fleet_lease_v1')
        return { leased: true, task_id: TASK, agent_id: AGENT,
          role: 'IMPLEMENTER', lease_generation: generation, authority_effect: false };
      throw Error('unknown_fixed_rpc: ' + name);
    },
  });
  const response = await routes({ req: { method: 'POST' }, path: '/v1/devos/cycle',
    clientId: 'disposable-device', body: {
      fleet: { agents: [{ agent_id: AGENT, role: 'IMPLEMENTER',
        lifecycle_state: 'ACTIVE', tab_id: 'tab-1',
        target_id: 'webcontents:71', generation_epoch: 9 }] },
    } });
  return { cycle: await response.json(), calls };
}
async function claim() {
  const actual = await cycle();
  assert.equal(actual.calls.filter(x => x === 'devos_fleet_lease_v1').length, 1);
  const lease = inspectStagingLease({ snapshot: SNAPSHOT(), runtimeControl: CONTROL,
    cycle: actual.cycle, workspace_id: WS, task_id: TASK, agent_id: AGENT,
    lease_generation: 3 });
  assert.equal(lease.state, 'STAGING_LEASE_OBSERVED');
  return lease;
}
async function realTempGitEvidence() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'metaengine-w48-synthetic-'));
  const src = path.join(root, 'calc.mjs');
  const tst = path.join(root, 'calc.test.mjs');
  try {
    git(root, 'init', '-q');
    await writeFile(src, 'export const add = (a,b) => a - b;\n');
    await writeFile(tst, "import test from 'node:test'; import assert from 'node:assert/strict'; import {add} from './calc.mjs'; test('fixed goal',()=>assert.equal(add(2,3),5));\n");
    git(root, 'add', '--', 'calc.mjs', 'calc.test.mjs');
    git(root, '-c', 'user.email=w48@example.invalid', '-c', 'user.name=W48 Fixture',
      'commit', '-qm', 'synthetic failing initial commit');
    const base = git(root, 'rev-parse', 'HEAD');
    const before = status(tst, root, ['--test']);
    assert.equal(before, 1, 'actual test must fail before edit');
    const old = await readFile(src, 'utf8');
    assert.equal(old, 'export const add = (a,b) => a - b;\n');
    // The only edit allowed by this disposable reference harness.
    await writeFile(src, 'export const add = (a,b) => a + b;\n');
    git(root, 'add', '--', 'calc.mjs');
    git(root, '-c', 'user.email=w48@example.invalid', '-c', 'user.name=W48 Fixture',
      'commit', '-qm', 'synthetic bounded repair');
    const head = git(root, 'rev-parse', 'HEAD');
    assert.notEqual(head, base);
    const after = status(tst, root, ['--test']);
    const build = status(src, root, ['--check']);
    assert.equal(after, 0);
    assert.equal(build, 0);
    assert.equal(git(root, 'status', '--porcelain'), '');
    const fileDigest = hash(await readFile(src));
    const manifestDigest = hash(JSON.stringify({ base, head, fileDigest, tests: [before, after, build] }));
    // Independent critic uses a different OS process to recompute bytes and Git HEAD.
    const criticCode = [
      "const fs=require('fs'),crypto=require('crypto'),cp=require('child_process');",
      "const [src,base,expectedHead,expectedDigest,expectedManifest]=process.argv.slice(1);",
      "const head=cp.execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();",
      "const digest=crypto.createHash('sha256').update(fs.readFileSync(src)).digest('hex');",
      "const manifest=crypto.createHash('sha256').update(JSON.stringify({base,head,fileDigest:digest,tests:[1,0,0]})).digest('hex');",
      "const valid=head===expectedHead&&digest===expectedDigest&&manifest===expectedManifest;",
      "process.stdout.write(JSON.stringify({verdict:valid?'ACCEPT':'REJECT',head,digest,manifest}));",
    ].join('');
    const independent = JSON.parse(execFileSync(process.execPath,
      ['-e', criticCode, src, base, head, fileDigest, manifestDigest], { cwd: root, encoding: 'utf8' }));
    assert.equal(independent.verdict, 'ACCEPT');
    return {
      source: { repo_scope: 'UNIQUE_TEMP_GIT', base_sha: base, head_sha: head },
      tests: { before_exit_code: before, after_exit_code: after, build_exit_code: build,
        working_tree_clean: true },
      artifact: { origin: 'SYNTHETIC/STAGING', file_sha256: fileDigest,
        manifest_sha256: manifestDigest, source_head_sha: head },
      critic: { source: 'INDEPENDENT_DISPOSABLE_PROCESS',
        agent_id: 'agent_critic000001', verdict: independent.verdict,
        artifact_sha256: manifestDigest, source_head_sha: independent.head },
    };
  } finally { await rm(root, { recursive: true, force: true }); }
}
const effect = lease => ({
  effect_id: randomUUID(), operation: 'FIXED_SANDBOX_SOURCE_EDIT',
  state: 'ACKED', ack_durable: true, task_id: lease.task_id,
  lease_generation: lease.lease_generation,
});
const times = () => ({ ready_at_ms: Date.now() - 5_000,
  completed_at_ms: Date.now() - 2_000 });
const checkpoint = (lease, evidence, e = effect(lease)) =>
  sealStagingCheckpoint({ lease, effect: e, ...evidence, ...times() });
const pg = c => ({ backend: 'OWN_PG17_DISPOSABLE', origin: 'SYNTHETIC/STAGING',
  checkpoint_sha256: c.checkpoint_sha256, task_id: c.task_id,
  lease_generation: c.lease_generation, source_sha: c.source_sha,
  artifact_sha256: c.artifact_sha256, effect_id: c.effect_id });

test('actual existing leased cycle -> failing temp Git test -> fixed edit -> independent critic', async () => {
  const lease = await claim();
  const evidence = await realTempGitEvidence();
  const saved = checkpoint(lease, evidence);
  assert.equal(saved.state, 'STAGING_REVIEW_REQUIRED');
  assert.equal(saved.live_completion_verified, false);
  assert.match(saved.checkpoint_sha256, /^[0-9a-f]{64}$/);
  assert.equal(inspectStagingRestart({checkpoint:saved,pgReadback:null,effect:{
    state:'ACKED',ack_durable:true }, requested_task_id:NEXT,requested_lease_generation:1
  }).reason, 'DURABLE_OWN_PG_READBACK_MISSING');
  const live = await inspectLiveCompletionForStaging({expected:{
    task_id:TASK, run_id:WS, owner_epoch:1, lease_generation:3, agent_id:AGENT,
    source_sha:evidence.source.head_sha,
  }});
  assert.equal(live.state, 'LIVE_UNKNOWN');
  assert.equal(live.live_completion_verified, false);
});

test('crash before or after durable intent, lost ACK, or duplicate old request never replays edit', async () => {
  const lease = await claim(), evidence = await realTempGitEvidence();
  for (const state of ['PREPARED', 'AMBIGUOUS']) {
    const s = sealStagingCheckpoint({lease,effect:{...effect(lease),state},...evidence,...times()});
    assert.equal(s.state, 'AMBIGUOUS');
    assert.equal(s.permission_to_edit, false);
  }
  const e=effect(lease), c=checkpoint(lease,evidence,e);
  for(const state of ['PREPARED','AMBIGUOUS']) {
    const r=inspectStagingRestart({checkpoint:c,pgReadback:pg(c),effect:{...e,state},
      requested_task_id:NEXT,requested_lease_generation:1});
    assert.equal(r.state,'AMBIGUOUS');
  }
  assert.equal(inspectStagingRestart({checkpoint:c,pgReadback:pg(c),effect:e,
    requested_task_id:TASK,requested_lease_generation:3}).reason,'COMPLETED_TASK_REPLAY_FORBIDDEN');
  assert.equal(inspectStagingRestart({checkpoint:c,pgReadback:{...pg(c),checkpoint_sha256:'f'.repeat(64)},
    effect:e,requested_task_id:NEXT,requested_lease_generation:1}).state,'UNKNOWN');
});

test('lease transfer, epoch drift, RESULT_READY expiry, critic digest drift all fail closed', async () => {
  const lease=await claim(), evidence=await realTempGitEvidence(), e=effect(lease);
  assert.equal(sealStagingCheckpoint({lease:{...lease,lease_generation:4},
    effect:e,...evidence,...times()}).state,'AMBIGUOUS');
  assert.equal(sealStagingCheckpoint({lease,effect:e,...evidence,
    ready_at_ms:Date.now()-86_400_100,completed_at_ms:Date.now()}).reason,'RESULT_READY_EXPIRED');
  assert.equal(sealStagingCheckpoint({lease,effect:e,...evidence,
    critic:{...evidence.critic,artifact_sha256:'f'.repeat(64)},...times()
  }).reason,'INDEPENDENT_CRITIC_BINDING_MISSING');
  const c=checkpoint(lease,evidence,e);
  assert.equal(inspectStagingRestart({checkpoint:c,pgReadback:{...pg(c),lease_generation:9},
    effect:e,requested_task_id:NEXT,requested_lease_generation:1}).state,'UNKNOWN');
  const rollover=await cycle({control:{...CONTROL,generation_floor:9}});
  assert.equal(inspectStagingLease({snapshot:SNAPSHOT(),runtimeControl:CONTROL,
    cycle:rollover.cycle,workspace_id:WS,task_id:TASK,agent_id:AGENT,
    lease_generation:3}).state,'UNKNOWN');
});

test('readback alone is STAGING eligibility, never physical claim or C2 completion', async () => {
  const lease=await claim(), evidence=await realTempGitEvidence(), e=effect(lease);
  const c=checkpoint(lease,evidence,e);
  const next=inspectStagingRestart({checkpoint:c,pgReadback:pg(c),effect:e,
    requested_task_id:NEXT,requested_lease_generation:1});
  assert.equal(next.state,'NEXT_TASK_ELIGIBLE_STAGING_ONLY');
  assert.equal(next.permission_to_claim,false);
  assert.equal(next.permission_to_edit,false);
  assert.equal(next.live_completion_verified,false);
});
