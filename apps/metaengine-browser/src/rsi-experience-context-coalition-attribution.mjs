import crypto from 'node:crypto';

import {
  verifyRsiExperienceContextAttributionPlan,
  verifyRsiExperienceContextAttributionResult,
} from './rsi-experience-context-ablation-attribution.mjs';

export const RSI_EXPERIENCE_COALITION_PLAN_SCHEMA =
  'metaengine.rsi.experience-coalition-plan.v1';
export const RSI_EXPERIENCE_COALITION_RECEIPT_SCHEMA =
  'metaengine.rsi.experience-coalition-receipt.v1';
export const RSI_EXPERIENCE_COALITION_RESULT_SCHEMA =
  'metaengine.rsi.experience-coalition-result.v1';

const D=/^sha256:[0-9a-f]{64}$/;
const I=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const T=/^[A-Z0-9][A-Z0-9_.:-]{0,95}$/;
const DIR=new Set(['HIGHER_BETTER','LOWER_BETTER']);
const MAX_CASES=12;
const MAX_PERMUTATIONS=4;
const MAX_COALITIONS=48;
const MAX_REFS=24;

function stable(v){
  if(Array.isArray(v))return v.map(stable);
  if(!v||typeof v!=='object')return v;
  return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));
}
function digest(v){
  return 'sha256:'+crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex');
}
function pd(v,l){
  const x=String(v||'').trim().toLowerCase();
  if(!D.test(x))throw new Error('rsi_coalition_'+l+'_digest_invalid');
  return x;
}
function id(v,l){
  const x=String(v||'').trim();
  if(!I.test(x))throw new Error('rsi_coalition_'+l+'_invalid');
  return x;
}
function tok(v,l){
  const x=String(v||'').trim().toUpperCase();
  if(!T.test(x))throw new Error('rsi_coalition_'+l+'_invalid');
  return x;
}
function num(v,l){
  const x=Number(v);
  if(!Number.isFinite(x))throw new Error('rsi_coalition_'+l+'_invalid');
  return x;
}
function nonneg(v,l){
  const x=num(v,l);
  if(x<0)throw new Error('rsi_coalition_'+l+'_invalid');
  return x;
}
function refs(v){
  if(!Array.isArray(v)||v.length<1||v.length>MAX_REFS){
    throw new Error('rsi_coalition_evidence_refs_invalid');
  }
  const out=v.map(x=>id(x,'evidence_ref')).sort();
  if(new Set(out).size!==out.length)throw new Error('rsi_coalition_evidence_ref_duplicate');
  return Object.freeze(out);
}
function zero(extra={}){
  return Object.freeze({...extra,
    execution_authority:false,browser_authority:false,scheduler_authority:false,task_authority:false,
    production_mutation_authority:false,promotion_authority:false,release_authority:false,
    self_update_authority:false,automatic_retry_allowed:false,authority_effect:false});
}
function assertZero(v,l){
  for(const f of ['execution_authority','browser_authority','scheduler_authority','task_authority',
    'production_mutation_authority','promotion_authority','release_authority','self_update_authority','authority_effect']){
    if(Object.hasOwn(v||{},f)&&v[f]!==false)throw new Error('rsi_coalition_'+l+'_'+f+'_invalid');
  }
  if(Object.hasOwn(v||{},'automatic_retry_allowed')&&v.automatic_retry_allowed!==false){
    throw new Error('rsi_coalition_'+l+'_automatic_retry_invalid');
  }
}
function normalizeSpec(v){
  if(!Array.isArray(v)||v.length<1||v.length>12)throw new Error('rsi_coalition_objective_spec_invalid');
  const out=v.map(row=>{
    const metric=tok(row?.metric,'metric');
    const direction=tok(row?.direction,'direction');
    if(!DIR.has(direction))throw new Error('rsi_coalition_direction_invalid');
    return Object.freeze({metric,direction,epsilon:nonneg(row?.epsilon??0,'epsilon')});
  }).sort((a,b)=>a.metric.localeCompare(b.metric));
  if(new Set(out.map(x=>x.metric)).size!==out.length)throw new Error('rsi_coalition_objective_duplicate');
  return Object.freeze(out);
}
function normalizeObjectives(v,spec){
  if(!Array.isArray(v)||v.length!==spec.length)throw new Error('rsi_coalition_objectives_invalid');
  const map=new Map();
  for(const row of v){
    const metric=tok(row?.metric,'objective_metric');
    if(map.has(metric))throw new Error('rsi_coalition_objective_duplicate');
    map.set(metric,num(row?.value,'objective_value'));
  }
  return Object.freeze(spec.map(s=>{
    if(!map.has(s.metric))throw new Error('rsi_coalition_objective_missing');
    return Object.freeze({metric:s.metric,value:map.get(s.metric)});
  }));
}
function uniqueOrders(cases){
  const base=[...cases].sort((a,b)=>a.case_id.localeCompare(b.case_id));
  const candidates=[];
  const add=arr=>{
    const key=arr.map(x=>x.case_id).join('|');
    if(!candidates.some(row=>row.key===key))candidates.push({key,rows:arr});
  };
  add(base);
  add([...base].reverse());
  for(let shift=1;shift<base.length&&candidates.length<MAX_PERMUTATIONS;shift+=1){
    add(base.slice(shift).concat(base.slice(0,shift)));
    if(candidates.length<MAX_PERMUTATIONS){
      const rev=[...base].reverse();
      add(rev.slice(shift).concat(rev.slice(0,shift)));
    }
  }
  return candidates.slice(0,Math.min(MAX_PERMUTATIONS,Math.max(2,base.length))).map(x=>x.rows);
}
function coalitionKey(rows){
  return [...rows].map(x=>x.case_id).sort().join('|');
}
function classifyTransition(spec,before,after){
  if(before.hard_invariants_pass!==true&&after.hard_invariants_pass===true){
    return Object.freeze({outcome:'HELPFUL',relation:'ADDING_MEMORY_RESTORES_HARD_INVARIANT',effects:[]});
  }
  if(before.hard_invariants_pass===true&&after.hard_invariants_pass!==true){
    return Object.freeze({outcome:'HARMFUL',relation:'ADDING_MEMORY_BREAKS_HARD_INVARIANT',effects:[]});
  }
  if(before.hard_invariants_pass!==true&&after.hard_invariants_pass!==true){
    return Object.freeze({outcome:'AMBIGUOUS',relation:'BOTH_COALITIONS_FAIL_HARD_INVARIANTS',effects:[]});
  }
  let afterBetter=false;
  let beforeBetter=false;
  const effects=spec.map((s,i)=>{
    const b=before.objectives[i].value;
    const a=after.objectives[i].value;
    const signed=s.direction==='HIGHER_BETTER'?a-b:b-a;
    if(signed>s.epsilon)afterBetter=true;
    if(signed<(-s.epsilon))beforeBetter=true;
    return Object.freeze({
      metric:s.metric,direction:s.direction,epsilon:s.epsilon,
      without_memory_value:b,with_memory_value:a,
      signed_memory_marginal:signed,
    });
  });
  if(afterBetter&&!beforeBetter){
    return Object.freeze({outcome:'HELPFUL',relation:'WITH_MEMORY_PARETO_DOMINATES',effects:Object.freeze(effects)});
  }
  if(beforeBetter&&!afterBetter){
    return Object.freeze({outcome:'HARMFUL',relation:'WITHOUT_MEMORY_PARETO_DOMINATES',effects:Object.freeze(effects)});
  }
  if(afterBetter&&beforeBetter){
    return Object.freeze({outcome:'AMBIGUOUS',relation:'OBJECTIVE_TRADEOFF',effects:Object.freeze(effects)});
  }
  return Object.freeze({outcome:'NEUTRAL',relation:'NO_CLEAR_MARGINAL_EFFECT',effects:Object.freeze(effects)});
}

