import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { RSI_META_PROFILE_SHADOW_SELECTION_SCHEMA } from '../src/rsi-meta-profile-shadow-selection.mjs';
import {
  RsiBoundedCanaryAdmissionLedger,
  createRsiBoundedCanaryAdmission,
  createRsiBoundedCanaryShadowEvidence,
  rsiBoundedCanaryAdmissionTrustRootSnapshot,
  verifyRsiBoundedCanaryAdmission,
  verifyRsiBoundedCanaryShadowEvidence,
} from '../src/rsi-bounded-canary-admission.mjs';

const SOURCE='a'.repeat(40);

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map((key)=>[key,stable(value[key])]));
}
function digest(value){
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`;
}
function d(label){return digest({label});}

function selection(){
  const core={
    schema:RSI_META_PROFILE_SHADOW_SELECTION_SCHEMA,
    version:1,
    source_sha:SOURCE,
    selection_id:'canary.shadow.selection.1',
    qualification_digest:d('qualification'),
    meta_record_digest:d('meta-record'),
    library_digest:d('library'),
    incumbent_profile_digest:d('incumbent'),
    challenger_profile_digest:d('challenger'),
    mode:'SHADOW_ONLY',
    external_selector:true,
    authored_by_candidate:false,
    candidate_can_select_profile:false,
    selection_can_change_execution:false,
    selection_can_replace_incumbent:false,
    selection_can_grant_skill_activity:false,
    continuous_shadow_review_required:true,
    canary_gate_still_required:true,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,selection_digest:digest(core)});
}

function evidence(overrides={}){
  const s=selection();
  return createRsiBoundedCanaryShadowEvidence({
    evidence_id:overrides.evidence_id||'canary.shadow.evidence.1',
    shadow_selection:s,
    context_cohort_digest:overrides.context_cohort_digest||d('cohort'),
    shadow_observation_count:overrides.shadow_observation_count??32,
    matched_count:overrides.matched_count??32,
    divergence_count:overrides.divergence_count??0,
    ambiguity_count:overrides.ambiguity_count??0,
    incident_count:overrides.incident_count??0,
    hard_invariant_violation_count:overrides.hard_invariant_violation_count??0,
    identity_drift_count:overrides.identity_drift_count??0,
    outcome_evidence_digest:d('outcome'),
    safety_evidence_digest:d('safety'),
    security_evidence_digest:d('security'),
    awareness_evidence_digest:d('awareness'),
    utility_evidence_digest:d('utility'),
    evidence_refs:['canary:trajectory:1','canary:trajectory:2'],
    external_observer:true,
    authored_by_candidate:false,
  });
}

test('clean shadow evidence admits only an external read-only bounded canary handoff',()=>{
  const s=selection();
  const e=evidence();
  verifyRsiBoundedCanaryShadowEvidence(e,{shadow_selection:s});
  assert.equal(e.eligible_for_bounded_canary_admission,true);
  assert.equal(e.rollback_required_latched,false);

  const admission=createRsiBoundedCanaryAdmission({
    admission_id:'canary.admission.1',
    shadow_selection:s,
    shadow_evidence:e,
    fixed_cohort_digest:d('cohort'),
    decision_budget:16,
    external_admission_owner:true,
    authored_by_candidate:false,
  });
  verifyRsiBoundedCanaryAdmission(admission,{shadow_selection:s,shadow_evidence:e});

  assert.equal(admission.canary_surface,'READ_ONLY_DECISION_SUPPORT');
  assert.equal(admission.incumbent_remains_default,true);
  assert.equal(admission.incumbent_is_mandatory_fallback,true);
  assert.equal(admission.decision_budget,16);
  assert.equal(admission.eligible_for_external_bounded_canary_handoff,true);
  assert.equal(admission.canary_activation_authorized,false);
  assert.equal(admission.live_profile_activation_authorized,false);
  assert.equal(admission.canary_mutations_allowed,false);
  assert.equal(admission.canary_browser_effects_allowed,false);
  assert.equal(admission.canary_tool_execution_allowed,false);
  assert.equal(admission.execution_authority,false);
  assert.equal(admission.authority_effect,false);
});

test('insufficient shadow coverage never becomes canary admission evidence',()=>{
  const e=evidence({
    evidence_id:'canary.shadow.evidence.short',
    shadow_observation_count:31,
    matched_count:31,
  });
  assert.equal(e.minimum_shadow_observations,32);
  assert.equal(e.eligible_for_bounded_canary_admission,false);
  assert.throws(()=>createRsiBoundedCanaryAdmission({
    admission_id:'canary.admission.short',
    shadow_selection:selection(),
    shadow_evidence:e,
    fixed_cohort_digest:d('cohort'),
    external_admission_owner:true,
    authored_by_candidate:false,
  }),/clean_shadow_evidence_required/);
});

test('ambiguity incident hard-invariant failure or identity drift latches rollback',()=>{
  for(const [label,overrides] of [
    ['ambiguity',{matched_count:31,ambiguity_count:1}],
    ['incident',{matched_count:31,divergence_count:1,incident_count:1}],
    ['hard',{hard_invariant_violation_count:1}],
    ['identity',{identity_drift_count:1}],
  ]){
    const e=evidence({evidence_id:`canary.shadow.evidence.${label}`,...overrides});
    assert.equal(e.rollback_required_latched,true,label);
    assert.equal(e.eligible_for_bounded_canary_admission,false,label);
    assert.throws(()=>createRsiBoundedCanaryAdmission({
      admission_id:`canary.admission.${label}`,
      shadow_selection:selection(),
      shadow_evidence:e,
      fixed_cohort_digest:d('cohort'),
      external_admission_owner:true,
      authored_by_candidate:false,
    }),/clean_shadow_evidence_required/);
  }
});

test('cohort and decision budget are external fixed gates, not candidate choices',()=>{
  const s=selection();
  const e=evidence();
  assert.throws(()=>createRsiBoundedCanaryAdmission({
    admission_id:'canary.admission.cohort-drift',
    shadow_selection:s,
    shadow_evidence:e,
    fixed_cohort_digest:d('different-cohort'),
    external_admission_owner:true,
    authored_by_candidate:false,
  }),/cohort_binding_mismatch/);
  assert.throws(()=>createRsiBoundedCanaryAdmission({
    admission_id:'canary.admission.budget-drift',
    shadow_selection:s,
    shadow_evidence:e,
    fixed_cohort_digest:d('cohort'),
    decision_budget:17,
    external_admission_owner:true,
    authored_by_candidate:false,
  }),/fixed_decision_budget_required/);
  assert.throws(()=>createRsiBoundedCanaryAdmission({
    admission_id:'canary.admission.candidate-owned',
    shadow_selection:s,
    shadow_evidence:e,
    fixed_cohort_digest:d('cohort'),
    external_admission_owner:false,
    authored_by_candidate:true,
  }),/external_admission_owner_required/);
});

test('digest tampering fails closed for shadow evidence and canary admission',()=>{
  const s=selection();
  const e=evidence();
  const tamperedEvidence={...e,utility_evidence_digest:d('tampered-utility')};
  assert.throws(
    ()=>verifyRsiBoundedCanaryShadowEvidence(tamperedEvidence,{shadow_selection:s}),
    /shadow_evidence_digest_mismatch/,
  );

  const admission=createRsiBoundedCanaryAdmission({
    admission_id:'canary.admission.digest',
    shadow_selection:s,
    shadow_evidence:e,
    fixed_cohort_digest:d('cohort'),
    external_admission_owner:true,
    authored_by_candidate:false,
  });
  const tamperedAdmission={...admission,incumbent_is_mandatory_fallback:false};
  assert.throws(
    ()=>verifyRsiBoundedCanaryAdmission(tamperedAdmission,{shadow_selection:s,shadow_evidence:e}),
    /admission_policy_invalid/,
  );
});

test('durable rollback latch survives restart and blocks later admission',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-canary-admission-'));
  try{
    const statePath=path.join(root,'canary.json');
    const bad=evidence({
      evidence_id:'canary.shadow.evidence.rollback',
      matched_count:31,
      ambiguity_count:1,
    });
    const ledger=new RsiBoundedCanaryAdmissionLedger({statePath,source_sha:SOURCE});
    await ledger.init();
    const recorded=await ledger.recordEvidence(bad);
    assert.equal(recorded.state,'ROLLBACK_REQUIRED_LATCHED');
    assert.equal(ledger.snapshot().rollback_required_latched,true);
    assert.equal(ledger.snapshot().active_canary_admission_digest,null);
    assert.equal(ledger.snapshot().ledger_can_activate_canary,false);

    const restored=new RsiBoundedCanaryAdmissionLedger({statePath,source_sha:SOURCE});
    await restored.init();
    assert.equal(restored.snapshot().rollback_required_latched,true);

    const good=evidence({evidence_id:'canary.shadow.evidence.after-rollback'});
    const admission=createRsiBoundedCanaryAdmission({
      admission_id:'canary.admission.after-rollback',
      shadow_selection:selection(),
      shadow_evidence:good,
      fixed_cohort_digest:d('cohort'),
      external_admission_owner:true,
      authored_by_candidate:false,
    });
    await assert.rejects(()=>restored.add({admission,shadow_evidence:good}),/rollback_latch_active/);
  }finally{
    await fs.rm(root,{recursive:true,force:true});
  }
});

test('clean durable admission is append-only and still cannot activate a canary',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-canary-clean-'));
  try{
    const statePath=path.join(root,'canary.json');
    const s=selection();
    const e=evidence();
    const admission=createRsiBoundedCanaryAdmission({
      admission_id:'canary.admission.persist',
      shadow_selection:s,
      shadow_evidence:e,
      fixed_cohort_digest:d('cohort'),
      external_admission_owner:true,
      authored_by_candidate:false,
    });
    const ledger=new RsiBoundedCanaryAdmissionLedger({statePath,source_sha:SOURCE});
    await ledger.init();
    assert.equal((await ledger.add({admission,shadow_evidence:e})).state,'ELIGIBLE_FOR_EXTERNAL_BOUNDED_CANARY_HANDOFF');
    assert.equal((await ledger.add({admission,shadow_evidence:e})).state,'IDEMPOTENT');
    assert.equal(ledger.snapshot().row_count,1);
    assert.equal(ledger.snapshot().rollback_required_latched,false);
    assert.equal(ledger.snapshot().active_canary_admission_digest,null);
    assert.equal(ledger.snapshot().ledger_can_activate_canary,false);

    const restored=new RsiBoundedCanaryAdmissionLedger({statePath,source_sha:SOURCE});
    await restored.init();
    assert.equal(restored.snapshot().row_count,1);
    assert.equal(restored.snapshot().rollback_required_latched,false);
  }finally{
    await fs.rm(root,{recursive:true,force:true});
  }
});

test('bounded canary trust root freezes identity, cohort, budget and zero authority',()=>{
  const root=rsiBoundedCanaryAdmissionTrustRootSnapshot();
  assert.equal(root.phase18_shadow_selection_required,true);
  assert.equal(root.minimum_shadow_observations,32);
  assert.equal(root.fixed_read_only_decision_budget,16);
  assert.equal(root.canary_surface,'READ_ONLY_DECISION_SUPPORT');
  assert.equal(root.incumbent_remains_default,true);
  assert.equal(root.incumbent_is_mandatory_fallback,true);
  assert.equal(root.identity_stable_manifest_required,true);
  assert.equal(root.outcome_safety_security_awareness_utility_evidence_required,true);
  assert.equal(root.ambiguity_latches_rollback,true);
  assert.equal(root.incident_latches_rollback,true);
  assert.equal(root.hard_invariant_failure_latches_rollback,true);
  assert.equal(root.identity_drift_latches_rollback,true);
  assert.equal(root.canary_activation_authorized,false);
  assert.equal(root.live_profile_activation_authorized,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.canary_admission_root_digest,/^sha256:[0-9a-f]{64}$/);
});
