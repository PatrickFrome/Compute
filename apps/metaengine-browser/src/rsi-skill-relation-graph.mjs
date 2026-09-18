import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { verifyRsiVerifiedSkillLibrary } from './rsi-verified-skill-library.mjs';

export const RSI_SKILL_RELATION_EDGE_SCHEMA='metaengine.rsi.skill-relation-edge.v1';
export const RSI_SKILL_RELATION_GRAPH_SCHEMA='metaengine.rsi.skill-relation-graph.v1';
export const RSI_SKILL_RELATION_STORE_SCHEMA='metaengine.rsi.skill-relation-store.v1';

const SHA256=/^sha256:[0-9a-f]{64}$/;
const SAFE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const RELATIONS=new Set(['PREREQUISITE','ANTAGONISTIC','ENHANCES','CO_OCCURS']);
const SCOPES=new Set(['GLOBAL_VERIFIED','CONTEXT_BOUND']);
const MAX_EDGES=8192;
const MAX_REFS=32;

function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))}
function dg(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}
function digest(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA256.test(x))throw new Error(`rsi_relation_${l}_digest_invalid`);return x}
function id(v,l){const x=String(v||'').trim();if(!SAFE.test(x))throw new Error(`rsi_relation_${l}_invalid`);return x}
function token(v,l,set){const x=String(v||'').trim().toUpperCase();if(!set.has(x))throw new Error(`rsi_relation_${l}_invalid`);return x}
function refs(v){if(!Array.isArray(v)||v.length<1||v.length>MAX_REFS)throw new Error('rsi_relation_evidence_refs_invalid');const out=[...new Set(v.map(x=>id(x,'evidence_ref')))].sort();if(out.length!==v.length)throw new Error('rsi_relation_evidence_ref_duplicate');return Object.freeze(out)}
function assertZero(v,l){for(const f of ['execution_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','authority_effect'])if(v?.[f]!==false)throw new Error(`rsi_relation_${l}_${f}_invalid`);if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_relation_${l}_retry_invalid`)}

function member(library,skillDigest,label){
  const d=digest(skillDigest,label);
  const row=library.entries.find(x=>x.skill_digest===d);
  if(!row)throw new Error(`rsi_relation_${label}_not_in_library`);
  return row;
}

export function createRsiSkillRelationEdge({
  relation_id,library,from_skill_digest,to_skill_digest,relation_type,scope='GLOBAL_VERIFIED',
  context_digest=null,evidence_digest,evidence_refs,
  external_evaluator=false,authored_by_candidate=true,
}={}){
  const lib=verifyRsiVerifiedSkillLibrary(library);
  if(external_evaluator!==true||authored_by_candidate!==false)throw new Error('rsi_relation_external_evaluator_required');
  const from=member(lib,from_skill_digest,'from_skill');
  const to=member(lib,to_skill_digest,'to_skill');
  if(from.skill_digest===to.skill_digest)throw new Error('rsi_relation_self_edge_forbidden');
  const type=token(relation_type,'type',RELATIONS);
  const relationScope=token(scope,'scope',SCOPES);
  const context=relationScope==='CONTEXT_BOUND'?digest(context_digest,'context'):null;
  if(relationScope==='GLOBAL_VERIFIED'&&context_digest!=null)throw new Error('rsi_relation_global_context_forbidden');
  const core={
    schema:RSI_SKILL_RELATION_EDGE_SCHEMA,version:1,
    relation_id:id(relation_id,'relation_id'),
    library_id:lib.library_id,
    from_skill_digest:from.skill_digest,
    from_skill_evidence_digest:from.evidence_digest,
    to_skill_digest:to.skill_digest,
    to_skill_evidence_digest:to.evidence_digest,
    relation_type:type,
    scope:relationScope,
    context_digest:context,
    evidence_digest:digest(evidence_digest,'evidence'),
    evidence_refs:refs(evidence_refs),
    external_evaluator:true,authored_by_candidate:false,
    candidate_can_author_relation:false,
    relation_is_execution_authority:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,relation_digest:dg(core)});
}

export function verifyRsiSkillRelationEdge(row,library){
  if(!row||row.schema!==RSI_SKILL_RELATION_EDGE_SCHEMA||row.version!==1)throw new Error('rsi_relation_edge_invalid');
  assertZero(row,'edge');
  if(row.external_evaluator!==true||row.authored_by_candidate!==false||row.candidate_can_author_relation!==false||row.relation_is_execution_authority!==false)throw new Error('rsi_relation_edge_policy_invalid');
  const canonical=createRsiSkillRelationEdge({
    relation_id:row.relation_id,library,from_skill_digest:row.from_skill_digest,to_skill_digest:row.to_skill_digest,
    relation_type:row.relation_type,scope:row.scope,context_digest:row.context_digest,
    evidence_digest:row.evidence_digest,evidence_refs:row.evidence_refs,
    external_evaluator:true,authored_by_candidate:false,
  });
  if(canonical.relation_digest!==digest(row.relation_digest,'relation'))throw new Error('rsi_relation_edge_digest_mismatch');
  return canonical;
}

export function createRsiSkillRelationGraph({graph_id,library,edges,external_graph_owner=false,authored_by_candidate=true}={}){
  const lib=verifyRsiVerifiedSkillLibrary(library);
  if(external_graph_owner!==true||authored_by_candidate!==false)throw new Error('rsi_relation_graph_external_owner_required');
  if(!Array.isArray(edges)||edges.length>MAX_EDGES)throw new Error('rsi_relation_graph_edges_invalid');
  const checked=edges.map(e=>verifyRsiSkillRelationEdge(e,lib));
  const ids=new Set(),digests=new Set(),pairType=new Set();
  for(const edge of checked){
    if(ids.has(edge.relation_id)||digests.has(edge.relation_digest))throw new Error('rsi_relation_graph_edge_duplicate');
    const key=`${edge.scope}:${edge.context_digest||'-'}:${edge.relation_type}:${edge.from_skill_digest}->${edge.to_skill_digest}`;
    if(pairType.has(key))throw new Error('rsi_relation_graph_semantic_duplicate');
    ids.add(edge.relation_id);digests.add(edge.relation_digest);pairType.add(key);
  }
  const ordered=checked.slice().sort((a,b)=>a.relation_digest.localeCompare(b.relation_digest));
  const core={
    schema:RSI_SKILL_RELATION_GRAPH_SCHEMA,version:1,
    graph_id:id(graph_id,'graph_id'),
    library_id:lib.library_id,library_digest:lib.library_digest,
    skill_digests:Object.freeze(lib.entries.map(x=>x.skill_digest).sort()),
    edges:Object.freeze(ordered),edge_count:ordered.length,
    relation_types:Object.freeze([...RELATIONS].sort()),
    graph_is_append_only_evidence_projection:true,
    edges_require_external_evidence:true,
    context_bound_edges_require_exact_context:true,
    candidate_can_author_edges:false,candidate_can_delete_edges:false,
    graph_is_execution_authority:false,
    external_graph_owner:true,authored_by_candidate:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,graph_digest:dg(core)});
}

export function verifyRsiSkillRelationGraph(row,library){
  if(!row||row.schema!==RSI_SKILL_RELATION_GRAPH_SCHEMA||row.version!==1)throw new Error('rsi_relation_graph_invalid');
  assertZero(row,'graph');
  if(row.graph_is_append_only_evidence_projection!==true||row.edges_require_external_evidence!==true
    ||row.context_bound_edges_require_exact_context!==true||row.candidate_can_author_edges!==false
    ||row.candidate_can_delete_edges!==false||row.graph_is_execution_authority!==false
    ||row.external_graph_owner!==true||row.authored_by_candidate!==false)throw new Error('rsi_relation_graph_policy_invalid');
  const c=createRsiSkillRelationGraph({graph_id:row.graph_id,library,edges:row.edges,external_graph_owner:true,authored_by_candidate:false});
  if(c.graph_digest!==digest(row.graph_digest,'graph'))throw new Error('rsi_relation_graph_digest_mismatch');
  return c;
}

function stateCore(sourceSha,libraryId,edges){
  const core={
    schema:RSI_SKILL_RELATION_STORE_SCHEMA,version:1,source_sha:sourceSha,library_id:libraryId,
    edges,edge_count:edges.length,max_edges:MAX_EDGES,append_only:true,
    candidate_can_delete:false,candidate_can_rewrite:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return {...core,state_digest:dg(core)};
}

export class RsiSkillRelationStore{
  #path;#source;#libraryId;#edges=[];#initialized=false;
  constructor({statePath,source_sha,library_id}={}){
    if(!statePath)throw new Error('rsi_relation_state_path_required');
    this.#path=path.resolve(statePath);
    this.#source=String(source_sha||'').toLowerCase();if(!/^[0-9a-f]{40}$/.test(this.#source))throw new Error('rsi_relation_source_sha_invalid');
    this.#libraryId=id(library_id,'library_id');
  }
  async init(){
    if(this.#initialized)return this.snapshot();
    await fs.mkdir(path.dirname(this.#path),{recursive:true});
    try{
      const parsed=JSON.parse(await fs.readFile(this.#path,'utf8'));assertZero(parsed,'state');
      if(parsed.schema!==RSI_SKILL_RELATION_STORE_SCHEMA||parsed.version!==1||parsed.source_sha!==this.#source||parsed.library_id!==this.#libraryId
        ||parsed.append_only!==true||parsed.candidate_can_delete!==false||parsed.candidate_can_rewrite!==false)throw new Error('rsi_relation_state_invalid');
      const clone=structuredClone(parsed);delete clone.state_digest;
      if(dg(clone)!==digest(parsed.state_digest,'state'))throw new Error('rsi_relation_state_digest_mismatch');
      if(!Array.isArray(parsed.edges)||parsed.edges.length>MAX_EDGES)throw new Error('rsi_relation_state_edges_invalid');
      const seen=new Set();
      for(const edge of parsed.edges){
        assertZero(edge,'edge');digest(edge.relation_digest,'relation');
        if(edge.schema!==RSI_SKILL_RELATION_EDGE_SCHEMA||edge.library_id!==this.#libraryId||edge.external_evaluator!==true||edge.authored_by_candidate!==false)throw new Error('rsi_relation_state_edge_invalid');
        const cloneEdge=structuredClone(edge);delete cloneEdge.relation_digest;
        if(dg(cloneEdge)!==edge.relation_digest)throw new Error('rsi_relation_state_edge_digest_mismatch');
        if(seen.has(edge.relation_digest))throw new Error('rsi_relation_state_edge_duplicate');seen.add(edge.relation_digest);
      }
      this.#edges=parsed.edges;
    }catch(e){if(e?.code!=='ENOENT')throw e}
    this.#initialized=true;return this.snapshot();
  }
  async #persist(){const s=stateCore(this.#source,this.#libraryId,this.#edges);const temp=`${this.#path}.tmp`;const h=await fs.open(temp,'w',0o600);try{await h.writeFile(`${JSON.stringify(s)}\n`,'utf8');await h.sync()}finally{await h.close()}await fs.rename(temp,this.#path);return s}
  async add(edge,library){
    if(!this.#initialized)throw new Error('rsi_relation_store_not_initialized');
    const checked=verifyRsiSkillRelationEdge(edge,library);
    if(checked.library_id!==this.#libraryId)throw new Error('rsi_relation_library_identity_mismatch');
    const semanticKey=`${checked.scope}:${checked.context_digest||'-'}:${checked.relation_type}:${checked.from_skill_digest}->${checked.to_skill_digest}`;
    const existing=this.#edges.find(x=>x.relation_digest===checked.relation_digest);
    if(existing)return Object.freeze({state:'IDEMPOTENT',relation_digest:checked.relation_digest,authority_effect:false});
    if(this.#edges.some(x=>`${x.scope}:${x.context_digest||'-'}:${x.relation_type}:${x.from_skill_digest}->${x.to_skill_digest}`===semanticKey))throw new Error('rsi_relation_semantic_conflict');
    if(this.#edges.length>=MAX_EDGES)throw new Error('rsi_relation_capacity_exceeded');
    this.#edges.push(checked);await this.#persist();
    return Object.freeze({state:'APPENDED',relation_digest:checked.relation_digest,authority_effect:false});
  }
  graph(library){
    if(!this.#initialized)throw new Error('rsi_relation_store_not_initialized');
    return createRsiSkillRelationGraph({graph_id:`graph.${this.#libraryId}`,library,edges:this.#edges,external_graph_owner:true,authored_by_candidate:false});
  }
  snapshot(){return Object.freeze({schema:RSI_SKILL_RELATION_STORE_SCHEMA,version:1,source_sha:this.#source,library_id:this.#libraryId,initialized:this.#initialized,edge_count:this.#edges.length,max_edges:MAX_EDGES,authority_effect:false})}
}

export function rsiSkillRelationGraphTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.skill-relation-graph-root.v1',version:1,
    relation_types:Object.freeze([...RELATIONS].sort()),scopes:Object.freeze([...SCOPES].sort()),
    exact_verified_library_membership_required:true,external_evidence_required:true,
    context_bound_edges_require_exact_context:true,append_only_relation_evidence:true,
    candidate_can_author_edges:false,candidate_can_delete_edges:false,
    relation_graph_can_only_constrain_or_order_selection:true,
    relation_graph_cannot_grant_skill_activity:true,graph_is_execution_authority:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    scheduler_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...root,relation_root_digest:dg(root)});
}
