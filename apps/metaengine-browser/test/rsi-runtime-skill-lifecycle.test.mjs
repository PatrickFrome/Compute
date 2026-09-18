import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createRsiBrowserOutcomeEpisode } from '../src/rsi-browser-outcome-ingest.mjs';
import { createRsiStepCreditReceipt } from '../src/rsi-runtime-credit-assignment.mjs';
import {
  createRsiSkillCapsule,
  createRsiSkillEvidence,
  createRsiVerifiedSkillLibrary,
} from '../src/rsi-verified-skill-library.mjs';
import {
  RsiRuntimeSkillLifecycle,
  rsiRuntimeSkillLifecycleTrustRootSnapshot,
} from '../src/rsi-runtime-skill-lifecycle.mjs';

const SOURCE='a'.repeat(40);
const d=(char)=>`sha256:${char.repeat(64)}`;

function verifiedSkill({id='skill.runtime.credit',source='b',impl='c'}={}){
  const capsule=createRsiSkillCapsule({
    skill_id:id,
    version:1,
    parent_skill_digest:null,
    source_candidate_sha:source.repeat(40),
    role:'ANALYZER',
    input_schema_digest:d('1'),
    output_schema_digest:d('2'),
    implementation_digest:d(impl),
    components:[{component_id:`${id}.component`,artifact_digest:d('f'),kind:'TYPED_TRANSFORM'}],
    capabilities:['READ_VERIFIED_CONTEXT','ANALYZE_FAILURE_CODES'],
    max_context_tokens:2048,
    max_output_tokens:512,
    max_invocations:2,
    external_builder:true,
    authored_by_candidate:false,
  });
  const evidence=createRsiSkillEvidence({
    capsule,
    hidden_holdout_digest:d('4'),
    evaluator_root_digest:d('5'),
    unit_test_digest:d('6'),
    runtime_feedback_digest:d('7'),
    attempt_count:12,
    success_count:10,
    hard_invariants_pass:true,
    verified_for_library:true,
    evidence_refs:[`VERIFY_${id}`],
    external_evaluator:true,
    authored_by_candidate:false,
  });
  return {capsule,evidence};
}

function library(entries, id='runtime.skill.library.1'){
  return createRsiVerifiedSkillLibrary({
    library_id:id,
    entries,
    external_library_owner:true,
    authored_by_candidate:false,
  });
}

function episode({command,skillDigest,step=1,count=1,predecessor=null,effect='CONFIRMED'}){
  return createRsiBrowserOutcomeEpisode({
    source_sha:SOURCE,
    readback:{
      schema:'metaengine.rsi.result-receipt-readback.v1',
      command_id:command,
      found:true,
      terminal:true,
      status:'COMPLETED',
      receipt:{
        schema:'metaengine.native-supervisor.command-receipt.v2',
        command_id:command,
        action:'SCROLL',
        platform:'CHATGPT',
        result:{moved:true,raw_value:'must-not-enter-skill-state'},
        effect_outcome:effect,
        lane:'MUTATION',
        effect_key:`effect-${command.slice(0,8)}`,
        execution_ms:9.5,
        recorded_at:'2026-09-18T18:00:00.000Z',
        authority_effect:false,
      },
      error:null,
      execution_authority:false,
      production_mutation_authority:false,
      promotion_authority:false,
      self_update_authority:false,
      automatic_retry_allowed:false,
      authority_effect:false,
    },
    attribution:{
      task_id:'task.skill.lifecycle.1',
      task_signature_digest:d('8'),
      environment_fingerprint:'env.browser.chatgpt.v1',
      model_family:'GPT_5_6_SOL',
      candidate_id:`candidate_sha256_${'9'.repeat(64)}`,
      candidate_sha:'d'.repeat(40),
      proposal_digest:d('a'),
      skill_digests:[skillDigest],
      trajectory_id:'trajectory.skill.lifecycle.1',
      step_index:step,
      step_count:count,
      predecessor_episode_digest:predecessor,
      external_attribution:true,
      authored_by_candidate:false,
    },
  });
}

