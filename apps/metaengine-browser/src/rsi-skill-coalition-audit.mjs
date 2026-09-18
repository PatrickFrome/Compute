import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const RSI_SKILL_COALITION_OBSERVATION_SCHEMA='metaengine.rsi.skill-coalition-observation.v1';
export const RSI_SKILL_COALITION_AUDIT_SCHEMA='metaengine.rsi.skill-coalition-audit.v1';
export const RSI_SKILL_COALITION_STATE_SCHEMA='metaengine.rsi.skill-coalition-state.v1';

const SHA256=/^sha256:[0-9a-f]{64}$/;
const SAFE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const MAX_ROWS=8192;
function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))}
function dg(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}
function digest(v,l){const x=String(v||'').toLowerCase();if(!SHA256.test(x))throw new Error(`rsi_coalition_${l}_digest_invalid`);return x}
function id(v,l){const x=String(v||'').trim();if(!SAFE.test(x))throw new Error(`rsi_coalition_${l}_invalid`);return x}
function zero(v,l){for(const f of ['execution_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','authority_effect'])if(v?.[f]!==false)throw new Error(`rsi_coalition_${l}_${f}_invalid`);if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_coalition_${l}_retry_invalid`)}
function skills(v){if(!Array.isArray(v)||v.length<1||v.length>32)throw new Error('rsi_coalition_skills_invalid');const s=[...new Set(v.map(x=>digest(x,'skill')))].sort();if(s.length!==v.length)throw new Error('rsi_coalition_skill_duplicate');return Object.freeze(s)}
function score(v){const n=Number(v);if(!Number.isFinite(n)||n<0||n>1)throw new Error('rsi_coalition_utility_invalid');return Math.round(n*1e9)/1e9}

export function createRsiSkillCoalitionObservation({observation_id,context_digest,trial_group,skill_digests,utility,evaluator_digest,evidence_refs,external_evaluator=false,authored_by_candidate=true}={}){
  if(external_evaluator!==true||authored_by_candidate!==false)throw new Error('rsi_coalition_external_evaluator_required');
  if(!Array.isArray(evidence_refs)||evidence_refs.length<1)throw new Error('rsi_coalition_evidence_refs_invalid');
  const core={schema:RSI_SKILL_COALITION_OBSERVATION_SCHEMA,version:1,observation_id:id(observation_id,'observation_id'),context_digest:digest(context_digest,'context'),trial_group:id(trial_group,'trial_group'),skill_digests:skills(skill_digests),utility:score(utility),evaluator_digest:digest(evaluator_digest,'evaluator'),evidence_refs:Object.freeze([...new Set(evidence_refs.map(x=>id(x,'evidence_ref')))].sort()),external_evaluator:true,authored_by_candidate:false,candidate_can_choose_coalition:false,candidate_can_write_utility:false,execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false};
  return Object.freeze({...core,observation_digest:dg(core)});
}
export function verifyRsiSkillCoalitionObservation(row){
  if(!row||row.schema!==RSI_SKILL_COALITION_OBSERVATION_SCHEMA||row.version!==1)throw new Error('rsi_coalition_observation_invalid');
  zero(row,'observation');
  const c=createRsiSkillCoalitionObservation({...row,external_evaluator:true,authored_by_candidate:false});
  if(c.observation_digest!==digest(row.observation_digest,'observation'))throw new Error('rsi_coalition_observation_digest_mismatch');
  return c;
}
function diffOne(a,b){
  const A=new Set(a),B=new Set(b);const add=[...A].filter(x=>!B.has(x));const rem=[...B].filter(x=>!A.has(x));
  return add.length===1&&rem.length===0?add[0]:null;
}
export function createRsiSkillCoalitionAudit({context_digest,observations,min_negative_pairs=2}={}){
  const ctx=digest(context_digest,'context');
  if(!Array.isArray(observations)||observations.length<2)throw new Error('rsi_coalition_observations_insufficient');
  const rows=observations.map(verifyRsiSkillCoalitionObservation).filter(r=>r.context_digest===ctx);
  const seen=new Set(rows.map(r=>r.observation_digest));if(seen.size!==rows.length)throw new Error('rsi_coalition_observation_duplicate');
  const marginals=new Map();
  for(const withRow of rows)for(const withoutRow of rows){
    if(withRow.trial_group!==withoutRow.trial_group)continue;
    const skill=diffOne(withRow.skill_digests,withoutRow.skill_digests);if(!skill)continue;
    if(!marginals.has(skill))marginals.set(skill,[]);
    marginals.get(skill).push(withRow.utility-withoutRow.utility);
  }
  const summaries=[...marginals.entries()].map(([skill,vals])=>{
    const mean=vals.reduce((a,b)=>a+b,0)/vals.length;
    const neg=vals.filter(v=>v<0).length,pos=vals.filter(v=>v>0).length;
    return Object.freeze({skill_digest:skill,pair_count:vals.length,mean_marginal:Math.round(mean*1e9)/1e9,negative_pair_count:neg,positive_pair_count:pos,mask:neg>=min_negative_pairs&&pos===0&&mean<0});
  }).sort((a,b)=>a.skill_digest.localeCompare(b.skill_digest));
  const masked=summaries.filter(x=>x.mask).map(x=>x.skill_digest);
  const core={schema:RSI_SKILL_COALITION_AUDIT_SCHEMA,version:1,context_digest:ctx,observation_digests:rows.map(x=>x.observation_digest).sort(),summaries,masked_skill_digests:Object.freeze(masked),min_negative_pairs,candidate_can_choose_threshold:false,coalition_pollution_checked:true,cross_skill_interaction_evidence_required:true,mask_is_execution_authority:false,execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false};
  return Object.freeze({...core,audit_digest:dg(core)});
}
function state(source,rows){const core={schema:RSI_SKILL_COALITION_STATE_SCHEMA,version:1,source_sha:source,rows,append_only:true,candidate_can_delete:false,execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false};return {...core,state_digest:dg(core)}}
export class RsiSkillCoalitionAuditStore{
  #path;#source;#rows=[];#init=false;
  constructor({statePath,source_sha}={}){if(!statePath)throw new Error('rsi_coalition_state_path_required');this.#path=path.resolve(statePath);this.#source=String(source_sha||'').toLowerCase();if(!/^[0-9a-f]{40}$/.test(this.#source))throw new Error('rsi_coalition_source_sha_invalid')}
  async init(){if(this.#init)return this.snapshot();await fs.mkdir(path.dirname(this.#path),{recursive:true});try{const p=JSON.parse(await fs.readFile(this.#path,'utf8'));zero(p,'state');if(p.schema!==RSI_SKILL_COALITION_STATE_SCHEMA||p.version!==1||p.source_sha!==this.#source||p.append_only!==true||p.candidate_can_delete!==false)throw new Error('rsi_coalition_state_invalid');const clone=structuredClone(p);delete clone.state_digest;if(dg(clone)!==digest(p.state_digest,'state'))throw new Error('rsi_coalition_state_digest_mismatch');if(!Array.isArray(p.rows)||p.rows.length>MAX_ROWS)throw new Error('rsi_coalition_rows_invalid');this.#rows=p.rows.map(verifyRsiSkillCoalitionObservation)}catch(e){if(e?.code!=='ENOENT')throw e}this.#init=true;return this.snapshot()}
  async #persist(){const s=state(this.#source,this.#rows);const temp=`${this.#path}.tmp`;const h=await fs.open(temp,'w',0o600);try{await h.writeFile(`${JSON.stringify(s)}\n`,'utf8');await h.sync()}finally{await h.close()}await fs.rename(temp,this.#path);return s}
  async add(row){if(!this.#init)throw new Error('rsi_coalition_not_initialized');const x=verifyRsiSkillCoalitionObservation(row);if(this.#rows.some(r=>r.observation_digest===x.observation_digest))return Object.freeze({state:'IDEMPOTENT',authority_effect:false});if(this.#rows.length>=MAX_ROWS)throw new Error('rsi_coalition_capacity_exceeded');this.#rows.push(x);await this.#persist();return Object.freeze({state:'APPENDED',observation_digest:x.observation_digest,authority_effect:false})}
  audit(context_digest){if(!this.#init)throw new Error('rsi_coalition_not_initialized');return createRsiSkillCoalitionAudit({context_digest,observations:this.#rows})}
  auditIfAvailable(context_digest){if(!this.#init)throw new Error('rsi_coalition_not_initialized');const ctx=digest(context_digest,'context');const rows=this.#rows.filter(r=>r.context_digest===ctx);if(rows.length<2)return null;try{return createRsiSkillCoalitionAudit({context_digest:ctx,observations:rows})}catch(e){if(e?.message==='rsi_coalition_observations_insufficient')return null;throw e}}
  snapshot(){return Object.freeze({schema:RSI_SKILL_COALITION_STATE_SCHEMA,version:1,source_sha:this.#source,initialized:this.#init,row_count:this.#rows.length,authority_effect:false})}
}
export function rsiSkillCoalitionAuditTrustRootSnapshot(){const root={schema:'metaengine.rsi.skill-coalition-audit-root.v1',version:1,external_evaluator_required:true,matched_coalition_pairs_required:true,coalition_pollution_checked:true,context_bound:true,candidate_can_choose_coalition:false,candidate_can_write_utility:false,candidate_can_choose_threshold:false,mask_is_execution_authority:false,execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false};return Object.freeze({...root,coalition_root_digest:dg(root)})}
