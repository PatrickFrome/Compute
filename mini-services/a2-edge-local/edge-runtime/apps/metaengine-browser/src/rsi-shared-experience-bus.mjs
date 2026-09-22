import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const RSI_SHARED_EXPERIENCE_HYPOTHESIS_SCHEMA='metaengine.rsi.shared-experience-hypothesis.v1';
export const RSI_SHARED_EXPERIENCE_ADMISSION_SCHEMA='metaengine.rsi.shared-experience-admission.v1';
export const RSI_SHARED_EXPERIENCE_BUS_SCHEMA='metaengine.rsi.shared-experience-bus.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const SAFE_TAG_RE=/^[A-Z0-9][A-Z0-9_.:-]{1,63}$/;
const MAX_ROWS=1024;
const MAX_EVALUATOR_COST_UNITS=64;

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`;}
function exactSha(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA40_RE.test(x))throw new Error(`rsi_experience_${l}_sha_invalid`);return x;}
function exactDigest(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA256_RE.test(x))throw new Error(`rsi_experience_${l}_digest_invalid`);return x;}
function id(v,l){const x=String(v||'').trim();if(!SAFE_ID_RE.test(x))throw new Error(`rsi_experience_${l}_invalid`);return x;}
function boundedPositiveInt(v,l,max=Number.MAX_SAFE_INTEGER){const n=Number(v);if(!Number.isSafeInteger(n)||n<1||n>max)throw new Error(`rsi_experience_${l}_invalid`);return n;}
function ratio(v,l){const n=Number(v);if(!Number.isFinite(n)||n<=0||n>1)throw new Error(`rsi_experience_${l}_invalid`);return n;}
function assertZero(v,l){for(const f of ['execution_authority','browser_authority','task_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','authority_effect'])if(v?.[f]!==false)throw new Error(`rsi_experience_${l}_${f}_invalid`);if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_experience_${l}_retry_invalid`);}
function zero(extra={}){return Object.freeze({...extra,execution_authority:false,browser_authority:false,task_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false});}
function tags(value,label){
  if(!Array.isArray(value)||value.length<1||value.length>16)throw new Error(`rsi_experience_${label}_invalid`);
  const out=[...new Set(value.map(v=>String(v||'').trim().toUpperCase()))].sort();
  if(out.length!==value.length||out.some(v=>!SAFE_TAG_RE.test(v)))throw new Error(`rsi_experience_${label}_invalid`);
  return Object.freeze(out);
}

