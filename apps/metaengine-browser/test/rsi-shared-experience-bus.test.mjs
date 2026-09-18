import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  RsiSharedExperienceBus,
  createRsiSharedExperienceAdmission,
  createRsiSharedExperienceHypothesis,
  rsiSharedExperienceBusTrustRootSnapshot,
  verifyRsiSharedExperienceAdmission,
  verifyRsiSharedExperienceHypothesis,
} from '../src/rsi-shared-experience-bus.mjs';

const SOURCE='a'.repeat(40);
function dg(label){return `sha256:${crypto.createHash('sha256').update(String(label),'utf8').digest('hex')}`;}

function hypothesis(label='one',overrides={}){
  return createRsiSharedExperienceHypothesis({
    hypothesis_id:`experience.hypothesis.${label}`,
    source_sha:SOURCE,
    origin_candidate_digest:dg(`candidate-${label}`),
    origin_lineage_digest:dg(`lineage-${label}`),
    sanitized_summary_digest:dg(`summary-${label}`),
    supporting_evidence_digest:dg(`support-${label}`),
    counterevidence_digest:dg(`counter-${label}`),
    falsification_test_digest:dg(`falsify-${label}`),
    scope_tags:['VERIFIER','PLANNING'],
    recipient_group_tags:['CODING','BROWSER'],
    evaluator_cost_units:8,
    expected_information_gain:0.8,
    hidden_data_disclosed:false,
    raw_benchmark_content_included:false,
    raw_verifier_assets_included:false,
    external_synthesizer:true,
    authored_by_candidate:false,
    ...overrides,
  });
}
function admission(row,label='one',overrides={}){
  return createRsiSharedExperienceAdmission({
    admission_id:`experience.admission.${label}`,
    hypothesis:row,
    supporting_evidence_verified:true,
    counterevidence_reviewed:true,
    falsification_test_precommitted:true,
    hidden_data_non_disclosure_pass:true,
    scope_precision_pass:true,
    evaluator_budget_available:true,
    marginal_information_gain_certified:true,
    external_reviewer:true,
    authored_by_candidate:false,
    ...overrides,
  });
}

test('evidence-backed hypothesis can enter shared bus only as advisory experience',()=>{
  const h=hypothesis();
  assert.equal(verifyRsiSharedExperienceHypothesis(h).hypothesis_digest,h.hypothesis_digest);
  assert.equal(h.hidden_data_disclosed,false);
  assert.equal(h.raw_benchmark_content_included,false);
  assert.equal(h.raw_verifier_assets_included,false);
  assert.equal(h.candidate_can_choose_recipients,false);
  assert.equal(h.hypothesis_is_mutation_authority,false);

  const a=admission(h);
  assert.equal(verifyRsiSharedExperienceAdmission(a,{hypothesis:h}).admission_digest,a.admission_digest);
  assert.equal(a.state,'ELIGIBLE_FOR_SHARED_EXPERIENCE_BUS');
  assert.equal(a.eligible_for_shared_experience_bus,true);
  assert.equal(a.shared_experience_is_advisory_only,true);
  assert.equal(a.shared_experience_can_mutate_active_skill,false);
  assert.equal(a.shared_experience_can_mutate_verifier,false);
  assert.equal(a.shared_experience_can_mutate_benchmark,false);
  assert.equal(a.shared_experience_can_schedule_work,false);
  assert.equal(a.shared_experience_can_execute_browser_effect,false);
  assert.equal(a.consumer_must_revalidate_locally,true);
  assert.equal(a.authority_effect,false);
});

test('raw hidden benchmark or verifier assets can never enter shared experience',()=>{
  assert.throws(()=>hypothesis('hidden',{hidden_data_disclosed:true}),/hidden_data_disclosure_forbidden/);
  assert.throws(()=>hypothesis('benchmark',{raw_benchmark_content_included:true}),/hidden_data_disclosure_forbidden/);
  assert.throws(()=>hypothesis('verifier',{raw_verifier_assets_included:true}),/hidden_data_disclosure_forbidden/);
});

test('hypothesis requires independent support counterevidence and falsification roots',()=>{
  const same=dg('same-root');
  assert.throws(()=>hypothesis('alias',{
    supporting_evidence_digest:same,
    counterevidence_digest:same,
  }),/independent_evidence_roots_required/);
});

test('missing evidence review falsification budget or information-gain gate rejects sharing',()=>{
  const cases=[
    ['support',{supporting_evidence_verified:false},'SUPPORTING_EVIDENCE_UNVERIFIED'],
    ['counter',{counterevidence_reviewed:false},'COUNTEREVIDENCE_NOT_REVIEWED'],
    ['falsification',{falsification_test_precommitted:false},'FALSIFICATION_TEST_NOT_PRECOMMITTED'],
    ['hidden',{hidden_data_non_disclosure_pass:false},'HIDDEN_DATA_BOUNDARY_FAILURE'],
    ['scope',{scope_precision_pass:false},'SCOPE_PRECISION_FAILURE'],
    ['budget',{evaluator_budget_available:false},'EVALUATOR_BUDGET_UNAVAILABLE'],
    ['gain',{marginal_information_gain_certified:false},'LOW_INFORMATION_GAIN'],
  ];
  for(const [label,overrides,blocker] of cases){
    const h=hypothesis(label);
    const a=admission(h,label,overrides);
    assert.equal(a.state,'SHARED_EXPERIENCE_REJECTED');
    assert.ok(a.blockers.includes(blocker),blocker);
    assert.equal(a.eligible_for_shared_experience_bus,false);
  }
});

