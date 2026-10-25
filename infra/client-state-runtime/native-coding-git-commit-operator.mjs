import path from 'node:path';
import {readNativeCodingProtectedJson} from '../../apps/metaengine-browser/src/native-coding-host-observers.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH=/^[0-9a-f]{64}$/;
const fail=reason=>{throw Error('native_coding_commit_operator_'+reason);};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)
  &&Object.keys(value).sort().join('\0')===[...keys].sort().join('\0');
const absolute=value=>typeof value==='string'&&path.isAbsolute(value)&&!value.includes('\0')&&path.resolve(value)===value;
export const NATIVE_CODING_GIT_COMMIT_OPERATOR_FILE='native-coding-git-commit-operator-v1.json';

// Separate protected descriptor: the existing operator-paths.v1 contract is
// deliberately not widened. This is a physical pin registry, not execution or
// lease authority. No request/model can create or update it through this module.
export async function readNativeCodingGitCommitOperator(stateDirectory,{readProtectedJson=readNativeCodingProtectedJson}={}){
  if(!absolute(stateDirectory)||typeof readProtectedJson!=='function')fail('private_state_directory_required');
  const {value,sha256}=await readProtectedJson(path.join(stateDirectory,NATIVE_CODING_GIT_COMMIT_OPERATOR_FILE));
  const fields=['schema','registry_id','generation','git_executable','git_executable_sha256',
    'journal_root','bindings','model_paths_allowed','production_qualified','authority_effect'];
  if(value&&Object.hasOwn(value,'profile_bindings'))fields.push('profile_bindings');
  if(!HASH.test(sha256||'')||!exact(value,fields)
    ||value.schema!=='metaengine.native-coding.git-commit-operator.v1'||!UUID.test(value.registry_id||'')
    ||!Number.isSafeInteger(value.generation)||value.generation<1||!absolute(value.git_executable)||!absolute(value.journal_root)
    ||!HASH.test(value.git_executable_sha256||'')||value.model_paths_allowed!==false||value.production_qualified!==false
    ||value.authority_effect!==false||!Array.isArray(value.bindings)
    ||Object.hasOwn(value,'profile_bindings')&&(!Array.isArray(value.profile_bindings)||value.profile_bindings.length<1)
    ||value.bindings.length+(value.profile_bindings?.length??0)<1)fail('descriptor_invalid');
  const roots=new Set(),pairs=new Set();
  for(const [kind,rows] of [['project',value.bindings],['profile',value.profile_bindings??[]]])for(const row of rows){
    const keys=['workspace_id','path','root_identity_sha256','branch_ref','git_dir_identity_sha256','common_dir_identity_sha256',
      ...(kind==='project'?['project_id']:['profile_id','profile_sha256'])];
    if(!exact(row,keys)||!UUID.test(row[kind==='project'?'project_id':'profile_id']||'')
      ||kind==='profile'&&!HASH.test(row.profile_sha256||'')||!UUID.test(row.workspace_id||'')||!absolute(row.path)
      ||!['root_identity_sha256','git_dir_identity_sha256','common_dir_identity_sha256'].every(key=>HASH.test(row[key]||''))
      ||!/^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]{0,160}$/.test(row.branch_ref||''))fail('managed_pin_invalid');
    const pair=kind+':'+row[kind==='project'?'project_id':'profile_id']+':'+row.root_identity_sha256;
    if(roots.has(row.root_identity_sha256)||pairs.has(pair))fail('managed_pin_ambiguous');roots.add(row.root_identity_sha256);pairs.add(pair);
    const relative=path.relative(row.path,value.journal_root),reverse=path.relative(value.journal_root,row.path);
    if(!relative||!reverse||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative)
      ||reverse!=='..'&&!reverse.startsWith('..'+path.sep)&&!path.isAbsolute(reverse))fail('journal_overlaps_worker');
  }
  return Object.freeze({value:structuredClone(value),sha256});
}
