import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {nativeCallbackInitialPublicationAck,validateNativeCallbackInitialPublicationAck} from '../src/native-coding-publication-handoff-contract.mjs';
import {generatedRunOwnerRead} from './fixtures/native-run-owner-read.mjs';
function fixture(){
 const scope=generatedRunOwnerRead().scope.execution,requestId=randomUUID(),runId=randomUUID();
 const publication={schema:'metaengine.native-coding.callback-publication.v1',job_sha256:null,
  root:{scope,reserve_request_id:requestId,run_id:runId},cursor:{revision:0,record_count:2,intent_count:0,dispatch_fenced:false,head_sha256:'a'.repeat(64)}};
 return{scope,requestId,runId,publication};
}
test('initial publication acknowledgement is an exact original-request readback, not a dispatch token',()=>{
 const f=fixture(),ack=nativeCallbackInitialPublicationAck(f.publication,f.scope,f.requestId);
 assert.equal(validateNativeCallbackInitialPublicationAck(ack,f),ack);assert.ok(Object.isFrozen(ack));
 assert.equal(ack.execution_ready,false);assert.equal(ack.authority_effect,false);assert.equal(ack.automatic_retry_allowed,false);
 assert.equal(Object.hasOwn(ack,'send_capability'),false);assert.equal(Object.hasOwn(ack,'scope'),false);
});
for(const change of ['job','revision','record_count','intent_count','dispatch_fenced','origin','scope'])test('initial readback refuses non-inert or foreign publication: '+change,()=>{
 const f=fixture();
 if(change==='job')f.publication.job_sha256='b'.repeat(64);
 else if(change==='origin')f.publication.root.reserve_request_id=randomUUID();
 else if(change==='scope')f.publication.root.scope={...f.scope,reservation_id:randomUUID()};
 else f.publication.cursor[change]=change==='dispatch_fenced'?true:3;
 assert.throws(()=>nativeCallbackInitialPublicationAck(f.publication,f.scope,f.requestId));
});
for(const key of ['request_id','run_id','task_id','workspace_id','reservation_id','lease_generation','execution_ready','authority_effect','root_sha256'])test('initial readback refuses changed '+key,()=>{
 const f=fixture(),ack={...nativeCallbackInitialPublicationAck(f.publication,f.scope,f.requestId)};
 ack[key]=['execution_ready','authority_effect'].includes(key)?true:key==='lease_generation'?2:key==='root_sha256'?'invalid':randomUUID();
 assert.throws(()=>validateNativeCallbackInitialPublicationAck(ack,f));
});
test('initial readback rejects hidden extra fields and incomplete execution scope',()=>{
 const f=fixture(),ack=nativeCallbackInitialPublicationAck(f.publication,f.scope,f.requestId);
 assert.throws(()=>validateNativeCallbackInitialPublicationAck({...ack,verified:true},f));
 assert.throws(()=>nativeCallbackInitialPublicationAck(f.publication,{reservation_id:f.scope.reservation_id},f.requestId));
});