test('evaluator-cost budget is bounded and information gain is explicit',()=>{
  assert.throws(()=>hypothesis('too-expensive',{evaluator_cost_units:65}),/evaluator_cost_units_invalid/);
  assert.throws(()=>hypothesis('zero-gain',{expected_information_gain:0}),/expected_information_gain_invalid/);
  const h=hypothesis('ratio',{evaluator_cost_units:8,expected_information_gain:0.8});
  assert.equal(h.information_gain_per_cost,0.1);
});

test('append-only bus preserves multiple and conflicting evidence-backed hypotheses',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-shared-experience-bus-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const statePath=path.join(dir,'bus.json');
  const bus=new RsiSharedExperienceBus({statePath,source_sha:SOURCE});
  await bus.init();

  const h1=hypothesis('one');
  const a1=admission(h1,'one');
  assert.equal((await bus.add({hypothesis:h1,admission:a1})).state,'ELIGIBLE_FOR_SHARED_EXPERIENCE_BUS');

  const h2=hypothesis('two',{
    scope_tags:['VERIFIER','MEMORY'],
    recipient_group_tags:['CODING','RESEARCH'],
    evaluator_cost_units:4,
    expected_information_gain:0.6,
  });
  const a2=admission(h2,'two');
  assert.equal((await bus.add({hypothesis:h2,admission:a2})).state,'ELIGIBLE_FOR_SHARED_EXPERIENCE_BUS');

  const snap=bus.snapshot();
  assert.equal(snap.row_count,2);
  assert.equal(snap.eligible_count,2);
  assert.equal(snap.preserves_conflicting_hypotheses,true);
  assert.equal(snap.scalar_winner_forbidden,true);
  assert.equal(snap.bus_can_mutate_active_state,false);
  assert.equal(snap.bus_can_schedule_work,false);
  assert.equal(snap.bus_can_execute_browser_effect,false);
  assert.ok(snap.represented_recipient_groups.includes('CODING'));
  assert.ok(snap.represented_recipient_groups.includes('RESEARCH'));
  assert.ok(snap.represented_scopes.includes('MEMORY'));
  assert.equal(bus.eligibleForRecipient('CODING').length,2);
  assert.equal(bus.eligibleForRecipient('RESEARCH').length,1);

  const restored=new RsiSharedExperienceBus({statePath,source_sha:SOURCE});
  await restored.init();
  assert.equal(restored.snapshot().row_count,2);
  assert.equal((await restored.add({hypothesis:h1,admission:a1})).state,'IDEMPOTENT');
});

test('same hypothesis cannot be rewritten with conflicting admission evidence',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-shared-experience-conflict-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const bus=new RsiSharedExperienceBus({statePath:path.join(dir,'bus.json'),source_sha:SOURCE});
  await bus.init();
  const h=hypothesis('conflict');
  const a1=admission(h,'conflict');
  await bus.add({hypothesis:h,admission:a1});
  const a2=admission(h,'conflict-2',{scope_precision_pass:false});
  await assert.rejects(()=>bus.add({hypothesis:h,admission:a2}),/identity_conflict/);
});

test('candidate cannot author hypothesis or admission',()=>{
  assert.throws(()=>hypothesis('candidate',{external_synthesizer:false,authored_by_candidate:true}),/external_synthesizer_required/);
  const h=hypothesis('candidate-review');
  assert.throws(()=>admission(h,'candidate-review',{external_reviewer:false,authored_by_candidate:true}),/external_reviewer_required/);
});

test('shared experience trust root preserves evidence boundaries and zero authority',()=>{
  const root=rsiSharedExperienceBusTrustRootSnapshot();
  assert.equal(root.evidence_backed_hypothesis_required,true);
  assert.equal(root.counterevidence_required,true);
  assert.equal(root.precommitted_falsification_test_required,true);
  assert.equal(root.hidden_data_non_disclosure_required,true);
  assert.equal(root.raw_benchmark_content_sharing_forbidden,true);
  assert.equal(root.raw_verifier_asset_sharing_forbidden,true);
  assert.equal(root.bounded_evaluator_cost_units,64);
  assert.equal(root.marginal_information_gain_required,true);
  assert.equal(root.local_consumer_revalidation_required,true);
  assert.equal(root.source_provenance_required,true);
  assert.equal(root.conflicting_hypotheses_preserved,true);
  assert.equal(root.scalar_winner_forbidden,true);
  assert.equal(root.bus_can_mutate_active_state,false);
  assert.equal(root.bus_can_schedule_work,false);
  assert.equal(root.bus_can_execute_browser_effect,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.shared_experience_bus_root_digest,/^sha256:[0-9a-f]{64}$/);
});