export function createRsiSharedExperienceHypothesis({
  hypothesis_id,
  source_sha,
  origin_candidate_digest,
  origin_lineage_digest,
  sanitized_summary_digest,
  distilled_recipe_digest,
  supporting_evidence_digest,
  counterevidence_digest,
  falsification_test_digest,
  source_context_digest,
  local_revalidation_protocol_digest,
  negative_transfer_probe_digest,
  scope_tags,
  recipient_group_tags,
  evaluator_cost_units,
  expected_information_gain,
  hidden_data_disclosed=false,
  raw_benchmark_content_included=false,
  raw_verifier_assets_included=false,
  external_synthesizer=false,
  authored_by_candidate=true,
}={}){
  if(external_synthesizer!==true||authored_by_candidate!==false)throw new Error('rsi_experience_external_synthesizer_required');
  if(hidden_data_disclosed!==false||raw_benchmark_content_included!==false||raw_verifier_assets_included!==false)throw new Error('rsi_experience_hidden_data_disclosure_forbidden');
  const roots=[
    exactDigest(origin_candidate_digest,'origin_candidate'),
    exactDigest(origin_lineage_digest,'origin_lineage'),
    exactDigest(sanitized_summary_digest,'sanitized_summary'),
    exactDigest(distilled_recipe_digest,'distilled_recipe'),
    exactDigest(supporting_evidence_digest,'supporting_evidence'),
    exactDigest(counterevidence_digest,'counterevidence'),
    exactDigest(falsification_test_digest,'falsification_test'),
    exactDigest(source_context_digest,'source_context'),
    exactDigest(local_revalidation_protocol_digest,'local_revalidation_protocol'),
    exactDigest(negative_transfer_probe_digest,'negative_transfer_probe'),
  ];
  if(new Set(roots).size!==roots.length)throw new Error('rsi_experience_independent_evidence_roots_required');
  const cost=boundedPositiveInt(evaluator_cost_units,'evaluator_cost_units',MAX_EVALUATOR_COST_UNITS);
  const info=ratio(expected_information_gain,'expected_information_gain');
  const core=zero({
    schema:RSI_SHARED_EXPERIENCE_HYPOTHESIS_SCHEMA,
    version:1,
    hypothesis_id:id(hypothesis_id,'hypothesis_id'),
    source_sha:exactSha(source_sha,'source'),
    origin_candidate_digest:roots[0],
    origin_lineage_digest:roots[1],
    sanitized_summary_digest:roots[2],
    distilled_recipe_digest:roots[3],
    supporting_evidence_digest:roots[4],
    counterevidence_digest:roots[5],
    falsification_test_digest:roots[6],
    source_context_digest:roots[7],
    local_revalidation_protocol_digest:roots[8],
    negative_transfer_probe_digest:roots[9],
    scope_tags:tags(scope_tags,'scope_tags'),
    recipient_group_tags:tags(recipient_group_tags,'recipient_group_tags'),
    evaluator_cost_units:cost,
    expected_information_gain:info,
    information_gain_per_cost:info/cost,
    external_synthesizer:true,
    authored_by_candidate:false,
    hidden_data_disclosed:false,
    raw_benchmark_content_included:false,
    raw_verifier_assets_included:false,
    candidate_can_mark_hypothesis_verified:false,
    candidate_can_expand_scope:false,
    candidate_can_choose_recipients:false,
    candidate_can_choose_revalidation_protocol:false,
    candidate_can_suppress_counterevidence:false,
    distilled_recipe_is_advisory_only:true,
    hypothesis_is_mutation_authority:false,
    hypothesis_is_evaluation_authority:false,
  });
  return Object.freeze({...core,hypothesis_digest:digest(core)});
}

export function verifyRsiSharedExperienceHypothesis(hypothesis){
  if(!hypothesis||hypothesis.schema!==RSI_SHARED_EXPERIENCE_HYPOTHESIS_SCHEMA||hypothesis.version!==1)throw new Error('rsi_experience_hypothesis_invalid');
  assertZero(hypothesis,'hypothesis');
  if(hypothesis.external_synthesizer!==true||hypothesis.authored_by_candidate!==false
    ||hypothesis.hidden_data_disclosed!==false||hypothesis.raw_benchmark_content_included!==false
    ||hypothesis.raw_verifier_assets_included!==false||hypothesis.candidate_can_mark_hypothesis_verified!==false
    ||hypothesis.candidate_can_expand_scope!==false||hypothesis.candidate_can_choose_recipients!==false
    ||hypothesis.candidate_can_choose_revalidation_protocol!==false||hypothesis.candidate_can_suppress_counterevidence!==false
    ||hypothesis.distilled_recipe_is_advisory_only!==true
    ||hypothesis.hypothesis_is_mutation_authority!==false||hypothesis.hypothesis_is_evaluation_authority!==false)throw new Error('rsi_experience_hypothesis_policy_invalid');
  const canonical=createRsiSharedExperienceHypothesis({
    hypothesis_id:hypothesis.hypothesis_id,
    source_sha:hypothesis.source_sha,
    origin_candidate_digest:hypothesis.origin_candidate_digest,
    origin_lineage_digest:hypothesis.origin_lineage_digest,
    sanitized_summary_digest:hypothesis.sanitized_summary_digest,
    distilled_recipe_digest:hypothesis.distilled_recipe_digest,
    supporting_evidence_digest:hypothesis.supporting_evidence_digest,
    counterevidence_digest:hypothesis.counterevidence_digest,
    falsification_test_digest:hypothesis.falsification_test_digest,
    source_context_digest:hypothesis.source_context_digest,
    local_revalidation_protocol_digest:hypothesis.local_revalidation_protocol_digest,
    negative_transfer_probe_digest:hypothesis.negative_transfer_probe_digest,
    scope_tags:hypothesis.scope_tags,
    recipient_group_tags:hypothesis.recipient_group_tags,
    evaluator_cost_units:hypothesis.evaluator_cost_units,
    expected_information_gain:hypothesis.expected_information_gain,
    hidden_data_disclosed:false,
    raw_benchmark_content_included:false,
    raw_verifier_assets_included:false,
    external_synthesizer:true,
    authored_by_candidate:false,
  });
  if(canonical.hypothesis_digest!==exactDigest(hypothesis.hypothesis_digest,'hypothesis'))throw new Error('rsi_experience_hypothesis_digest_mismatch');
  return canonical;
}

