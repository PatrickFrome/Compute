/**
 * Wave10 W65 evidence-shape falsifier. All inputs are untrusted.
 * No CI JSON or caller attestations authorize installation or LIVE.
 */
const SHA=/^[a-f0-9]{40}$/;
export const MANDATORY_W65=Object.freeze([
  'Client State Runtime Contracts','ME2 Unified Gate',
  'Client Source Sync W50 (source only)','Client PG17 Qualification W45',
  'Client W48 Serial Staging Source and Disposable PG17',
  'Client W58 Native Windows Backup ACL','Browser Windows Package Smoke',
  'METAENGINE Browser Self Update E2E',
]);
const ACL='Client W58 Native Windows Backup ACL';
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const id=x=>Number.isSafeInteger(x)&&x>0;
function completed(r,sha,name,event,os){
  return obj(r)&&r.name===name&&r.head_sha===sha&&r.event===event
    &&r.status==='completed'&&r.conclusion==='success'&&id(r.run_id)
    &&id(r.attempt)&&Array.isArray(r.jobs)&&r.jobs.length>0
    &&r.jobs.every(j=>obj(j)&&id(j.job_id)&&j.run_id===r.run_id
      &&j.head_sha===sha&&j.status==='completed'&&j.conclusion==='success')
    &&(!os||r.jobs.some(j=>j.platform===os));
}
export function falsifyClientAcceptanceW65(input={}){
  const x=obj(input)?input:{},sha=x.final_source_sha;
  const valid=typeof sha==='string'&&SHA.test(sha);
  const runs=Array.isArray(x.runs)&&x.runs.length<=128?x.runs:[];
  const gates={},reasons=[];
  const check=(name,ok)=>{gates[name]=ok?'CLAIM_CONSISTENT_NOT_ATTESTED':'BLOCKED';if(!ok)reasons.push(name);};
  const seen=(name,event,os)=>valid&&runs.some(r=>completed(r,sha,name,event,os));
  check('CURRENT_FINAL_SHA',valid&&x.current_github_head_sha===sha
    &&x.checked_out_source_sha===sha&&x.candidate_tree_clean===true
    &&x.ancestry_checked_against_current_ref===true);
  check('UNIQUE_RUNS',runs.length>0&&runs.every((r,i)=>id(r?.run_id)
    &&runs.findIndex(v=>v?.run_id===r.run_id)===i));
  for(const name of MANDATORY_W65)
    check('SAME_SHA_'+name,seen(name,'push')||seen(name,'pull_request'));
  check('ACL_PUSH_WINDOWS',seen(ACL,'push','windows'));
  check('ACL_PR_WINDOWS',seen(ACL,'pull_request','windows'));
  check('ACL_PUSH_UBUNTU',seen(ACL,'push','ubuntu'));
  check('ACL_PR_UBUNTU',seen(ACL,'pull_request','ubuntu'));
  check('SOURCE_ONLY',x.receipt_class==='SOURCE_STAGING_ONLY'
    &&x.hosted_fallback===false&&x.install_claimed===false&&x.live_claimed===false);
  return Object.freeze({schema:'metaengine.client.w65.critic.v1',
    state:reasons.length?'BLOCKED':'REVIEW_REQUIRED',source_sha:valid?sha:null,
    gates:Object.freeze(gates),reasons:Object.freeze(reasons),
    evidence_class:'UNTRUSTED_CI_CLAIM_CONSISTENCY_ONLY',
    source_accepted:false,installed_proven:false,live_accepted:false,
    effect_authority:false,can_merge:false,can_install:false,
    native_owner_proven:false,physical_pg_proven:false,
    automatic_retry_allowed:false,hosted_fallback_allowed:false});
}