// Generated configuration only: not installed Windows or execution evidence.
import {randomUUID} from 'node:crypto';
const h=n=>String(n).repeat(64),sha=n=>String(n).repeat(40);
function processIdentity(){const created_at=new Date(Date.now()-10000).toISOString(),pid=123;
 return{pid,created_at,process_incarnation_id:`pid:${pid}:created_100ns:${BigInt(Date.parse(created_at))*10000n+116444736000000000n}`};}
export function generatedStage(){
 const worktree={path:'C:\\approved-repository',root_identity_sha256:h(3),base_sha:sha(4)};
 return {schema:'metaengine.native-coding.workspace-stage.v1',preparation_id:randomUUID(),workspace_id:randomUUID(),repo_id:'test:generated',
  repo_root:worktree.path,managed_root:'C:\\approved-worktrees',repo_root_identity_sha256:h(3),managed_root_identity_sha256:h(4),
  user_sid:'S-1-5-21-111',artifact:{installed_exe_sha256:h(1),installed_asar_sha256:h(2),runtime_bundle_sha256:h(3),source_sha:sha(4),cli_executable_sha256:h(5)},
  postgres:{system_identifier:'123456',data_directory_identity_sha256:h(6),postmaster:processIdentity()},
  agents:['IMPLEMENTER','CRITIC'].map((role,i)=>({provider_id:randomUUID(),agent_id:`agent_generated-${i}`,role,agent_generation_epoch:1,worktree,
   sandbox:{backend:'CODEX_WINDOWS_ELEVATED',mode:role==='CRITIC'?'read-only':'workspace-write',evidence_sha256:h(7),outside_write_denied:true,worktree_write_denied:role==='CRITIC'}})),
  expires_at:new Date(Date.now()+3600000).toISOString()};
}