export function createRsiExperienceCoalitionPlan({
  single_memory_plan,
  single_memory_result,
  coalition_protocol_digest,
  external_planner=false,
  authored_by_candidate=true,
}={}){
  const singlePlan=verifyRsiExperienceContextAttributionPlan(single_memory_plan);
  const singleResult=verifyRsiExperienceContextAttributionResult(single_memory_result);
  if(singleResult.plan_digest!==singlePlan.plan_digest
    ||singleResult.context_plan_digest!==singlePlan.context_plan_digest
    ||singleResult.target_context_digest!==singlePlan.target_context_digest){
    throw new Error('rsi_coalition_single_attribution_binding_mismatch');
  }
  if(singleResult.state!=='AMBIGUOUS_INTERACTIONS_HOLD'
    ||singleResult.ambiguous_interactions_present!==true
    ||singlePlan.selected_case_count<2){
    throw new Error('rsi_coalition_ambiguous_single_memory_result_required');
  }
  if(external_planner!==true||authored_by_candidate!==false){
    throw new Error('rsi_coalition_external_planner_required');
  }
  const protocol=pd(coalition_protocol_digest,'protocol');
  const selected=[...singlePlan.selected_cases].sort((a,b)=>a.case_id.localeCompare(b.case_id));
  if(selected.length>MAX_CASES)throw new Error('rsi_coalition_case_count_invalid');
  const orders=uniqueOrders(selected);
  const coalitionMap=new Map();
  function ensureCoalition(rows){
    const sorted=[...rows].sort((a,b)=>a.case_id.localeCompare(b.case_id));
    const key=coalitionKey(sorted);
    if(coalitionMap.has(key))return coalitionMap.get(key);
    const material={
      single_memory_plan_digest:singlePlan.plan_digest,
      single_memory_result_digest:singleResult.result_digest,
      coalition_protocol_digest:protocol,
      retained_case_digests:sorted.map(x=>x.case_digest).sort(),
    };
    const cd=digest(material);
    const all=new Map(selected.map(x=>[x.case_id,x.case_digest]));
    const retained=new Set(sorted.map(x=>x.case_id));
    const removed=[...all.entries()]
      .filter(([caseId])=>!retained.has(caseId))
      .map(([case_id,case_digest])=>Object.freeze({case_id,case_digest}))
      .sort((a,b)=>a.case_id.localeCompare(b.case_id));
    const row=Object.freeze({
      coalition_id:'rsi_mem_coalition_'+cd.slice(7,31),
      coalition_digest:cd,
      retained_cases:Object.freeze(sorted.map(x=>Object.freeze({case_id:x.case_id,case_digest:x.case_digest}))),
      removed_cases:Object.freeze(removed),
      retained_case_count:sorted.length,
      removed_case_count:removed.length,
      exact_selected_case_partition:true,
      scheduler_action_authorized:false,
      authority_effect:false,
    });
    coalitionMap.set(key,row);
    return row;
  }
  const permutations=orders.map((order,pIndex)=>{
    const states=[];
    for(let k=0;k<=order.length;k+=1){
      states.push(ensureCoalition(order.slice(0,k)));
    }
    return Object.freeze({
      permutation_index:pIndex+1,
      order:Object.freeze(order.map(x=>Object.freeze({case_id:x.case_id,case_digest:x.case_digest}))),
      coalition_ids:Object.freeze(states.map(x=>x.coalition_id)),
      transition_count:order.length,
      authority_effect:false,
    });
  });
  const coalitions=[...coalitionMap.values()].sort((a,b)=>a.coalition_id.localeCompare(b.coalition_id));
  if(coalitions.length>MAX_COALITIONS)throw new Error('rsi_coalition_plan_capacity_exceeded');
  const core=zero({
    schema:RSI_EXPERIENCE_COALITION_PLAN_SCHEMA,version:1,
    single_memory_plan_digest:singlePlan.plan_digest,
    single_memory_result_digest:singleResult.result_digest,
    context_plan_digest:singlePlan.context_plan_digest,
    target_context_digest:singlePlan.target_context_digest,
    graph_snapshot_digest:singlePlan.graph_snapshot_digest,
    evaluation_protocol_digest:singlePlan.evaluation_protocol_digest,
    coalition_protocol_digest:protocol,
    objective_spec:singlePlan.objective_spec,
    selected_cases:Object.freeze(selected),
    selected_case_count:selected.length,
    permutation_count:permutations.length,
    permutations:Object.freeze(permutations),
    coalition_count:coalitions.length,
    coalitions:Object.freeze(coalitions),
    attribution_method:'DETERMINISTIC_PERMUTATION_MARGINAL_V1',
    full_shapley_claimed:false,
    causal_claim_scope:'MATCHED_SAMPLED_COALITION_MARGINALS',
    ambiguous_single_memory_attribution_required:true,
    all_states_precommitted:true,
    external_planner:true,authored_by_candidate:false,
    candidate_can_select_permutations:false,
    candidate_can_select_coalitions:false,
    interaction_scores_are_authority:false,
    graph_write_performed:false,
  });
  return Object.freeze({...core,plan_digest:digest(core)});
}

