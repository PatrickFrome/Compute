import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRsiBenchmarkProvenancePolicy,
  verifyRsiBenchmarkProvenancePolicy,
  createRsiBenchmarkTaskProvenance,
  verifyRsiBenchmarkTaskProvenance,
  assessRsiBenchmarkContamination,
  verifyRsiBenchmarkContaminationAssessment,
  createRsiBenchmarkEvidenceAdmission,
  verifyRsiBenchmarkEvidenceAdmission,
  rsiBenchmarkProvenanceTrustRootSnapshot,
} from '../src/rsi-benchmark-provenance-guard.mjs';

const d=(c)=>`sha256:${c.repeat(64)}`;
const sha=(c)=>c.repeat(40);

function policy(overrides={}){
  return createRsiBenchmarkProvenancePolicy({
    policy_id:'benchmark.provenance.1',
    min_resistant_tasks:4,
    min_source_families:2,
    max_public_static_fraction:0.25,
    external_policy_owner:true,
    authored_by_candidate:false,
    ...overrides,
  });
}

function task(index,overrides={}){
  const chars='123456789abcdef';
  const c=chars[(index-1)%chars.length];
  const p=policy();
  return createRsiBenchmarkTaskProvenance({
    policy:p,
    task_id:`task.fresh.${index}`,
    benchmark_id:'rsi.hidden.browser.v1',
    benchmark_version:'2026-09-18.1',
    task_prompt_digest:d(c),
    hidden_test_digest:d(chars[index%chars.length]),
    source_kind:index%2===0?'CROSS_REPO_FRESH':'FRESH_PRIVATE_COMMIT',
    source_family:index%2===0?'repo.family.b':'repo.family.a',
    source_repository_digest:d(index%2===0?'a':'b'),
    candidate_repository_digest:d('c'),
    source_commit_sha:sha(c),
    source_published_at:`2026-09-18T0${index}:00:00.000Z`,
    candidate_frozen_at:'2026-09-17T23:00:00.000Z',
    task_materialized_at:`2026-09-18T0${index}:05:00.000Z`,
    searchability:'NOT_SEARCHABLE',
    reference_solution_visible:false,
    hidden_tests_visible:false,
    evaluator_harness_visible:false,
    evaluator_harness_mutated_by_candidate:false,
    task_authored_by_candidate:false,
    task_selected_by_candidate:false,
    source_repository_selected_by_candidate:false,
    ingested_into_trusted_memory:false,
    ingested_into_skill_library:false,
    external_provenance_verifier:true,
    authored_by_candidate:false,
    evidence_refs:[`PROVENANCE_${index}`],
    ...overrides,
  });
}

test('policy refuses candidate-owned freshness labels, task selection and benchmark-to-memory feedback',()=>{
  const p=policy();
  verifyRsiBenchmarkProvenancePolicy(p);
  assert.equal(p.candidate_can_choose_tasks,false);
  assert.equal(p.candidate_can_choose_source_repositories,false);
  assert.equal(p.candidate_can_label_freshness,false);
  assert.equal(p.candidate_can_author_provenance,false);
  assert.equal(p.candidate_can_mutate_evaluator_harness,false);
  assert.equal(p.benchmark_tasks_may_train_trusted_memory,false);
  assert.equal(p.benchmark_tasks_may_seed_skill_library,false);
  assert.equal(p.public_static_can_be_sole_promotion_evidence,false);
  assert.equal(p.proven_uncontaminated_claim_allowed,false);
  assert.equal(p.authority_effect,false);
});

test('fresh cross-repo/private task with hidden evidence is contamination-resistant, not claimed proven uncontaminated',()=>{
  const p=policy();
  const t=task(1);
  verifyRsiBenchmarkTaskProvenance(t,p);
  const a=assessRsiBenchmarkContamination({policy:p,task:t});
  verifyRsiBenchmarkContaminationAssessment(a,p,t);
  assert.equal(a.risk_state,'CONTAMINATION_RESISTANT');
  assert.equal(a.eligible_for_full_holdout_evidence,true);
  assert.equal(a.eligible_for_trusted_experience_memory,true);
  assert.equal(a.eligible_for_skill_library_training,false);
  assert.equal(a.proven_uncontaminated,false);
  assert.equal(a.model_training_cutoff_proven,false);
  assert.equal(a.assessment_is_promotion_authority,false);
  assert.equal(a.authority_effect,false);
});

