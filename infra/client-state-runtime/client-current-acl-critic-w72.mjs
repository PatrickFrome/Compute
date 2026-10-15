// W72: independently review the *shape* of current-source CI receipts.
// Untrusted input. Actual GitHub events/checkout/ancestry must be fetched independently.
const SHA=/^[0-9a-f]{40}$/;
const validId=x=>Number.isSafeInteger(x)&&x>0;
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
export function falsifyCurrentWindowsAclW72(input={}){
  const x=obj(input)?input:{},sha=x.source_sha;
  const reasons=[];
  if(!(typeof sha==='string'&&SHA.test(sha)&&x.current_github_head_sha===sha
      &&x.checked_out_sha===sha&&x.source_clean===true
      &&x.ancestry_complete===true&&x.evidence_class==='SOURCE_STAGING_ONLY'))
    reasons.push('EXACT_CURRENT_SOURCE_UNPROVEN');
  const runs=Array.isArray(x.runs)&&x.runs.length<=8?x.runs:[];
  if(runs.length!==new Set(runs.map(r=>r?.run_id)).size)reasons.push('REUSED_RUN_ID');
  for(const event of ['push','pull_request']){
    const ok=runs.some(r=>obj(r)&&r.event===event&&r.name==='Client W72 Native Windows ACL (current source)'
      &&r.head_sha===sha&&validId(r.run_id)&&validId(r.attempt)
      &&r.status==='completed'&&r.conclusion==='success'
      &&Array.isArray(r.jobs)&&r.jobs.some(j=>obj(j)&&j.platform==='windows'
        &&validId(j.job_id)&&j.run_id===r.run_id&&j.head_sha===sha
        &&j.status==='completed'&&j.conclusion==='success'));
    if(!ok)reasons.push(event==='push'?'CURRENT_WINDOWS_PUSH_NOT_TERMINAL_SUCCESS':'CURRENT_WINDOWS_PR_NOT_TERMINAL_SUCCESS');
  }
  if(x.install_claimed===true||x.live_claimed===true||x.historical_red_relabelled===true)
    reasons.push('UNAUTHORIZED_ATTESTATION');
  return Object.freeze({schema:'metaengine.client.w72.acl-critic.v1',
    state:reasons.length?'BLOCKED':'REVIEW_REQUIRED',reasons:Object.freeze(reasons),
    evidence_class:'UNTRUSTED_RECEIPT_CONSISTENCY_ONLY',
    source_sha:typeof sha==='string'&&SHA.test(sha)?sha:null,
    source_accepted:false,installed_owner_proven:false,physical_pg_proven:false,
    can_merge:false,can_install:false,live_accepted:false,authority_effect:false,
    automatic_retry_allowed:false,hosted_fallback_allowed:false});
}
