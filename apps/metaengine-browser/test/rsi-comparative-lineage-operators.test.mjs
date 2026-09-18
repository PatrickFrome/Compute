import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRsiTrajectoryEvidence,
  verifyRsiTrajectoryEvidence,
  createRsiReactionNormProfile,
  verifyRsiReactionNormProfile,
  createRsiCrossLineageContrast,
  verifyRsiCrossLineageContrast,
  createRsiComparativeMutationPortfolio,
  verifyRsiComparativeMutationPortfolio,
  rsiComparativeLineageTrustRootSnapshot,
} from '../src/rsi-comparative-lineage-operators.mjs';

const sha=(c)=>c.repeat(40);
const d=(c)=>`sha256:${c.repeat(64)}`;
const cid=(c)=>`candidate_sha256_${c.repeat(64)}`;

function trajectory({
  id='t.1',
  candidate='1',
  lineage='lineage.a',
  task='task.one',
  outcome='FAIL',
  failures=['TIMEOUT_RECURRENCE'],
  successes=[],
  evaluator='a',
  tool='b',
}={}) {
  return createRsiTrajectoryEvidence({
    trajectory_id:id,
    candidate_id:cid(candidate),
    candidate_sha:sha(candidate),
    lineage_id:lineage,
    task_id:task,
    environment_family:'WINDOWS_BROWSER',
    outcome,
    evaluator_root_digest:d(evaluator),
    trajectory_digest:d(candidate),
    failure_codes:failures,
    success_mechanism_codes:successes,
    tool_sequence_digest:d(tool),
    evidence_refs:[`RUN_${id}`],
    external_evaluator:true,
    authored_by_candidate:false,
  });
}

test('trajectory evidence is external, structured and shares no raw trajectory/user/page data',()=>{
  const row=trajectory();
  verifyRsiTrajectoryEvidence(row);
  assert.equal(row.external_evaluator,true);
  assert.equal(row.authored_by_candidate,false);
  assert.equal(row.raw_trajectory_shared_with_candidate,false);
  assert.equal(row.raw_page_text_shared,false);
  assert.equal(row.raw_user_input_shared,false);
  assert.equal(row.secret_material_shared,false);
  assert.equal(row.model_narrative_is_authority,false);
  assert.equal(row.candidate_can_edit_trajectory_evidence,false);
  assert.equal(row.authority_effect,false);

  assert.throws(()=>createRsiTrajectoryEvidence({
    trajectory_id:'bad.self',
    candidate_id:cid('1'),
    candidate_sha:sha('1'),
    lineage_id:'lineage.a',
    task_id:'task.one',
    environment_family:'WINDOWS_BROWSER',
    outcome:'FAIL',
    evaluator_root_digest:d('a'),
    trajectory_digest:d('1'),
    failure_codes:['FAIL'],
    success_mechanism_codes:[],
    tool_sequence_digest:d('b'),
    evidence_refs:['MODEL_SELF_REPORT'],
    external_evaluator:false,
    authored_by_candidate:true,
  }),/external_origin_required/);
});

test('reaction norm requires same candidate across multiple tasks and exposes recurring genotype-level failure signal',()=>{
  const rows=[
    trajectory({id:'t.1',task:'task.one',failures:['CONTEXT_LOSS','TOOL_RETRY']}),
    trajectory({id:'t.2',task:'task.two',failures:['CONTEXT_LOSS']}),
    trajectory({id:'t.3',task:'task.three',outcome:'PASS',failures:[],successes:['RESULT_READBACK']}),
  ];
  const profile=createRsiReactionNormProfile({trajectories:rows});
  verifyRsiReactionNormProfile(profile);
  assert.equal(profile.task_count,3);
  assert.equal(profile.fail_count,2);
  assert.equal(profile.pass_count,1);
  assert.equal(profile.genotype_level_defect_signal,true);
  assert.deepEqual(profile.recurring_failure_codes,[{code:'CONTEXT_LOSS',task_count:2}]);
  assert.equal(profile.multi_task_comparison_required,true);
  assert.equal(profile.raw_trajectory_shared_with_candidate,false);
  assert.equal(profile.profile_is_mutation_authority,false);

  assert.throws(()=>createRsiReactionNormProfile({
    trajectories:[rows[0],trajectory({id:'x.1',candidate:'2',task:'task.two'})],
  }),/candidate_mismatch/);
  assert.throws(()=>createRsiReactionNormProfile({
    trajectories:[rows[0],trajectory({id:'t.same',task:'task.one'})],
  }),/multi_task_required/);
});