export function createRsiSharedExperienceAdmission({
  admission_id,
  hypothesis,
  supporting_evidence_verified,
  counterevidence_reviewed,
  falsification_test_precommitted,
  hidden_data_non_disclosure_pass,
  recipe_distillation_verified,
  context_compatibility_pass,
  negative_transfer_probe_pass,
  scope_precision_pass,
  evaluator_budget_available,
  marginal_information_gain_certified,
  external_reviewer=false,
  authored_by_candidate=true,
}={}){
  if(external_reviewer!==true||authored_by_candidate!==false)throw new Error('rsi_experience_external_reviewer_required');
  const checked=verifyRsiSharedExperienceHypothesis(hypothesis);
  const blockers=[];
  if(supporting_evidence_verified!==true)blockers.push('SUPPORTING_EVIDENCE_UNVERIFIED');
  if(counterevidence_reviewed!==true)blockers.push('COUNTEREVIDENCE_NOT_REVIEWED');
  if(falsification_test_precommitted!==true)blockers.push('FALSIFICATION_TEST_NOT_PRECOMMITTED');
  if(hidden_data_non_disclosure_pass!==true)blockers.push('HIDDEN_DATA_BOUNDARY_FAILURE');
  if(recipe_distillation_verified!==true)blockers.push('RECIPE_DISTILLATION_UNVERIFIED');
  if(context_compatibility_pass!==true)blockers.push('CONTEXT_COMPATIBILITY_FAILURE');
  if(negative_transfer_probe_pass!==true)blockers.push('NEGATIVE_TRANSFER_DETECTED');
  if(scope_precision_pass!==true)blockers.push('SCOPE_PRECISION_FAILURE');
  if(evaluator_budget_available!==true)blockers.push('EVALUATOR_BUDGET_UNAVAILABLE');
  if(marginal_information_gain_certified!==true)blockers.push('LOW_INFORMATION_GAIN');
  const pass=blockers.length===0;
  const core=zero({
    schema:RSI_SHARED_EXPERIENCE_ADMISSION_SCHEMA,
    version:1,
    admission_id:id(admission_id,'admission_id'),
    source_sha:checked.source_sha,
    hypothesis_digest:checked.hypothesis_digest,
    origin_candidate_digest:checked.origin_candidate_digest,
    origin_lineage_digest:checked.origin_lineage_digest,
    sanitized_summary_digest:checked.sanitized_summary_digest,
    distilled_recipe_digest:checked.distilled_recipe_digest,
    supporting_evidence_digest:checked.supporting_evidence_digest,
    counterevidence_digest:checked.counterevidence_digest,
    falsification_test_digest:checked.falsification_test_digest,
    source_context_digest:checked.source_context_digest,
    local_revalidation_protocol_digest:checked.local_revalidation_protocol_digest,
    negative_transfer_probe_digest:checked.negative_transfer_probe_digest,
    supporting_evidence_verified:supporting_evidence_verified===true,
    counterevidence_reviewed:counterevidence_reviewed===true,
    falsification_test_precommitted:falsification_test_precommitted===true,
    hidden_data_non_disclosure_pass:hidden_data_non_disclosure_pass===true,
    recipe_distillation_verified:recipe_distillation_verified===true,
    context_compatibility_pass:context_compatibility_pass===true,
    negative_transfer_probe_pass:negative_transfer_probe_pass===true,
    scope_precision_pass:scope_precision_pass===true,
    evaluator_budget_available:evaluator_budget_available===true,
    marginal_information_gain_certified:marginal_information_gain_certified===true,
    scope_tags:checked.scope_tags,
    recipient_group_tags:checked.recipient_group_tags,
    evaluator_cost_units:checked.evaluator_cost_units,
    expected_information_gain:checked.expected_information_gain,
    information_gain_per_cost:checked.information_gain_per_cost,
    blockers:Object.freeze(blockers.sort()),
    state:pass?'ELIGIBLE_FOR_SHARED_EXPERIENCE_BUS':'SHARED_EXPERIENCE_REJECTED',
    eligible_for_shared_experience_bus:pass,
    external_reviewer:true,
    authored_by_candidate:false,
    shared_experience_is_advisory_only:true,
    shared_experience_can_mutate_active_skill:false,
    shared_experience_can_mutate_verifier:false,
    shared_experience_can_mutate_benchmark:false,
    shared_experience_can_schedule_work:false,
    shared_experience_can_execute_browser_effect:false,
    consumer_must_revalidate_locally:true,
    consumer_must_preserve_source_provenance:true,
  });
  return Object.freeze({...core,admission_digest:digest(core)});
}