test('reference solution, hidden tests, evaluator mutation or benchmark feedback into memory is hard contamination',()=>{
  const p=policy();
  for(const [field,code] of [
    ['reference_solution_visible','REFERENCE_SOLUTION_VISIBLE'],
    ['hidden_tests_visible','HIDDEN_TESTS_VISIBLE'],
    ['evaluator_harness_mutated_by_candidate','EVALUATOR_HARNESS_MUTATED'],
    ['task_authored_by_candidate','TASK_AUTHORED_BY_CANDIDATE'],
    ['task_selected_by_candidate','TASK_SELECTED_BY_CANDIDATE'],
    ['source_repository_selected_by_candidate','SOURCE_REPOSITORY_SELECTED_BY_CANDIDATE'],
    ['ingested_into_trusted_memory','TASK_INGESTED_INTO_TRUSTED_MEMORY'],
    ['ingested_into_skill_library','TASK_INGESTED_INTO_SKILL_LIBRARY'],
  ]){
    const t=task(2,{[field]:true});
    const a=assessRsiBenchmarkContamination({policy:p,task:t});
    assert.equal(a.risk_state,'CONTAMINATED',field);
    assert.equal(a.hard_contamination_signals.includes(code),true,field);
    assert.equal(a.eligible_for_full_holdout_evidence,false);
    assert.equal(a.eligible_for_trusted_experience_memory,false);
  }
});

test('public static/searchable tasks are supplemental suspect evidence, never sole holdout truth',()=>{
  const p=policy();
  const t=task(3,{
    source_kind:'PUBLIC_STATIC',
    source_commit_sha:null,
    searchability:'SEARCHABLE',
  });
  const a=assessRsiBenchmarkContamination({policy:p,task:t});
  assert.equal(a.risk_state,'SUSPECT');
  assert.equal(a.public_static_supplemental_only,true);
  assert.equal(a.eligible_for_full_holdout_evidence,false);
  assert.equal(a.warning_signals.includes('PUBLIC_STATIC_TASK'),true);
  assert.equal(a.warning_signals.includes('PROMPT_SEARCHABLE'),true);
});

test('dynamic semantic variant requires external parent/equivalence evidence',()=>{
  const p=policy();
  assert.throws(()=>createRsiBenchmarkTaskProvenance({
    policy:p,
    task_id:'task.variant.bad',
    benchmark_id:'rsi.variant',
    benchmark_version:'v1',
    task_prompt_digest:d('1'),hidden_test_digest:d('2'),
    source_kind:'DYNAMIC_SEMANTIC_VARIANT',source_family:'variant.family',
    source_repository_digest:d('a'),candidate_repository_digest:d('c'),
    source_published_at:'2026-09-18T01:00:00Z',candidate_frozen_at:'2026-09-17T23:00:00Z',task_materialized_at:'2026-09-18T01:10:00Z',
    searchability:'NOT_SEARCHABLE',
    external_provenance_verifier:true,authored_by_candidate:false,evidence_refs:['VARIANT_BAD'],
  }),/dynamic_variant_evidence_required/);

  const t=task(4,{
    source_kind:'DYNAMIC_SEMANTIC_VARIANT',
    source_commit_sha:null,
    source_parent_task_digest:d('d'),
    semantic_equivalence_receipt_digest:d('e'),
    searchability:'NOT_SEARCHABLE',
  });
  const a=assessRsiBenchmarkContamination({policy:p,task:t});
  assert.equal(a.risk_state,'CONTAMINATION_RESISTANT');
  assert.equal(a.dynamic_variant_verified,true);
});

test('cross-repo freshness must actually use a distinct source repository',()=>{
  const p=policy();
  assert.throws(()=>task(2,{
    source_kind:'CROSS_REPO_FRESH',
    source_repository_digest:d('c'),
    candidate_repository_digest:d('c'),
  }),/cross_repo_alias_forbidden/);
});