test('cross-lineage contrast requires same task, target failure, reference success, different lineage and same evaluator root',()=>{
  const target=trajectory({
    id:'target.fail',candidate:'1',lineage:'lineage.a',task:'task.shared',
    outcome:'FAIL',failures:['BAD_TOOL_ROUTING'],successes:[],evaluator:'a',
  });
  const reference=trajectory({
    id:'reference.pass',candidate:'2',lineage:'lineage.b',task:'task.shared',
    outcome:'PASS',failures:[],successes:['VERIFY_BEFORE_MUTATE','RESULT_READBACK'],evaluator:'a',
  });
  const contrast=createRsiCrossLineageContrast({target_trajectory:target,reference_trajectory:reference});
  verifyRsiCrossLineageContrast(contrast);
  assert.equal(contrast.same_task_comparison,true);
  assert.equal(contrast.distinct_lineage_required,true);
  assert.equal(contrast.target_failure_required,true);
  assert.equal(contrast.reference_success_required,true);
  assert.deepEqual(contrast.target_failure_codes,['BAD_TOOL_ROUTING']);
  assert.deepEqual(contrast.reference_success_mechanism_codes,['RESULT_READBACK','VERIFY_BEFORE_MUTATE']);
  assert.equal(contrast.candidate_can_select_reference,false);
  assert.equal(contrast.contrast_is_mutation_authority,false);

  assert.throws(()=>createRsiCrossLineageContrast({
    target_trajectory:target,
    reference_trajectory:trajectory({
      id:'wrong.task',candidate:'2',lineage:'lineage.b',task:'task.other',
      outcome:'PASS',failures:[],successes:['RESULT_READBACK'],evaluator:'a',
    }),
  }),/same_task_required/);
  assert.throws(()=>createRsiCrossLineageContrast({
    target_trajectory:target,
    reference_trajectory:trajectory({
      id:'same.lineage',candidate:'2',lineage:'lineage.a',task:'task.shared',
      outcome:'PASS',failures:[],successes:['RESULT_READBACK'],evaluator:'a',
    }),
  }),/distinct_lineage_required/);
});

test('comparative portfolio prefers reaction-norm and cross-lineage operators while preserving clonal fallback',()=>{
  const target=trajectory({
    id:'target.fail',candidate:'1',lineage:'lineage.a',task:'task.shared',
    outcome:'FAIL',failures:['BAD_TOOL_ROUTING'],successes:[],evaluator:'a',
  });
  const profile=createRsiReactionNormProfile({trajectories:[
    target,
    trajectory({id:'t.2',candidate:'1',lineage:'lineage.a',task:'task.two',failures:['BAD_TOOL_ROUTING'],evaluator:'a'}),
  ]});
  const contrast=createRsiCrossLineageContrast({
    target_trajectory:target,
    reference_trajectory:trajectory({
      id:'ref',candidate:'2',lineage:'lineage.b',task:'task.shared',
      outcome:'PASS',failures:[],successes:['RESULT_READBACK'],evaluator:'a',
    }),
  });
  const portfolio=createRsiComparativeMutationPortfolio({
    target_trajectory:target,
    reaction_norm_profile:profile,
    cross_lineage_contrasts:[contrast],
    generation:18,
    max_proposals:3,
  });
  verifyRsiComparativeMutationPortfolio(portfolio);
  assert.deepEqual(portfolio.proposals.map((row)=>row.operator),[
    'REACTION_NORM','CROSS_LINEAGE_HYBRID','CLONAL',
  ]);
  assert.equal(portfolio.comparative_evidence_preferred_when_available,true);
  assert.equal(portfolio.clonal_fallback_preserved,true);
  assert.equal(portfolio.reaction_norm_requires_multi_task_evidence,true);
  assert.equal(portfolio.cross_lineage_requires_same_task_fail_pass,true);
  assert.equal(portfolio.scheduler_action_authorized,false);
  assert.equal(portfolio.candidate_can_select_operator,false);
  assert.equal(portfolio.candidate_can_select_reference,false);
  for(const proposal of portfolio.proposals){
    assert.equal(proposal.candidate_can_materialize_directly,false);
    assert.equal(proposal.proposal_is_scheduler_authority,false);
    assert.equal(proposal.authority_effect,false);
  }
});

