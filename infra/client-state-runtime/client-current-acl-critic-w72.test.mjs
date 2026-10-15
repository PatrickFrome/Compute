import assert from 'node:assert/strict';
import test from 'node:test';
import {falsifyCurrentWindowsAclW72} from './client-current-acl-critic-w72.mjs';
const sha='a'.repeat(40),old='b'.repeat(40);
function fixture(){
 const runs=['push','pull_request'].map((event,i)=>({
  name:'Client W72 Native Windows ACL (current source)',event,head_sha:sha,
  run_id:200+i,attempt:1,status:'completed',conclusion:'success',
  jobs:[{platform:'windows',job_id:100+i,run_id:200+i,head_sha:sha,status:'completed',conclusion:'success'}]
 }));
 return {source_sha:sha,current_github_head_sha:sha,checked_out_sha:sha,
  source_clean:true,ancestry_complete:true,evidence_class:'SOURCE_STAGING_ONLY',
  install_claimed:false,live_claimed:false,historical_red_relabelled:false,runs};
}
test('even apparently green evidence is REVIEW_REQUIRED, never installed authority',()=>{
 const r=falsifyCurrentWindowsAclW72(fixture());
 assert.equal(r.state,'REVIEW_REQUIRED');
 for(const k of ['source_accepted','installed_owner_proven','can_merge','can_install',
   'live_accepted','authority_effect','automatic_retry_allowed','hosted_fallback_allowed'])
   assert.equal(r[k],false,k);
});
const cases=[
 ['queued push',x=>x.runs[0].status='queued','CURRENT_WINDOWS_PUSH_NOT_TERMINAL_SUCCESS'],
 ['failed PR job',x=>x.runs[1].jobs[0].conclusion='failure','CURRENT_WINDOWS_PR_NOT_TERMINAL_SUCCESS'],
 ['parent green only',x=>x.runs[1].head_sha=old,'CURRENT_WINDOWS_PR_NOT_TERMINAL_SUCCESS'],
 ['Linux is not Windows',x=>x.runs[0].jobs[0].platform='ubuntu','CURRENT_WINDOWS_PUSH_NOT_TERMINAL_SUCCESS'],
 ['historical red relabel',x=>x.historical_red_relabelled=true,'UNAUTHORIZED_ATTESTATION'],
 ['dirty source',x=>x.source_clean=false,'EXACT_CURRENT_SOURCE_UNPROVEN'],
 ['partial ancestry',x=>x.ancestry_complete=false,'EXACT_CURRENT_SOURCE_UNPROVEN'],
 ['reused run',x=>x.runs[1].run_id=200,'REUSED_RUN_ID'],
 ['installed self-report',x=>x.install_claimed=true,'UNAUTHORIZED_ATTESTATION'],
];
for(const [name,mutate,reason] of cases)test('falsifier rejects '+name,()=>{
 const x=fixture();mutate(x);const r=falsifyCurrentWindowsAclW72(x);
 assert.equal(r.state,'BLOCKED');assert.ok(r.reasons.includes(reason),JSON.stringify(r));
});
test('malformed evidence is blocked',()=>{
 for(const x of [null,{},[],42,'PASS']){
  const r=falsifyCurrentWindowsAclW72(x);
  assert.equal(r.state,'BLOCKED');assert.equal(r.live_accepted,false);
 }
});
