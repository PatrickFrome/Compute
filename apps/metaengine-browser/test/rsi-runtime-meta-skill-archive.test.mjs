import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createRsiSkillCapsule,
  createRsiSkillEvidence,
  createRsiVerifiedSkillLibrary,
} from '../src/rsi-verified-skill-library.mjs';
import {
  createRsiMetaSkillProfile,
  createRsiMetaSkillFastLoopSummary,
  createRsiMetaSkillEvolutionPlan,
  createRsiMetaSkillEvaluation,
  finalizeRsiMetaSkillEvolution,
} from '../src/rsi-meta-skill-evolution.mjs';
import {
  RsiRuntimeMetaSkillArchive,
  RSI_FIXED_META_OPERATION_DIGEST,
  createRsiRuntimeMetaSkillRecord,
  verifyRsiRuntimeMetaSkillRecord,
  rsiRuntimeMetaSkillArchiveTrustRootSnapshot,
} from '../src/rsi-runtime-meta-skill-archive.mjs';

const SOURCE='a'.repeat(40);
const d=(char)=>`sha256:${char.repeat(64)}`;

function makeSkill({id,role,sourceChar,implChar}){
  const capsule=createRsiSkillCapsule({
    skill_id:id,version:1,parent_skill_digest:null,source_candidate_sha:sourceChar.repeat(40),
    role,input_schema_digest:d('1'),output_schema_digest:d('2'),implementation_digest:d(implChar),
    components:[{component_id:`${id}.component`,artifact_digest:d('f'),kind:'TYPED_TRANSFORM'}],
    capabilities:['READ_VERIFIED_CONTEXT'],max_context_tokens:2048,max_output_tokens:512,max_invocations:2,
    external_builder:true,authored_by_candidate:false,
  });
  const evidence=createRsiSkillEvidence({
    capsule,hidden_holdout_digest:d(sourceChar),evaluator_root_digest:d('4'),unit_test_digest:d('5'),
    runtime_feedback_digest:d('6'),attempt_count:12,success_count:10,hard_invariants_pass:true,
    verified_for_library:true,evidence_refs:[`VERIFY_${id}`],external_evaluator:true,authored_by_candidate:false,
  });
  return {capsule,evidence};
}
function binding(entry){return {skill_id:entry.capsule.skill_id,skill_version:entry.capsule.skill_version,skill_digest:entry.capsule.skill_digest}}
function fixture(){
  const analyzer1=makeSkill({id:'meta.analyzer.v1',role:'ANALYZER',sourceChar:'b',implChar:'b'});
  const analyzer2=makeSkill({id:'meta.analyzer.alt',role:'ANALYZER',sourceChar:'c',implChar:'c'});
  const retriever=makeSkill({id:'meta.retriever',role:'RETRIEVER',sourceChar:'d',implChar:'d'});
  const allocator=makeSkill({id:'meta.allocator',role:'ALLOCATOR',sourceChar:'e',implChar:'e'});
  const proposer=makeSkill({id:'meta.proposer',role:'PROPOSER',sourceChar:'f',implChar:'f'});
  const evolver=makeSkill({id:'meta.evolver',role:'EVOLVER',sourceChar:'a',implChar:'a'});
  const library=createRsiVerifiedSkillLibrary({
    library_id:'runtime.meta.skill.library',
    entries:[analyzer1,analyzer2,retriever,allocator,proposer,evolver],
    external_library_owner:true,authored_by_candidate:false,
  });
  const parent=createRsiMetaSkillProfile({
    profile_id:'meta.profile.parent',library,profile_generation:1,slow_meta_epoch:1,fast_skill_epoch:10,
    frozen_backbone_family:'GPT_5_6_SOL',
    bindings:{
      ANALYZER:binding(analyzer1),RETRIEVER:binding(retriever),ALLOCATOR:binding(allocator),
      PROPOSER:binding(proposer),EVOLVER:binding(evolver),
    },
    external_profile_owner:true,authored_by_candidate:false,
  });
  const successor=createRsiMetaSkillProfile({
    profile_id:'meta.profile.successor',library,profile_generation:2,slow_meta_epoch:2,fast_skill_epoch:10,
    frozen_backbone_family:'GPT_5_6_SOL',
    bindings:{
      ANALYZER:binding(analyzer2),RETRIEVER:binding(retriever),ALLOCATOR:binding(allocator),
      PROPOSER:binding(proposer),EVOLVER:binding(evolver),
    },
    external_profile_owner:true,authored_by_candidate:false,
  });
  const fast=createRsiMetaSkillFastLoopSummary({
    profile:parent,library,fast_holdout_digest:d('7'),episode_count:10,
    helpful_count:8,harmful_count:1,neutral_count:1,insufficient_count:0,
    evidence_refs:['meta:fast:summary'],external_evaluator:true,authored_by_candidate:false,
  });
  const plan=createRsiMetaSkillEvolutionPlan({
    parent_profile:parent,successor_profile:successor,library,fast_loop_summary:fast,
    min_fast_episodes:8,meta_holdout_digest:d('8'),max_role_changes:1,
    external_meta_operator:true,authored_by_candidate:false,
  });
  const evaluation=createRsiMetaSkillEvaluation({
    plan,parent_profile:parent,successor_profile:successor,library,fast_loop_summary:fast,
    evaluator_root_digest:d('9'),
    objective_spec:[
      {metric:'task_success',direction:'MAXIMIZE',materiality_threshold:0.01},
      {metric:'latency_ms',direction:'MINIMIZE',materiality_threshold:1},
    ],
    parent_metrics:{task_success:0.70,latency_ms:100},
    successor_metrics:{task_success:0.76,latency_ms:94},
    hard_invariants_pass:true,evidence_refs:['meta:slow:evaluation'],
    external_evaluator:true,authored_by_candidate:false,
  });
  const result=finalizeRsiMetaSkillEvolution({
    plan,parent_profile:parent,successor_profile:successor,library,fast_loop_summary:fast,evaluation,
  });
  return {library,parent,successor,fast,plan,evaluation,result};
}