export function verifyRsiSharedExperienceAdmission(admission,{hypothesis}={}){
  if(!admission||admission.schema!==RSI_SHARED_EXPERIENCE_ADMISSION_SCHEMA||admission.version!==1)throw new Error('rsi_experience_admission_invalid');
  assertZero(admission,'admission');
  if(admission.external_reviewer!==true||admission.authored_by_candidate!==false
    ||admission.shared_experience_is_advisory_only!==true||admission.shared_experience_can_mutate_active_skill!==false
    ||admission.shared_experience_can_mutate_verifier!==false||admission.shared_experience_can_mutate_benchmark!==false
    ||admission.shared_experience_can_schedule_work!==false||admission.shared_experience_can_execute_browser_effect!==false
    ||admission.consumer_must_revalidate_locally!==true||admission.consumer_must_preserve_source_provenance!==true)throw new Error('rsi_experience_admission_policy_invalid');
  const checked=verifyRsiSharedExperienceHypothesis(hypothesis);
  if(admission.hypothesis_digest!==checked.hypothesis_digest)throw new Error('rsi_experience_admission_binding_mismatch');
  const canonical=createRsiSharedExperienceAdmission({
    admission_id:admission.admission_id,
    hypothesis:checked,
    supporting_evidence_verified:admission.supporting_evidence_verified,
    counterevidence_reviewed:admission.counterevidence_reviewed,
    falsification_test_precommitted:admission.falsification_test_precommitted,
    hidden_data_non_disclosure_pass:admission.hidden_data_non_disclosure_pass,
    recipe_distillation_verified:admission.recipe_distillation_verified,
    context_compatibility_pass:admission.context_compatibility_pass,
    negative_transfer_probe_pass:admission.negative_transfer_probe_pass,
    scope_precision_pass:admission.scope_precision_pass,
    evaluator_budget_available:admission.evaluator_budget_available,
    marginal_information_gain_certified:admission.marginal_information_gain_certified,
    external_reviewer:true,
    authored_by_candidate:false,
  });
  if(canonical.admission_digest!==exactDigest(admission.admission_digest,'admission'))throw new Error('rsi_experience_admission_digest_mismatch');
  return canonical;
}

function verifyStoredBusRow(row,sourceSha){
  if(!row||typeof row!=='object'||Array.isArray(row))throw new Error('rsi_experience_bus_row_invalid');
  const h=verifyRsiSharedExperienceHypothesis(row.hypothesis);
  const a=verifyRsiSharedExperienceAdmission(row.admission,{hypothesis:h});
  const expected=exactSha(sourceSha,'bus_source');
  if(row.source_sha!==expected||h.source_sha!==expected||a.source_sha!==expected)throw new Error('rsi_experience_bus_source_mismatch');
  if(a.hypothesis_digest!==h.hypothesis_digest)throw new Error('rsi_experience_bus_binding_mismatch');
  return Object.freeze({source_sha:expected,hypothesis:structuredClone(h),admission:structuredClone(a)});
}

