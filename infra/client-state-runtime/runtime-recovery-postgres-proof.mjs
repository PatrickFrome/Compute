import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=()=>{throw Error('runtime_recovery_postgres_identity_unproven');};
const same=(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
async function bytes(file,maximum){
  const before=await fs.lstat(file);if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size<1||before.size>maximum)fail();
  const value=await fs.readFile(file),after=await fs.lstat(file);
  if(before.ino!==after.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs||value.length!==before.size)fail();return value;
}
// Host-only producer, after launcher's actual SQL/cluster/PGDATA validation.
// Browser receives no database URL, private configuration or PGDATA path.
export async function runtimeRecoveryPostgresProof({identity,pgDataDirectory,expectedClusterSystemIdentifier}={}){
  if(!identity||!Number.isSafeInteger(identity.pid)||identity.pid<1||identity.version<170000||identity.version>=180000
    ||!/^[1-9][0-9]{15,19}$/.test(identity.system_identifier||'')||!Number.isFinite(Date.parse(identity.started_at))
    ||expectedClusterSystemIdentifier&&identity.system_identifier!==expectedClusterSystemIdentifier
    ||typeof pgDataDirectory!=='string'||!path.isAbsolute(pgDataDirectory)||typeof identity.data_directory!=='string')fail();
  const directory=await fs.realpath(pgDataDirectory),actual=await fs.realpath(identity.data_directory);
  if(!same(directory,actual)||(await fs.lstat(directory)).isSymbolicLink()||!(await fs.lstat(directory)).isDirectory())fail();
  const version=await bytes(path.join(directory,'PG_VERSION'),32);
  if(version.toString('utf8').trim()!=='17')fail();
  const pidBytes=await bytes(path.join(directory,'postmaster.pid'),65536),lines=pidBytes.toString('utf8').trim().split(/\r?\n/);
  if(Number(lines[0])!==identity.pid||!same(lines[1],directory)||Number(lines[3])!==identity.port)fail();
  const proof={schema:'metaengine.client-state.postgres-continuity.v1',pid:identity.pid,version:identity.version,
    system_identifier:identity.system_identifier,started_at:new Date(identity.started_at).toISOString(),
    data_directory_sha256:hash(directory.toLowerCase()),postmaster_pid_sha256:hash(pidBytes),authority_effect:false};
  return Object.freeze({...proof,sha256:hash(JSON.stringify(proof))});
}
