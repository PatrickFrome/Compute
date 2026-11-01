import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {nativeCodingCanonicalJson} from '../src/native-coding-task-context.mjs';
import {prepareNativeCodingAgentRunBridge} from '../src/native-coding-agent-run-bridge.mjs';

// Generated lifecycle counterfactual ONLY. Evaluate the actual bridge body with
// an unqualified gate and broker double; no sockets, SQL, Windows qualification,
// publication proof or native Owner evidence is produced by these tests.
async function fixture({brokerFailure=false,launchFailure=false}={}){
 const events=[],held=Promise.withResolvers();
 const facet={agentOperation:async()=>{events.push('effect');throw Error('generated_no_effect');},
  trackCallback:operation=>Promise.resolve().then(operation),
  fence:async()=>{events.push('fence');},finish:async()=>{events.push('finish');}};
 const broker={issueRun:()=>({}),revokeRun(){events.push('revoke');},
  close:async()=>{events.push('broker-close');},drainCallbacks:async()=>{events.push('broker-drain');}};
 const source=await fs.readFile(new URL('../src/native-coding-agent-run-bridge.mjs',import.meta.url),'utf8');
 const prepare=new Function('requireNativeRunCallbackPublication','createHash','createNativeCodingAgentMcpBroker',
  'nativeCodingAgentMcpIntentBodySha256','createNativeCodingAgentMcpLaunch','validateNativeCodingAgentHostRequest','canonical',
  source.replace(/^import .*;\r?\n/gm,'').replace('export async function','async function')+'\nreturn prepareNativeCodingAgentRunBridge;')
  (()=>{events.push('unqualified-gate');},createHash,async()=>{events.push('broker');if(brokerFailure)throw Error('generated_broker_failure');return broker;},
   ()=>'',async()=>{events.push('launch');if(launchFailure)throw Error('generated_launch_failure');return {fixture_only:true};},x=>x,nativeCodingCanonicalJson);
 const binding={task_id:randomUUID(),agent_id:'agent_generated123',lease_generation:1,agent_generation_epoch:1,role:'IMPLEMENTER',base_sha:'a'.repeat(40)};
 const authorization={...binding,authorized:true,trust_namespace:'LOCAL_OPERATOR_QA',permit_id:randomUUID(),owner_epoch:1,
  user_sid:'S-1-5-21-111-1001',workspace_id:randomUUID(),project_id:randomUUID(),worktree_path:'/generated/worktree'};
 const permit={...authorization,revoked:false,provider_id:randomUUID(),worktree:{path:authorization.worktree_path,base_sha:binding.base_sha},
  expires_at:new Date(Date.now()+60000).toISOString()};
 const input={ownPostgres:{openAgentRunCustody:async()=>{events.push('legacy-open');throw Error('generated_reclaim_forbidden');}},
  runId:randomUUID(),binding,permit,authorization,deadlineAt:permit.expires_at,pins:{},
  takePreparedCustody:()=>{events.push('take');return facet;}};
 return {events,facet,broker,held,input,prepare};
}

test('prepared bridge consumes the original facet once and never reopens legacy custody',async()=>{
 const f=await fixture(),bridge=await f.prepare(f.input);
 assert.deepEqual(f.events,['unqualified-gate','take','broker','launch']);
 await bridge.close();await bridge.drainCallbacks();
 assert.equal(f.events.filter(x=>x==='take').length,1);assert.equal(f.events.includes('legacy-open'),false);
 assert.equal(f.events.includes('effect'),false);assert.equal(f.events.filter(x=>x==='finish').length,1);
});

test('prepared facet requires no alternate openAgentRunCustody capability',async()=>{
 const f=await fixture(),bridge=await f.prepare({...f.input,ownPostgres:{}});await bridge.close();await bridge.drainCallbacks();
 assert.equal(f.events.includes('legacy-open'),false);assert.equal(f.events.filter(x=>x==='take').length,1);
});

for(const value of [null,true,{},'prepared'])test('malformed prepared closure '+JSON.stringify(value)+' cannot fallback or open broker',async()=>{
 const f=await fixture();await assert.rejects(f.prepare({...f.input,takePreparedCustody:value}),/native_coding_agent_run_bridge_denied/);
 assert.equal(f.events.includes('legacy-open'),false);assert.equal(f.events.includes('broker'),false);
});

test('a consumed or throwing prepared closure cannot reopen another custody',async()=>{
 const f=await fixture();await assert.rejects(f.prepare({...f.input,takePreparedCustody:()=>{f.events.push('take');throw Error('generated_consumed');}}),/generated_consumed/);
 assert.deepEqual(f.events,['unqualified-gate','take']);
});

for(const missing of ['agentOperation','trackCallback','fence','finish'])test('malformed original facet missing '+missing+' is rejected and remaining cleanup joined',async()=>{
 const f=await fixture(),facet={...f.facet};delete facet[missing];
 await assert.rejects(f.prepare({...f.input,takePreparedCustody:()=>{f.events.push('take');return facet;}}),/native_coding_agent_run_bridge_denied/);
 assert.equal(f.events.includes('legacy-open'),false);assert.equal(f.events.includes('broker'),false);
 if(missing!=='fence')assert.equal(f.events.includes('fence'),true);
 if(missing!=='finish')assert.equal(f.events.includes('finish'),true);
});

for(const failure of ['brokerFailure','launchFailure'])test('construction '+failure+' fences and joins the same original facet',async()=>{
 const f=await fixture({[failure]:true});await assert.rejects(f.prepare(f.input),/generated_.*_failure/);
 assert.equal(f.events.includes('legacy-open'),false);assert.equal(f.events.filter(x=>x==='take').length,1);
 assert.equal(f.events.filter(x=>x==='fence').length,1);assert.equal(f.events.filter(x=>x==='finish').length,1);
});

test('failed broker construction cleanup still joins the original Host facet before rejecting',async()=>{
 const f=await fixture({launchFailure:true});let joined=false;
 f.broker.close=async()=>{f.events.push('broker-close');throw Error('generated_close_failed');};
 f.facet.finish=async()=>{f.events.push('finish');await f.held.promise;joined=true;};
 const work=f.prepare(f.input);work.catch(()=>{});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.events.includes('finish'),true);assert.equal(joined,false);f.held.resolve();
 await assert.rejects(work,/generated_close_failed/);assert.equal(joined,true);
 assert.equal(f.events.includes('legacy-open'),false);
});

test('late asynchronous prepared handoff is rejected after reclaiming its original facet',async()=>{
 const f=await fixture();let settled=false;
 const work=f.prepare({...f.input,takePreparedCustody:()=>{f.events.push('take');return f.held.promise;}});
 work.then(()=>{settled=true;},()=>{settled=true;});await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);
 f.held.resolve(f.facet);await assert.rejects(work,/native_coding_agent_run_bridge_denied/);
 assert.deepEqual(f.events,['unqualified-gate','take','fence','finish']);
});

test('real CLOSED gate rejects the prepared path before custody, broker or effects',async()=>{
 const f=await fixture();await assert.rejects(prepareNativeCodingAgentRunBridge(f.input),/native_run_callback_directory_durability_unqualified/);
 assert.deepEqual(f.events,[]);
});
