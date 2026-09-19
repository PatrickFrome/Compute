import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateRsiPhysicalMergeGate,
  rsiPhysicalMergeGateTrustRootSnapshot,
} from '../../../coordination/devos/compute-governance-physical-merge-gate.mjs';

function branch(contexts=[]){
  return {
    name:'main',
    protected:true,
    protection:{
      required_status_checks:{
        enforcement_level:'non_admins',
        contexts,
        checks:contexts.map((context)=>({context,app_id:null})),
      },
    },
  };
}
function ruleset({
  enforcement='active',
  include=['~DEFAULT_BRANCH'],
  contexts=['governance'],
  bypass=[],
  current='never',
}={}){
  return {
    id:1,
    name:'metaengine-governance',
    target:'branch',
    enforcement,
    conditions:{ref_name:{include,exclude:[]}},
    rules:[{
      type:'required_status_checks',
      parameters:{
        strict_required_status_checks_policy:true,
        required_status_checks:contexts.map((context)=>({context,integration_id:null})),
      },
    }],
    bypass_actors:bypass,
    current_user_can_bypass:current,
  };
}

test('required governance context in branch protection proves mechanical gate',()=>{
  const result=evaluateRsiPhysicalMergeGate({
    repository:'PatrickFrome/Compute',
    branch_readback:branch(['governance']),
    ruleset_readbacks:[],
  });
  assert.equal(result.physical_merge_gate_enforced,true);
  assert.equal(result.eligible_for_governed_merge_claim,true);
  assert.deepEqual(result.blockers,[]);
  assert.equal(result.authority_effect,false);
  assert.equal(result.promotion_authority,false);
});

test('active default-branch ruleset can mechanically require governance',()=>{
  const result=evaluateRsiPhysicalMergeGate({
    repository:'PatrickFrome/Compute',
    branch_readback:branch([]),
    ruleset_readbacks:[ruleset()],
  });
  assert.equal(result.physical_merge_gate_enforced,true);
  assert.equal(result.active_ruleset_requires_governance,true);
});

test('disabled ruleset does not prove governance enforcement',()=>{
  const result=evaluateRsiPhysicalMergeGate({
    repository:'PatrickFrome/Compute',
    branch_readback:branch([]),
    ruleset_readbacks:[ruleset({enforcement:'disabled',contexts:[]})],
  });
  assert.equal(result.physical_merge_gate_enforced,false);
  assert.ok(result.blockers.includes('GOVERNANCE_CHECK_NOT_MECHANICALLY_REQUIRED'));
});

test('successful workflow existence without required status context is insufficient',()=>{
  const result=evaluateRsiPhysicalMergeGate({
    repository:'PatrickFrome/Compute',
    branch_readback:branch([]),
    ruleset_readbacks:[],
  });
  assert.equal(result.state,'PHYSICAL_MERGE_GATE_NOT_PROVEN');
  assert.equal(result.eligible_for_governed_merge_claim,false);
});

test('ruleset targeting a different branch is ignored',()=>{
  const result=evaluateRsiPhysicalMergeGate({
    repository:'PatrickFrome/Compute',
    branch_readback:branch([]),
    ruleset_readbacks:[ruleset({include:['refs/heads/release']})],
  });
  assert.equal(result.active_ruleset_requires_governance,false);
  assert.equal(result.physical_merge_gate_enforced,false);
});

test('ruleset bypass actors prevent absolute physical-gate proof',()=>{
  const result=evaluateRsiPhysicalMergeGate({
    repository:'PatrickFrome/Compute',
    branch_readback:branch([]),
    ruleset_readbacks:[ruleset({bypass:[{actor_id:1,actor_type:'RepositoryRole'}]})],
  });
  assert.equal(result.physical_merge_gate_enforced,false);
  assert.ok(result.blockers.includes('GOVERNANCE_CHECK_NOT_MECHANICALLY_REQUIRED'));
});

test('current-user always-bypass prevents physical-gate proof',()=>{
  const result=evaluateRsiPhysicalMergeGate({
    repository:'PatrickFrome/Compute',
    branch_readback:branch([]),
    ruleset_readbacks:[ruleset({current:'always'})],
  });
  assert.equal(result.physical_merge_gate_enforced,false);
});

test('unprotected main fails closed even if supplied status context matches',()=>{
  const readback=branch(['governance']);
  readback.protected=false;
  const result=evaluateRsiPhysicalMergeGate({
    repository:'PatrickFrome/Compute',
    branch_readback:readback,
    ruleset_readbacks:[],
  });
  assert.equal(result.physical_merge_gate_enforced,false);
  assert.ok(result.blockers.includes('MAIN_BRANCH_NOT_PROTECTED'));
});

test('expected check name is frozen by the trust root',()=>{
  assert.throws(
    ()=>evaluateRsiPhysicalMergeGate({
      repository:'PatrickFrome/Compute',
      branch_readback:branch(['anything']),
      ruleset_readbacks:[],
      expected_governance_check:'anything',
    }),
    /expected_check_not_frozen/,
  );
});

test('trust root makes workflow-only evidence explicitly insufficient',()=>{
  const root=rsiPhysicalMergeGateTrustRootSnapshot();
  assert.equal(root.expected_governance_check,'governance');
  assert.equal(root.active_enforcement_required,true);
  assert.equal(root.no_ruleset_bypass_actor_required,true);
  assert.equal(root.workflow_success_without_required_check_is_insufficient,true);
  assert.equal(root.candidate_cannot_select_check_name,true);
  assert.equal(root.authority_effect,false);
  assert.equal(root.promotion_authority,false);
});
