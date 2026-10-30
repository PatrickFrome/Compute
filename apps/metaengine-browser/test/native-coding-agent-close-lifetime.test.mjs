import {generatedRunCustodyDouble} from './fixtures/native-coding-run-custody-double.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {nativeCodingCanonicalJson} from '../src/native-coding-task-context.mjs';
// Executes the actual bridge and runtime wrapper source with a generated broker
// lifecycle double; default publication gate is deliberately excluded from
// this counterfactual source extraction, NOT production readiness. No sockets are opened; the required socket lane is untouched.
async function fixture({legacy=false}={}){
 let source=await fs.readFile(new URL('../src/native-coding-agent-run-bridge.mjs',import.meta.url),'utf8');
 if(legacy){const begin=source.indexOf('      close(){'),end=source.indexOf('      },',begin)+8;assert.ok(begin>0&&end>begin);
  source=source.slice(0,begin)+'      async close(){if(closed)return;closed=true;broker.revokeRun(runId);await broker.close();job=null;},'+source.slice(end);}
 const gate=Promise.withResolvers(),callbacks=Promise.withResolvers();let closes=0,revokes=0;
 const broker={issueRun:()=>({}),revokeRun:()=>{revokes++;},close:()=>{closes++;return gate.promise;},drainCallbacks:()=>callbacks.promise};
 const prepare=new Function('requireNativeRunCallbackPublication','createHash','createNativeCodingAgentMcpBroker','nativeCodingAgentMcpIntentBodySha256','createNativeCodingAgentMcpLaunch',
  'validateNativeCodingAgentHostRequest','canonical',source.replace(/^import .*;\n/gm,'').replace('export async function','async function')+'\nreturn prepareNativeCodingAgentRunBridge;')
  (()=>{},createHash,async()=>broker,()=>'',async()=>({fixture_only:true}),x=>x,nativeCodingCanonicalJson);
 const binding={task_id:randomUUID(),agent_id:'agent_fixture-12345678',lease_generation:1,agent_generation_epoch:1,role:'IMPLEMENTER',base_sha:'a'.repeat(40)};
 const authorization={...binding,permit_id:randomUUID(),owner_epoch:1,user_sid:'S-1-5-21-111-1001',workspace_id:randomUUID(),project_id:randomUUID(),
  worktree_path:'/fixture/worktree',authorized:true,trust_namespace:'LOCAL_OPERATOR_QA'};
 const permit={...authorization,revoked:false,provider_id:randomUUID(),worktree:{path:authorization.worktree_path,base_sha:binding.base_sha},expires_at:new Date(Date.now()+60000).toISOString()};
 const bridge=await prepare({ownPostgres:generatedRunCustodyDouble(async()=>{throw Error('NO_HOST_EFFECT_ALLOWED');}),runId:randomUUID(),binding,permit,authorization,deadlineAt:permit.expires_at,pins:{}});
 const runtime=await fs.readFile(new URL('../src/native-coding-runtime.mjs',import.meta.url),'utf8');
 const start=runtime.indexOf('        let bridgeClosePromise=null,bridgeCallbackPromise=null;'),end=runtime.indexOf('        activeBridges.add(wrapper);',start);
 assert.ok(start>0&&end>start);const active=new Set();
 const wrapperSource=legacy?'const wrapper=Object.freeze({async close(){activeBridges.delete(wrapper);await bridge.close();}});':runtime.slice(start,end);
 const wrapper=new Function('bridge','activeBridges','closed','fail',wrapperSource+'\nactiveBridges.add(wrapper);return wrapper;')
  (bridge,active,false,()=>{throw Error('closed');});
 return {bridge,wrapper,active,gate,callbacks,get closes(){return closes;},get revokes(){return revokes;}};
}
test('cancellation unawaited close, runner finally and concurrent quit join exactly one original transport promise',async()=>{
 const f=await fixture();const cancelled=f.wrapper.close();void cancelled.catch(()=>{});
 assert.equal(f.wrapper.close(),cancelled);const direct=f.bridge.close();assert.equal(f.bridge.close(),direct);
 assert.equal(f.active.has(f.wrapper),true);assert.equal(f.closes,1);assert.equal(f.revokes,1);
 let finished=false;cancelled.then(()=>{finished=true;});await Promise.resolve();assert.equal(finished,false);
 f.gate.resolve();await Promise.all([cancelled,direct]);assert.equal(f.active.size,1);
 const joined=f.wrapper.drainCallbacks();assert.equal(f.wrapper.drainCallbacks(),joined);f.callbacks.resolve();await joined;assert.equal(f.active.size,0);assert.equal(f.closes,1);
 assert.equal(f.wrapper.close(),cancelled);
});
test('failed original transport close stays retained and explicit; repeat/quit never creates another shutdown',async()=>{
 const f=await fixture(),first=f.wrapper.close();const refusal=assert.rejects(first,/fixture_close_failed/);
 f.gate.reject(Error('fixture_close_failed'));await refusal;
 assert.equal(f.active.has(f.wrapper),true);assert.equal(f.wrapper.close(),first);
 await assert.rejects(f.wrapper.close(),/fixture_close_failed/);assert.equal(f.closes,1);assert.equal(f.revokes,1);
});
test('transport close does not call or await a fabricated Host effect/readback',async()=>{
 const f=await fixture();const closing=f.wrapper.close();f.gate.resolve();await closing;
 assert.equal(f.closes,1);assert.equal(f.active.size,1);f.callbacks.resolve();await f.wrapper.drainCallbacks();assert.equal(f.active.size,0);
});

test('counterfactual old close loses registration and reports a second close finished while original still owns transport',async()=>{
 const f=await fixture({legacy:true});const original=f.wrapper.close();let firstDone=false;original.then(()=>{firstDone=true;});
 await f.wrapper.close();assert.equal(firstDone,false);assert.equal(f.active.size,0);assert.equal(f.closes,1);
 f.gate.resolve();await original;
});
