import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateComputeGovernancePr,
  expectedLevel1ForBranch,
} from '../../../coordination/devos/compute-governance-pr-contract.mjs';

const BRANCH='work/browser-final-2026-convergence-rsi-example-v1';

function readyBody({
  branch=BRANCH,
  level='CROSS-CUTTING',
  checked=true,
}={}) {
  const mark=checked?'x':' ';
  return [
    '## Roadmap binding',
    '',
    '- Canonical Level-1 milestone: ' + level,
    '- Level-2 milestone: RSI_CANONICAL_REPAIR_R4',
    '- Canonical acceptance criterion advanced: mechanically enforced merge evidence',
    '- Why this moves the project toward real compute rather than control-plane-only complexity: prevents unqualified self-modification from entering main',
    '',
    '## Workstream',
    '',
    '- Supervisor baseline checkpoint: RSI_MAIN_85767548',
    '- Assigned branch: ' + branch,
    '- Base semantic checkpoint: RSI_POST_821_CANONICAL_REPAIR',
    '',
    '## Evidence',
    '',
    '- [' + mark + '] Positive tests pass',
    '- [' + mark + '] Fail-closed/adversarial negative canaries pass',
    '- [' + mark + '] LIVE / SYNTHETIC / CONTROL_PLANE_ONLY / SCHEMA_ONLY / HISTORICAL evidence is clearly labeled',
    '- [' + mark + '] Deep amplifier research completed for the semantic step',
    '- [' + mark + '] Amplifier candidates are classified ADOPT_NOW / EXPERIMENT / DEFER / REJECT',
    '- [' + mark + '] Supabase security advisor reviewed after DDL changes',
    '- [' + mark + '] Supabase performance advisor reviewed after DDL changes',
    '- [' + mark + '] No unapproved mutation-domain overlap',
    '- [' + mark + '] Dependency gates satisfied',
    '- [' + mark + '] Level-2 work remains subordinate to `docs/CANONICAL_ROADMAP.md`',
    '',
    '## Integration',
    '',
    '- Risks / unresolved questions: repository ruleset activation remains external',
    '- Rollback or fail-closed behavior: any missing evidence blocks merge eligibility',
  ].join('\n');
}

test('browser convergence branches are registered as CROSS-CUTTING',()=>{
  assert.equal(expectedLevel1ForBranch(BRANCH),'CROSS-CUTTING');
});

test('ready PR with complete durable evidence contract is merge-eligible',()=>{
  const result=evaluateComputeGovernancePr({
    baseRef:'main',
    headRef:BRANCH,
    body:readyBody(),
    draft:false,
  });
  assert.equal(result.valid_for_current_state,true);
  assert.equal(result.eligible_for_merge,true);
  assert.deepEqual(result.blockers,[]);
  assert.equal(result.authority_effect,false);
  assert.equal(result.scheduler_authority,false);
  assert.equal(result.execution_authority,false);
  assert.equal(result.promotion_authority,false);
});

test('draft may retain ready-only evidence as advisory but core identity is mandatory',()=>{
  const body=[
    'Canonical Level-1 milestone: CROSS-CUTTING',
    'Level-2 milestone: RSI_CANONICAL_REPAIR_R4',
    'Supervisor baseline checkpoint: CP_R4',
    'Assigned branch: ' + BRANCH,
    'Base semantic checkpoint: BASE_R4',
  ].join('\n');
  const result=evaluateComputeGovernancePr({
    baseRef:'main',
    headRef:BRANCH,
    body,
    draft:true,
  });
  assert.equal(result.valid_for_current_state,true);
  assert.equal(result.eligible_for_merge,false);
  assert.ok(result.advisories.some((item)=>item.startsWith('EVIDENCE_PENDING:')));
});

test('single-line template placeholders cannot satisfy core identity',()=>{
  const body=[
    '- Canonical Level-1 milestone: <!-- R1 / C1..C17 / F1+ / CROSS-CUTTING -->',
    '- Level-2 milestone: <!-- e.g. RSI_CANONICAL_REPAIR_R4 -->',
    '- Supervisor baseline checkpoint:',
    '- Assigned branch:',
    '- Base semantic checkpoint:',
  ].join('\n');
  const result=evaluateComputeGovernancePr({
    baseRef:'main',
    headRef:BRANCH,
    body,
    draft:true,
  });
  assert.equal(result.valid_for_current_state,false);
  assert.ok(result.blockers.some((item)=>item.startsWith('MISSING_CORE_FIELD:')));
});

test('multiline placeholder comments are removed before field evaluation',()=>{
  const body=[
    '- Canonical Level-1 milestone: <!--',
    '  CROSS-CUTTING',
    '-->',
    '- Level-2 milestone: RSI_CANONICAL_REPAIR_R4',
    '- Supervisor baseline checkpoint: CP_R4',
    '- Assigned branch: ' + BRANCH,
    '- Base semantic checkpoint: BASE_R4',
  ].join('\n');
  const result=evaluateComputeGovernancePr({
    baseRef:'main',
    headRef:BRANCH,
    body,
    draft:true,
  });
  assert.equal(result.valid_for_current_state,false);
  assert.ok(result.blockers.includes('MISSING_CORE_FIELD:Canonical Level-1 milestone'));
});

test('malformed HTML comment fails closed',()=>{
  const body=[
    '- Canonical Level-1 milestone: CROSS-CUTTING',
    '- Level-2 milestone: RSI_CANONICAL_REPAIR_R4',
    '- Supervisor baseline checkpoint: CP_R4',
    '- Assigned branch: ' + BRANCH,
    '- Base semantic checkpoint: BASE_R4',
    '<!-- unterminated governance note',
  ].join('\n');
  const result=evaluateComputeGovernancePr({
    baseRef:'main',
    headRef:BRANCH,
    body,
    draft:true,
  });
  assert.equal(result.valid_for_current_state,false);
  assert.ok(result.blockers.includes('MALFORMED_HTML_COMMENT'));
});

test('assigned branch mismatch fails closed',()=>{
  const result=evaluateComputeGovernancePr({
    baseRef:'main',
    headRef:BRANCH,
    body:readyBody({branch:'work/browser-final-2026-convergence-other'}),
    draft:false,
  });
  assert.equal(result.valid_for_current_state,false);
  assert.ok(result.blockers.includes('ASSIGNED_BRANCH_MISMATCH'));
});

test('ready PR with unchecked evidence cannot be merge-eligible',()=>{
  const result=evaluateComputeGovernancePr({
    baseRef:'main',
    headRef:BRANCH,
    body:readyBody({checked:false}),
    draft:false,
  });
  assert.equal(result.valid_for_current_state,false);
  assert.equal(result.eligible_for_merge,false);
  assert.ok(result.blockers.some((item)=>item.startsWith('UNCHECKED_EVIDENCE:')));
});

test('unknown branch and non-main base both fail closed',()=>{
  const result=evaluateComputeGovernancePr({
    baseRef:'release',
    headRef:'work/unregistered-rsi-branch',
    body:readyBody({branch:'work/unregistered-rsi-branch'}),
    draft:false,
  });
  assert.ok(result.blockers.includes('BASE_MUST_BE_MAIN'));
  assert.ok(result.blockers.includes('UNREGISTERED_WORKSTREAM'));
});
