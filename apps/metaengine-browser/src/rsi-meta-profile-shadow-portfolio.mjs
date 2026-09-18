import crypto from 'node:crypto';

import { verifyRsiRuntimeMetaSkillRecord } from './rsi-runtime-meta-skill-archive.mjs';

export const RSI_META_PROFILE_SHADOW_PORTFOLIO_SCHEMA='metaengine.rsi.meta-profile-shadow-portfolio.v1';
export const RSI_META_PROFILE_SHADOW_SELECTION_SCHEMA='metaengine.rsi.meta-profile-shadow-selection.v1';

const SHA40=/^[0-9a-f]{40}$/;
const SHA256=/^sha256:[0-9a-f]{64}$/;
const SAFE_ROLE=/^[A-Z][A-Z0-9_]{2,63}$/;
const MAX_ENTRIES=64;

function stable(v){
  if(Array.isArray(v))return v.map(stable);
  if(!v||typeof v!=='object')return v;
  return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));
}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}
function exactSha(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA40.test(x))throw new Error(`rsi_meta_portfolio_${l}_sha_invalid`);return x}
function exactDigest(v,l){const x=String(v||'').trim().toLowerCase();if(!SHA256.test(x))throw new Error(`rsi_meta_portfolio_${l}_digest_invalid`);return x}
function role(v,l='role'){const x=String(v||'').trim().toUpperCase();if(!SAFE_ROLE.test(x))throw new Error(`rsi_meta_portfolio_${l}_invalid`);return x}
function assertZero(v,l){
  for(const f of ['execution_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','authority_effect']){
    if(v?.[f]!==false)throw new Error(`rsi_meta_portfolio_${l}_${f}_invalid`);
  }
  if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_meta_portfolio_${l}_retry_invalid`);
}
function zero(extra={}){
  return Object.freeze({
    ...extra,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  });
}
function qualificationDigest(row){
  const core=structuredClone(row);
  delete core.qualification_digest;
  return digest(core);
}
function verifyQualification(row){
  if(!row||row.schema!=='metaengine.rsi.meta-profile-qualification.v1'||row.version!==1)throw new Error('rsi_meta_portfolio_qualification_invalid');
  assertZero(row,'qualification');
  if(row.state!=='QUALIFIED_FOR_SHADOW_PROFILE_SELECTION'||row.qualified_for_shadow_profile_selection!==true
    ||row.live_profile_activation_authorized!==false||row.profile_replacement_authorized!==false
    ||row.canary_activation_authorized!==false||row.external_activation_gate_still_required!==true){
    throw new Error('rsi_meta_portfolio_qualification_policy_invalid');
  }
  const qd=exactDigest(row.qualification_digest,'qualification');
  if(qd!==qualificationDigest(row))throw new Error('rsi_meta_portfolio_qualification_digest_mismatch');
  return row;
}
function nicheForRecord(record){
  const changed=record?.plan?.changed_roles;
  if(!Array.isArray(changed)||changed.length<1||changed.length>5)throw new Error('rsi_meta_portfolio_changed_roles_invalid');
  const roles=[...new Set(changed.map(x=>role(x,'changed_role')))].sort();
  if(roles.length!==changed.length)throw new Error('rsi_meta_portfolio_changed_roles_duplicate');
  return Object.freeze({
    changed_roles:Object.freeze(roles),
    niche_key:roles.join('+'),
  });
}
function canonicalEntry({qualification,meta_record}={}){
  const q=verifyQualification(qualification);
  const record=verifyRsiRuntimeMetaSkillRecord(meta_record);
  if(exactSha(q.source_sha,'qualification_source')!==exactSha(record.source_sha,'record_source'))throw new Error('rsi_meta_portfolio_source_mismatch');
  if(exactDigest(q.meta_record_digest,'qualification_record')!==record.record_digest)throw new Error('rsi_meta_portfolio_record_mismatch');
  if(exactDigest(q.successor_profile_digest,'qualification_successor')!==record.successor_profile_digest)throw new Error('rsi_meta_portfolio_successor_mismatch');
  if(record.eligible_for_meta_archive!==true)throw new Error('rsi_meta_portfolio_archive_eligibility_required');
  const niche=nicheForRecord(record);
  const core={
    source_sha:record.source_sha,
    qualification_id:String(q.qualification_id),
    qualification_digest:q.qualification_digest,
    confirmation_index:Number(q.confirmation_index),
    alpha_used:Number(q.alpha_used),
    meta_record_digest:record.record_digest,
    parent_profile_digest:record.parent_profile_digest,
    successor_profile_digest:record.successor_profile_digest,
    library_digest:record.library_digest,
    changed_roles:niche.changed_roles,
    niche_key:niche.niche_key,
    evidence_relation:record.relation,
    qualification_state:q.state,
    shadow_only:true,
    live_profile_activation_authorized:false,
    canary_activation_authorized:false,
    profile_replacement_authorized:false,
    scalar_rank:null,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,entry_digest:digest(core)});
}

export function createRsiMetaProfileShadowPortfolio({
  qualified_entries,
  external_portfolio_owner=false,
  authored_by_candidate=true,
}={}){
  if(external_portfolio_owner!==true||authored_by_candidate!==false)throw new Error('rsi_meta_portfolio_external_owner_required');
  if(!Array.isArray(qualified_entries)||qualified_entries.length<1||qualified_entries.length>MAX_ENTRIES)throw new Error('rsi_meta_portfolio_entries_invalid');
  const seenQualification=new Set();
  const seenRecord=new Set();
  const entries=qualified_entries.map(canonicalEntry);
  for(const entry of entries){
    if(seenQualification.has(entry.qualification_digest)||seenRecord.has(entry.meta_record_digest))throw new Error('rsi_meta_portfolio_duplicate_entry');
    seenQualification.add(entry.qualification_digest);seenRecord.add(entry.meta_record_digest);
  }
  entries.sort((a,b)=>a.niche_key.localeCompare(b.niche_key)||a.qualification_digest.localeCompare(b.qualification_digest));
  const niches=[...new Set(entries.map(x=>x.niche_key))].sort().map(nicheKey=>{
    const rows=entries.filter(x=>x.niche_key===nicheKey);
    return Object.freeze({
      niche_key:nicheKey,
      changed_roles:rows[0].changed_roles,
      candidate_count:rows.length,
      qualification_digests:Object.freeze(rows.map(x=>x.qualification_digest)),
      successor_profile_digests:Object.freeze(rows.map(x=>x.successor_profile_digest)),
      scalar_winner:null,
      automatic_tie_break_allowed:false,
    });
  });
  const sourceShas=[...new Set(entries.map(x=>x.source_sha))];
  if(sourceShas.length!==1)throw new Error('rsi_meta_portfolio_mixed_source_forbidden');
  const core={
    schema:RSI_META_PROFILE_SHADOW_PORTFOLIO_SCHEMA,version:1,
    source_sha:sourceShas[0],
    entries:Object.freeze(entries),
    entry_count:entries.length,
    niches:Object.freeze(niches),
    niche_count:niches.length,
    max_entries:MAX_ENTRIES,
    policy:'QUALIFIED_EVIDENCE_DERIVED_ROLE_NICHES_V1',
    quality_diversity_archive_semantics:true,
    qualified_phase17_only:true,
    preserve_distinct_niches:true,
    scalar_winner_authoritative:false,
    automatic_cross_niche_ranking_allowed:false,
    automatic_within_niche_tie_break_allowed:false,
    ambiguous_niche_requires_external_disambiguation:true,
    portfolio_is_profile_activation_authority:false,
    portfolio_is_canary_authority:false,
    external_portfolio_owner:true,
    authored_by_candidate:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...core,portfolio_digest:digest(core)});
}

export function verifyRsiMetaProfileShadowPortfolio(portfolio){
  if(!portfolio||portfolio.schema!==RSI_META_PROFILE_SHADOW_PORTFOLIO_SCHEMA||portfolio.version!==1)throw new Error('rsi_meta_portfolio_invalid');
  assertZero(portfolio,'portfolio');
  if(portfolio.quality_diversity_archive_semantics!==true||portfolio.qualified_phase17_only!==true
    ||portfolio.preserve_distinct_niches!==true||portfolio.scalar_winner_authoritative!==false
    ||portfolio.automatic_cross_niche_ranking_allowed!==false||portfolio.automatic_within_niche_tie_break_allowed!==false
    ||portfolio.ambiguous_niche_requires_external_disambiguation!==true
    ||portfolio.portfolio_is_profile_activation_authority!==false||portfolio.portfolio_is_canary_authority!==false
    ||portfolio.external_portfolio_owner!==true||portfolio.authored_by_candidate!==false){
    throw new Error('rsi_meta_portfolio_policy_invalid');
  }
  const clone=structuredClone(portfolio);delete clone.portfolio_digest;
  if(digest(clone)!==exactDigest(portfolio.portfolio_digest,'portfolio'))throw new Error('rsi_meta_portfolio_digest_mismatch');
  if(!Array.isArray(portfolio.entries)||portfolio.entries.length<1||portfolio.entries.length>MAX_ENTRIES)throw new Error('rsi_meta_portfolio_entries_invalid');
  for(const entry of portfolio.entries)assertZero(entry,'entry');
  return portfolio;
}

export function selectRsiMetaProfileShadowCandidate({
  portfolio,
  requested_meta_role,
  qualification_digest=null,
  external_selector=false,
  authored_by_candidate=true,
}={}){
  const checked=verifyRsiMetaProfileShadowPortfolio(portfolio);
  if(external_selector!==true||authored_by_candidate!==false)throw new Error('rsi_meta_portfolio_external_selector_required');
  const requestedRole=role(requested_meta_role,'requested_role');
  const matches=checked.entries.filter(entry=>entry.changed_roles.includes(requestedRole));
  let selected=null;
  let state='NO_MATCH';
  if(qualification_digest!=null){
    const qd=exactDigest(qualification_digest,'requested_qualification');
    selected=matches.find(x=>x.qualification_digest===qd)||null;
    state=selected?'SHADOW_CANDIDATE_IDENTIFIED':'NO_MATCH';
  }else if(matches.length===1){
    selected=matches[0];
    state='SHADOW_CANDIDATE_IDENTIFIED';
  }else if(matches.length>1){
    state='AMBIGUOUS_NICHE';
  }
  return zero({
    schema:RSI_META_PROFILE_SHADOW_SELECTION_SCHEMA,version:1,
    state,
    portfolio_digest:checked.portfolio_digest,
    requested_meta_role:requestedRole,
    candidate_count:matches.length,
    candidate_qualification_digests:Object.freeze(matches.map(x=>x.qualification_digest)),
    selected_qualification_digest:selected?.qualification_digest||null,
    selected_successor_profile_digest:selected?.successor_profile_digest||null,
    shadow_only:true,
    external_selector:true,
    authored_by_candidate:false,
    selection_is_profile_activation_authority:false,
    selection_is_canary_authority:false,
    live_profile_activation_authorized:false,
    canary_activation_authorized:false,
    profile_replacement_authorized:false,
    ambiguous_selection_auto_resolved:false,
  });
}

export function rsiMetaProfileShadowPortfolioTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.meta-profile-shadow-portfolio-root.v1',version:1,
    policy:'QUALIFIED_EVIDENCE_DERIVED_ROLE_NICHES_V1',
    max_entries:MAX_ENTRIES,
    qualification_state_required:'QUALIFIED_FOR_SHADOW_PROFILE_SELECTION',
    exact_meta_record_binding_required:true,
    exact_source_sha_binding_required:true,
    niche_derived_from_verified_changed_roles:true,
    quality_diversity_archive_semantics:true,
    preserve_distinct_niches:true,
    scalar_winner_authoritative:false,
    automatic_cross_niche_ranking_allowed:false,
    automatic_within_niche_tie_break_allowed:false,
    ambiguous_niche_requires_external_disambiguation:true,
    explicit_external_selector_required:true,
    portfolio_is_profile_activation_authority:false,
    selection_is_profile_activation_authority:false,
    selection_is_canary_authority:false,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    scheduler_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  return Object.freeze({...root,portfolio_root_digest:digest(root)});
}
