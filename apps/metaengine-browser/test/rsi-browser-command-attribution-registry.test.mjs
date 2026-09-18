import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RsiBrowserCommandAttributionRegistry,
  rsiBrowserCommandAttributionTrustRootSnapshot,
} from '../src/rsi-browser-command-attribution-registry.mjs';

const SOURCE='a'.repeat(40);
const COMMAND='11111111-1111-4111-8111-111111111111';
const d=(c)=>`sha256:${c.repeat(64)}`;
const cid=(c)=>`candidate_sha256_${c.repeat(64)}`;

function registration(overrides={}) {
  return {
    command_id:COMMAND,
    task_id:'task.browser.candidate.1',
    task_signature_digest:d('1'),
    environment_fingerprint:'env.metaengine.browser.v1',
    model_family:'GPT_5_6_SOL',
    producer:'DB_LEASE_SUPERVISOR',
    lease_evidence_digest:d('2'),
    candidate_id:cid('c'),
    candidate_sha:'c'.repeat(40),
    proposal_digest:d('3'),
    skill_digests:[d('4')],
    external_attribution:true,
    authored_by_candidate:false,
    ...overrides,
  };
}

test('trusted registry binds an exact command to externally authored candidate credit metadata',()=>{
  const r=new RsiBrowserCommandAttributionRegistry({source_sha:SOURCE});
  const event=r.prepareRegister(registration());
  const row=r.apply(event);
  assert.equal(row.command_id,COMMAND);
  assert.equal(row.candidate_id,cid('c'));
  assert.equal(row.producer,'DB_LEASE_SUPERVISOR');
  assert.equal(row.db_lease_is_execution_authority,true);
  assert.equal(row.registry_is_execution_authority,false);
  assert.equal(row.execution_authority,false);
  assert.equal(r.lookup(COMMAND).attribution_digest,row.attribution_digest);
  assert.equal(r.snapshot().active_count,1);
});

test('mapping replacement and candidate-authored registration are fail-closed',()=>{
  const r=new RsiBrowserCommandAttributionRegistry({source_sha:SOURCE});
  r.apply(r.prepareRegister(registration()));
  assert.throws(()=>r.prepareRegister(registration()),/duplicate_registration/);
  assert.throws(()=>r.prepareRegister(registration({candidate_sha:'d'.repeat(40)})),/replacement_forbidden/);
  const second='22222222-2222-4222-8222-222222222222';
  assert.throws(()=>r.prepareRegister(registration({
    command_id:second,
    external_attribution:false,
    authored_by_candidate:true,
  })),/external_origin_required/);
});

test('consume is bound to the exact attribution and outcome digest and replay restores no active mapping',()=>{
  const first=new RsiBrowserCommandAttributionRegistry({source_sha:SOURCE});
  const registered=first.prepareRegister(registration());
  first.apply(registered);
  const consumed=first.prepareConsume({command_id:COMMAND,outcome_episode_digest:d('9')});
  first.apply(consumed);
  assert.equal(first.lookup(COMMAND),null);
  assert.equal(first.snapshot().active_count,0);
  assert.equal(first.snapshot().consumed_count,1);

  const second=new RsiBrowserCommandAttributionRegistry({source_sha:SOURCE});
  second.replay([registered,consumed]);
  assert.deepEqual(second.snapshot(),first.snapshot());
});

test('candidate binding is all-or-none and DB lease evidence is mandatory',()=>{
  const r=new RsiBrowserCommandAttributionRegistry({source_sha:SOURCE});
  assert.throws(()=>r.prepareRegister(registration({proposal_digest:null})),/candidate_binding_incomplete/);
  assert.throws(()=>r.prepareRegister(registration({lease_evidence_digest:null})),/lease_evidence_digest_invalid/);
  assert.throws(()=>r.prepareRegister(registration({producer:'PAGE_MODEL'})),/producer_invalid/);
});

test('registry trust root is zero-authority and cannot become a second scheduler',()=>{
  const root=rsiBrowserCommandAttributionTrustRootSnapshot();
  assert.equal(root.db_lease_is_execution_authority,true);
  assert.equal(root.registry_is_execution_authority,false);
  assert.equal(root.candidate_can_register_mapping,false);
  assert.equal(root.candidate_can_replace_mapping,false);
  assert.equal(root.second_scheduler,false);
  assert.equal(root.execution_authority,false);
  assert.equal(root.promotion_authority,false);
  assert.equal(root.self_update_authority,false);
  assert.equal(root.authority_effect,false);
});
