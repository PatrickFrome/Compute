import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  RsiSkillCoalitionAuditStore,
  createRsiSkillCoalitionObservation,
  createRsiSkillCoalitionAudit,
  rsiSkillCoalitionAuditTrustRootSnapshot,
} from '../src/rsi-skill-coalition-audit.mjs';

const SOURCE='a'.repeat(40);
const d=(char)=>`sha256:${char.repeat(64)}`;
const A=d('1'), B=d('2'), CTX=d('3');

function obs({id,group,skills,utility}){
  return createRsiSkillCoalitionObservation({
    observation_id:id,context_digest:CTX,trial_group:group,skill_digests:skills,utility,
    evaluator_digest:d('4'),evidence_refs:[`coalition:${id}`],
    external_evaluator:true,authored_by_candidate:false,
  });
}

test('matched coalition marginals mask a repeatedly harmful skill without granting activity',()=>{
  const rows=[
    obs({id:'coalition.g1.base',group:'trial.group.1',skills:[A],utility:0.80}),
    obs({id:'coalition.g1.with-b',group:'trial.group.1',skills:[A,B],utility:0.60}),
    obs({id:'coalition.g2.base',group:'trial.group.2',skills:[A],utility:0.75}),
    obs({id:'coalition.g2.with-b',group:'trial.group.2',skills:[A,B],utility:0.55}),
  ];
  const audit=createRsiSkillCoalitionAudit({context_digest:CTX,observations:rows});
  const b=audit.summaries.find(x=>x.skill_digest===B);
  assert.equal(b.pair_count,2);
  assert.equal(b.negative_pair_count,2);
  assert.equal(b.positive_pair_count,0);
  assert.equal(b.mask,true);
  assert.deepEqual(audit.masked_skill_digests,[B]);
  assert.equal(audit.mask_is_execution_authority,false);
  assert.equal(audit.authority_effect,false);
});

test('one negative marginal is evidence but insufficient for hard coalition mask',()=>{
  const rows=[
    obs({id:'coalition.single.base',group:'trial.single',skills:[A],utility:0.80}),
    obs({id:'coalition.single.with-b',group:'trial.single',skills:[A,B],utility:0.60}),
  ];
  const audit=createRsiSkillCoalitionAudit({context_digest:CTX,observations:rows});
  assert.equal(audit.summaries.find(x=>x.skill_digest===B).mask,false);
  assert.deepEqual(audit.masked_skill_digests,[]);
});

test('candidate-authored coalition utility is rejected',()=>{
  assert.throws(()=>createRsiSkillCoalitionObservation({
    observation_id:'coalition.bad',context_digest:CTX,trial_group:'trial.bad',skill_digests:[A],utility:1,
    evaluator_digest:d('4'),evidence_refs:['coalition:bad'],external_evaluator:false,authored_by_candidate:true,
  }),/external_evaluator_required/);
});

test('coalition audit store is source-fenced durable and idempotent',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-coalition-'));
  try{
    const statePath=path.join(root,'coalition.json');
    const store=new RsiSkillCoalitionAuditStore({statePath,source_sha:SOURCE});
    await store.init();
    const a=obs({id:'coalition.persist.base',group:'trial.persist',skills:[A],utility:0.8});
    const b=obs({id:'coalition.persist.with-b',group:'trial.persist',skills:[A,B],utility:0.6});
    assert.equal((await store.add(a)).state,'APPENDED');
    assert.equal((await store.add(a)).state,'IDEMPOTENT');
    await store.add(b);
    assert.equal(store.snapshot().row_count,2);
    const audit=store.auditIfAvailable(CTX);
    assert.ok(audit);
    const restored=new RsiSkillCoalitionAuditStore({statePath,source_sha:SOURCE});
    await restored.init();
    assert.equal(restored.snapshot().row_count,2);
  }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('coalition audit trust root keeps masking contextual and non-authoritative',()=>{
  const root=rsiSkillCoalitionAuditTrustRootSnapshot();
  assert.equal(root.external_evaluator_required,true);
  assert.equal(root.matched_coalition_pairs_required,true);
  assert.equal(root.coalition_pollution_checked,true);
  assert.equal(root.context_bound,true);
  assert.equal(root.candidate_can_choose_coalition,false);
  assert.equal(root.candidate_can_write_utility,false);
  assert.equal(root.candidate_can_choose_threshold,false);
  assert.equal(root.mask_is_execution_authority,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.coalition_root_digest,/^sha256:[0-9a-f]{64}$/);
});