test('full holdout admission requires enough resistant tasks and source-family diversity',()=>{
  const p=policy();
  const tasks=[task(1),task(2),task(3,{source_kind:'FRESH_PRIVATE_COMMIT',source_commit_sha:sha('3'),source_family:'repo.family.a'}),task(4)];
  const assessments=tasks.map(t=>assessRsiBenchmarkContamination({policy:p,task:t}));
  const admission=createRsiBenchmarkEvidenceAdmission({policy:p,assessments,tasks});
  verifyRsiBenchmarkEvidenceAdmission(admission,p,assessments,tasks);
  assert.equal(admission.state,'ELIGIBLE_FOR_FULL_HOLDOUT_EVIDENCE');
  assert.equal(admission.resistant_task_count,4);
  assert.ok(admission.resistant_source_family_count>=2);
  assert.equal(admission.contaminated_task_count,0);
  assert.equal(admission.eligible_for_full_holdout_evidence,true);
  assert.equal(admission.eligible_as_sole_promotion_evidence,false);
  assert.equal(admission.existing_evaluator_and_promotion_gates_still_required,true);
});

test('suspect/unknown tasks do not count toward required resistant set and public-static fraction is bounded',()=>{
  const p=policy();
  const tasks=[
    task(1),task(2),
    task(3,{source_kind:'PUBLIC_STATIC',source_commit_sha:null,searchability:'SEARCHABLE'}),
    task(4,{source_kind:'PUBLIC_STATIC',source_commit_sha:null,searchability:'UNKNOWN'}),
  ];
  const assessments=tasks.map(t=>assessRsiBenchmarkContamination({policy:p,task:t}));
  const admission=createRsiBenchmarkEvidenceAdmission({policy:p,assessments,tasks});
  assert.equal(admission.state,'HELD_FOR_BENCHMARK_REFRESH');
  assert.equal(admission.resistant_task_count,2);
  assert.equal(admission.suspect_task_count,2);
  assert.equal(admission.suspect_or_unknown_counts_toward_required_resistant_set,false);
  assert.equal(admission.blockers.includes('INSUFFICIENT_RESISTANT_TASKS'),true);
  assert.equal(admission.blockers.includes('PUBLIC_STATIC_FRACTION_EXCEEDED'),true);
});

test('one contaminated task fails closed even if enough other tasks are fresh',()=>{
  const p=policy();
  const tasks=[task(1),task(2),task(3),task(4),task(5,{hidden_tests_visible:true})];
  const assessments=tasks.map(t=>assessRsiBenchmarkContamination({policy:p,task:t}));
  const admission=createRsiBenchmarkEvidenceAdmission({policy:p,assessments,tasks});
  assert.equal(admission.state,'HELD_FOR_BENCHMARK_REFRESH');
  assert.equal(admission.contaminated_task_count,1);
  assert.equal(admission.contaminated_evidence_weight,0);
  assert.equal(admission.blockers.includes('CONTAMINATED_TASK_PRESENT'),true);
});

test('candidate-authored provenance is rejected and model training cutoff is never invented',()=>{
  const p=policy();
  assert.throws(()=>createRsiBenchmarkTaskProvenance({
    policy:p,task_id:'task.self',benchmark_id:'self.bench',benchmark_version:'v1',
    task_prompt_digest:d('1'),hidden_test_digest:d('2'),source_kind:'PUBLIC_STATIC',source_family:'public',
    source_repository_digest:d('a'),candidate_repository_digest:d('c'),
    source_published_at:'2025-01-01T00:00:00Z',candidate_frozen_at:'2026-09-18T00:00:00Z',task_materialized_at:'2026-09-18T01:00:00Z',
    searchability:'UNKNOWN',external_provenance_verifier:false,authored_by_candidate:true,evidence_refs:['SELF'],
  }),/external_origin_required/);
  const t=task(6);
  assert.equal(t.model_training_cutoff_proven,false);
  const a=assessRsiBenchmarkContamination({policy:p,task:t});
  assert.equal(a.proven_uncontaminated,false);
});

test('trust root encodes contamination resistance without making provenance a promotion authority',()=>{
  const root=rsiBenchmarkProvenanceTrustRootSnapshot();
  assert.equal(root.raw_task_content_in_trust_root,false);
  assert.equal(root.candidate_can_choose_tasks,false);
  assert.equal(root.candidate_can_label_freshness,false);
  assert.equal(root.benchmark_tasks_may_train_trusted_memory,false);
  assert.equal(root.benchmark_tasks_may_seed_skill_library,false);
  assert.equal(root.public_static_can_be_sole_promotion_evidence,false);
  assert.equal(root.proven_uncontaminated_claim_allowed,false);
  assert.equal(root.hidden_tests_required,true);
  assert.equal(root.external_provenance_required,true);
  assert.equal(root.execution_authority,false);
  assert.equal(root.promotion_authority,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.benchmark_root_digest,/^sha256:[0-9a-f]{64}$/);
});