export function verifyRsiExperienceCoalitionPlan(row){
  if(!row||row.schema!==RSI_EXPERIENCE_COALITION_PLAN_SCHEMA||row.version!==1){
    throw new Error('rsi_coalition_plan_schema_invalid');
  }
  assertZero(row,'plan');
  if(row.attribution_method!=='DETERMINISTIC_PERMUTATION_MARGINAL_V1'
    ||row.full_shapley_claimed!==false
    ||row.causal_claim_scope!=='MATCHED_SAMPLED_COALITION_MARGINALS'
    ||row.ambiguous_single_memory_attribution_required!==true
    ||row.all_states_precommitted!==true
    ||row.external_planner!==true||row.authored_by_candidate!==false
    ||row.candidate_can_select_permutations!==false||row.candidate_can_select_coalitions!==false
    ||row.interaction_scores_are_authority!==false||row.graph_write_performed!==false){
    throw new Error('rsi_coalition_plan_policy_invalid');
  }
  for(const f of ['single_memory_plan_digest','single_memory_result_digest','context_plan_digest',
    'target_context_digest','graph_snapshot_digest','evaluation_protocol_digest','coalition_protocol_digest']){
    pd(row[f],f);
  }
  const spec=normalizeSpec(row.objective_spec);
  if(!Array.isArray(row.selected_cases)||row.selected_case_count!==row.selected_cases.length
    ||row.selected_case_count<2||row.selected_case_count>MAX_CASES){
    throw new Error('rsi_coalition_selected_cases_invalid');
  }
  const selected=new Map(row.selected_cases.map(x=>[id(x.case_id,'case_id'),pd(x.case_digest,'case')]));
  if(selected.size!==row.selected_case_count)throw new Error('rsi_coalition_selected_case_duplicate');
  if(!Array.isArray(row.coalitions)||row.coalition_count!==row.coalitions.length
    ||row.coalition_count<3||row.coalition_count>MAX_COALITIONS){
    throw new Error('rsi_coalition_coalitions_invalid');
  }
  const coalitionIds=new Set();
  const coalitionById=new Map();
  for(const coalition of row.coalitions){
    const coalitionId=id(coalition.coalition_id,'coalition_id');
    if(coalitionIds.has(coalitionId))throw new Error('rsi_coalition_duplicate');
    coalitionIds.add(coalitionId);
    pd(coalition.coalition_digest,'coalition');
    if(coalition.exact_selected_case_partition!==true
      ||coalition.scheduler_action_authorized!==false||coalition.authority_effect!==false){
      throw new Error('rsi_coalition_partition_policy_invalid');
    }
    const retained=new Map((coalition.retained_cases||[]).map(x=>[id(x.case_id,'retained_case'),pd(x.case_digest,'retained_case')]));
    const removed=new Map((coalition.removed_cases||[]).map(x=>[id(x.case_id,'removed_case'),pd(x.case_digest,'removed_case')]));
    if(retained.size!==coalition.retained_case_count||removed.size!==coalition.removed_case_count
      ||retained.size+removed.size!==selected.size){
      throw new Error('rsi_coalition_partition_count_invalid');
    }
    for(const [caseId,caseDigest] of selected){
      const inRetained=retained.get(caseId)===caseDigest;
      const inRemoved=removed.get(caseId)===caseDigest;
      if(inRetained===inRemoved)throw new Error('rsi_coalition_partition_invalid');
    }
    coalitionById.set(coalitionId,coalition);
  }
  if(!Array.isArray(row.permutations)||row.permutation_count!==row.permutations.length
    ||row.permutation_count<2||row.permutation_count>MAX_PERMUTATIONS){
    throw new Error('rsi_coalition_permutations_invalid');
  }
  const orderKeys=new Set();
  for(const perm of row.permutations){
    const order=(perm.order||[]).map(x=>({case_id:id(x.case_id,'order_case'),case_digest:pd(x.case_digest,'order_case')}));
    if(order.length!==selected.size||new Set(order.map(x=>x.case_id)).size!==selected.size){
      throw new Error('rsi_coalition_permutation_order_invalid');
    }
    for(const x of order){
      if(selected.get(x.case_id)!==x.case_digest)throw new Error('rsi_coalition_permutation_case_mismatch');
    }
    const orderKey=order.map(x=>x.case_id).join('|');
    if(orderKeys.has(orderKey))throw new Error('rsi_coalition_permutation_duplicate');
    orderKeys.add(orderKey);
    if(!Array.isArray(perm.coalition_ids)||perm.coalition_ids.length!==selected.size+1
      ||perm.transition_count!==selected.size||perm.authority_effect!==false){
      throw new Error('rsi_coalition_permutation_shape_invalid');
    }
    for(let k=0;k<perm.coalition_ids.length;k+=1){
      const coalition=coalitionById.get(id(perm.coalition_ids[k],'permutation_coalition_id'));
      if(!coalition||coalition.retained_case_count!==k){
        throw new Error('rsi_coalition_permutation_state_invalid');
      }
      const expected=new Set(order.slice(0,k).map(x=>x.case_id));
      const actual=new Set(coalition.retained_cases.map(x=>x.case_id));
      if(expected.size!==actual.size||[...expected].some(x=>!actual.has(x))){
        throw new Error('rsi_coalition_permutation_prefix_mismatch');
      }
    }
  }
  if(spec.length!==row.objective_spec.length)throw new Error('rsi_coalition_objective_spec_invalid');
  const clone=structuredClone(row),claimed=pd(clone.plan_digest,'plan');delete clone.plan_digest;
  if(digest(clone)!==claimed)throw new Error('rsi_coalition_plan_digest_mismatch');
  return row;
}