function busState(sourceSha,rows){
  const eligible=rows.filter(r=>r.admission.eligible_for_shared_experience_bus===true);
  const groupTags=[...new Set(eligible.flatMap(r=>r.admission.recipient_group_tags))].sort();
  const scopeTags=[...new Set(eligible.flatMap(r=>r.admission.scope_tags))].sort();
  const totalCost=eligible.reduce((sum,r)=>sum+r.admission.evaluator_cost_units,0);
  const core=zero({
    schema:RSI_SHARED_EXPERIENCE_BUS_SCHEMA,
    version:1,
    source_sha:sourceSha,
    rows,
    row_count:rows.length,
    eligible_count:eligible.length,
    represented_recipient_groups:Object.freeze(groupTags),
    represented_scopes:Object.freeze(scopeTags),
    total_admitted_evaluator_cost_units:totalCost,
    append_only:true,
    preserves_conflicting_hypotheses:true,
    scalar_winner_forbidden:true,
    bus_can_mutate_active_state:false,
    bus_can_schedule_work:false,
    bus_can_execute_browser_effect:false,
    bus_can_mark_hypothesis_true:false,
    candidate_can_delete:false,
    candidate_can_rewrite:false,
  });
  return {...core,state_digest:digest(core)};
}

export class RsiSharedExperienceBus{
  #path;#sourceSha;#rows=[];#initialized=false;
  constructor({statePath,source_sha}={}){if(!statePath)throw new Error('rsi_experience_bus_path_required');this.#path=path.resolve(statePath);this.#sourceSha=exactSha(source_sha,'bus_source');}
  async init(){
    if(this.#initialized)return this.snapshot();
    await fs.mkdir(path.dirname(this.#path),{recursive:true});
    try{
      const p=JSON.parse(await fs.readFile(this.#path,'utf8'));assertZero(p,'bus');
      if(p.schema!==RSI_SHARED_EXPERIENCE_BUS_SCHEMA||p.version!==1||p.source_sha!==this.#sourceSha||p.append_only!==true
        ||p.preserves_conflicting_hypotheses!==true||p.scalar_winner_forbidden!==true
        ||p.bus_can_mutate_active_state!==false||p.bus_can_schedule_work!==false||p.bus_can_execute_browser_effect!==false
        ||p.bus_can_mark_hypothesis_true!==false||p.candidate_can_delete!==false||p.candidate_can_rewrite!==false)throw new Error('rsi_experience_bus_state_invalid');
      const clone=structuredClone(p);delete clone.state_digest;if(digest(clone)!==exactDigest(p.state_digest,'bus'))throw new Error('rsi_experience_bus_digest_mismatch');
      if(!Array.isArray(p.rows)||p.rows.length>MAX_ROWS)throw new Error('rsi_experience_bus_rows_invalid');
      const ids=new Set();
      const checkedRows=p.rows.map((row)=>{
        const checked=verifyStoredBusRow(row,this.#sourceSha);
        if(ids.has(checked.hypothesis.hypothesis_digest))throw new Error('rsi_experience_bus_hypothesis_duplicate');
        ids.add(checked.hypothesis.hypothesis_digest);
        return checked;
      });
      const canonical=busState(this.#sourceSha,checkedRows);
      if(p.row_count!==canonical.row_count||p.eligible_count!==canonical.eligible_count
        ||JSON.stringify(p.represented_recipient_groups)!==JSON.stringify(canonical.represented_recipient_groups)
        ||JSON.stringify(p.represented_scopes)!==JSON.stringify(canonical.represented_scopes)
        ||p.total_admitted_evaluator_cost_units!==canonical.total_admitted_evaluator_cost_units)throw new Error('rsi_experience_bus_summary_mismatch');
      this.#rows=checkedRows;
    }catch(error){if(error?.code!=='ENOENT')throw error;}
    this.#initialized=true;return this.snapshot();
  }
  async #persist(rows=this.#rows){const s=busState(this.#sourceSha,rows);const tmp=`${this.#path}.tmp`;const h=await fs.open(tmp,'w',0o600);try{await h.writeFile(`${JSON.stringify(s)}\n`,'utf8');await h.sync();}finally{await h.close();}await fs.rename(tmp,this.#path);}
  async add({hypothesis,admission}={}){
    if(!this.#initialized)throw new Error('rsi_experience_bus_not_initialized');
    const h=verifyRsiSharedExperienceHypothesis(hypothesis);
    const a=verifyRsiSharedExperienceAdmission(admission,{hypothesis:h});
    if(h.source_sha!==this.#sourceSha||a.source_sha!==this.#sourceSha)throw new Error('rsi_experience_bus_source_mismatch');
    const existing=this.#rows.find(r=>r.hypothesis.hypothesis_digest===h.hypothesis_digest);
    if(existing){
      if(existing.admission.admission_digest!==a.admission_digest)throw new Error('rsi_experience_bus_identity_conflict');
      return zero({state:'IDEMPOTENT',admission_digest:a.admission_digest});
    }
    if(this.#rows.length>=MAX_ROWS)throw new Error('rsi_experience_bus_capacity_exceeded');
    const nextRow=verifyStoredBusRow({source_sha:this.#sourceSha,hypothesis:structuredClone(h),admission:structuredClone(a)},this.#sourceSha);
    const preview=Object.freeze([...this.#rows,nextRow]);
    await this.#persist(preview);
    this.#rows=preview;
    return zero({state:a.state,admission_digest:a.admission_digest});
  }
  eligibleForRecipient(recipientTag){
    if(!this.#initialized)throw new Error('rsi_experience_bus_not_initialized');
    const tag=String(recipientTag||'').trim().toUpperCase();
    if(!SAFE_TAG_RE.test(tag))throw new Error('rsi_experience_recipient_tag_invalid');
    return Object.freeze(this.#rows.filter(r=>r.admission.eligible_for_shared_experience_bus===true&&r.admission.recipient_group_tags.includes(tag)).map(r=>Object.freeze(structuredClone(r.admission))));
  }
  snapshot(){const s=busState(this.#sourceSha,this.#rows);return Object.freeze({schema:s.schema,version:s.version,source_sha:s.source_sha,initialized:this.#initialized,row_count:s.row_count,eligible_count:s.eligible_count,represented_recipient_groups:s.represented_recipient_groups,represented_scopes:s.represented_scopes,total_admitted_evaluator_cost_units:s.total_admitted_evaluator_cost_units,append_only:true,preserves_conflicting_hypotheses:true,scalar_winner_forbidden:true,bus_can_mutate_active_state:false,bus_can_schedule_work:false,bus_can_execute_browser_effect:false,bus_can_mark_hypothesis_true:false,authority_effect:false});}
}

export function rsiSharedExperienceBusTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.shared-experience-bus-root.v1',
    version:1,
    evidence_backed_hypothesis_required:true,
    counterevidence_required:true,
    precommitted_falsification_test_required:true,
    verified_recipe_distillation_required:true,
    context_compatibility_gate_required:true,
    negative_transfer_probe_required:true,
    local_revalidation_protocol_digest_required:true,
    hidden_data_non_disclosure_required:true,
    raw_benchmark_content_sharing_forbidden:true,
    raw_verifier_asset_sharing_forbidden:true,
    bounded_evaluator_cost_units:MAX_EVALUATOR_COST_UNITS,
    marginal_information_gain_required:true,
    external_synthesizer_required:true,
    external_reviewer_required:true,
    local_consumer_revalidation_required:true,
    source_provenance_required:true,
    conflicting_hypotheses_preserved:true,
    scalar_winner_forbidden:true,
    bus_can_mutate_active_state:false,
    bus_can_schedule_work:false,
    bus_can_execute_browser_effect:false,
    execution_authority:false,
    browser_authority:false,
    task_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...root,shared_experience_bus_root_digest:digest(root)});
}
