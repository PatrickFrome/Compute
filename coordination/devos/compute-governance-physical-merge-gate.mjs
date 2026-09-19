export const RSI_PHYSICAL_MERGE_GATE_SCHEMA =
  'metaengine.rsi.physical-merge-gate.v1';

const EXPECTED_REPOSITORY='PatrickFrome/Compute';
const EXPECTED_TARGET_REF='refs/heads/main';
const EXPECTED_GOVERNANCE_CHECK='governance';

function plain(value,label){
  if(!value||typeof value!=='object'||Array.isArray(value)){
    throw new Error(`rsi_physical_merge_gate_${label}_invalid`);
  }
  return value;
}
function list(value,label){
  if(!Array.isArray(value)) throw new Error(`rsi_physical_merge_gate_${label}_invalid`);
  return value;
}
function text(value,label){
  const out=String(value||'').trim();
  if(!out) throw new Error(`rsi_physical_merge_gate_${label}_invalid`);
  return out;
}
function zero(extra={}){
  return Object.freeze({
    ...extra,
    execution_authority:false,
    browser_authority:false,
    task_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    signing_authority:false,
    direct_tool_execution_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  });
}
function branchRuleTargetsMain(rule){
  const include=rule?.conditions?.ref_name?.include;
  if(!Array.isArray(include)) return false;
  return include.some((entry)=>{
    const value=String(entry||'').trim();
    return value==='~DEFAULT_BRANCH'
      ||value==='main'
      ||value==='refs/heads/main';
  });
}
function requiredContexts(rule){
  if(rule?.type!=='required_status_checks') return [];
  const checks=rule?.parameters?.required_status_checks;
  if(!Array.isArray(checks)) return [];
  return checks.map((row)=>String(row?.context||'').trim()).filter(Boolean);
}
function rulesetEvidence(rulesets){
  const matches=[];
  for(const candidate of rulesets){
    const ruleSet=plain(candidate,'ruleset');
    if(ruleSet.target!=='branch') continue;
    if(ruleSet.enforcement!=='active') continue;
    if(!branchRuleTargetsMain(ruleSet)) continue;
    const contexts=[];
    for(const rule of list(ruleSet.rules||[],'rules')){
      contexts.push(...requiredContexts(rule));
    }
    const bypassActors=Array.isArray(ruleSet.bypass_actors)?ruleSet.bypass_actors:[];
    matches.push(Object.freeze({
      id:ruleSet.id,
      name:String(ruleSet.name||''),
      enforcement:ruleSet.enforcement,
      contexts:Object.freeze([...new Set(contexts)].sort()),
      bypass_actor_count:bypassActors.length,
      current_user_can_bypass:String(ruleSet.current_user_can_bypass||'unknown'),
    }));
  }
  return Object.freeze(matches);
}
function branchProtectionContexts(branch){
  const required=branch?.protection?.required_status_checks;
  const values=[];
  for(const value of Array.isArray(required?.contexts)?required.contexts:[]){
    const context=String(value||'').trim();
    if(context) values.push(context);
  }
  for(const row of Array.isArray(required?.checks)?required.checks:[]){
    const context=String(row?.context||'').trim();
    if(context) values.push(context);
  }
  return Object.freeze([...new Set(values)].sort());
}

export function evaluateRsiPhysicalMergeGate({
  repository,
  target_ref=EXPECTED_TARGET_REF,
  branch_readback,
  ruleset_readbacks=[],
  expected_governance_check=EXPECTED_GOVERNANCE_CHECK,
}={}){
  if(text(repository,'repository')!==EXPECTED_REPOSITORY){
    throw new Error('rsi_physical_merge_gate_repository_mismatch');
  }
  if(text(target_ref,'target_ref')!==EXPECTED_TARGET_REF){
    throw new Error('rsi_physical_merge_gate_target_ref_mismatch');
  }
  const branch=plain(branch_readback,'branch_readback');
  if(branch.name!=='main') throw new Error('rsi_physical_merge_gate_branch_name_mismatch');

  const expected=text(expected_governance_check,'expected_check');
  if(expected!==EXPECTED_GOVERNANCE_CHECK){
    throw new Error('rsi_physical_merge_gate_expected_check_not_frozen');
  }

  const blockers=[];
  if(branch.protected!==true) blockers.push('MAIN_BRANCH_NOT_PROTECTED');

  const branchContexts=branchProtectionContexts(branch);
  const rulesets=rulesetEvidence(list(ruleset_readbacks,'ruleset_readbacks'));

  const branchProtectionRequiresGovernance=branchContexts.includes(expected);
  const activeRulesetsWithGovernance=rulesets.filter((row)=>
    row.contexts.includes(expected)
    &&row.bypass_actor_count===0
    &&row.current_user_can_bypass!=='always'
  );

  if(!branchProtectionRequiresGovernance && activeRulesetsWithGovernance.length===0){
    blockers.push('GOVERNANCE_CHECK_NOT_MECHANICALLY_REQUIRED');
  }

  const physical=blockers.length===0;
  return zero({
    schema:RSI_PHYSICAL_MERGE_GATE_SCHEMA,
    version:1,
    repository:EXPECTED_REPOSITORY,
    target_ref:EXPECTED_TARGET_REF,
    expected_governance_check:EXPECTED_GOVERNANCE_CHECK,
    branch_protected:branch.protected===true,
    branch_required_status_contexts:branchContexts,
    active_targeting_rulesets:rulesets,
    branch_protection_requires_governance:branchProtectionRequiresGovernance,
    active_ruleset_requires_governance:activeRulesetsWithGovernance.length>0,
    blockers:Object.freeze(blockers.sort()),
    state:physical?'PHYSICAL_MERGE_GATE_ENFORCED':'PHYSICAL_MERGE_GATE_NOT_PROVEN',
    physical_merge_gate_enforced:physical,
    eligible_for_governed_merge_claim:physical,
  });
}

export function rsiPhysicalMergeGateTrustRootSnapshot(){
  return zero({
    schema:'metaengine.rsi.physical-merge-gate-root.v1',
    version:1,
    repository:EXPECTED_REPOSITORY,
    target_ref:EXPECTED_TARGET_REF,
    expected_governance_check:EXPECTED_GOVERNANCE_CHECK,
    active_enforcement_required:true,
    no_ruleset_bypass_actor_required:true,
    workflow_success_without_required_check_is_insufficient:true,
    candidate_cannot_select_check_name:true,
  });
}
