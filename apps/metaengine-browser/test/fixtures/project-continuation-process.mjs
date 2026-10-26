// Every invocation is a new process. Intent and receipt state crosses only
// durable files/SQLite. No installed Browser, provider, Owner or PostgreSQL is used.
import fs from 'node:fs/promises';
import {appendFileSync} from 'node:fs';
import path from 'node:path';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {ClientGoalJournal} from '../../src/client-goal-journal.mjs';
import {createClientNativeCodingGoalRouter} from '../../src/client-native-coding-goal.mjs';
import {createAutonomousProjectJournal} from '../../src/autonomous-project-journal.mjs';
import {AutonomousProjectTaskRuntime} from '../../src/autonomous-project-task-runtime.mjs';
import {createNativeCodingGitCommitter} from '../../../../infra/client-state-runtime/native-coding-git-commit.mjs';
import {hash,canonicalHash,writeNewJson,readJson,fixtureNativeResult,fixtureSnapshot,FIXED_SOURCE} from './project-continuation-support.mjs';

const [mode,directory]=process.argv.slice(2);
const m=await readJson(path.join(directory,'manifest.json'));
const log=async(name,value)=>{
  const handle=await fs.open(path.join(directory,name),'a',0o600);
  try{await handle.writeFile(JSON.stringify(value)+'\n');await handle.sync();}finally{await handle.close();}
};
const output=value=>process.stdout.write(JSON.stringify({...value,process_id:process.pid})+'\n');

