// W56 actual disposable PG17 + temporary Git serial continuation.
// Owns no installed PGDATA, model Send, provider token, or external effect.
import test from 'node:test';
import { createW64DisposablePgLifecycle } from './client-serial-loop-pg17-lifecycle-w64.mjs';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, realpath, rm } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
import { createDevosSupervisorRoutes } from '../../apps/metaengine-browser/supabase/a2-browser-native-supervisor-v1/devos-routes.mjs';
import { inspectStagingLease, sealStagingCheckpoint,
  inspectLiveCompletionForStaging, verifyStagingCheckpointDigest } from './client-serial-loop-staging-w48.mjs';
import { inspectStagingNextLease } from './client-serial-loop-staging-w56.mjs';
import { probeW64GeneratedDevelopmentWorker } from './client-serial-loop-development-worker-w64.mjs';
import { runW80GeneratedFixtureEdit } from './client-c2-worker-edit-w80.mjs';

const BIN = process.env.W48_PG17_BIN;
const digest = v => createHash('sha256').update(v).digest('hex');
const git = (cwd,...args) => execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
const runNode = (cwd,...args) => {
  const env={...process.env}; delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath,args,{cwd,env,encoding:'utf8'}).status;
};
const q = v => {
  // Every SQL literal is a generated UUID, SHA or a fixed internal constant.
  assert.match(String(v),/^[a-zA-Z0-9_./-]+$/);
  return "'" + v + "'";
};
async function port() {
  const server=net.createServer();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const result=server.address().port;
  await new Promise(resolve=>server.close(resolve));
  return result;
}
async function nextSupervisorLease(workspace_id,task_id) {
  const AGENT='agent_implementer0002', owner_generation=8, lease_generation=2;
  const control={schema:'metaengine.devos.environment-state.v1',state:'OPEN',
    authoritative:true,authority_effect:false,continuous_service_allowed:true,
    workspace_id,generation_floor:owner_generation,refill_enabled:true,
    supervisor_admission_enabled:true};
  const task={task_id,state:'READY',role:'IMPLEMENTER',priority:100,
    authority_effect:false,task_spec:{fleet_coordination_v1:{
      version:1,role:'IMPLEMENTER',resource:'BROWSER',slots:1,dependencies:[]}}};
  const snapshot={active_tasks:[task],active_claims:[],completed_tasks:[],recent_events:[],authority_effect:false};
  const calls=[];
  const route=createDevosSupervisorRoutes({workspaceId:workspace_id,
    readRuntimeControl:async()=>control,
    rpc:async name=>{
      calls.push(name);
      if(name==='devos_fleet_snapshot_v1')return snapshot;
      if(name==='devos_fleet_reconcile_v1')return {authority_effect:false};
      if(name==='devos_fleet_lease_v1')return {leased:true,task_id,agent_id:AGENT,
        role:'IMPLEMENTER',lease_generation,authority_effect:false};
      throw Error('unknown_fixed_rpc');
    }});
  const response=await route({req:{method:'POST'},path:'/v1/devos/cycle',
    clientId:'w56-disposable-only',body:{fleet:{agents:[{agent_id:AGENT,
      role:'IMPLEMENTER',lifecycle_state:'ACTIVE',tab_id:'tab-1',
      target_id:'webcontents:71',generation_epoch:9}]}}});
  const cycle=await response.json();
  assert.equal(calls.filter(x=>x==='devos_fleet_lease_v1').length,1);
  const lease=inspectStagingLease({snapshot,runtimeControl:control,cycle,
    workspace_id,task_id,agent_id:AGENT,lease_generation});
  assert.equal(lease.state,'STAGING_LEASE_OBSERVED');
  return lease;
}