export function createRsiExperienceCoalitionReceipt({
  plan,coalition_id,hard_invariants_pass,objectives,
  workload_digest,seed_set_digest,budget_digest,evaluator_id,
  evidence_digest,evidence_refs,external_evaluator=false,authored_by_candidate=true,
}={}){
  const checked=verifyRsiExperienceCoalitionPlan(plan);
  if(external_evaluator!==true||authored_by_candidate!==false){
    throw new Error('rsi_coalition_external_evaluator_required');
  }
  const coalition=checked.coalitions.find(x=>x.coalition_id===String(coalition_id||''));
  if(!coalition)throw new Error('rsi_coalition_id_invalid');
  if(typeof hard_invariants_pass!=='boolean')throw new Error('rsi_coalition_hard_invariant_result_required');
  const values=normalizeObjectives(objectives,normalizeSpec(checked.objective_spec));
  const core=zero({
    schema:RSI_EXPERIENCE_COALITION_RECEIPT_SCHEMA,version:1,
    plan_digest:checked.plan_digest,
    coalition_id:coalition.coalition_id,
    coalition_digest:coalition.coalition_digest,
    retained_case_count:coalition.retained_case_count,
    removed_case_count:coalition.removed_case_count,
    hard_invariants_pass,
    objectives:values,
    workload_digest:pd(workload_digest,'workload'),
    seed_set_digest:pd(seed_set_digest,'seed_set'),
    budget_digest:pd(budget_digest,'budget'),
    evaluator_id:id(evaluator_id,'evaluator_id'),
    evidence_digest:pd(evidence_digest,'evidence'),
    evidence_refs:refs(evidence_refs),
    external_evaluator:true,authored_by_candidate:false,
    matched_workload_required:true,matched_seed_set_required:true,matched_budget_required:true,
    candidate_can_edit_receipt:false,
    coalition_receipt_is_authority:false,
  });
  return Object.freeze({...core,receipt_digest:digest(core)});
}