test('portfolio falls back to one clonal proposal when comparative evidence is absent',()=>{
  const target=trajectory({id:'target.only',task:'task.only'});
  const portfolio=createRsiComparativeMutationPortfolio({
    target_trajectory:target,
    generation:19,
    max_proposals:3,
  });
  assert.equal(portfolio.proposal_count,1);
  assert.equal(portfolio.proposals[0].operator,'CLONAL');
  assert.equal(portfolio.proposals[0].rationale_source,'SINGLE_EXTERNALLY_VERIFIED_FAILURE');
});

test('candidate cannot smuggle pass-success or fail-success evidence across operator boundary',()=>{
  assert.throws(()=>trajectory({
    id:'bad.pass',outcome:'PASS',failures:['FAKE_FAILURE'],successes:['GOOD'],
  }),/pass_failure_codes_forbidden/);
  assert.throws(()=>trajectory({
    id:'bad.fail',outcome:'FAIL',failures:['BAD'],successes:['FAKE_SUCCESS'],
  }),/fail_success_codes_forbidden/);
});

test('exact same evidence generation deterministically reproduces comparative portfolio',()=>{
  const target=trajectory({id:'replay.target',task:'task.shared',failures:['X']});
  const ref=trajectory({
    id:'replay.ref',candidate:'2',lineage:'lineage.b',task:'task.shared',
    outcome:'PASS',failures:[],successes:['Y'],evaluator:'a',
  });
  const contrast=createRsiCrossLineageContrast({target_trajectory:target,reference_trajectory:ref});
  const input={
    target_trajectory:target,
    cross_lineage_contrasts:[contrast],
    generation:20,
    max_proposals:2,
  };
  const left=createRsiComparativeMutationPortfolio(input);
  const right=createRsiComparativeMutationPortfolio(input);
  assert.equal(left.portfolio_digest,right.portfolio_digest);
  assert.deepEqual(left.proposals,right.proposals);
});

test('comparative lineage trust root freezes operator/reference authority outside candidate',()=>{
  const root=rsiComparativeLineageTrustRootSnapshot();
  assert.deepEqual(root.operators,['CLONAL','REACTION_NORM','CROSS_LINEAGE_HYBRID']);
  assert.equal(root.reaction_norm_requires_multi_task_evidence,true);
  assert.equal(root.cross_lineage_requires_same_task_fail_pass,true);
  assert.equal(root.raw_trajectory_shared_with_candidate,false);
  assert.equal(root.external_evaluator_required,true);
  assert.equal(root.candidate_can_select_operator,false);
  assert.equal(root.candidate_can_select_reference,false);
  assert.equal(root.mutation_plan_materialization_external,true);
  assert.equal(root.scheduler_action_authorized,false);
  assert.equal(root.execution_authority,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.lineage_root_digest,/^sha256:[0-9a-f]{64}$/);
});