function credit(ep,{sign='POSITIVE',score=0.6,id=null}={}){
  return createRsiStepCreditReceipt({
    credit_id:id||`credit.${ep.command_id}`,
    episode:ep,
    credit_sign:sign,
    credit_score:score,
    method:'EXTERNAL_STEP_EVALUATOR',
    evaluator_digest:d('b'),
    evaluation_digest:d('c'),
    failure_codes:sign==='NEGATIVE'?['SKILL_HARMFUL_OUTCOME']:[],
    lesson_digests:[d('d')],
    evidence_refs:[`eval:${ep.command_id}`],
    external_credit_assigner:true,
    authored_by_candidate:false,
  });
}

function uuidFor(n){
  return `${String(n).padStart(8,'0')}-1111-4111-8111-${String(n).padStart(12,'0')}`;
}

test('credited skill evidence is held before library adoption and reconciled after exact verified library arrives',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-skill-pending-'));
  try{
    const skill=verifiedSkill();
    const store=new RsiRuntimeSkillLifecycle({
      statePath:path.join(root,'skill-state.json'),
      source_sha:SOURCE,
      clock:()=>1_800_000_000_000,
    });
    await store.init();
    const ep=episode({command:uuidFor(1),skillDigest:skill.capsule.skill_digest});
    const held=await store.recordCreditedOutcome({
      episode:ep,
      credit_receipt:credit(ep),
      generation:1,
      authoring_prior:'VERIFIED_DIRECT_SKILL',
      authoring_provenance_digest:d('e'),
      external_evaluator:true,
      authored_by_candidate:false,
    });
    assert.equal(held.state,'HELD_NO_LIBRARY');
    assert.equal(store.snapshot().pending_count,1);
    assert.equal(store.snapshot().lifecycle_evidence_count,0);

    const adopted=await store.adoptVerifiedLibrary({
      library:library([skill]),
      external_library_owner:true,
      authored_by_candidate:false,
    });
    assert.equal(adopted.state,'ADOPTED');
    assert.equal(adopted.reconciled_pending,1);
    assert.equal(store.snapshot().pending_count,0);
    assert.equal(store.snapshot().lifecycle_evidence_count,1);
    assert.equal(store.snapshot().library_present,true);

    const raw=await fs.readFile(path.join(root,'skill-state.json'),'utf8');
    assert.doesNotMatch(raw,/must-not-enter-skill-state/);
    assert.doesNotMatch(raw,/"result":/);
  }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('verified library updates are append-only and cannot silently remove or rewrite an adopted skill',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-skill-library-'));
  try{
    const first=verifiedSkill({id:'skill.runtime.first',source:'b',impl:'c'});
    const second=verifiedSkill({id:'skill.runtime.second',source:'c',impl:'d'});
    const store=new RsiRuntimeSkillLifecycle({statePath:path.join(root,'skill-state.json'),source_sha:SOURCE});
    await store.init();
    await store.adoptVerifiedLibrary({
      library:library([first],'runtime.skill.library.append'),
      external_library_owner:true,
      authored_by_candidate:false,
    });
    await store.adoptVerifiedLibrary({
      library:library([first,second],'runtime.skill.library.append'),
      external_library_owner:true,
      authored_by_candidate:false,
    });
    assert.equal(store.snapshot().library_entry_count,2);

    await assert.rejects(()=>store.adoptVerifiedLibrary({
      library:library([second],'runtime.skill.library.append'),
      external_library_owner:true,
      authored_by_candidate:false,
    }),/library_non_append_only_update/);
  }finally{await fs.rm(root,{recursive:true,force:true})}
});