export function verifyRsiExperienceCoalitionReceipt(row,plan){
  if(!row||row.schema!==RSI_EXPERIENCE_COALITION_RECEIPT_SCHEMA||row.version!==1){
    throw new Error('rsi_coalition_receipt_schema_invalid');
  }
  assertZero(row,'receipt');
  if(row.external_evaluator!==true||row.authored_by_candidate!==false
    ||row.matched_workload_required!==true||row.matched_seed_set_required!==true
    ||row.matched_budget_required!==true||row.candidate_can_edit_receipt!==false
    ||row.coalition_receipt_is_authority!==false){
    throw new Error('rsi_coalition_receipt_policy_invalid');
  }
  const checked=verifyRsiExperienceCoalitionPlan(plan);
  const canonical=createRsiExperienceCoalitionReceipt({
    plan:checked,coalition_id:row.coalition_id,
    hard_invariants_pass:row.hard_invariants_pass,objectives:row.objectives,
    workload_digest:row.workload_digest,seed_set_digest:row.seed_set_digest,
    budget_digest:row.budget_digest,evaluator_id:row.evaluator_id,
    evidence_digest:row.evidence_digest,evidence_refs:row.evidence_refs,
    external_evaluator:true,authored_by_candidate:false,
  });
  if(canonical.receipt_digest!==pd(row.receipt_digest,'receipt')){
    throw new Error('rsi_coalition_receipt_digest_mismatch');
  }
  return row;
}

