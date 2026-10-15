import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sealStagingCheckpoint, verifyStagingCheckpointDigest,
  inspectStagingRestart } from './client-serial-loop-staging-w48.mjs';
import { inspectStagingNextLease } from './client-serial-loop-staging-w56.mjs';

const ID = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const TASK = ID(11), NEXT = ID(12), WS = ID(13);
const lease = { schema:'metaengine.client.serial-loop-staging-w48.v1',
  state:'STAGING_LEASE_OBSERVED', origin:'SYNTHETIC/STAGING',
  workspace_id:WS, task_id:TASK, agent_id:'agent_implementer0001',
  lease_generation:3, owner_generation:8 };
const effect = { effect_id:randomUUID(),operation:'FIXED_SANDBOX_SOURCE_EDIT',
  task_id:TASK,lease_generation:3,state:'ACKED',ack_durable:true };
const now = Date.now();
const c = sealStagingCheckpoint({
  lease,effect,source:{repo_scope:'UNIQUE_TEMP_GIT',base_sha:'a'.repeat(40),
    head_sha:'b'.repeat(40)},
  tests:{before_exit_code:1,after_exit_code:0,build_exit_code:0,working_tree_clean:true},
  artifact:{origin:'SYNTHETIC/STAGING',file_sha256:'c'.repeat(64),
    manifest_sha256:'d'.repeat(64),source_head_sha:'b'.repeat(40)},
  critic:{source:'INDEPENDENT_DISPOSABLE_PROCESS',agent_id:'agent_critic000001',
    verdict:'ACCEPT',artifact_sha256:'d'.repeat(64),source_head_sha:'b'.repeat(40)},
  ready_at_ms:now-10000,completed_at_ms:now-5000,
});
const pg = Object.freeze({backend:'OWN_PG17_DISPOSABLE',origin:'SYNTHETIC/STAGING',
  checkpoint_sha256:c.checkpoint_sha256,task_id:c.task_id,
  lease_generation:c.lease_generation,source_sha:c.source_sha,
  artifact_sha256:c.artifact_sha256,effect_id:c.effect_id});
const next = Object.freeze({...lease,task_id:NEXT,agent_id:'agent_implementer0002',lease_generation:1});
const nextPg = Object.freeze({backend:'OWN_PG17_DISPOSABLE',
  origin:'SYNTHETIC/STAGING',state:'LEASED_STAGING_ONLY',row_count:1,
  workspace_id:WS,task_id:NEXT,agent_id:next.agent_id,lease_generation:1,
  owner_generation:8,event_seq:9,after_checkpoint_sha256:c.checkpoint_sha256});
const inspect = args => inspectStagingNextLease({
  completedCheckpoint:c,completedPgReadback:pg,completedEffect:effect,
  nextLease:next,nextPgLeaseReadback:nextPg,...args,
});

test('canonical digest is recomputed, not accepted by hex shape', () => {
  assert.equal(c.state,'STAGING_REVIEW_REQUIRED');
  assert.equal(verifyStagingCheckpointDigest(c),true);
  for(const [key,value] of Object.entries({
    workspace_id:ID(77),task_id:ID(88),source_sha:'e'.repeat(40),
    file_sha256:'e'.repeat(64),critic_digest:'e'.repeat(64),
    agent_id:'agent_implementer9999',owner_generation:9,
    ready_at_ms:c.ready_at_ms-1,effect_id:randomUUID(),
  })) {
    const drift={...c,[key]:value};
    assert.equal(verifyStagingCheckpointDigest(drift),false,key);
    assert.equal(inspectStagingRestart({checkpoint:drift,pgReadback:pg,
      effect,requested_task_id:NEXT,requested_lease_generation:1}).state,'UNKNOWN',key);
  }
});

test('next task requires both real-bound Supervisor/W30 observation and distinct durable PG lease', () => {
  assert.equal(inspect().state,'NEXT_LEASE_READBACK_STAGING_ONLY');
  assert.equal(inspect().permission_to_edit,false);
  assert.equal(inspect().permission_to_claim,false);
  assert.equal(inspect().live_completion_verified,false);
  assert.equal(inspect({nextPgLeaseReadback:null}).state,'UNKNOWN');
  assert.equal(inspect({nextLease:null}).state,'UNKNOWN');
  assert.equal(inspect({nextLease:{...next,task_id:TASK}}).state,'UNKNOWN');
  assert.equal(inspect({nextPgLeaseReadback:{...nextPg,row_count:2}}).state,'UNKNOWN');
  assert.equal(inspect({nextPgLeaseReadback:{...nextPg,lease_generation:2}}).state,'UNKNOWN');
  assert.equal(inspect({nextPgLeaseReadback:{...nextPg,agent_id:'agent_wrong00001'}}).state,'UNKNOWN');
  assert.equal(inspect({nextPgLeaseReadback:{...nextPg,after_checkpoint_sha256:'a'.repeat(64)}}).state,'UNKNOWN');
  assert.equal(inspect({nextLease:{...next,owner_generation:9}}).state,'UNKNOWN');
  assert.equal(inspect({nextLease:{...next,workspace_id:ID(99)}}).state,'UNKNOWN');
});

test('crash, lost ACK, expiry, stale source/critic and transferred generation fence continuation', () => {
  for(const state of ['PREPARED','AMBIGUOUS']) {
    assert.equal(inspect({completedEffect:{...effect,state}}).state,'UNKNOWN');
  }
  assert.equal(inspect({completedEffect:{...effect,ack_durable:false}}).state,'UNKNOWN');
  assert.equal(inspect({completedCheckpoint:{...c,critic_agent_id:'agent_wrong00001'}}).state,'UNKNOWN');
  assert.equal(inspect({completedCheckpoint:{...c,source_sha:'e'.repeat(40)}}).state,'UNKNOWN');
  assert.equal(inspect({completedPgReadback:{...pg,checkpoint_sha256:'e'.repeat(64)}}).state,'UNKNOWN');
  assert.equal(inspect({observed_at_ms:c.ready_at_ms+86400000}).state,'UNKNOWN');
  assert.equal(inspect({nextLease:{...next,lease_generation:2}}).state,'UNKNOWN');
});
