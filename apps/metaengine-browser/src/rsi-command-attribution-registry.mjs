import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const RSI_COMMAND_ATTRIBUTION_BINDING_SCHEMA='metaengine.rsi.command-attribution-binding.v1';
export const RSI_COMMAND_ATTRIBUTION_REGISTRY_SCHEMA='metaengine.rsi.command-attribution-registry.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const DIGEST_RE=/^sha256:[0-9a-f]{64}$/;
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const SAFE_TOKEN_RE=/^[A-Z0-9][A-Z0-9_.:-]{0,95}$/;
const MAX_SKILLS=32;
const MAX_BINDINGS=4096;
const MAX_PENDING=1024;
const KEEP_CONSUMED=2048;

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}
function exactSha(v,l){const o=String(v||'').trim().toLowerCase();if(!SHA40_RE.test(o))throw new Error(`rsi_command_attribution_${l}_sha_invalid`);return o}
function exactDigest(v,l){const o=String(v||'').trim().toLowerCase();if(!DIGEST_RE.test(o))throw new Error(`rsi_command_attribution_${l}_digest_invalid`);return o}
function uuid(v,l){const o=String(v||'').trim().toLowerCase();if(!UUID_RE.test(o))throw new Error(`rsi_command_attribution_${l}_invalid`);return o}
function boundedId(v,l){const o=String(v||'').trim();if(!SAFE_ID_RE.test(o))throw new Error(`rsi_command_attribution_${l}_invalid`);return o}
function token(v,l,{nullable=false}={}){if(nullable&&(v==null||v===''))return null;const o=String(v||'').trim().toUpperCase();if(!SAFE_TOKEN_RE.test(o))throw new Error(`rsi_command_attribution_${l}_invalid`);return o}
function iso(v,l){const raw=String(v||'').trim();if(!raw||Number.isNaN(Date.parse(raw)))throw new Error(`rsi_command_attribution_${l}_invalid`);return new Date(raw).toISOString()}
function safeRuntimeCandidateId(v){return boundedId(v,'runtime_candidate_id')}
function skillDigests(v){if(!Array.isArray(v)||v.length>MAX_SKILLS)throw new Error('rsi_command_attribution_skill_digests_invalid');const seen=new Set();return Object.freeze(v.map(x=>exactDigest(x,'skill')).sort().map(x=>{if(seen.has(x))throw new Error('rsi_command_attribution_skill_digest_duplicate');seen.add(x);return x}))}
function evidenceCandidateId(candidateDigest){const d=exactDigest(candidateDigest,'candidate_record');return `candidate_sha256_${d.slice('sha256:'.length)}`}
function assertZero(v,l){for(const f of ['execution_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','authority_effect'])if(v?.[f]!==false)throw new Error(`rsi_command_attribution_${l}_${f}_invalid`);if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_command_attribution_${l}_automatic_retry_invalid`)}

export function createRsiCommandAttributionBinding({
  source_sha,command_id,action,platform=null,effect_key=null,
  task_id,task_signature_digest,environment_fingerprint,model_family,
  runtime_candidate_id,candidate_digest,candidate_sha,proposal_digest,skill_digests=[],
  bound_at,external_planner=false,authored_by_candidate=true,
}={}){
  if(external_planner!==true||authored_by_candidate!==false)throw new Error('rsi_command_attribution_external_planner_required');
  const core={
    schema:RSI_COMMAND_ATTRIBUTION_BINDING_SCHEMA,version:1,
    source_sha:exactSha(source_sha,'source'),
    command_id:uuid(command_id,'command_id'),
    action:token(action,'action'),
    platform:token(platform,'platform',{nullable:true}),
    effect_key:effect_key==null?null:boundedId(effect_key,'effect_key'),
    task_id:boundedId(task_id,'task_id'),
    task_signature_digest:exactDigest(task_signature_digest,'task_signature'),
    environment_fingerprint:boundedId(environment_fingerprint,'environment_fingerprint'),
    model_family:token(model_family,'model_family'),
    runtime_candidate_id:safeRuntimeCandidateId(runtime_candidate_id),
    candidate_id:evidenceCandidateId(candidate_digest),
    candidate_record_digest:exactDigest(candidate_digest,'candidate_record'),
    candidate_sha:exactSha(candidate_sha,'candidate'),
    proposal_digest:exactDigest(proposal_digest,'proposal'),
    skill_digests:skillDigests(skill_digests),
    bound_at:iso(bound_at,'bound_at'),
    state:'BOUND',
    consumed_episode_digest:null,
    consumed_at:null,
    external_planner:true,authored_by_candidate:false,
    binding_is_effect_authority:false,
    candidate_can_edit_binding:false,
    raw_command_payload_stored:false,
    raw_page_text_stored:false,
    raw_user_input_stored:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,
    self_update_authority:false,scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,binding_digest:digest(core)});
}

export function verifyRsiCommandAttributionBinding(row){
  if(!row||typeof row!=='object'||Array.isArray(row)||row.schema!==RSI_COMMAND_ATTRIBUTION_BINDING_SCHEMA||row.version!==1)throw new Error('rsi_command_attribution_binding_invalid');
  assertZero(row,'binding');
  if(row.external_planner!==true||row.authored_by_candidate!==false||row.binding_is_effect_authority!==false||row.candidate_can_edit_binding!==false||row.raw_command_payload_stored!==false||row.raw_page_text_stored!==false||row.raw_user_input_stored!==false)throw new Error('rsi_command_attribution_binding_policy_invalid');
  if(row.state!=='BOUND'||row.consumed_episode_digest!==null||row.consumed_at!==null)throw new Error('rsi_command_attribution_binding_state_invalid');
  const canonical=createRsiCommandAttributionBinding({
    source_sha:row.source_sha,command_id:row.command_id,action:row.action,platform:row.platform,effect_key:row.effect_key,
    task_id:row.task_id,task_signature_digest:row.task_signature_digest,environment_fingerprint:row.environment_fingerprint,
    model_family:row.model_family,runtime_candidate_id:row.runtime_candidate_id,candidate_digest:row.candidate_record_digest,
    candidate_sha:row.candidate_sha,proposal_digest:row.proposal_digest,skill_digests:row.skill_digests,bound_at:row.bound_at,
    external_planner:true,authored_by_candidate:false,
  });
  if(canonical.binding_digest!==exactDigest(row.binding_digest,'binding'))throw new Error('rsi_command_attribution_binding_digest_mismatch');
  if(canonical.candidate_id!==row.candidate_id)throw new Error('rsi_command_attribution_candidate_identity_mismatch');
  return canonical;
}

function storedRow(binding,{state='BOUND',consumed_episode_digest=null,consumed_at=null}={}){
  const checked=verifyRsiCommandAttributionBinding(binding);
  if(!['BOUND','CONSUMED'].includes(state))throw new Error('rsi_command_attribution_stored_state_invalid');
  if(state==='CONSUMED'){
    exactDigest(consumed_episode_digest,'consumed_episode');
    iso(consumed_at,'consumed_at');
  }else if(consumed_episode_digest!=null||consumed_at!=null)throw new Error('rsi_command_attribution_unconsumed_receipt_invalid');
  return Object.freeze({...checked,state,consumed_episode_digest:state==='CONSUMED'?consumed_episode_digest:null,consumed_at:state==='CONSUMED'?consumed_at:null});
}

function registryState(sourceSha,entries){
  const rows=[...entries.values()].sort((a,b)=>a.command_id.localeCompare(b.command_id));
  const core={
    schema:RSI_COMMAND_ATTRIBUTION_REGISTRY_SCHEMA,version:1,source_sha:sourceSha,
    entries:rows,
    append_only_binding_identity:true,
    consumed_rows_are_operational_tombstones:true,
    candidate_can_write_registry:false,
    binding_is_effect_authority:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,
    self_update_authority:false,scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return {...core,state_digest:digest(core)};
}

export class RsiCommandAttributionRegistry{
  #path;#sourceSha;#clock;#entries=new Map();#initialized=false;
  constructor({statePath,source_sha,clock=()=>Date.now()}={}){
    if(!statePath||typeof statePath!=='string')throw new Error('rsi_command_attribution_state_path_required');
    if(typeof clock!=='function')throw new Error('rsi_command_attribution_clock_required');
    this.#path=path.resolve(statePath);this.#sourceSha=exactSha(source_sha,'source');this.#clock=clock;
  }
  #now(){const n=Number(this.#clock());if(!Number.isFinite(n))throw new Error('rsi_command_attribution_clock_invalid');return new Date(n).toISOString()}
  async init(){
    if(this.#initialized)return this.snapshot();
    await fs.mkdir(path.dirname(this.#path),{recursive:true});
    try{
      const parsed=JSON.parse(await fs.readFile(this.#path,'utf8'));
      assertZero(parsed,'registry');
      if(parsed.schema!==RSI_COMMAND_ATTRIBUTION_REGISTRY_SCHEMA||parsed.version!==1||parsed.source_sha!==this.#sourceSha||parsed.candidate_can_write_registry!==false||parsed.binding_is_effect_authority!==false||!Array.isArray(parsed.entries))throw new Error('rsi_command_attribution_registry_invalid');
      const clone=structuredClone(parsed);delete clone.state_digest;
      if(digest(clone)!==exactDigest(parsed.state_digest,'registry_state'))throw new Error('rsi_command_attribution_registry_digest_mismatch');
      if(parsed.entries.length>MAX_BINDINGS)throw new Error('rsi_command_attribution_registry_capacity_exceeded');
      for(const row of parsed.entries){
        const base={...row,state:'BOUND',consumed_episode_digest:null,consumed_at:null};
        const checked=verifyRsiCommandAttributionBinding(base);
        if(this.#entries.has(checked.command_id))throw new Error('rsi_command_attribution_command_duplicate');
        this.#entries.set(checked.command_id,storedRow(checked,{state:row.state,consumed_episode_digest:row.consumed_episode_digest,consumed_at:row.consumed_at}));
      }
    }catch(error){if(error?.code!=='ENOENT')throw error}
    this.#initialized=true;return this.snapshot();
  }
  async #persist(){
    const state=registryState(this.#sourceSha,this.#entries);
    const temp=`${this.#path}.tmp`;
    const handle=await fs.open(temp,'w',0o600);
    try{await handle.writeFile(`${JSON.stringify(state)}\n`,'utf8');await handle.sync()}finally{await handle.close()}
    await fs.rename(temp,this.#path);
    return state;
  }
  #compact(){
    if(this.#entries.size<MAX_BINDINGS)return;
    const consumed=[...this.#entries.values()].filter(x=>x.state==='CONSUMED').sort((a,b)=>String(a.consumed_at).localeCompare(String(b.consumed_at)));
    const removable=Math.max(0,consumed.length-KEEP_CONSUMED);
    for(let i=0;i<removable;i+=1)this.#entries.delete(consumed[i].command_id);
    if(this.#entries.size>=MAX_BINDINGS)throw new Error('rsi_command_attribution_registry_capacity_exceeded');
  }
  async bind(input){
    if(!this.#initialized)throw new Error('rsi_command_attribution_registry_not_initialized');
    const binding=createRsiCommandAttributionBinding({...input,source_sha:this.#sourceSha,bound_at:input?.bound_at||this.#now()});
    const existing=this.#entries.get(binding.command_id);
    if(existing){
      if(existing.binding_digest!==binding.binding_digest)throw new Error('rsi_command_attribution_command_rebind_forbidden');
      return structuredClone(existing);
    }
    const pending=[...this.#entries.values()].filter(x=>x.state==='BOUND').length;
    if(pending>=MAX_PENDING)throw new Error('rsi_command_attribution_pending_capacity_exceeded');
    this.#compact();this.#entries.set(binding.command_id,storedRow(binding));await this.#persist();return structuredClone(this.#entries.get(binding.command_id));
  }
  resolve({command_id,action,platform=null,effect_key=null}={}){
    if(!this.#initialized)throw new Error('rsi_command_attribution_registry_not_initialized');
    const id=uuid(command_id,'command_id');const row=this.#entries.get(id);
    if(!row||row.state!=='BOUND')return null;
    if(row.action!==token(action,'action')||row.platform!==token(platform,'platform',{nullable:true})||row.effect_key!==(effect_key==null?null:boundedId(effect_key,'effect_key')))throw new Error('rsi_command_attribution_runtime_binding_mismatch');
    return structuredClone(row);
  }
  async consume({command_id,episode_digest}={}){
    if(!this.#initialized)throw new Error('rsi_command_attribution_registry_not_initialized');
    const id=uuid(command_id,'command_id');const episode=exactDigest(episode_digest,'episode');const row=this.#entries.get(id);
    if(!row)throw new Error('rsi_command_attribution_binding_not_found');
    if(row.state==='CONSUMED'){
      if(row.consumed_episode_digest!==episode)throw new Error('rsi_command_attribution_consumed_episode_conflict');
      return structuredClone(row);
    }
    const next=storedRow({...row,state:'BOUND',consumed_episode_digest:null,consumed_at:null},{state:'CONSUMED',consumed_episode_digest:episode,consumed_at:this.#now()});
    this.#entries.set(id,next);await this.#persist();return structuredClone(next);
  }
  snapshot(){
    const rows=[...this.#entries.values()];
    return Object.freeze({
      schema:RSI_COMMAND_ATTRIBUTION_REGISTRY_SCHEMA,version:1,source_sha:this.#sourceSha,initialized:this.#initialized,
      binding_count:rows.length,pending_count:rows.filter(x=>x.state==='BOUND').length,consumed_count:rows.filter(x=>x.state==='CONSUMED').length,
      max_pending:MAX_PENDING,max_bindings:MAX_BINDINGS,
      durable_atomic_snapshot:true,candidate_can_write_registry:false,binding_is_effect_authority:false,
      raw_command_payload_stored:false,raw_page_text_stored:false,raw_user_input_stored:false,
      execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
      scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
    });
  }
}

export function rsiCommandAttributionTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.command-attribution-root.v1',version:1,
    policy_path:'apps/metaengine-browser/src/rsi-command-attribution-registry.mjs',
    exact_command_binding_required:true,
    external_planner_required:true,
    candidate_evidence_id_derived_from_candidate_record_digest:true,
    candidate_can_write_registry:false,binding_is_effect_authority:false,
    raw_command_payload_stored:false,raw_page_text_stored:false,raw_user_input_stored:false,
    consumed_binding_tombstones:true,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...root,attribution_root_digest:digest(root)});
}