test('two-timescale meta record archives a Pareto advance under a fixed non-self-rewriting meta operation',()=>{
  const fx=fixture();
  assert.equal(fx.result.state,'ELIGIBLE_FOR_META_ARCHIVE');
  const record=createRsiRuntimeMetaSkillRecord({
    source_sha:SOURCE,record_id:'meta.record.1',library:fx.library,
    parent_profile:fx.parent,successor_profile:fx.successor,fast_loop_summary:fx.fast,
    plan:fx.plan,evaluation:fx.evaluation,result:fx.result,
    external_archive_owner:true,authored_by_candidate:false,
  });
  verifyRsiRuntimeMetaSkillRecord(record);
  assert.equal(record.fixed_meta_operation_digest,RSI_FIXED_META_OPERATION_DIGEST);
  assert.equal(record.fixed_meta_operation,true);
  assert.equal(record.meta_operation_self_rewrite_allowed,false);
  assert.equal(record.two_timescale_required,true);
  assert.equal(record.eligible_for_meta_archive,true);
  assert.equal(record.successor_profile_activation_authorized,false);
  assert.equal(record.existing_tournament_required,true);
  assert.equal(record.existing_recursive_risk_gate_required,true);
  assert.equal(record.authority_effect,false);
});

test('fast-loop and slow-loop holdouts remain separated by the underlying verified meta-skill plan',()=>{
  const fx=fixture();
  assert.notEqual(fx.fast.fast_holdout_digest,fx.plan.meta_holdout_digest);
  assert.equal(fx.plan.fast_and_slow_holdouts_separate,true);
  assert.equal(fx.plan.changed_role_count,1);
  assert.deepEqual(fx.plan.changed_roles,['ANALYZER']);
});

