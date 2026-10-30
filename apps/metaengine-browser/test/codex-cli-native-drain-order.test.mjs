import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {resolveCodexCliJobHelperSource} from '../src/codex-cli-windows-process-controller.mjs';
// Native SOURCE ordering plus a deterministic dependency model, not C#/Win32
// execution. A blocked stdin writer/readers become drainable only after the
// exact child tree releases its pipe ends. A timeout is always a failed proof.
const stages=[
 ['terminate','Require(TerminateJobObject(job,124),"descendant_cleanup_failed");'],
 ['accounting','Require(empty && accounting.total>=1 && accounting.terminated<=accounting.total,"accounting_not_empty");'],
 ['pipes','Require(Task.WaitAll(new[]{outTask,errTask,inputTask},5000),"pipe_drain_unconfirmed");'],
 ['thread','CloseChecked(ref process.thread,"thread_close_failed");'],
 ['process','CloseChecked(ref process.process,"process_close_failed");'],
 ['job','CloseChecked(ref job,"job_close_failed");'],
 ['candidate','Emit(Terminal("exit",launch,helperIdentity,runId,process,birth,code,reason,false,null,accounting));'],
];
function ordered(source){return stages.map(([name,marker])=>{assert.equal(source.split(marker).length,2,marker);return {name,index:source.indexOf(marker)};})
 .sort((a,b)=>a.index-b.index).map(x=>x.name);}
function model(order,{fail=null}={}){
 const calls=[];let treeEmpty=false,pipeEndsGone=false,drained=false,emitted=false;
 for(const name of order){calls.push(name);if(name===fail)return {calls,emitted,hold:true};
  if(name==='terminate'){treeEmpty=true;pipeEndsGone=true;}
  if(name==='accounting'&&!treeEmpty)return {calls,emitted,hold:true};
  if(name==='pipes'){if(!pipeEndsGone)return {calls,emitted,hold:true};drained=true;}
  if(name==='candidate'){assert.ok(treeEmpty&&drained);emitted=true;}
 }return {calls,emitted,hold:false};
}
test('normal native cleanup terminates descendants before joining held stdin/stdout/stderr and before every checked close',async()=>{
 const source=await fs.readFile(resolveCodexCliJobHelperSource(),'utf8'),order=ordered(source);
 assert.deepEqual(order,stages.map(x=>x[0]));assert.equal(model(order).emitted,true);
 assert.match(source,/SafeFileHandle\(handle,false\)/);assert.match(source,/finally \{ CloseChecked\(ref handle,"output_pipe_close_failed"\); \}/);
 assert.match(source,/finally \{ CloseChecked\(ref handle,"input_pipe_close_failed"\); \}/);
 const early=source.replace(stages[2][1],'').replace(stages[0][1],stages[2][1]+'\n'+stages[0][1]);
 const counterfactual=model(ordered(early));assert.equal(counterfactual.hold,true);assert.equal(counterfactual.emitted,false);
});
for(const failure of stages.slice(0,-1).map(x=>x[0]))test('failed/unconfirmed native '+failure+' cannot emit a cleanup candidate',async()=>{
 const source=await fs.readFile(resolveCodexCliJobHelperSource(),'utf8'),result=model(ordered(source),{fail:failure});
 assert.equal(result.hold,true);assert.equal(result.emitted,false);assert.equal(result.calls.includes('candidate'),false);
});