export function finalizeRsiExperienceCoalitionAttribution({plan,receipts}={}){
  const checked=verifyRsiExperienceCoalitionPlan(plan);
  if(!Array.isArray(receipts)||receipts.length!==checked.coalition_count){
    throw new Error('rsi_coalition_receipt_set_incomplete');
  }
  const byId=new Map();
  for(const receipt of receipts){
    const row=verifyRsiExperienceCoalitionReceipt(receipt,checked);
    if(byId.has(row.coalition_id))throw new Error('rsi_coalition_receipt_duplicate');
    byId.set(row.coalition_id,row);
  }
  const ordered=checked.coalitions.map(c=>{
    const row=byId.get(c.coalition_id);
    if(!row)throw new Error('rsi_coalition_receipt_missing');
    return row;
  });
  const contracts=[
    new Set(ordered.map(x=>x.workload_digest)),
    new Set(ordered.map(x=>x.seed_set_digest)),
    new Set(ordered.map(x=>x.budget_digest)),
    new Set(ordered.map(x=>x.evaluator_id)),
  ];
  if(contracts.some(x=>x.size!==1))throw new Error('rsi_coalition_matched_evaluation_contract_mismatch');

  const spec=normalizeSpec(checked.objective_spec);
  const marginalByCase=new Map(checked.selected_cases.map(x=>[x.case_id,[]]));
  const receiptById=new Map(ordered.map(x=>[x.coalition_id,x]));
  for(const perm of checked.permutations){
    for(let k=0;k<perm.order.length;k+=1){
      const memory=perm.order[k];
      const before=receiptById.get(perm.coalition_ids[k]);
      const after=receiptById.get(perm.coalition_ids[k+1]);
      const cls=classifyTransition(spec,before,after);
      marginalByCase.get(memory.case_id).push(Object.freeze({
        permutation_index:perm.permutation_index,
        position:k+1,
        before_coalition_id:before.coalition_id,
        after_coalition_id:after.coalition_id,
        outcome:cls.outcome,
        relation:cls.relation,
        effects:cls.effects,
        before_receipt_digest:before.receipt_digest,
        after_receipt_digest:after.receipt_digest,
        authority_effect:false,
      }));
    }
  }
  const records=checked.selected_cases.map(memory=>{
    const rows=marginalByCase.get(memory.case_id);
    const helpful=rows.filter(x=>x.outcome==='HELPFUL').length;
    const harmful=rows.filter(x=>x.outcome==='HARMFUL').length;
    const neutral=rows.filter(x=>x.outcome==='NEUTRAL').length;
    const ambiguous=rows.filter(x=>x.outcome==='AMBIGUOUS').length;
    let outcome='NEUTRAL';
    if(ambiguous>0||(helpful>0&&harmful>0))outcome='AMBIGUOUS';
    else if(helpful>0)outcome='HELPFUL';
    else if(harmful>0)outcome='HARMFUL';
    return Object.freeze({
      case_id:memory.case_id,case_digest:memory.case_digest,
      outcome,helpful_marginal_count:helpful,harmful_marginal_count:harmful,
      neutral_marginal_count:neutral,ambiguous_marginal_count:ambiguous,
      sample_count:rows.length,marginals:Object.freeze(rows),
      sampled_coalition_estimate:true,full_shapley_claimed:false,
      authority_effect:false,
    });
  }).sort((a,b)=>a.case_id.localeCompare(b.case_id));
  const ambiguousRecords=records.filter(x=>x.outcome==='AMBIGUOUS');
  const ready=ambiguousRecords.length===0;
  const judgments=ready?records.map(row=>Object.freeze({
    case_id:row.case_id,case_digest:row.case_digest,outcome:row.outcome,
    evidence_digest:digest({
      plan_digest:checked.plan_digest,
      case_id:row.case_id,
      marginal_receipts:row.marginals.flatMap(x=>[x.before_receipt_digest,x.after_receipt_digest]).sort(),
    }),
    evidence_refs:Object.freeze(row.marginals.map(x=>'coalition:'+x.permutation_index+':'+x.position).sort()),
  })):[];
  const core=zero({
    schema:RSI_EXPERIENCE_COALITION_RESULT_SCHEMA,version:1,
    state:ready?'COALITION_ATTRIBUTION_READY':'AMBIGUOUS_COALITION_HOLD',
    plan_digest:checked.plan_digest,
    single_memory_result_digest:checked.single_memory_result_digest,
    context_plan_digest:checked.context_plan_digest,
    target_context_digest:checked.target_context_digest,
    coalition_receipt_digests:Object.freeze(ordered.map(x=>x.receipt_digest).sort()),
    record_count:records.length,records:Object.freeze(records),
    utility_judgments:Object.freeze(judgments),
    utility_judgment_count:judgments.length,
    all_precommitted_coalitions_evaluated:true,
    all_evaluations_matched:true,
    sampled_coalition_estimate:true,
    full_shapley_claimed:false,
    causal_claim_scope:'MATCHED_SAMPLED_COALITION_MARGINALS',
    ambiguous_interactions_present:!ready,
    eligible_for_context_utility_feedback:ready,
    attribution_is_contextual_not_global_truth:true,
    attribution_is_skill_evidence:false,
    attribution_is_scheduler_authority:false,
    attribution_is_promotion_authority:false,
    graph_write_performed:false,
  });
  return Object.freeze({...core,result_digest:digest(core)});
}

