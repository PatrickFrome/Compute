import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createRsiBoundedCanaryShadowEvidence,
  createRsiBoundedCanaryAdmission,
} from '../src/rsi-bounded-canary-admission.mjs';
import {
  RsiMetaProfileCanaryLedger,
  createRsiMetaProfileCanaryAdmission,
  createRsiMetaProfileCanaryDecision,
  createRsiMetaProfileCanaryOutcome,
  verifyRsiMetaProfileCanaryAdmission,
  verifyRsiMetaProfileCanaryDecision,
  verifyRsiMetaProfileCanaryOutcome,
  rsiMetaProfileCanaryTrustRootSnapshot,
} from '../src/rsi-meta-profile-canary-admission.mjs';

const SOURCE='a'.repeat(40);
const d=(char)=>`sha256:${char.repeat(64)}`;
function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))}
const dg=(v)=>`sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`;

function fixture(){
  const selectionCore={
    schema:'metaengine.rsi.meta-profile-shadow-selection.v1',version:1,source_sha:SOURCE,
    selection_id:'shadow.selection.canary.test',
    qualification_digest:d('2'),meta_record_digest:d('3'),library_digest:d('4'),
    incumbent_profile_digest:d('5'),challenger_profile_digest:d('6'),mode:'SHADOW_ONLY',
    external_selector:true,authored_by_candidate:false,candidate_can_select_profile:false,
    selection_can_change_execution:false,selection_can_replace_incumbent:false,selection_can_grant_skill_activity:false,
    continuous_shadow_review_required:true,canary_gate_still_required:true,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  const selection={...selectionCore,selection_digest:dg(selectionCore)};
  const qualification={
    schema:'metaengine.rsi.meta-profile-qualification.v1',version:1,source_sha:SOURCE,
    qualification_digest:d('2'),meta_record_digest:d('3'),
    qualified_for_shadow_profile_selection:true,
  };
  const record={
    schema:'metaengine.rsi.runtime-meta-skill-record.v1',version:1,source_sha:SOURCE,
    record_digest:d('3'),library_digest:d('4'),eligible_for_meta_archive:true,
  };
  const library={library_digest:d('4')};
  const governance={library_digest:d('4'),governance_digest:d('7')};
  const shadowEvidence=createRsiBoundedCanaryShadowEvidence({
    evidence_id:'canary.shadow.evidence.test',shadow_selection:selection,context_cohort_digest:d('8'),
    shadow_observation_count:32,matched_count:24,divergence_count:8,ambiguity_count:0,incident_count:0,
    hard_invariant_violation_count:0,identity_drift_count:0,outcome_evidence_digest:d('9'),
    safety_evidence_digest:d('a'),security_evidence_digest:d('b'),awareness_evidence_digest:d('c'),utility_evidence_digest:d('d'),
    evidence_refs:['canary:shadow:evidence:test'],external_observer:true,authored_by_candidate:false,
  });
  const boundedAdmission=createRsiBoundedCanaryAdmission({
    admission_id:'bounded.canary.handoff.test',shadow_selection:selection,shadow_evidence:shadowEvidence,
    fixed_cohort_digest:d('8'),decision_budget:16,external_admission_owner:true,authored_by_candidate:false,
  });
  const admission=createRsiMetaProfileCanaryAdmission({
    source_sha:SOURCE,canary_id:'canary.readonly.1',selection,qualification,meta_record:record,
    current_library:library,current_governance:governance,bounded_canary_admission:boundedAdmission,
    bounded_shadow_evidence:shadowEvidence,cohort_digest:d('8'),
    max_decisions:16,action_surface:'READ_ONLY_DECISION_SUPPORT',
    external_canary_owner:true,authored_by_candidate:false,
  });
  return {selection,qualification,record,library,governance,shadowEvidence,boundedAdmission,admission};
}

test('canary admission is identity-stable, fixed-budget and read-only advisory',()=>{
  const fx=fixture();
  const a=verifyRsiMetaProfileCanaryAdmission(fx.admission);
  assert.equal(a.action_surface,'READ_ONLY_DECISION_SUPPORT');
  assert.equal(a.max_decisions,16);
  assert.equal(a.clean_shadow_evidence_required,true);
  assert.equal(a.minimum_shadow_observations_required,32);
  assert.equal(a.bounded_handoff_required,true);
  assert.equal(a.baseline_is_default,true);
  assert.equal(a.baseline_fallback_required,true);
  assert.equal(a.candidate_can_choose_cohort,false);
  assert.equal(a.candidate_can_choose_exposure,false);
  assert.equal(a.canary_can_execute_browser_effect,false);
  assert.equal(a.canary_decision_is_advisory_only,true);
  assert.equal(a.authority_effect,false);
});

test('canary decision fails closed on library or governance identity drift',()=>{
  const fx=fixture();
  assert.throws(()=>createRsiMetaProfileCanaryDecision({
    admission:fx.admission,decision_seq:1,context_digest:d('9'),baseline_plan_digest:d('a'),
    baseline_selected_skill_digests:[d('b')],challenger_skill_digest:d('c'),challenger_status:'SHADOW_DIVERGENCE',
    current_library_digest:d('d'),current_governance_digest:fx.governance.governance_digest,cohort_digest:d('8'),
  }),/identity_drift/);
  assert.throws(()=>createRsiMetaProfileCanaryDecision({
    admission:fx.admission,decision_seq:1,context_digest:d('9'),baseline_plan_digest:d('a'),
    baseline_selected_skill_digests:[d('b')],challenger_skill_digest:d('c'),challenger_status:'SHADOW_DIVERGENCE',
    current_library_digest:fx.library.library_digest,current_governance_digest:d('e'),cohort_digest:d('8'),
  }),/identity_drift/);
});

test('challenger divergence produces advisory decision while baseline execution remains unchanged',()=>{
  const fx=fixture();
  const decision=createRsiMetaProfileCanaryDecision({
    admission:fx.admission,decision_seq:1,context_digest:d('9'),baseline_plan_digest:d('a'),
    baseline_selected_skill_digests:[d('b')],challenger_skill_digest:d('c'),challenger_status:'SHADOW_DIVERGENCE',
    current_library_digest:fx.library.library_digest,current_governance_digest:fx.governance.governance_digest,cohort_digest:d('8'),
  });
  verifyRsiMetaProfileCanaryDecision(decision,fx.admission);
  assert.equal(decision.mode,'CHALLENGER_ADVISORY');
  assert.equal(decision.baseline_execution_unchanged,true);
  assert.equal(decision.challenger_is_advisory_only,true);
  assert.equal(decision.decision_can_execute_browser_effect,false);
  assert.equal(decision.decision_can_retry_physical_effect,false);
});

test('canary outcome evaluates outcome safety security awareness and task utility',()=>{
  const fx=fixture();
  const decision=createRsiMetaProfileCanaryDecision({
    admission:fx.admission,decision_seq:1,context_digest:d('9'),baseline_plan_digest:d('a'),
    baseline_selected_skill_digests:[d('b')],challenger_skill_digest:d('c'),challenger_status:'SHADOW_DIVERGENCE',
    current_library_digest:fx.library.library_digest,current_governance_digest:fx.governance.governance_digest,cohort_digest:d('8'),
  });
  const outcome=createRsiMetaProfileCanaryOutcome({
    admission:fx.admission,decision,outcome_id:'canary.outcome.1',
    outcome_safety:'PASS',security_awareness:'PASS',task_utility:0.4,
    ambiguous:false,hard_invariant_pass:true,evidence_digest:d('d'),evidence_refs:['canary:evidence:1'],
    external_evaluator:true,authored_by_candidate:false,
  });
  verifyRsiMetaProfileCanaryOutcome(outcome,{admission:fx.admission,decision});
  assert.equal(outcome.rollback_required,false);
  assert.equal(outcome.learning_success_eligible,true);
});

test('ambiguity or security failure latches rollback and prevents further canary decisions',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-canary-'));
  try{
    const fx=fixture();
    const statePath=path.join(root,'canary.json');
    const ledger=new RsiMetaProfileCanaryLedger({statePath,source_sha:SOURCE});
    await ledger.init();
    assert.equal((await ledger.admit(fx.admission)).state,'CANARY_ADMITTED');

    const decision=await ledger.issueDecision(fx.admission.canary_id,{
      context_digest:d('9'),baseline_plan_digest:d('a'),baseline_selected_skill_digests:[d('b')],
      challenger_skill_digest:d('c'),challenger_status:'SHADOW_DIVERGENCE',
      current_library_digest:fx.library.library_digest,current_governance_digest:fx.governance.governance_digest,
      cohort_digest:d('8'),
    });
    const outcome=createRsiMetaProfileCanaryOutcome({
      admission:fx.admission,decision,outcome_id:'canary.outcome.rollback',
      outcome_safety:'PASS',security_awareness:'FAIL',task_utility:0.8,
      ambiguous:false,hard_invariant_pass:true,evidence_digest:d('d'),evidence_refs:['canary:security:fail'],
      external_evaluator:true,authored_by_candidate:false,
    });
    const stored=await ledger.recordOutcome(fx.admission.canary_id,outcome);
    assert.equal(stored.state,'ROLLBACK_REQUIRED');
    assert.equal(stored.rollback_required,true);
    assert.equal(ledger.snapshot().rollback_required_count,1);
    await assert.rejects(()=>ledger.issueDecision(fx.admission.canary_id,{
      context_digest:d('e'),baseline_plan_digest:d('f'),baseline_selected_skill_digests:[],
      challenger_skill_digest:null,challenger_status:'NO_APPLICABLE_META_ROLE',
      current_library_digest:fx.library.library_digest,current_governance_digest:fx.governance.governance_digest,
      cohort_digest:d('8'),
    }),/rollback_latched/);

    const restored=new RsiMetaProfileCanaryLedger({statePath,source_sha:SOURCE});
    await restored.init();
    assert.equal(restored.snapshot().rollback_required_count,1);
  }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('ledger requires one externally evaluated outcome before next canary decision',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-canary-pending-'));
  try{
    const fx=fixture();
    const ledger=new RsiMetaProfileCanaryLedger({statePath:path.join(root,'canary.json'),source_sha:SOURCE});
    await ledger.init();await ledger.admit(fx.admission);
    await ledger.issueDecision(fx.admission.canary_id,{
      context_digest:d('9'),baseline_plan_digest:d('a'),baseline_selected_skill_digests:[],
      challenger_skill_digest:null,challenger_status:'NO_APPLICABLE_META_ROLE',
      current_library_digest:fx.library.library_digest,current_governance_digest:fx.governance.governance_digest,
      cohort_digest:d('8'),
    });
    await assert.rejects(()=>ledger.issueDecision(fx.admission.canary_id,{
      context_digest:d('b'),baseline_plan_digest:d('c'),baseline_selected_skill_digests:[],
      challenger_skill_digest:null,challenger_status:'NO_APPLICABLE_META_ROLE',
      current_library_digest:fx.library.library_digest,current_governance_digest:fx.governance.governance_digest,
      cohort_digest:d('8'),
    }),/previous_decision_outcome_pending/);
  }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('canary trust root freezes exposure and preserves baseline authority',()=>{
  const root=rsiMetaProfileCanaryTrustRootSnapshot();
  assert.equal(root.allowed_surface,'READ_ONLY_DECISION_SUPPORT');
  assert.equal(root.max_canary_decisions,16);
  assert.equal(root.clean_shadow_evidence_required,true);
  assert.equal(root.minimum_shadow_observations_required,32);
  assert.equal(root.bounded_handoff_required,true);
  assert.equal(root.exact_library_and_governance_identity_required,true);
  assert.equal(root.baseline_is_default,true);
  assert.equal(root.baseline_fallback_required,true);
  assert.equal(root.outcome_safety_required,true);
  assert.equal(root.security_awareness_required,true);
  assert.equal(root.task_utility_required,true);
  assert.equal(root.one_outcome_per_decision_required,true);
  assert.equal(root.rollback_latch_monotonic,true);
  assert.equal(root.ambiguity_latches_rollback,true);
  assert.equal(root.canary_decisions_advisory_only,true);
  assert.equal(root.canary_can_execute_browser_effect,false);
  assert.equal(root.authority_effect,false);
});