test('library append does not imply activation and one external shadow evidence window unlocks bounded exploration',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-skill-shadow-admission-'));
  try{
    const first=verifiedSkill({id:'skill.runtime.shadow.first',source:'b',impl:'c'});
    const second=verifiedSkill({id:'skill.runtime.shadow.second',source:'c',impl:'d'});
    const store=new RsiRuntimeSkillLifecycle({statePath:path.join(root,'skill-state.json'),source_sha:SOURCE});
    await store.init();

    await store.adoptVerifiedLibrary({
      library:library([first],'runtime.skill.library.shadow'),
      external_library_owner:true,
      authored_by_candidate:false,
    });
    assert.equal(store.snapshot().active_count,0);
    assert.throws(()=>store.activationView([first.capsule.skill_digest]),/requested_skill_not_active:DORMANT_CAP/);

    await store.adoptVerifiedLibrary({
      library:library([first,second],'runtime.skill.library.shadow'),
      external_library_owner:true,
      authored_by_candidate:false,
    });
    assert.equal(store.snapshot().library_entry_count,2);
    assert.equal(store.snapshot().active_count,0);
    assert.throws(()=>store.activationView([second.capsule.skill_digest]),/requested_skill_not_active:DORMANT_CAP/);

    const ep=episode({command:uuidFor(250),skillDigest:second.capsule.skill_digest});
    const applied=await store.recordCreditedOutcome({
      episode:ep,
      credit_receipt:credit(ep,{sign:'POSITIVE',score:0.25,id:'credit.shadow.second.1'}),
      generation:1,
      authoring_prior:'VERIFIED_DIRECT_SKILL',
      authoring_provenance_digest:d('e'),
      external_evaluator:true,
      authored_by_candidate:false,
    });
    assert.equal(applied.state,'APPLIED');
    const governance=store.governance();
    const secondRow=governance.entries.find((row)=>row.skill_digest===second.capsule.skill_digest);
    assert.equal(secondRow.evidence_window_count,1);
    assert.equal(secondRow.state,'EXPLORATION_ACTIVE');
    assert.equal(secondRow.active_for_composition,true);
    assert.equal(store.activationView([second.capsule.skill_digest]).selected_count,1);
  }finally{await fs.rm(root,{recursive:true,force:true})}
});


test('exact library CAS rejects stale append preconditions before any adoption effect',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-skill-library-cas-'));
  try{
    const first=verifiedSkill({id:'skill.runtime.cas.first',source:'b',impl:'c'});
    const second=verifiedSkill({id:'skill.runtime.cas.second',source:'c',impl:'d'});
    const store=new RsiRuntimeSkillLifecycle({statePath:path.join(root,'skill-state.json'),source_sha:SOURCE});
    await store.init();

    await assert.rejects(()=>store.adoptVerifiedLibrary({
      library:library([first],'runtime.skill.library.cas'),
      expected_current_library_digest:d('f'),
      external_library_owner:true,
      authored_by_candidate:false,
    }),/cas_requires_current_library/);

    const initial=await store.adoptVerifiedLibrary({
      library:library([first],'runtime.skill.library.cas'),
      external_library_owner:true,
      authored_by_candidate:false,
    });
    assert.equal(initial.cas_checked,false);
    const before=store.verifiedLibrarySnapshot();

    const successor=library([first,second],'runtime.skill.library.cas');
    await assert.rejects(()=>store.adoptVerifiedLibrary({
      library:successor,
      expected_current_library_digest:d('f'),
      external_library_owner:true,
      authored_by_candidate:false,
    }),/cas_mismatch/);
    assert.equal(store.verifiedLibrarySnapshot().library_digest,before.library_digest);
    assert.equal(store.verifiedLibrarySnapshot().entry_count,1);

    const applied=await store.adoptVerifiedLibrary({
      library:successor,
      expected_current_library_digest:before.library_digest,
      external_library_owner:true,
      authored_by_candidate:false,
    });
    assert.equal(applied.state,'ADOPTED');
    assert.equal(applied.cas_checked,true);
    assert.equal(store.verifiedLibrarySnapshot().library_digest,successor.library_digest);
    assert.equal(store.verifiedLibrarySnapshot().entry_count,2);

    await assert.rejects(()=>store.adoptVerifiedLibrary({
      library:successor,
      expected_current_library_digest:before.library_digest,
      external_library_owner:true,
      authored_by_candidate:false,
    }),/cas_mismatch/);
  }finally{await fs.rm(root,{recursive:true,force:true})}
});


