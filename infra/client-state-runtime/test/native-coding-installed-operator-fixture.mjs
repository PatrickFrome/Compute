import path from 'node:path';

// Generated placement-only descriptor. These paths/digests are not installed
// payloads, ACL evidence, authenticated configuration or native qualification.
export function generatedInstalledOperator({resources,stateDirectory}){
 const bundle=path.join(resources,'client-state-runtime');
 return {schema:'metaengine.native-coding.operator-paths.v1',
  cli_executable:path.join(bundle,'runtime','codex','codex.exe'),
  git_executable:path.join(bundle,'runtime','git','bin','git.exe'),
  codex_home:path.join(stateDirectory,'codex-home'),journal_root:path.join(stateDirectory,'journal'),
  worker_temp_root:path.join(stateDirectory,'worker-temp'),result_index_root:path.join(stateDirectory,'result-index'),
  sandbox_receipts:{IMPLEMENTER:{path:path.join(stateDirectory,'canaries','implementer.json'),sha256:'a'.repeat(64)},
   CRITIC:{path:path.join(stateDirectory,'canaries','critic.json'),sha256:'b'.repeat(64)}}};
}

// Include the actual shared guard call when tests evaluate a smaller source
// closure. Fixtures replace protected reads, never the production path guard.
export function installedOperatorReaderSource(source){
 const start=source.indexOf('  async function readInstalledOperator('),end=source.indexOf('  async function prepareNativeScopes(',start);
 if(start<0||end<=start)throw Error('fixture_installed_operator_reader_missing');
 return source.slice(start,end);
}
