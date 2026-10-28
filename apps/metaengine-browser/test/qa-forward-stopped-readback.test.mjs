import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {assertStoppedQualificationReadback,preserveStoppedQualificationAttempt} from '../scripts/qa-forward-stopped-readback.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(){
  const postgresContinuity={schema:'metaengine.client-state.postgres-continuity.v1',pid:1200,version:170006,
    system_identifier:'7694034680113450848',started_at:'2026-10-25T17:35:15.252Z',data_directory_sha256:'a'.repeat(64),
    postmaster_pid_sha256:'b'.repeat(64),authority_effect:false,sha256:'c'.repeat(64)};
  return {bundleSha256:'d'.repeat(64),postgresContinuity,pidState:()=> 'ABSENT',portState:async()=> 'ABSENT',ports:[55433,55434],
    status:{schema:'metaengine.client-state.runtime-status.v1',state:'STOPPED',reason:'runtime_health_failed',runtime_ready:false,
      children_stopped:true,bundle_sha256:'d'.repeat(64),postgres_mode:'attached',api_role_mode:'direct',authority_effect:false,
      host_pid:1400,children:[{name:'api',pid:1401},{name:'edge',pid:1402}],postgres_continuity:structuredClone(postgresContinuity)}};
}
test('confirmed stopped failure permits a new qualification without relabelling the failed generation',async()=>{
  const f=fixture(),before=structuredClone(f.status),seenPids=[],seenPorts=[];
  assert.equal(await assertStoppedQualificationReadback({...f,pidState:p=>{seenPids.push(p);return 'ABSENT';},portState:async p=>{seenPorts.push(p);return 'ABSENT';}}),true);
  assert.deepEqual(seenPids,[1400,1401,1402]);assert.deepEqual(seenPorts,[55433,55434]);assert.deepEqual(f.status,before);
});
test('a still present or unknown host/child/port prevents requalification',async()=>{
  for(const value of ['PRESENT','UNKNOWN'])for(const livePid of [1400,1401,1402]){
    const f=fixture();await assert.rejects(assertStoppedQualificationReadback({...f,pidState:p=>p===livePid?value:'ABSENT'}),/resume_owned_process_present/);
  }
  for(const value of ['PRESENT','UNKNOWN'])for(const livePort of [55433,55434]){
    const f=fixture();await assert.rejects(assertStoppedQualificationReadback({...f,portState:async p=>p===livePort?value:'ABSENT'}),/resume_endpoint_presence_unresolved/);
  }
});
test('an unconfirmed stop, foreign candidate or incomplete child census is rejected',async()=>{
  for(const patch of [{state:'READY'},{state:'FAILED'},{reason:'requested'},{children_stopped:false},{runtime_ready:true},
    {bundle_sha256:'e'.repeat(64)},{children:[]},{children:[{name:'api',pid:1401},{name:'api',pid:1402}]},
    {children:[{name:'api',pid:1400},{name:'edge',pid:1402}]},{postgres_mode:'owned'},{authority_effect:true}]){
    const f=fixture();await assert.rejects(assertStoppedQualificationReadback({...f,status:{...f.status,...patch}}),/resume_stopped_host_unverified/);
  }
});
test('same PID cannot conceal a changed PostgreSQL incarnation or cluster',async()=>{
  for(const patch of [{pid:1201},{started_at:'2026-10-25T17:35:16.252Z'},{system_identifier:'7694034680113450849'},
    {postmaster_pid_sha256:'e'.repeat(64)},{data_directory_sha256:'f'.repeat(64)},{sha256:'0'.repeat(64)}]){
    const f=fixture();await assert.rejects(assertStoppedQualificationReadback({...f,postgresContinuity:{...f.postgresContinuity,...patch}}),/resume_postgres_continuity_changed/);
  }
});
async function directory(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'stopped-qualification-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
test('failure evidence remains byte exact and one-shot custody survives later uncertainty',async t=>{
  const root=await directory(t),statusBytes=Buffer.from('{"state":"STOPPED","reason":"runtime_health_failed"}\r\n'),stderrBytes=Buffer.from('connection failure\r\n');
  await fs.writeFile(path.join(root,'runtime-instance.json'),statusBytes);await fs.writeFile(path.join(root,'qualification-host.stderr'),stderrBytes);
  let checks=0,protectedDirectory=null;
  const output=await preserveStoppedQualificationAttempt({stateDirectory:root,statusBytes,stderrBytes,verify:async()=>{checks++;},protect:async p=>{protectedDirectory=p;}});
  assert.equal(checks,2);assert.equal(protectedDirectory,output);
  assert.deepEqual(await fs.readFile(path.join(root,'runtime-instance.json')),statusBytes);
  assert.deepEqual(await fs.readFile(path.join(root,'qualification-host.stderr')),stderrBytes);
  assert.deepEqual(await fs.readFile(path.join(output,'prior-runtime-instance.json')),statusBytes);
  assert.deepEqual(await fs.readFile(path.join(output,'prior-qualification-host.stderr')),stderrBytes);
  const record=JSON.parse(await fs.readFile(path.join(root,'stopped-qualification-resume-attempt.json')));
  assert.equal(record.prior_status_sha256,hash(statusBytes));assert.equal(record.prior_stderr_sha256,hash(stderrBytes));
  assert.equal(record.previous_qualification_passed,false);assert.equal(record.automatic_retry_allowed,false);
  await assert.rejects(preserveStoppedQualificationAttempt({stateDirectory:root,statusBytes,stderrBytes,verify:async()=>{},protect:async()=>{}}),{code:'EEXIST'});
});
test('failed initial readback writes nothing; a changed final readback retains the attempt and originals',async t=>{
  const first=await directory(t),statusBytes=Buffer.from('{}'),stderrBytes=Buffer.from('failure');
  await assert.rejects(preserveStoppedQualificationAttempt({stateDirectory:first,statusBytes,stderrBytes,verify:async()=>{throw Error('readback changed');},protect:async()=>{}}),/readback changed/);
  assert.deepEqual(await fs.readdir(first),[]);
  const second=await directory(t);let calls=0;
  await assert.rejects(preserveStoppedQualificationAttempt({stateDirectory:second,statusBytes,stderrBytes,verify:async()=>{if(++calls===2)throw Error('process appeared');},protect:async()=>{}}),/process appeared/);
  const record=JSON.parse(await fs.readFile(path.join(second,'stopped-qualification-resume-attempt.json')));
  assert.deepEqual(await fs.readFile(path.join(record.evidence_directory,'prior-runtime-instance.json')),statusBytes);
  assert.equal(record.previous_qualification_passed,false);
});
