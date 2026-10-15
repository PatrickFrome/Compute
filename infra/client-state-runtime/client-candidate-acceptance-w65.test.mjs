import test from 'node:test';
import assert from 'node:assert/strict';
import {falsifyClientAcceptanceW65,MANDATORY_W65} from './client-candidate-acceptance-w65.mjs';
const SHA='a'.repeat(40),PARENT='b'.repeat(40);
const run=(name,event,id)=>({name,event,head_sha:SHA,run_id:id,attempt:1,status:'completed',
  conclusion:'success',jobs:['windows','ubuntu'].map((platform,i)=>({
    platform,job_id:10*id+i+1,run_id:id,head_sha:SHA,status:'completed',conclusion:'success'}))});
function fixture(){
  const runs=MANDATORY_W65.map((name,i)=>run(name,'push',i+101));
  runs.push(run('Client W58 Native Windows Backup ACL','pull_request',120));
  return {final_source_sha:SHA,current_github_head_sha:SHA,checked_out_source_sha:SHA,
    candidate_tree_clean:true,ancestry_checked_against_current_ref:true,
    receipt_class:'SOURCE_STAGING_ONLY',hosted_fallback:false,
    install_claimed:false,live_claimed:false,runs};
}
test('all plausible receipts prove consistency only, never SOURCE acceptance or LIVE',()=>{
  const r=falsifyClientAcceptanceW65(fixture());
  assert.equal(r.state,'REVIEW_REQUIRED',JSON.stringify(r));
  for(const key of ['source_accepted','installed_proven','live_accepted','effect_authority',
    'can_merge','can_install','automatic_retry_allowed','hosted_fallback_allowed',
    'native_owner_proven','physical_pg_proven'])assert.equal(r[key],false,key);
});
const negatives=[
  ['QUEUED ACL push',x=>x.runs[5].status='queued','ACL_PUSH_WINDOWS'],
  ['QUEUED ACL PR',x=>x.runs.at(-1).status='queued','ACL_PR_WINDOWS'],
  ['old ACL PR head',x=>x.runs.at(-1).head_sha=PARENT,'ACL_PR_WINDOWS'],
  ['old ACL push head',x=>x.runs[5].head_sha=PARENT,'ACL_PUSH_WINDOWS'],
  ['PR-only cannot cover push',x=>x.runs.splice(5,1),'ACL_PUSH_WINDOWS'],
  ['push-only cannot cover PR',x=>x.runs.pop(),'ACL_PR_WINDOWS'],
  ['workflow dispatch not PR',x=>x.runs.at(-1).event='workflow_dispatch','ACL_PR_WINDOWS'],
  ['Windows ACL failed',x=>x.runs[5].jobs[0].conclusion='failure','ACL_PUSH_WINDOWS'],
  ['Windows ACL skipped',x=>x.runs[5].jobs[0].conclusion='skipped','ACL_PUSH_WINDOWS'],
  ['Linux is not Windows ACL',x=>x.runs[5].jobs.shift(),'ACL_PUSH_WINDOWS'],
  ['Linux ACL failure',x=>x.runs[5].jobs[1].conclusion='failure','SAME_SHA_Client W58 Native Windows Backup ACL'],
  ['missing job',x=>x.runs[5].jobs=[],'ACL_PUSH_WINDOWS'],
  ['job from parent',x=>x.runs[5].jobs[0].head_sha=PARENT,'ACL_PUSH_WINDOWS'],
  ['job from foreign run',x=>x.runs[5].jobs[0].run_id=999,'ACL_PUSH_WINDOWS'],
  ['run without attempt',x=>x.runs.at(-1).attempt=0,'ACL_PR_WINDOWS'],
  ['duplicate run ID',x=>x.runs.at(-1).run_id=x.runs[0].run_id,'UNIQUE_RUNS'],
  ['parent ME2 GREEN',x=>x.runs[1].head_sha=PARENT,'SAME_SHA_ME2 Unified Gate'],
  ['failed Client contracts',x=>x.runs[0].conclusion='failure','SAME_SHA_Client State Runtime Contracts'],
  ['missing source sync',x=>x.runs.splice(2,1),'SAME_SHA_Client Source Sync W50 (source only)'],
  ['PG Host-cap red',x=>x.runs[3].jobs[0].conclusion='failure','SAME_SHA_Client PG17 Qualification W45'],
  ['serial PG absent',x=>x.runs.splice(4,1),'SAME_SHA_Client W48 Serial Staging Source and Disposable PG17'],
  ['package skipped',x=>x.runs[6].conclusion='skipped','SAME_SHA_Browser Windows Package Smoke'],
  ['self-update red',x=>x.runs[7].conclusion='failure','SAME_SHA_METAENGINE Browser Self Update E2E'],
  ['current GitHub ref moved',x=>x.current_github_head_sha=PARENT,'CURRENT_FINAL_SHA'],
  ['checkout SHA moved',x=>x.checked_out_source_sha=PARENT,'CURRENT_FINAL_SHA'],
  ['source dirty',x=>x.candidate_tree_clean=false,'CURRENT_FINAL_SHA'],
  ['no independent ancestry',x=>x.ancestry_checked_against_current_ref=false,'CURRENT_FINAL_SHA'],
  ['installed asserted',x=>x.install_claimed=true,'SOURCE_ONLY'],
  ['LIVE asserted',x=>x.live_claimed=true,'SOURCE_ONLY'],
  ['hosted fallback asserted',x=>x.hosted_fallback=true,'SOURCE_ONLY'],
];
for(const [label,mutate,expected] of negatives)test('W65 BLOCKS '+label,()=>{
  const x=fixture();mutate(x);const r=falsifyClientAcceptanceW65(x);
  assert.equal(r.state,'BLOCKED',JSON.stringify(r));assert.ok(r.reasons.includes(expected));
  assert.equal(r.can_install,false);assert.equal(r.live_accepted,false);
});
test('no evidence, scalar, malformed input always blocked',()=>{
  for(const x of [null,undefined,7,false,[],{},'READY']){
    const r=falsifyClientAcceptanceW65(x);
    assert.equal(r.state,'BLOCKED');assert.equal(r.source_sha,null);
    assert.equal(r.effect_authority,false);
  }
});