test('runtime meta archive is append-only, restart durable, and cannot activate profiles',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-meta-archive-'));
  try{
    const fx=fixture();
    const record=createRsiRuntimeMetaSkillRecord({
      source_sha:SOURCE,record_id:'meta.record.persist',library:fx.library,
      parent_profile:fx.parent,successor_profile:fx.successor,fast_loop_summary:fx.fast,
      plan:fx.plan,evaluation:fx.evaluation,result:fx.result,
      external_archive_owner:true,authored_by_candidate:false,
    });
    const statePath=path.join(root,'meta.json');
    const archive=new RsiRuntimeMetaSkillArchive({statePath,source_sha:SOURCE});
    await archive.init();
    assert.equal((await archive.add(record)).state,'ELIGIBLE_FOR_META_ARCHIVE');
    assert.equal((await archive.add(record)).state,'IDEMPOTENT');
    assert.equal(archive.snapshot().eligible_count,1);
    assert.equal(archive.snapshot().active_profile_digest,null);
    assert.equal(archive.snapshot().archive_can_activate_profile,false);
    assert.equal(archive.eligible().length,1);
    const lookedUp=archive.recordByDigest(record.record_digest);
    assert.equal(lookedUp.record_digest,record.record_digest);
    assert.equal(lookedUp.record_id,record.record_id);
    assert.throws(()=>archive.recordByDigest('not-a-sha256-digest'),/record_digest_invalid/);

    const restored=new RsiRuntimeMetaSkillArchive({statePath,source_sha:SOURCE});
    await restored.init();
    assert.equal(restored.snapshot().record_count,1);
    assert.equal(restored.snapshot().eligible_count,1);
  }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('tampered fixed meta operation or candidate-authored archive record fails closed',()=>{
  const fx=fixture();
  const record=createRsiRuntimeMetaSkillRecord({
    source_sha:SOURCE,record_id:'meta.record.tamper',library:fx.library,
    parent_profile:fx.parent,successor_profile:fx.successor,fast_loop_summary:fx.fast,
    plan:fx.plan,evaluation:fx.evaluation,result:fx.result,
    external_archive_owner:true,authored_by_candidate:false,
  });
  assert.throws(()=>verifyRsiRuntimeMetaSkillRecord({...record,fixed_meta_operation_digest:d('f')}),/record_policy_invalid/);
  assert.throws(()=>createRsiRuntimeMetaSkillRecord({
    source_sha:SOURCE,record_id:'meta.record.candidate',library:fx.library,
    parent_profile:fx.parent,successor_profile:fx.successor,fast_loop_summary:fx.fast,
    plan:fx.plan,evaluation:fx.evaluation,result:fx.result,
    external_archive_owner:false,authored_by_candidate:true,
  }),/external_archive_owner_required/);
});

test('meta archive trust root keeps recursion bounded outside execution and activation authority',()=>{
  const root=rsiRuntimeMetaSkillArchiveTrustRootSnapshot();
  assert.equal(root.fixed_meta_operation,true);
  assert.equal(root.meta_operation_self_rewrite_allowed,false);
  assert.equal(root.two_timescale_meta_evolution_required,true);
  assert.equal(root.frozen_backbone_required,true);
  assert.equal(root.fast_and_slow_holdouts_separate,true);
  assert.equal(root.external_fast_summary_required,true);
  assert.equal(root.external_meta_operator_required,true);
  assert.equal(root.external_meta_evaluator_required,true);
  assert.equal(root.scalar_winner_authoritative,false);
  assert.equal(root.archive_can_activate_profile,false);
  assert.equal(root.candidate_can_activate_profile,false);
  assert.equal(root.existing_tournament_required,true);
  assert.equal(root.existing_recursive_risk_gate_required,true);
  assert.equal(root.authority_effect,false);
  assert.match(root.meta_archive_root_digest,/^sha256:[0-9a-f]{64}$/);
});
