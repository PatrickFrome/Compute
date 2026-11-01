import {randomUUID} from 'node:crypto';
import {createCodexCliWindowsProcessController} from './codex-cli-windows-process-controller.mjs';
import {createCodexCliLaunch,validateCodexCliJoinedSettlement,codexCliLaunchIdentity,codexCliSettlementSha256} from './codex-cli-physical-settlement.mjs';
import {managedProjectPrivateGitTools,gitInvocationArgv} from './managed-task-project-runtime-core.mjs';
import {markNativePhysicalSettlementUnconfirmed} from './native-coding-host-settlement.mjs';
const failure=reason=>Error('managed_project_native_'+reason);

// Private composition only. The default is the existing suspended Windows Job
// controller. An injected controller is a test/composition seam, not readiness.
export function createNativeManagedProjectGitExecutor({privateTools,processController=null,timeoutMs=120000}={}){
 const tools=managedProjectPrivateGitTools(privateTools),digest=privateTools?.gitExecutableSha256;
 if(!tools||!/^[a-f0-9]{64}$/.test(digest||'')||!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>300000)throw failure('tools_required');
 const controller=processController??createCodexCliWindowsProcessController();
 if(typeof controller.spawn!=='function')throw failure('controller_required');
 const spawn=controller.spawn.bind(controller),records=new WeakMap(),pending=new Set();let closed=false,held=false;
 const revalidate=async()=>{if(privateTools.gitExecutableSha256!==digest)throw failure('tools_changed');await tools.revalidate();if(privateTools.gitExecutableSha256!==digest)throw failure('tools_changed');};
 function execute(input,options={}){
  const job=options.originalJob;
  if(!job||typeof job!=='object')return Promise.reject(failure('original_job_required'));
  const row={job,handle:null,attempted:false,joined:false,stopped:false,stops:[],stopFailure:null};
  const stop=()=>{
   row.stopped=true;
   if(row.handle&&!row.stopIssued){
    row.stopIssued=true;
    // terminate fences resume synchronously in the original controller.
    try{row.stops.push(Promise.resolve(row.handle.terminate('CANCELLED')).catch(error=>{row.stopFailure=error;}));}
    catch(error){row.stopFailure=error;}
   }
  };
  row.stop=stop;pending.add(row);
  row.work=Promise.resolve().then(async()=>{
   const plan=structuredClone(input),argv=gitInvocationArgv(plan),mutation=!plan.effect.endsWith('_READ');
   const {signal,revalidateBeforeBirth,revalidateBeforeResume,assertOwnerCurrent}=options;
   const deadline=Math.min(Date.now()+timeoutMs,options.deadlineAt??Infinity);
   if(!Number.isSafeInteger(deadline)||deadline<=Date.now())throw failure('deadline_invalid');
   if(mutation&&(!signal||![revalidateBeforeBirth,revalidateBeforeResume,assertOwnerCurrent].every(f=>typeof f==='function')))throw failure('original_authority_required');
   const open=()=>{if(closed||row.stopped||signal?.aborted)throw failure('cancelled');if(Date.now()>=deadline)throw failure('deadline_expired');};
   const veto=()=>{open();if(mutation){const result=assertOwnerCurrent();if(result!==undefined){row.stops.push(Promise.resolve(result).catch(()=>{}));throw failure('owner_veto_not_synchronous');}}open();};
   const env={...tools.environment};
   if(!mutation)Object.assign(env,{GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never',GCM_GUI_PROMPT:'0'});
   const spec=Object.freeze({executablePath:tools.gitExecutable,expectedExecutableSha256:digest,args:Object.freeze(argv),cwd:plan.cwd,
    env:Object.freeze(env),runId:randomUUID(),timeoutMs,deadlineAt:new Date(deadline).toISOString(),binding:Object.freeze(plan)});
   const launch=createCodexCliLaunch(spec);let originalFailure=null,result=null,outputFailure=null,bytes=0;const out=[],err=[],streamJoins=[];
   const collect=(stream,chunks)=>{
    streamJoins.push(new Promise(resolve=>{
     stream.on('data',chunk=>{const data=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);bytes+=data.length;
      if(bytes>8*1024*1024){outputFailure??=failure('output_too_large');stop();}else chunks.push(data);});
     stream.once('end',resolve);stream.once('error',error=>{outputFailure??=error;stop();resolve();});
    }));
   };
   signal?.addEventListener('abort',stop,{once:true});
   try{
    open();await revalidate();open();if(mutation)await revalidateBeforeBirth();veto();
    row.attempted=true;
    row.handle=await spawn({...spec,launch});
    collect(row.handle.stdout,out);collect(row.handle.stderr,err);
    if(closed||row.stopped||signal?.aborted)stop();
    const proof=row.handle.proof;
    if(!proof||proof.tree_control_bound!==true||proof.started_suspended!==true||proof.executable_sha256!==digest
      ||codexCliSettlementSha256(proof.launch)!==codexCliSettlementSha256(codexCliLaunchIdentity(launch)))throw failure('process_binding_changed');
    open();await revalidate();open();if(mutation)await revalidateBeforeResume();veto();
    await row.handle.resume('',{deadlineAt:spec.deadlineAt});
    result=await row.handle.completion;
   }catch(error){originalFailure=error;stop();}
   finally{
    if(row.handle){
     try{
      result??=await row.handle.completion;
      validateCodexCliJoinedSettlement(result?.joined_settlement,{proof:row.handle.proof,launch});
      await Promise.all(streamJoins);await Promise.all(row.stops);
      if(row.stopFailure)throw row.stopFailure;
      row.joined=true;
     }catch(error){originalFailure=markNativePhysicalSettlementUnconfirmed(error);}
    }
    await Promise.all(row.stops);
    signal?.removeEventListener('abort',stop);
   }
   if(originalFailure)throw originalFailure;
   if(outputFailure)throw outputFailure;
   if(row.stopped||signal?.aborted)throw failure('cancelled');
   if(result?.exit_code!==0)throw failure('git_failed_'+String(result?.exit_code));
   await revalidate();open();
   const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
   return Object.freeze({code:0,signal:null,stdout:decoder.decode(Buffer.concat(out)),stderr:decoder.decode(Buffer.concat(err))});
  }).then(value=>{records.set(value,row);return value;},error=>{
   const value=error instanceof Error?error:failure('unknown_failure');records.set(value,row);throw value;
  }).finally(()=>{if(row.attempted&&!row.joined)held=true;pending.delete(row);});
  row.work.catch(()=>{});return row.work;
 }
 async function joinOriginalDrain(original,job){
  const row=records.get(original);
  if(!row||row.job!==job)throw markNativePhysicalSettlementUnconfirmed(failure('original_resource_required'));
  await row.work.catch(()=>{});
  if(row.attempted&&!row.joined)throw markNativePhysicalSettlementUnconfirmed(failure('resource_join_unconfirmed'));
 }
 function close(){closed=true;for(const row of pending)row.stop();}
 async function drainResources(){
  if(!closed)throw failure('not_closed');
  const rows=[...pending];await Promise.allSettled(rows.map(row=>row.work));
  if(held||rows.some(row=>row.attempted&&!row.joined))throw markNativePhysicalSettlementUnconfirmed(failure('resource_join_unconfirmed'));
 }
 Object.defineProperties(execute,{joinOriginalDrain:{value:joinOriginalDrain},close:{value:close},drainResources:{value:drainResources}});
 return Object.freeze({execute:Object.freeze(execute),close,drainResources});
}
