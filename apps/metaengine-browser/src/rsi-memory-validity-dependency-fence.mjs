import crypto from 'node:crypto';

export const RSI_MEMORY_DEPENDENCY_FENCE_SCHEMA='metaengine.rsi.memory-dependency-fence.v1';
export const RSI_MEMORY_DEPENDENCY_ROOT_SCHEMA='metaengine.rsi.memory-dependency-root.v1';

const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const SAFE_TOKEN_RE=/^[A-Z0-9][A-Z0-9_.:-]{0,95}$/;
const DEPENDENCY_KINDS=new Set([
  'REPO_REVISION',
  'TOOLCHAIN_REVISION',
  'BROWSER_GENERATION',
  'API_CONTRACT',
  'RELEASE_AUTHORITY',
  'EXTERNAL_RESOURCE',
]);
const VALIDATION_STATES=new Set(['MATCH','SUPERSEDED','AMBIGUOUS','UNAVAILABLE']);
const MAX_SELECTED_CASES=12;
const MAX_DEPENDENCIES_PER_CASE=8;
const MAX_EVIDENCE_REFS=16;
const MAX_VALIDITY_MS=5*60*1000;
const MAX_PAYLOAD_BYTES=64*1024;

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
}
function digest(value){
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`;
}
function bytes(value){return Buffer.byteLength(JSON.stringify(stable(value)),'utf8')}
function zeroAuthority(extra={}){
  return Object.freeze({
    ...extra,
    execution_authority:false,
    browser_authority:false,
    scheduler_authority:false,
    task_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    release_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  });
}
function assertZeroAuthority(value,label){
  for(const key of [
    'execution_authority','browser_authority','scheduler_authority','task_authority',
    'production_mutation_authority','promotion_authority','release_authority',
    'self_update_authority','authority_effect',
  ]){
    if(Object.hasOwn(value||{},key)&&value[key]!==false)throw new Error(`rsi_memory_dependency_${label}_${key}_invalid`);
  }
  if(Object.hasOwn(value||{},'automatic_retry_allowed')&&value.automatic_retry_allowed!==false){
    throw new Error(`rsi_memory_dependency_${label}_retry_invalid`);
  }
}
function sha256(value,label){
  const out=String(value||'').trim().toLowerCase();
  if(!SHA256_RE.test(out))throw new Error(`rsi_memory_dependency_${label}_digest_invalid`);
  return out;
}
function safeId(value,label){
  const out=String(value||'').trim();
  if(!SAFE_ID_RE.test(out))throw new Error(`rsi_memory_dependency_${label}_invalid`);
  return out;
}
function token(value,label){
  const out=String(value||'').trim().toUpperCase();
  if(!SAFE_TOKEN_RE.test(out))throw new Error(`rsi_memory_dependency_${label}_invalid`);
  return out;
}
function iso(value,label){
  const raw=String(value||'').trim();
  const parsed=Date.parse(raw);
  if(!raw||!Number.isFinite(parsed))throw new Error(`rsi_memory_dependency_${label}_time_invalid`);
  return new Date(parsed).toISOString();
}
function refs(value){
  if(!Array.isArray(value)||value.length<1||value.length>MAX_EVIDENCE_REFS)throw new Error('rsi_memory_dependency_evidence_refs_invalid');
  const out=value.map(v=>safeId(v,'evidence_ref')).sort();
  if(new Set(out).size!==out.length)throw new Error('rsi_memory_dependency_evidence_ref_duplicate');
  return Object.freeze(out);
}
function planCore(plan){
  if(!plan||typeof plan!=='object'||Array.isArray(plan)||plan.schema!=='metaengine.rsi.experience-context-plan.v1'||plan.version!==1){
    throw new Error('rsi_memory_dependency_base_context_plan_invalid');
  }
  assertZeroAuthority(plan,'base_context_plan');
  const selected=Array.isArray(plan.selected_cases)?plan.selected_cases:[];
  if(selected.length<1||selected.length>MAX_SELECTED_CASES||plan.selected_case_count!==selected.length){
    throw new Error('rsi_memory_dependency_selected_cases_required');
  }
  if(plan.graph_snapshot_digest==null||plan.retrieval_digest==null)throw new Error('rsi_memory_dependency_verified_graph_required');
  return Object.freeze({
    context_plan_digest:sha256(plan.context_plan_digest,'context_plan'),
    query_digest:sha256(plan.query_digest,'query'),
    graph_snapshot_digest:sha256(plan.graph_snapshot_digest,'graph_snapshot'),
    retrieval_digest:sha256(plan.retrieval_digest,'retrieval'),
    target_context_digest:sha256(plan.target_context_digest,'target_context'),
    opportunity_id:safeId(plan.opportunity_id,'opportunity_id'),
    source_sha:String(plan.source_sha||'').trim().toLowerCase(),
    selected_cases:Object.freeze(selected.map(row=>Object.freeze(structuredClone(row)))),
  });
}
function normalizeDependency(dep){
  if(!dep||typeof dep!=='object'||Array.isArray(dep))throw new Error('rsi_memory_dependency_row_dependency_invalid');
  if(
    dep.external_readback_verified!==true
    || dep.dependency_relevance_verified!==true
    || dep.authored_by_candidate!==false
    || dep.candidate_can_define_dependency!==false
    || dep.candidate_can_define_revision!==false
  )throw new Error('rsi_memory_dependency_external_readback_required');
  const kind=token(dep.dependency_kind,'dependency_kind');
  if(!DEPENDENCY_KINDS.has(kind))throw new Error('rsi_memory_dependency_kind_invalid');
  const state=token(dep.validation_state,'validation_state');
  if(!VALIDATION_STATES.has(state))throw new Error('rsi_memory_dependency_validation_state_invalid');
  const bound=sha256(dep.bound_revision_digest,'bound_revision');
  let current=null;
  if(dep.current_revision_digest!=null)current=sha256(dep.current_revision_digest,'current_revision');
  if(state==='MATCH'&&current!==bound)throw new Error('rsi_memory_dependency_match_revision_mismatch');
  if(state==='SUPERSEDED'&&(!current||current===bound))throw new Error('rsi_memory_dependency_superseded_revision_invalid');
  if((state==='AMBIGUOUS'||state==='UNAVAILABLE')&&current!=null&&current===bound){
    throw new Error('rsi_memory_dependency_uncertain_state_cannot_claim_match');
  }
  return Object.freeze({
    dependency_id:safeId(dep.dependency_id,'dependency_id'),
    dependency_kind:kind,
    bound_revision_digest:bound,
    current_revision_digest:current,
    validation_state:state,
    observed_at:iso(dep.observed_at,'dependency_observed_at'),
    evidence_digest:sha256(dep.evidence_digest,'dependency_evidence'),
    evidence_refs:refs(dep.evidence_refs),
    external_readback_verified:true,
    dependency_relevance_verified:true,
    authored_by_candidate:false,
    candidate_can_define_dependency:false,
    candidate_can_define_revision:false,
  });
}
function normalizeCaseAssessment(row,selectedCase){
  if(!row||typeof row!=='object'||Array.isArray(row))throw new Error('rsi_memory_dependency_case_assessment_invalid');
  if(
    row.external_verifier!==true
    || row.authored_by_candidate!==false
    || row.candidate_can_override_status!==false
  )throw new Error('rsi_memory_dependency_case_external_verifier_required');
  if(row.case_id!==selectedCase.case_id||row.case_digest!==selectedCase.case_digest){
    throw new Error('rsi_memory_dependency_case_binding_mismatch');
  }
  if(!Array.isArray(row.dependencies)||row.dependencies.length>MAX_DEPENDENCIES_PER_CASE){
    throw new Error('rsi_memory_dependency_dependencies_invalid');
  }
  const dependencies=row.dependencies.map(normalizeDependency).sort((a,b)=>a.dependency_id.localeCompare(b.dependency_id));
  if(new Set(dependencies.map(dep=>dep.dependency_id)).size!==dependencies.length){
    throw new Error('rsi_memory_dependency_dependency_duplicate');
  }
  const noDependency=dependencies.length===0;
  if(noDependency&&row.no_dependency_applicable_verified!==true){
    throw new Error('rsi_memory_dependency_no_dependency_verification_required');
  }
  if(!noDependency&&row.no_dependency_applicable_verified!==false){
    throw new Error('rsi_memory_dependency_no_dependency_flag_invalid');
  }
  const blockedStates=dependencies.filter(dep=>dep.validation_state!=='MATCH');
  const status=blockedStates.length===0?'ELIGIBLE':'BLOCKED';
  const blockers=[...new Set(blockedStates.map(dep=>`DEPENDENCY_${dep.validation_state}`))].sort();
  return Object.freeze({
    case_id:selectedCase.case_id,
    case_digest:selectedCase.case_digest,
    dependencies:Object.freeze(dependencies),
    dependency_count:dependencies.length,
    no_dependency_applicable_verified:noDependency,
    status,
    blocker_codes:Object.freeze(blockers),
    external_verifier:true,
    authored_by_candidate:false,
    candidate_can_override_status:false,
    remains_queryable:true,
    history_deleted:false,
  });
}

export function createRsiMemoryDependencyFence({
  base_context_plan,
  assessment,
}={}){
  const base=planCore(base_context_plan);
  if(!assessment||typeof assessment!=='object'||Array.isArray(assessment))throw new Error('rsi_memory_dependency_assessment_invalid');
  if(
    assessment.external_verifier!==true
    || assessment.authored_by_candidate!==false
    || assessment.candidate_can_define_dependencies!==false
    || assessment.candidate_can_override_status!==false
  )throw new Error('rsi_memory_dependency_external_assessment_required');
  const observedAt=iso(assessment.observed_at,'observed_at');
  const validUntil=iso(assessment.valid_until,'valid_until');
  const observedMs=Date.parse(observedAt);
  const validUntilMs=Date.parse(validUntil);
  if(validUntilMs<=observedMs||validUntilMs-observedMs>MAX_VALIDITY_MS){
    throw new Error('rsi_memory_dependency_validity_window_invalid');
  }
  if(!Array.isArray(assessment.case_assessments)||assessment.case_assessments.length!==base.selected_cases.length){
    throw new Error('rsi_memory_dependency_complete_case_coverage_required');
  }
  const byId=new Map(base.selected_cases.map(row=>[row.case_id,row]));
  const seen=new Set();
  const rows=assessment.case_assessments.map(raw=>{
    const id=safeId(raw?.case_id,'case_id');
    if(seen.has(id))throw new Error('rsi_memory_dependency_case_duplicate');
    seen.add(id);
    const selected=byId.get(id);
    if(!selected)throw new Error('rsi_memory_dependency_case_not_selected');
    return normalizeCaseAssessment(raw,selected);
  }).sort((a,b)=>a.case_id.localeCompare(b.case_id));
  if(seen.size!==byId.size)throw new Error('rsi_memory_dependency_complete_case_coverage_required');
  const allowed=rows.filter(row=>row.status==='ELIGIBLE').map(row=>row.case_id).sort();
  const blocked=rows.filter(row=>row.status==='BLOCKED');
  const core=zeroAuthority({
    schema:RSI_MEMORY_DEPENDENCY_FENCE_SCHEMA,
    version:1,
    assessment_id:safeId(assessment.assessment_id,'assessment_id'),
    verifier_id:safeId(assessment.verifier_id,'verifier_id'),
    observed_at:observedAt,
    valid_until:validUntil,
    max_validity_ms:MAX_VALIDITY_MS,
    base_context_plan_digest:base.context_plan_digest,
    base_query_digest:base.query_digest,
    base_graph_snapshot_digest:base.graph_snapshot_digest,
    base_retrieval_digest:base.retrieval_digest,
    target_context_digest:base.target_context_digest,
    opportunity_id:base.opportunity_id,
    source_sha:base.source_sha,
    base_selected_cases:base.selected_cases,
    base_selected_case_count:base.selected_cases.length,
    case_assessments:Object.freeze(rows),
    case_assessment_count:rows.length,
    allowed_case_ids:Object.freeze(allowed),
    allowed_case_count:allowed.length,
    blocked_cases:Object.freeze(blocked.map(row=>Object.freeze({
      case_id:row.case_id,
      case_digest:row.case_digest,
      blocker_codes:row.blocker_codes,
      remains_queryable:true,
      candidate_guidance_allowed:false,
    }))),
    blocked_case_count:blocked.length,
    external_verifier:true,
    authored_by_candidate:false,
    candidate_can_define_dependencies:false,
    candidate_can_override_status:false,
    complete_selected_case_coverage:true,
    only_exact_match_dependencies_allow_guidance:true,
    ambiguous_dependency_blocks_guidance:true,
    unavailable_dependency_blocks_guidance:true,
    superseded_dependency_blocks_guidance:true,
    blocked_memory_remains_queryable:true,
    blocked_memory_history_deleted:false,
    fence_is_candidate_guidance_filter_only:true,
    fence_is_execution_authority:false,
    raw_trajectory_stored:false,
    raw_page_text_stored:false,
    raw_user_input_stored:false,
    secret_material_stored:false,
  });
  const payloadBytes=bytes(core);
  if(payloadBytes>MAX_PAYLOAD_BYTES)throw new Error('rsi_memory_dependency_payload_budget_exceeded');
  return Object.freeze({...core,payload_bytes:payloadBytes,max_payload_bytes:MAX_PAYLOAD_BYTES,fence_digest:digest(core)});
}

export function verifyRsiMemoryDependencyFence(row,{base_context_plan=null}={}){
  if(!row||typeof row!=='object'||Array.isArray(row)||row.schema!==RSI_MEMORY_DEPENDENCY_FENCE_SCHEMA||row.version!==1){
    throw new Error('rsi_memory_dependency_fence_invalid');
  }
  assertZeroAuthority(row,'fence');
  if(
    row.external_verifier!==true
    || row.authored_by_candidate!==false
    || row.candidate_can_define_dependencies!==false
    || row.candidate_can_override_status!==false
    || row.complete_selected_case_coverage!==true
    || row.only_exact_match_dependencies_allow_guidance!==true
    || row.ambiguous_dependency_blocks_guidance!==true
    || row.unavailable_dependency_blocks_guidance!==true
    || row.superseded_dependency_blocks_guidance!==true
    || row.blocked_memory_remains_queryable!==true
    || row.blocked_memory_history_deleted!==false
    || row.fence_is_candidate_guidance_filter_only!==true
    || row.fence_is_execution_authority!==false
    || row.raw_trajectory_stored!==false
    || row.raw_page_text_stored!==false
    || row.raw_user_input_stored!==false
    || row.secret_material_stored!==false
  )throw new Error('rsi_memory_dependency_policy_invalid');
  safeId(row.assessment_id,'assessment_id');
  safeId(row.verifier_id,'verifier_id');
  const observed=Date.parse(iso(row.observed_at,'observed_at'));
  const validUntil=Date.parse(iso(row.valid_until,'valid_until'));
  if(validUntil<=observed||validUntil-observed>MAX_VALIDITY_MS||row.max_validity_ms!==MAX_VALIDITY_MS){
    throw new Error('rsi_memory_dependency_validity_window_invalid');
  }
  for(const [value,label] of [
    [row.base_context_plan_digest,'base_context_plan'],
    [row.base_query_digest,'base_query'],
    [row.base_graph_snapshot_digest,'base_graph_snapshot'],
    [row.base_retrieval_digest,'base_retrieval'],
    [row.target_context_digest,'target_context'],
  ])sha256(value,label);
  safeId(row.opportunity_id,'opportunity_id');
  if(!Array.isArray(row.base_selected_cases)||row.base_selected_cases.length<1||row.base_selected_cases.length>MAX_SELECTED_CASES){
    throw new Error('rsi_memory_dependency_base_selected_cases_invalid');
  }
  if(row.base_selected_case_count!==row.base_selected_cases.length)throw new Error('rsi_memory_dependency_base_selected_case_count_invalid');
  const baseById=new Map();
  for(const selected of row.base_selected_cases){
    const id=safeId(selected?.case_id,'base_case_id');
    sha256(selected?.case_digest,'base_case');
    if(baseById.has(id))throw new Error('rsi_memory_dependency_base_case_duplicate');
    baseById.set(id,selected);
  }
  if(!Array.isArray(row.case_assessments)||row.case_assessment_count!==row.case_assessments.length||row.case_assessments.length!==baseById.size){
    throw new Error('rsi_memory_dependency_case_assessment_count_invalid');
  }
  const assessments=row.case_assessments.map(raw=>{
    const selected=baseById.get(raw?.case_id);
    if(!selected)throw new Error('rsi_memory_dependency_case_not_selected');
    return normalizeCaseAssessment(raw,selected);
  }).sort((a,b)=>a.case_id.localeCompare(b.case_id));
  if(JSON.stringify(assessments)!==JSON.stringify(row.case_assessments)){
    throw new Error('rsi_memory_dependency_case_assessment_not_canonical');
  }
  const expectedAllowed=assessments.filter(item=>item.status==='ELIGIBLE').map(item=>item.case_id).sort();
  const expectedBlocked=assessments.filter(item=>item.status==='BLOCKED').map(item=>({
    case_id:item.case_id,
    case_digest:item.case_digest,
    blocker_codes:item.blocker_codes,
    remains_queryable:true,
    candidate_guidance_allowed:false,
  }));
  if(
    JSON.stringify(row.allowed_case_ids)!==JSON.stringify(expectedAllowed)
    || row.allowed_case_count!==expectedAllowed.length
    || JSON.stringify(row.blocked_cases)!==JSON.stringify(expectedBlocked)
    || row.blocked_case_count!==expectedBlocked.length
  )throw new Error('rsi_memory_dependency_projection_set_mismatch');
  const core={...structuredClone(row)};
  delete core.payload_bytes;
  delete core.max_payload_bytes;
  delete core.fence_digest;
  const payloadBytes=bytes(core);
  if(payloadBytes!==Number(row.payload_bytes)||payloadBytes>Number(row.max_payload_bytes)||Number(row.max_payload_bytes)!==MAX_PAYLOAD_BYTES){
    throw new Error('rsi_memory_dependency_size_mismatch');
  }
  if(digest(core)!==sha256(row.fence_digest,'fence'))throw new Error('rsi_memory_dependency_fence_digest_mismatch');

  if(base_context_plan!=null){
    const base=planCore(base_context_plan);
    if(
      base.context_plan_digest!==row.base_context_plan_digest
      || base.query_digest!==row.base_query_digest
      || base.graph_snapshot_digest!==row.base_graph_snapshot_digest
      || base.retrieval_digest!==row.base_retrieval_digest
      || base.target_context_digest!==row.target_context_digest
      || base.opportunity_id!==row.opportunity_id
      || base.source_sha!==row.source_sha
      || JSON.stringify(base.selected_cases)!==JSON.stringify(row.base_selected_cases)
    )throw new Error('rsi_memory_dependency_base_context_lineage_mismatch');
  }
  return row;
}

export function rsiMemoryDependencyTrustRootSnapshot(){
  const root=zeroAuthority({
    schema:RSI_MEMORY_DEPENDENCY_ROOT_SCHEMA,
    version:1,
    policy_path:'apps/metaengine-browser/src/rsi-memory-validity-dependency-fence.mjs',
    exact_base_context_plan_required:true,
    complete_selected_case_coverage_required:true,
    allowed_dependency_kinds:Object.freeze([...DEPENDENCY_KINDS].sort()),
    max_dependencies_per_case:MAX_DEPENDENCIES_PER_CASE,
    max_validity_ms:MAX_VALIDITY_MS,
    only_exact_match_dependencies_allow_guidance:true,
    ambiguous_dependency_blocks_guidance:true,
    unavailable_dependency_blocks_guidance:true,
    superseded_dependency_blocks_guidance:true,
    blocked_memory_remains_queryable:true,
    blocked_memory_history_deleted:false,
    dependency_fence_is_candidate_guidance_filter_only:true,
    candidate_can_define_dependencies:false,
    candidate_can_define_revision:false,
    candidate_can_override_status:false,
    execution_requires_independent_revalidation:true,
    no_second_scheduler:true,
    raw_trajectory_stored:false,
    raw_page_text_stored:false,
    raw_user_input_stored:false,
    secret_material_stored:false,
    max_payload_bytes:MAX_PAYLOAD_BYTES,
  });
  return Object.freeze({...root,memory_dependency_root_digest:digest(root)});
}