if(mode==='goal'||mode==='goal-restart'){
  const file=path.join(directory,'goal-journal.json');
  const journal=new ClientGoalJournal({
    loadState:()=>readJson(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;}),
    saveState:async value=>{
      const temporary=file+'.next';await writeNewJson(temporary,value);await fs.rename(temporary,file);
    },
  });
  const router=createClientNativeCodingGoalRouter({journal,request:async(operation,input)=>{
    await log('goal-requests.jsonl',{operation,request_id:input.request_id});
    return fixtureNativeResult(m,input);
  },projectSnapshot:async()=>fixtureSnapshot(m)});
  if(mode==='goal'){
    try{await router.submit({request_id:m.request_id,goal:m.objective});}
    catch(error){if(!m.reject_before_dispatch||!error.message.includes('rejected_before_dispatch:'))throw error;}
  }else{
    await journal.load();await router.refresh(journal.latest());
    try{await router.submit({request_id:m.request_id,goal:m.objective});throw Error('FIXTURE_RESEED_NOT_FENCED');}
    catch(error){if(!error.message.includes('request_already_recorded'))throw error;}
  }
  output({state:journal.latest().state,request_id:journal.latest().request_id,
    goal_id:journal.latest().receipt?.goal_id??null,physical_execution_proven:false});
}else if(mode==='commit'||mode==='commit-restart'){
  const context=await readJson(path.join(directory,'checkpoint-context.json'));
  const query={project_id:context.checkpoint.project_id,checkpoint_id:context.checkpoint.checkpoint_id,
    checkpoint_sha256:context.checkpoint_sha256};
  const original=childProcess.spawn;
  childProcess.spawn=(executable,args,options)=>{
    if(args.includes('update-ref'))appendFileSync(path.join(directory,'git-effects.jsonl'),JSON.stringify({operation:'update-ref',process_id:process.pid})+'\n');
    return original(executable,args,options);
  };syncBuiltinESMExports();
  const committer=createNativeCodingGitCommitter({gitExecutable:m.git_executable,expectedGitExecutableSha256:m.git_executable_sha256,
    journalRoot:path.join(directory,'git-journal'),readCheckpoint:async supplied=>{
      if(canonicalHash(supplied)!==canonicalHash(query))throw Error('FIXTURE_CHECKPOINT_SELECTOR_CHANGED');
      return structuredClone(context);
    },protectStorage:async root=>fs.chmod(root,0o700),verifyStorage:async()=>({owner_dacl_verified:false})});
  try{
    const first=mode==='commit'?await committer.COMMIT_CHECKPOINT(query):await committer.READ_COMMIT(query);
    if(mode==='commit-restart'){
      const duplicate=await committer.COMMIT_CHECKPOINT(query);
      if(canonicalHash(first)!==canonicalHash(duplicate))throw Error('FIXTURE_COMMIT_READBACK_CHANGED');
    }
    output({state:first.state,receipt:first});
  }finally{committer.close();childProcess.spawn=original;syncBuiltinESMExports();}
}else{
  const journal=createAutonomousProjectJournal({filePath:path.join(directory,'effects.sqlite')});
  const lease=m.lease;
  const runtime=new AutonomousProjectTaskRuntime({journal,materializeProject:async()=>({state:'NOT_REQUIRED'}),
    request:async({path:requestPath,body})=>{
      if(requestPath.endsWith('/snapshot'))return fixtureSnapshot(m);
      if(requestPath.endsWith('/spawn')){
        await log('spawn-requests.jsonl',{request_id:body.request_id});
        const file=path.join(directory,'spawn-fixture-record.json');
        let prior=await readJson(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
        if(prior&&canonicalHash(prior.body)!==canonicalHash(body))throw Error('FIXTURE_SPAWN_CONFLICT');
        if(!prior){
          prior={body,response:{schema:'metaengine.devos.project-spawn.v1',project_id:m.project_id,parent_task_id:lease.task_id,
            request_id:body.request_id,children:[{child_index:0,status:'ADMITTED',task_id:m.successor_task_id}],
            proposals_preserved:true,authority_effect:false}};
          await writeNewJson(file,prior);
        }
        return {...prior.response,replayed:false};
      }
      throw Error('FIXTURE_UNEXPECTED_ROUTE');
    }});
  try{
    if(['worker','worker-before-effect','worker-after-effect','worker-restart'].includes(mode)){
      const request={request_id:'fixture:invoice:repair',action:'WRITE_FILE',payload:{path:'invoice.mjs',sha256:hash(FIXED_SOURCE)}};
      const admission=await runtime.beginToolEffect(lease,request);
      if(admission.state==='NEW'){
        if(mode==='worker-before-effect')process.exit(73);
        const file=path.join(m.worktree,'invoice.mjs');
        const handle=await fs.open(file,'w');try{await handle.writeFile(FIXED_SOURCE);await handle.sync();}finally{await handle.close();}
        await log('worker-effects.jsonl',{run_id:m.writer_run_id,task_id:lease.task_id,artifact_sha256:hash(FIXED_SOURCE)});
        if(mode==='worker-after-effect')process.exit(74);
        await runtime.resolveToolEffect(lease,request.request_id,{request_id:request.request_id,status:'COMPLETED',
          summary:JSON.stringify({artifact_sha256:hash(FIXED_SOURCE)}),effect_unknown:false});
      }
      output({state:admission.state==='UNKNOWN'?'HOLD':admission.state,task_id:lease.task_id,run_id:m.writer_run_id,
        artifact_sha256:hash(await fs.readFile(path.join(m.worktree,'invoice.mjs'))),automatic_retry_allowed:false});
    }else if(mode==='turn'||mode==='turn-restart'){
      const results=[{request_id:'fixture:invoice:repair',status:'COMPLETED',summary:JSON.stringify({artifact_sha256:hash(FIXED_SOURCE)})}];
      const result=await runtime.continueConversation(lease,results,async prompt=>{
        await log('turn-effects.jsonl',{prompt_sha256:hash(prompt)});return {effect_state:'PROVEN_COMPOSER_CLEARED'};
      },{observeTranscriptFloor:async()=>120});
      output({...result,checkpoint:await journal.conversationCheckpoint(lease)});
    }else if(['successor','successor-restart','successor-conflict'].includes(mode)){
      const commit=await readJson(path.join(directory,'commit-result.json'));
      const objective=`Verify committed invoice artifact ${commit.receipt.head}`+(mode==='successor-conflict'?' with changed scope':'');
      try{
        const [result]=await runtime.serveToolRequests({lease,requests:[{request_id:'fixture:successor:review',action:'PROJECT_SPAWN',
          payload:{children:[{role:'CRITIC',objective}]}}]});
        if(mode==='successor-conflict')throw Error('FIXTURE_SUCCESSOR_CONFLICT_NOT_FENCED');
        output({state:result.status,receipt:JSON.parse(result.summary)});
      }catch(error){
        if(mode!=='successor-conflict'||!error.message.includes('binding_conflict'))throw error;
        output({state:'HOLD',reason:'SUCCESSOR_BINDING_CONFLICT',automatic_retry_allowed:false});
      }
    }else throw Error('FIXTURE_MODE_INVALID');
  }finally{await runtime.close();}
}
