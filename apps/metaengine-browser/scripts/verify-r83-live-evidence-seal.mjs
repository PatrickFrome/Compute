import crypto from 'node:crypto';
import fs from 'node:fs';

const SHA40=/^[0-9a-f]{40}$/;
const SHA64=/^[0-9a-f]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POSITIVE_INT=/^[1-9][0-9]*$/;

function fail(code){throw new Error(`r83_live_evidence_seal_${code}`)}
function object(v,code){if(!v||typeof v!=='object'||Array.isArray(v))fail(code);return v}
function string(v,code){if(typeof v!=='string'||!v)fail(code);return v}
function integer(v,code){if(!Number.isSafeInteger(v)||v<=0)fail(code);return v}
function exactFalse(v,code){if(v!==false)fail(code)}
function sha40(v,code){v=string(v,code);if(!SHA40.test(v))fail(code);return v}
function sha64(v,code){v=string(v,code);if(!SHA64.test(v))fail(code);return v}
function uuid(v,code){v=string(v,code);if(!UUID.test(v))fail(code);return v}

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
  return value;
}
export function evidenceDigest(value){
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))+'\n').digest('hex');
}

function validateRunShape(row,subject){
  object(row,'github_run_invalid');
  string(row.name,'github_run_name_invalid');
  integer(row.run_id,'github_run_id_invalid');
  if(row.run_attempt!==undefined)integer(row.run_attempt,'github_run_attempt_invalid');
  if(row.head_sha!==undefined&&row.head_sha!==subject)fail('github_run_head_mismatch');
  if(row.status!==undefined&&row.status!=='completed')fail('github_run_not_completed');
  if(row.conclusion!==undefined&&String(row.conclusion).toLowerCase()!=='success')fail('github_run_not_success');
}