export function verifyRsiExperienceCoalitionResult(row){
  if(!row||row.schema!==RSI_EXPERIENCE_COALITION_RESULT_SCHEMA||row.version!==1){
    throw new Error('rsi_coalition_result_schema_invalid');
  }
  assertZero(row,'result');
  if(!['COALITION_ATTRIBUTION_READY','AMBIGUOUS_COALITION_HOLD'].includes(row.state)
    ||row.all_precommitted_coalitions_evaluated!==true||row.all_evaluations_matched!==true
    ||row.sampled_coalition_estimate!==true||row.full_shapley_claimed!==false
    ||row.causal_claim_scope!=='MATCHED_SAMPLED_COALITION_MARGINALS'
    ||row.attribution_is_contextual_not_global_truth!==true
    ||row.attribution_is_skill_evidence!==false
    ||row.attribution_is_scheduler_authority!==false
    ||row.attribution_is_promotion_authority!==false||row.graph_write_performed!==false){
    throw new Error('rsi_coalition_result_policy_invalid');
  }
  const ready=row.state==='COALITION_ATTRIBUTION_READY';
  if(row.eligible_for_context_utility_feedback!==ready
    ||row.ambiguous_interactions_present===ready
    ||(ready&&row.utility_judgment_count!==row.record_count)
    ||(!ready&&row.utility_judgment_count!==0)){
    throw new Error('rsi_coalition_result_state_mismatch');
  }
  for(const f of ['plan_digest','single_memory_result_digest','context_plan_digest','target_context_digest']){
    pd(row[f],f);
  }
  const clone=structuredClone(row),claimed=pd(clone.result_digest,'result');delete clone.result_digest;
  if(digest(clone)!==claimed)throw new Error('rsi_coalition_result_digest_mismatch');
  return row;
}

export function rsiExperienceCoalitionAttributionTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.experience-coalition-attribution-root.v1',version:1,
    policy_path:'apps/metaengine-browser/src/rsi-experience-context-coalition-attribution.mjs',
    only_after_ambiguous_single_memory_attribution:true,
    deterministic_permutation_marginals:true,
    max_permutations:MAX_PERMUTATIONS,max_coalitions:MAX_COALITIONS,
    all_states_precommitted:true,matched_workload_seed_budget_evaluator_required:true,
    full_shapley_claimed:false,causal_claim_scope:'MATCHED_SAMPLED_COALITION_MARGINALS',
    hard_invariant_marginals_supported:true,pareto_objective_marginals:true,
    unresolved_interactions_block_utility_feedback:true,
    candidate_can_select_permutations:false,candidate_can_select_coalitions:false,
    candidate_can_author_attribution:false,attribution_is_contextual_not_global_truth:true,
    attribution_is_skill_evidence:false,attribution_is_scheduler_authority:false,
    attribution_is_promotion_authority:false,graph_write_performed_here:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,
    release_authority:false,self_update_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...root,coalition_root_digest:digest(root)});
}
