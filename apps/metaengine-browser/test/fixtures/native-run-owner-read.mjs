// Generated contract evidence only; never native Windows/Guardian authority.
import {sealedOwnerDigestW74} from '../../src/host-owner-genesis-custody-w74.mjs';
export function generatedRunOwnerRead(){
  const uuid=n=>String(n).repeat(8)+'-'+String(n).repeat(4)+'-4'+String(n).repeat(3)+'-8'+String(n).repeat(3)+'-'+String(n).repeat(12);
  const at=()=>new Date().toISOString(),birth='pid:9101:created_100ns:134000000000000001';
  const artifact={source_sha:'a'.repeat(40),installed_exe_sha256:'b'.repeat(64),installed_asar_sha256:'c'.repeat(64),runtime_bundle_sha256:'d'.repeat(64),cli_executable_sha256:'e'.repeat(64)};
  const record={schema:'metaengine.host.owner-incarnation.v1',source:'LOCAL_HOST_OWNER',owner_id:uuid(1),device_id:uuid(2),project_id:uuid(3),
    pid:9101,created_at:'2025-08-18T14:13:20.000Z',process_incarnation_id:birth,epoch:7,generation:1,source_sha:artifact.source_sha,
    device_key_fingerprint_sha256:'f'.repeat(64),observed_at:'2026-10-29T00:00:00.000Z',authority_effect:false,
    pending_custody:{schema:'metaengine.host.pending-owner-native-custody.v1',installed_exe_sha256:artifact.installed_exe_sha256,
      package_code_sha256:'1'.repeat(64),proof_identity:'2'.repeat(64),guardian_enrollment_evidence_sha256:'3'.repeat(64),loaded_runtime_code_attested:false}};
  const execution={workspace_id:uuid(4),task_id:uuid(5),lease_generation:1,agent_id:'agent_generated-one',target_id:'codex-cli:'+uuid(6),
    agent_generation_epoch:8,host_incarnation:birth,scope_sha256:'4'.repeat(64),reservation_id:uuid(7)};
  const scope={schema:'metaengine.native-coding.run-owner-scope.v1',execution,
    device:{device_id:record.device_id,client_id:record.owner_id,key_fingerprint_sha256:record.device_key_fingerprint_sha256,admin_grant_epoch:7},
    project_id:record.project_id,root_task_id:execution.task_id,activation_id:uuid(8),sealed_owner_sha256:sealedOwnerDigestW74(record),artifact,
    control:{workspace_id:execution.workspace_id,generation_floor:8,refill_enabled:true,supervisor_admission_enabled:true,reset_at:null,updated_at:at()},observed_at:at()};
  const evidence={schema:'metaengine.host.run-owner-read-evidence.v1',sealed_record:record,sealed_sha256:scope.sealed_owner_sha256,observed_at:at(),
    source:{source_sha:artifact.source_sha,installed_exe_sha256:artifact.installed_exe_sha256,package_code_sha256:record.pending_custody.package_code_sha256,
      proof_identity:record.pending_custody.proof_identity,loaded_runtime_code_attested:false,production_qualified:false},authority_effect:false};
  const binding={instance_id:uuid(9),host_pid:7201,request_id:uuid(6),action:'READ_RUN_OWNER_CUSTODY_V1',request_sha256:'5'.repeat(64),body_sha256:'6'.repeat(64)};
  return{scope,evidence,binding,input:{scope:execution}};
}