export function validateR83LiveEvidenceSeal(evidence,{installedProof=null,githubRuns=null}={}){
  object(evidence,'root_invalid');
  if(evidence.schema!=='metaengine.r83.live-evidence-seal.v1')fail('schema_invalid');

  const subject=object(evidence.subject,'subject_invalid');
  if(subject.repository!=='PatrickFrome/Compute')fail('repository_invalid');
  const sourceHead=sha40(subject.source_head,'subject_source_head_invalid');
  string(subject.package_version,'subject_package_version_invalid');
  sha64(subject.installer_sha256,'subject_installer_sha256_invalid');

  const github=object(evidence.github,'github_invalid');
  if(!Array.isArray(github.required_runs)||github.required_runs.length<10)fail('required_runs_invalid');
  const runIds=new Set();
  for(const row of github.required_runs){
    validateRunShape(row,sourceHead);
    if(runIds.has(row.run_id))fail('required_run_duplicate');
    runIds.add(row.run_id);
  }

  const installed=object(evidence.installed_electron,'installed_invalid');
  integer(installed.run_id,'installed_run_id_invalid');
  integer(installed.run_attempt,'installed_run_attempt_invalid');
  integer(installed.artifact_id,'installed_artifact_id_invalid');
  string(installed.artifact_name,'installed_artifact_name_invalid');
  integer(installed.producer_run_id,'producer_run_id_invalid');
  integer(installed.producer_run_number,'producer_run_number_invalid');
  integer(installed.producer_run_attempt,'producer_run_attempt_invalid');
  uuid(installed.enrollment_request_id,'enrollment_request_id_invalid');
  uuid(installed.client_id,'client_id_invalid');
  uuid(installed.device_id,'device_id_invalid');
  sha64(installed.key_fingerprint_sha256,'fingerprint_invalid');
  if(installed.private_key_exported!==false)fail('private_key_exported');
  if(installed.signed_transport_ready!==true)fail('signed_transport_not_ready');
  exactFalse(installed.authority_effect,'installed_authority_effect');

  const command=object(installed.command,'command_invalid');
  uuid(command.command_id,'command_id_invalid');
  if(command.action!=='POLL')fail('command_action_invalid');
  if(command.lane!=='READ_ONLY')fail('command_lane_invalid');
  if(command.terminal_status!=='COMPLETED')fail('command_terminal_status_invalid');
  if(command.leased_by!==installed.client_id)fail('command_leased_by_mismatch');
  if(command.source_head!==sourceHead)fail('command_source_head_mismatch');
  exactFalse(command.authority_effect,'command_authority_effect');

  if(installed.run_id!==github.required_runs.find(r=>r.name==='Client V1 Installed Electron Live Qualification')?.run_id)fail('installed_run_not_required');
  if(installed.producer_run_id!==github.required_runs.find(r=>r.name==='Browser Windows Package Smoke')?.run_id)fail('producer_run_not_required');

  const edge=object(evidence.edge,'edge_invalid');
  string(edge.project_ref,'edge_project_ref_invalid');
  const stableEdge=object(edge.stable,'stable_edge_invalid');
  const canary=object(edge.canary,'canary_edge_invalid');
  if(stableEdge.slug!=='a2-browser-native-supervisor-v1')fail('stable_slug_invalid');
  if(canary.slug!=='a2-browser-native-supervisor-v14-canary')fail('canary_slug_invalid');
  uuid(stableEdge.function_id,'stable_function_id_invalid');
  uuid(canary.function_id,'canary_function_id_invalid');
  integer(stableEdge.deployed_version,'stable_version_invalid');
  integer(canary.deployed_version,'canary_version_invalid');
  sha64(stableEdge.ezbr_sha256,'stable_digest_invalid');
  sha64(canary.ezbr_sha256,'canary_digest_invalid');
  if(stableEdge.ezbr_sha256!==canary.ezbr_sha256)fail('stable_canary_digest_mismatch');
  if(stableEdge.source_pin!==sourceHead||canary.source_pin!==sourceHead)fail('edge_source_pin_mismatch');
  integer(stableEdge.health_probe_run_id,'stable_health_run_invalid');
  integer(stableEdge.health_probe_attempt,'stable_health_attempt_invalid');
  integer(canary.health_probe_run_id,'canary_health_run_invalid');
  integer(canary.health_probe_attempt,'canary_health_attempt_invalid');
  exactFalse(edge.authority_effect,'edge_authority_effect');

  const rollback=object(edge.rollback_drill,'rollback_invalid');
  integer(rollback.rollback_version,'rollback_version_invalid');
  sha40(rollback.rollback_source_pin,'rollback_source_pin_invalid');
  sha64(rollback.rollback_ezbr_sha256,'rollback_digest_invalid');
  integer(rollback.rollback_health_probe_run_id,'rollback_health_run_invalid');
  integer(rollback.rollback_health_probe_attempt,'rollback_health_attempt_invalid');
  integer(rollback.restore_version,'restore_version_invalid');
  if(rollback.restore_version!==canary.deployed_version)fail('restore_version_canary_mismatch');
  if(rollback.restore_source_pin!==sourceHead)fail('restore_source_pin_mismatch');
  if(rollback.restore_ezbr_sha256!==canary.ezbr_sha256)fail('restore_digest_mismatch');
  integer(rollback.restore_health_probe_run_id,'restore_health_run_invalid');
  integer(rollback.restore_health_probe_attempt,'restore_health_attempt_invalid');
  exactFalse(rollback.authority_effect,'rollback_authority_effect');

  const policy=object(evidence.policy,'policy_invalid');
  for(const key of ['evidence_is_execution_authority','evidence_is_promotion_authority','promotion_authorized','automatic_retry_allowed','authority_effect'])exactFalse(policy[key],`policy_${key}`);

  if(installedProof){
    object(installedProof,'installed_proof_invalid');
    if(installedProof.schema!=='metaengine.client-v1.installed-electron-live.v1')fail('installed_proof_schema_invalid');
    if(installedProof.source_head!==sourceHead)fail('installed_proof_source_head_mismatch');
    if(installedProof.package_version!==subject.package_version)fail('installed_proof_package_version_mismatch');
    if(installedProof.installer_sha256!==subject.installer_sha256)fail('installed_proof_installer_mismatch');
    if(Number(installedProof.producer_run_id)!==installed.producer_run_id)fail('installed_proof_producer_run_mismatch');
    if(Number(installedProof.producer_run_number)!==installed.producer_run_number)fail('installed_proof_producer_number_mismatch');
    if(Number(installedProof.producer_run_attempt)!==installed.producer_run_attempt)fail('installed_proof_producer_attempt_mismatch');
    if(installedProof.client_id!==installed.client_id)fail('installed_proof_client_mismatch');
    if(installedProof.device_id!==installed.device_id)fail('installed_proof_device_mismatch');
    if(installedProof.key_fingerprint_sha256!==installed.key_fingerprint_sha256)fail('installed_proof_fingerprint_mismatch');
    if(installedProof.signed_transport_ready!==true)fail('installed_proof_transport_not_ready');
    if(installedProof.producer_terminal_success!==true)fail('installed_proof_producer_not_success');
    if(installedProof.installed_process_alive!==true)fail('installed_proof_process_not_alive');
    if(installedProof.private_key_exported!==false)fail('installed_proof_private_key_exported');
    if(installedProof.authority_effect!==false)fail('installed_proof_authority_effect');
  }

  if(githubRuns){
    object(githubRuns,'github_runs_invalid');
    for(const required of github.required_runs){
      const live=githubRuns[String(required.run_id)]??githubRuns[required.run_id];
      if(!live)fail(`github_run_missing_${required.run_id}`);
      if(Number(live.id)!==required.run_id)fail('github_run_id_mismatch');
      if(live.name!==required.name)fail('github_run_name_mismatch');
      if(live.head_sha!==sourceHead)fail('github_run_head_mismatch');
      if(live.status!=='completed'||String(live.conclusion).toLowerCase()!=='success')fail('github_run_not_success');
      if(required.run_attempt!==undefined&&Number(live.run_attempt)!==required.run_attempt)fail('github_run_attempt_mismatch');
    }
  }

  return Object.freeze({
    schema:'metaengine.r83.live-evidence-seal-verification.v1',
    verified:true,
    subject_source_head:sourceHead,
    installer_sha256:subject.installer_sha256,
    installed_run_id:installed.run_id,
    command_id:command.command_id,
    stable_edge_digest:stableEdge.ezbr_sha256,
    canary_edge_digest:canary.ezbr_sha256,
    evidence_sha256:evidenceDigest(evidence),
    execution_authority:false,
    promotion_authority:false,
    authority_effect:false,
  });
}

function readJson(path){return JSON.parse(fs.readFileSync(path,'utf8').replace(/^\\uFEFF/,''))}

if(import.meta.url===`file://${process.argv[1]}`){
  const args=process.argv.slice(2);
  const map=new Map();
  for(let i=0;i<args.length;i+=2)map.set(args[i],args[i+1]);
  const evidencePath=map.get('--evidence');
  if(!evidencePath)fail('cli_evidence_required');
  const installedProofPath=map.get('--installed-proof');
  const githubRunsPath=map.get('--github-runs');
  const result=validateR83LiveEvidenceSeal(readJson(evidencePath),{
    installedProof:installedProofPath?readJson(installedProofPath):null,
    githubRuns:githubRunsPath?readJson(githubRunsPath):null,
  });
  process.stdout.write(JSON.stringify(result)+'\n');
}
