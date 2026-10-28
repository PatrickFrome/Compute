import {isDeepStrictEqual} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const fail=reason=>{throw Error('qa_forward_install_'+reason);};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const pid=value=>Number.isSafeInteger(value)&&value>4;

// A new operator-requested qualification, never an installer/task retry. The
// failed generation stays failed; only a fresh run may produce readiness.
export async function assertStoppedQualificationReadback({status,bundleSha256,postgresContinuity,pidState,portState,ports}={}){
  if(status?.schema!=='metaengine.client-state.runtime-status.v1'||status.state!=='STOPPED'
    ||status.reason!=='runtime_health_failed'||status.runtime_ready!==false||status.children_stopped!==true
    ||status.bundle_sha256!==bundleSha256||status.postgres_mode!=='attached'||status.api_role_mode!=='direct'
    ||status.authority_effect!==false||!pid(status.host_pid)
    ||!Array.isArray(status.children)||status.children.length!==2
    ||new Set(status.children.map(c=>c.name)).size!==2
    ||status.children.some(c=>!['api','edge'].includes(c.name)||!pid(c.pid))
    ||new Set([status.host_pid,...status.children.map(c=>c.pid)]).size!==3)
    fail('resume_stopped_host_unverified');
  const pg=status.postgres_continuity;
  if(pg?.schema!=='metaengine.client-state.postgres-continuity.v1'||!pid(pg.pid)
    ||!/^[a-f0-9]{64}$/.test(pg.sha256||'')||pg.authority_effect!==false
    ||!isDeepStrictEqual(pg,postgresContinuity))fail('resume_postgres_continuity_changed');
  if(typeof pidState!=='function'||typeof portState!=='function'||!Array.isArray(ports)||ports.length!==2
    ||ports.some(p=>!Number.isSafeInteger(p)||p<1024||p>65535)||new Set(ports).size!==2)fail('resume_readback_dependencies');
  for(const childPid of [status.host_pid,...status.children.map(c=>c.pid)])
    if(await pidState(childPid)!=='ABSENT')fail('resume_owned_process_present');
  for(const port of ports)if(await portState(port)!=='ABSENT')fail('resume_endpoint_presence_unresolved');
  return true;
}

export async function preserveStoppedQualificationAttempt({stateDirectory,statusBytes,stderrBytes,verify,protect}={}){
  if(!path.isAbsolute(stateDirectory||'')||!Buffer.isBuffer(statusBytes)||!Buffer.isBuffer(stderrBytes)
    ||typeof verify!=='function'||typeof protect!=='function')fail('resume_archive_arguments');
  const write=async(file,bytes)=>{const h=await fs.open(file,'wx',0o600);try{await h.writeFile(bytes);await h.sync();}finally{await h.close();}};
  await verify();
  // A durable one-shot attempt prevents two operator processes from launching
  // replacement qualifications, including after an uncertain acknowledgement.
  const directory=path.join(stateDirectory,'stopped-qualification-resume-'+randomUUID());
  const record={schema:'metaengine.operator.stopped-qualification-resume.v1',state:'QUALIFICATION_RESUME_RESERVED',
    prior_status_sha256:sha(statusBytes),prior_stderr_sha256:sha(stderrBytes),evidence_directory:directory,
    previous_qualification_passed:false,installer_replayed:false,task_replayed:false,automatic_retry_allowed:false,authority_effect:false};
  await write(path.join(stateDirectory,'stopped-qualification-resume-attempt.json'),Buffer.from(JSON.stringify(record,null,2)+'\n'));
  await fs.mkdir(directory,{mode:0o700});await protect(directory);
  await write(path.join(directory,'prior-runtime-instance.json'),statusBytes);
  await write(path.join(directory,'prior-qualification-host.stderr'),stderrBytes);
  if(!statusBytes.equals(await fs.readFile(path.join(directory,'prior-runtime-instance.json')))
    ||!stderrBytes.equals(await fs.readFile(path.join(directory,'prior-qualification-host.stderr'))))fail('resume_archive_changed');
  await verify();return directory;
}