test('library admission barrier is durable, exact-bound and one-attempt before dormant append',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-skill-admission-barrier-'));
  try{
    const statePath=path.join(root,'skill-state.json');
    const first=verifiedSkill({id:'skill.runtime.admission.first',source:'b',impl:'c'});
    const second=verifiedSkill({id:'skill.runtime.admission.second',source:'c',impl:'d'});
    const third=verifiedSkill({id:'skill.runtime.admission.third',source:'d',impl:'e'});
    const store=new RsiRuntimeSkillLifecycle({statePath,source_sha:SOURCE,clock:()=>1_900_000_000_000});
    await store.init();
    const initialLibrary=library([first],'runtime.skill.library.admission');
    await store.adoptVerifiedLibrary({library:initialLibrary,external_library_owner:true,authored_by_candidate:false});
    const successor=library([first,second],'runtime.skill.library.admission');

    const prepared=await store.prepareVerifiedLibraryAdmission({
      attempt_id:'admission.phase34.second.1',
      expected_current_library_digest:initialLibrary.library_digest,
      successor_library_digest:successor.library_digest,
      proposed_skill_digest:second.capsule.skill_digest,
      phase33_certificate_digest:d('a'),
      external_library_owner:true,
      authored_by_candidate:false,
    });
    assert.equal(prepared.state,'PREPARED');
    assert.equal(prepared.expected_library_digest,initialLibrary.library_digest);
    assert.equal(prepared.successor_library_digest,successor.library_digest);
    assert.equal(store.snapshot().unresolved_library_admission_count,1);
    assert.deepEqual(store.libraryAdmissionAttempts()[0].transitions.map((row)=>row.state),['PREPARED']);

    await assert.rejects(()=>store.prepareVerifiedLibraryAdmission({
      attempt_id:'admission.phase34.concurrent.2',
      expected_current_library_digest:initialLibrary.library_digest,
      successor_library_digest:successor.library_digest,
      proposed_skill_digest:second.capsule.skill_digest,
      phase33_certificate_digest:d('b'),
      external_library_owner:true,
      authored_by_candidate:false,
    }),/admission_unresolved_prior/);

    const wrongSuccessor=library([first,third],'runtime.skill.library.admission');
    await assert.rejects(()=>store.adoptVerifiedLibrary({
      library:wrongSuccessor,
      expected_current_library_digest:initialLibrary.library_digest,
      admission_attempt_id:'admission.phase34.second.1',
      external_library_owner:true,
      authored_by_candidate:false,
    }),/admission_binding_mismatch/);
    assert.equal(store.libraryAdmissionAttempts()[0].state,'PREPARED');

    const restoredPrepared=new RsiRuntimeSkillLifecycle({statePath,source_sha:SOURCE,clock:()=>1_900_000_001_000});
    await restoredPrepared.init();
    assert.equal(restoredPrepared.libraryAdmissionAttempts()[0].state,'PREPARED');
    assert.equal(restoredPrepared.verifiedLibrarySnapshot().library_digest,initialLibrary.library_digest);

    const applied=await restoredPrepared.adoptVerifiedLibrary({
      library:successor,
      expected_current_library_digest:initialLibrary.library_digest,
      admission_attempt_id:'admission.phase34.second.1',
      external_library_owner:true,
      authored_by_candidate:false,
    });
    assert.equal(applied.state,'ADOPTED');
    assert.equal(applied.admission_state,'CONFIRMED');
    assert.equal(applied.reconciled_pending,0);
    assert.equal(restoredPrepared.snapshot().unresolved_library_admission_count,0);
    assert.equal(restoredPrepared.snapshot().active_count,0);
    const confirmed=restoredPrepared.libraryAdmissionAttempts()[0];
    assert.equal(confirmed.state,'CONFIRMED');
    assert.deepEqual(confirmed.transitions.map((row)=>row.state),['PREPARED','ATTEMPTED','CONFIRMED']);
    assert.equal(confirmed.phase33_certificate_digest,d('a'));
    assert.equal(confirmed.proposed_skill_digest,second.capsule.skill_digest);

    await assert.rejects(()=>restoredPrepared.adoptVerifiedLibrary({
      library:successor,
      expected_current_library_digest:successor.library_digest,
      admission_attempt_id:'admission.phase34.second.1',
      external_library_owner:true,
      authored_by_candidate:false,
    }),/admission_one_attempt_only/);

    const restoredConfirmed=new RsiRuntimeSkillLifecycle({statePath,source_sha:SOURCE});
    await restoredConfirmed.init();
    assert.equal(restoredConfirmed.verifiedLibrarySnapshot().library_digest,successor.library_digest);
    assert.equal(restoredConfirmed.libraryAdmissionAttempts()[0].state,'CONFIRMED');
    assert.equal(restoredConfirmed.snapshot().active_count,0);
    assert.throws(()=>restoredConfirmed.activationView([second.capsule.skill_digest]),/requested_skill_not_active:DORMANT_CAP/);
  }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('candidate-authored lifecycle evidence and unrouted attribution fail closed',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-skill-authority-'));
  try{
    const skill=verifiedSkill();
    const store=new RsiRuntimeSkillLifecycle({statePath:path.join(root,'skill-state.json'),source_sha:SOURCE});
    await store.init();
    await store.adoptVerifiedLibrary({
      library:library([skill]),
      external_library_owner:true,
      authored_by_candidate:false,
    });
    const ep=episode({command:uuidFor(2),skillDigest:skill.capsule.skill_digest});
    await assert.rejects(()=>store.recordCreditedOutcome({
      episode:ep,credit_receipt:credit(ep),generation:1,
      authoring_prior:'VERIFIED_DIRECT_SKILL',authoring_provenance_digest:d('e'),
      external_evaluator:false,authored_by_candidate:true,
    }),/external_evidence_required/);
    await assert.rejects(()=>store.recordCreditedOutcome({
      episode:ep,credit_receipt:credit(ep),generation:1,
      router_engaged:false,
      authoring_prior:'VERIFIED_DIRECT_SKILL',authoring_provenance_digest:d('e'),
      external_evaluator:true,authored_by_candidate:false,
    }),/router_engagement_required/);
    assert.equal(store.snapshot().lifecycle_evidence_count,0);
  }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('one harmful credited use quarantines a skill and bounded activation cannot bypass governance',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-skill-quarantine-'));
  try{
    const skill=verifiedSkill();
    const store=new RsiRuntimeSkillLifecycle({statePath:path.join(root,'skill-state.json'),source_sha:SOURCE});
    await store.init();
    await store.adoptVerifiedLibrary({library:library([skill]),external_library_owner:true,authored_by_candidate:false});
    const ep=episode({command:uuidFor(3),skillDigest:skill.capsule.skill_digest});
    await store.recordCreditedOutcome({
      episode:ep,
      credit_receipt:credit(ep,{sign:'NEGATIVE',score:-0.8}),
      generation:1,
      false_positive_injection:true,
      authoring_prior:'VERIFIED_DIRECT_SKILL',
      authoring_provenance_digest:d('e'),
      external_evaluator:true,
      authored_by_candidate:false,
    });
    const snapshot=store.snapshot();
    assert.equal(snapshot.quarantined_count,1);
    assert.equal(snapshot.active_count,0);
    assert.throws(()=>store.activationView([skill.capsule.skill_digest]),/requested_skill_not_active:QUARANTINED/);
  }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('repeated independently credited negative windows retire a harmful skill without deleting evidence',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-skill-retire-'));
  try{
    const skill=verifiedSkill();
    const statePath=path.join(root,'skill-state.json');
    const store=new RsiRuntimeSkillLifecycle({statePath,source_sha:SOURCE});
    await store.init();
    await store.adoptVerifiedLibrary({library:library([skill]),external_library_owner:true,authored_by_candidate:false});

    let predecessor=null;
    for(let i=1;i<=12;i+=1){
      const ep=episode({command:uuidFor(100+i),skillDigest:skill.capsule.skill_digest,step:i,count:12,predecessor});
      predecessor=ep.episode_digest;
      await store.recordCreditedOutcome({
        episode:ep,
        credit_receipt:credit(ep,{sign:'NEGATIVE',score:-0.5,id:`credit.negative.${i}`}),
        generation:i,
        authoring_prior:'VERIFIED_DIRECT_SKILL',
        authoring_provenance_digest:d('e'),
        external_evaluator:true,
        authored_by_candidate:false,
      });
    }
    const governance=store.governance();
    const row=governance.entries.find(x=>x.skill_digest===skill.capsule.skill_digest);
    assert.equal(row.state,'RETIRED');
    assert.equal(row.retirement_eligible,true);
    assert.equal(row.retained_in_evidence_archive,true);
    assert.equal(row.hard_deleted,false);
    assert.equal(store.snapshot().retired_count,1);
    assert.equal(store.snapshot().lifecycle_evidence_count,12);

    const restored=new RsiRuntimeSkillLifecycle({statePath,source_sha:SOURCE});
    await restored.init();
    assert.equal(restored.snapshot().retired_count,1);
    assert.equal(restored.snapshot().lifecycle_evidence_count,12);
  }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('same credit receipt is idempotent and cannot inflate skill utility counts',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-skill-idempotent-'));
  try{
    const skill=verifiedSkill();
    const store=new RsiRuntimeSkillLifecycle({statePath:path.join(root,'skill-state.json'),source_sha:SOURCE});
    await store.init();
    await store.adoptVerifiedLibrary({library:library([skill]),external_library_owner:true,authored_by_candidate:false});
    const ep=episode({command:uuidFor(4),skillDigest:skill.capsule.skill_digest});
    const receipt=credit(ep);
    const first=await store.recordCreditedOutcome({
      episode:ep,credit_receipt:receipt,generation:1,
      authoring_prior:'VERIFIED_DIRECT_SKILL',authoring_provenance_digest:d('e'),
      external_evaluator:true,authored_by_candidate:false,
    });
    const again=await store.recordCreditedOutcome({
      episode:ep,credit_receipt:receipt,generation:1,
      authoring_prior:'VERIFIED_DIRECT_SKILL',authoring_provenance_digest:d('e'),
      external_evaluator:true,authored_by_candidate:false,
    });
    assert.equal(first.state,'APPLIED');
    assert.equal(again.state,'IDEMPOTENT');
    assert.equal(store.snapshot().lifecycle_evidence_count,1);
  }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('skill lifecycle trust root remains evidence-only and cannot widen Browser authority',()=>{
  const root=rsiRuntimeSkillLifecycleTrustRootSnapshot();
  assert.equal(root.verified_library_required,true);
  assert.equal(root.library_updates_append_only,true);
  assert.equal(root.exact_library_digest_cas_supported,true);
  assert.equal(root.library_admission_write_ahead_barrier,true);
  assert.equal(root.one_attempt_per_library_admission,true);
  assert.equal(root.admission_reconciliation_required_after_attempt,true);
  assert.equal(root.phase33_certificate_digest_binding_required,true);
  assert.equal(root.retrieval_activation_separate_from_library_admission,true);
  assert.equal(root.independently_credited_outcomes_only,true);
  assert.equal(root.contextual_credit_not_global_truth,true);
  assert.equal(root.candidate_can_write_lifecycle,false);
  assert.equal(root.candidate_can_reactivate_skill,false);
  assert.equal(root.candidate_can_retire_skill,false);
  assert.equal(root.skill_activation_view_is_execution_authority,false);
  assert.equal(root.execution_authority,false);
  assert.equal(root.promotion_authority,false);
  assert.equal(root.self_update_authority,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.skill_lifecycle_root_digest,/^sha256:[0-9a-f]{64}$/);
});