test('W56 REAL PG17: source red-to-green, independent process critic, crash/restart, next leased task readback', {
  skip:!BIN?'real PG17 unconfigured (CI must provide W48_PG17_BIN; no CI skip permitted)':false,
  timeout:150_000,
},async()=>{
  const base=await realpath(os.tmpdir()), clusterId=randomUUID();
  const root=await mkdtemp(path.join(base,'metaengine-w56-own-pg17-'));
  const sourceDir=path.join(root,'unique-git'),data=path.join(root,'pgdata');
  const marker=path.join(root,'owned.json');
  const env={...process.env,PGHOST:'127.0.0.1',PGPORT:String(await port()),
    PGUSER:'w56_temporary',PGDATABASE:'postgres',PGSSLMODE:'disable',
    PGCONNECT_TIMEOUT:'3',HOME:root};
  const run=(name,args)=>(execFileSync(path.join(BIN,name+(process.platform==='win32'?'.exe':'')),args,{
    env,encoding:'utf8',stdio:name==='pg_ctl'?'ignore':['ignore','pipe','pipe'],timeout:35_000}) ?? '').trim();
  const sql=s=>run('psql',['-X','-v','ON_ERROR_STOP=1','-A','-t','-c',s]);
  const lifecycle = createW64DisposablePgLifecycle({run,root,data,port:Number(env.PGPORT),pgUser:'w56_temporary'});
  try {
    await writeFile(marker,JSON.stringify({schema:'metaengine.w56.disposable-pg17.v1',clusterId}));
    // Opt-in W80 physical PG17 lane uses a real locked linked worktree.
    // Historical W56 test is unchanged unless explicitly run as W80 staging.
    const w80 = process.env.W80_GENERATED_WORKER === '1';
    const seed=w80?path.join(root,'w80-seed'):sourceDir;
    await mkdir(seed);
    git(seed,'init','-q');
    // The repair authority binds exact LF bytes. A generated repo must not
    // inherit runner-wide autocrlf when its linked worktree is checked out.
    await writeFile(path.join(seed,'.gitattributes'),'*.mjs text eol=lf\n');
    const src=path.join(sourceDir,'calc.mjs'),tst=path.join(sourceDir,'calc.test.mjs');
    await writeFile(path.join(seed,'calc.mjs'),'export const sum=(a,b)=>a-b;\n');
    await writeFile(path.join(seed,'calc.test.mjs'),"import test from 'node:test';import assert from 'node:assert/strict';import {sum} from './calc.mjs';test('goal',()=>assert.equal(sum(2,3),5));\n");
    git(seed,'add','--','.gitattributes','calc.mjs','calc.test.mjs');
    git(seed,'-c','user.email=w56@example.invalid','-c','user.name=W56 Fixture','commit','-qm','red test');
    if(w80){
      const bare=path.join(root,'repo.git');
      git(root,'clone','-q','--bare',seed,bare);
      git(root,'--git-dir',bare,'worktree','add','--detach',sourceDir,'HEAD');
      git(root,'--git-dir',bare,'worktree','lock',sourceDir);
    }
    const base_sha=git(sourceDir,'rev-parse','HEAD');
    const developmentBefore=await probeW64GeneratedDevelopmentWorker(sourceDir);
    assert.equal(developmentBefore.head,base_sha,'real DevelopmentPlane must read red Git HEAD');
    assert.equal(runNode(sourceDir,'--test',tst),1,'real red test');
    const workspace_id=randomUUID(),task_id=randomUUID(),run_id=randomUUID(),
      effect_id=randomUUID(),next_task_id=randomUUID();
    if(w80){
      const receipt=await runW80GeneratedFixtureEdit({sourceDir,head:base_sha,
        task_id,run_id,workspace_id,effect_id,lease_generation:3,
        owner_generation:8,owner_epoch:8});
      assert.equal(receipt.state,'SOURCE_EDIT_APPLIED_STAGING');
      assert.equal(receipt.task_id,task_id);
      assert.equal(receipt.effect_id,effect_id);
      assert.equal(receipt.lease_generation,3);
      assert.equal(receipt.authority_effect,false,'generated signed scope cannot attest native Host');
    } else {
      await writeFile(src,'export const sum=(a,b)=>a+b;\n');
    }
    git(sourceDir,'add','--','calc.mjs');
    git(sourceDir,'-c','user.email=w56@example.invalid','-c','user.name=W56 Fixture','commit','-qm','bounded green edit');
    const head_sha=git(sourceDir,'rev-parse','HEAD');
    const developmentAfter=await probeW64GeneratedDevelopmentWorker(sourceDir);
    assert.equal(developmentAfter.head,head_sha,'real DevelopmentPlane must read repaired Git HEAD');
    assert.notEqual(developmentBefore.head,developmentAfter.head);
    assert.equal(developmentAfter.edit_authority,false);
    assert.notEqual(head_sha,base_sha);
    assert.equal(runNode(sourceDir,'--test',tst),0,'real green test');
    assert.equal(runNode(sourceDir,'--check',src),0,'real build syntax');
    assert.equal(git(sourceDir,'status','--porcelain'),'');
    const file_sha256=digest(await readFile(src));
    const artifact_sha256=digest(JSON.stringify({base_sha,head_sha,file_sha256,exit:[1,0,0]}));
    const independent=execFileSync(process.execPath,['-e',
      "const fs=require('fs'),cp=require('child_process'),c=require('crypto');const src=process.argv[1];process.stdout.write(JSON.stringify({head:cp.execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),hash:c.createHash('sha256').update(fs.readFileSync(src)).digest('hex')}))",
      src],{cwd:sourceDir,encoding:'utf8'});
    const critic=JSON.parse(independent);
    assert.deepEqual(critic,{head:head_sha,hash:file_sha256});
    const lease={schema:'metaengine.client.serial-loop-staging-w48.v1',
      state:'STAGING_LEASE_OBSERVED',origin:'SYNTHETIC/STAGING',
      workspace_id,task_id,agent_id:'agent_implementer0001',
      lease_generation:3,owner_generation:8};
    const effect={effect_id,operation:'FIXED_SANDBOX_SOURCE_EDIT',
      task_id,lease_generation:3,state:'ACKED',ack_durable:true};
    const checkpoint=sealStagingCheckpoint({lease,effect,
      source:{repo_scope:'UNIQUE_TEMP_GIT',base_sha,head_sha},
      tests:{before_exit_code:1,after_exit_code:0,build_exit_code:0,working_tree_clean:true},
      artifact:{origin:'SYNTHETIC/STAGING',file_sha256,
        manifest_sha256:artifact_sha256,source_head_sha:head_sha},
      critic:{source:'INDEPENDENT_DISPOSABLE_PROCESS',
        agent_id:'agent_critic000001',verdict:'ACCEPT',
        artifact_sha256,source_head_sha:critic.head},
      ready_at_ms:Date.now()-10000,completed_at_ms:Date.now()-5000});
    assert.equal(checkpoint.state,'STAGING_REVIEW_REQUIRED');
    assert.equal(verifyStagingCheckpointDigest(checkpoint),true);
    await mkdir(data);
    assert.match(run('initdb',['--version']),/PostgreSQL\) 17\./);
    run('initdb',['-D',data,'-A','trust','--no-instructions','-U','w56_temporary']);
    const opts='-h 127.0.0.1 -p '+env.PGPORT+' -k '+root;
    const first = await lifecycle.start(opts);
    sql("CREATE TABLE w56_checkpoint(task_id uuid PRIMARY KEY, lease_generation int NOT NULL, effect_id uuid NOT NULL, source_sha char(40) NOT NULL, artifact_sha256 char(64) NOT NULL, checkpoint_sha256 char(64) NOT NULL, origin text NOT NULL CHECK(origin='SYNTHETIC/STAGING'))");
    sql("CREATE TABLE w56_next_lease(task_id uuid PRIMARY KEY, workspace_id uuid NOT NULL, agent_id text NOT NULL, lease_generation int NOT NULL, owner_generation int NOT NULL, event_seq int NOT NULL, predecessor char(64) NOT NULL, origin text NOT NULL CHECK(origin='SYNTHETIC/STAGING'))");
    sql('INSERT INTO w56_checkpoint VALUES ('+
      [q(task_id),3,q(effect.effect_id),q(head_sha),q(artifact_sha256),
        q(checkpoint.checkpoint_sha256),q('SYNTHETIC/STAGING')].join(',')+')');
    // Abrupt postmaster death/restart forces WAL recovery, not process-local memory.
    await lifecycle.stop();
    const second = await lifecycle.start(opts);
    assert.notEqual(first.pid, second.pid, 'first restart must replace postmaster PID');
    assert.ok(second.birthMs >= first.birthMs);
    const prev=sql('SELECT task_id::text,lease_generation,effect_id::text,trim(source_sha),trim(artifact_sha256),trim(checkpoint_sha256),origin FROM w56_checkpoint WHERE task_id='+q(task_id));
    const fields=prev.split('|');
    assert.equal(fields.length,7);
    const prevPg={backend:'OWN_PG17_DISPOSABLE',origin:fields[6],
      task_id:fields[0],lease_generation:Number(fields[1]),
      effect_id:fields[2],source_sha:fields[3],artifact_sha256:fields[4],
      checkpoint_sha256:fields[5]};
    assert.equal(prevPg.checkpoint_sha256,checkpoint.checkpoint_sha256);
    const next=await nextSupervisorLease(workspace_id,next_task_id);
    // This generated-only row mirrors a readback, not a new runtime scheduler.
    sql('INSERT INTO w56_next_lease VALUES ('+
      [q(next_task_id),q(workspace_id),q(next.agent_id),
       next.lease_generation,next.owner_generation,9,
       q(checkpoint.checkpoint_sha256),q('SYNTHETIC/STAGING')].join(',')+')');
    assert.throws(()=>sql('INSERT INTO w56_next_lease VALUES ('+
      [q(next_task_id),q(workspace_id),q(next.agent_id),
       next.lease_generation,next.owner_generation,10,
       q(checkpoint.checkpoint_sha256),q('SYNTHETIC/STAGING')].join(',')+')'),
      /duplicate key|failed with status/, 'same task cannot receive duplicate row');
    await lifecycle.stop();
    const third = await lifecycle.start(opts);
    assert.notEqual(second.pid, third.pid, 'second restart must replace postmaster PID');
    assert.ok(third.birthMs >= second.birthMs);
    const dbRow=sql('SELECT task_id::text,workspace_id::text,agent_id,lease_generation,owner_generation,event_seq,trim(predecessor),origin FROM w56_next_lease WHERE task_id='+q(next_task_id));
    const r=dbRow.split('|');
    assert.equal(r.length,8);
    const db={backend:'OWN_PG17_DISPOSABLE',origin:r[7],
      state:'LEASED_STAGING_ONLY',row_count:Number(sql('SELECT count(*) FROM w56_next_lease WHERE task_id='+q(next_task_id))),
      task_id:r[0],workspace_id:r[1],agent_id:r[2],
      lease_generation:Number(r[3]),owner_generation:Number(r[4]),
      event_seq:Number(r[5]),after_checkpoint_sha256:r[6]};
    const verdict=inspectStagingNextLease({completedCheckpoint:checkpoint,
      completedPgReadback:prevPg,completedEffect:effect,
      nextLease:next,nextPgLeaseReadback:db});
    assert.equal(verdict.state,'NEXT_LEASE_READBACK_STAGING_ONLY');
    assert.equal(verdict.permission_to_edit,false);
    assert.equal(inspectStagingNextLease({completedCheckpoint:checkpoint,
      completedPgReadback:prevPg,completedEffect:{...effect,state:'AMBIGUOUS'},
      nextLease:next,nextPgLeaseReadback:db}).state,'UNKNOWN');
    assert.equal(inspectStagingNextLease({completedCheckpoint:checkpoint,
      completedPgReadback:prevPg,completedEffect:effect,
      nextLease:{...next,lease_generation:4},nextPgLeaseReadback:db}).state,'UNKNOWN');
    assert.equal(inspectStagingNextLease({completedCheckpoint:{...checkpoint,source_sha:'f'.repeat(40)},
      completedPgReadback:prevPg,completedEffect:effect,
      nextLease:next,nextPgLeaseReadback:db}).state,'UNKNOWN');
    assert.equal((await inspectLiveCompletionForStaging({expected:{
      task_id,run_id,owner_epoch:8,lease_generation:3,
      agent_id:lease.agent_id,source_sha:head_sha}})).state,'LIVE_UNKNOWN');
    console.log('W56_PG17_EVIDENCE',JSON.stringify({
      origin:'SYNTHETIC/STAGING',source_head_sha:head_sha,
      checkpoint_sha256:checkpoint.checkpoint_sha256,
      next_task_id,after_immediate_restarts:2,
      postmaster_birth_sequence:[first.birthMs,second.birthMs,third.birthMs],
      distinct_postmasters:new Set([first.pid,second.pid,third.pid]).size,
      development_plane:'ACTUAL_READ_ONLY_WORKER',development_plane_source:developmentAfter.head,
      continuation:verdict.state,live:'UNKNOWN',effect_authority:false}));
  }catch(e){
    console.error('W56_OWNED_PG17_LOG_TAIL',await lifecycle.logTail());
    throw e;
  }finally{
    const cleaned=await lifecycle.cleanup();
    if(!cleaned)console.error('W56_PG17_CLEANUP_FAILED',await lifecycle.logTail());
    const saved=JSON.parse(await readFile(marker,'utf8').catch(()=>'{}'));
    if(saved.schema==='metaengine.w56.disposable-pg17.v1'&&saved.clusterId===clusterId
        &&path.dirname(root)===base&&cleaned)await rm(root,{recursive:true,force:true});
  }
});
