import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readDirectoryIdentity} from './native-coding-fs-identity.mjs';
import {verifyOwnerOnlyWindowsStorage} from './private-windows-storage-acl.mjs';
import {nativeCodingCanonicalSha256 as digest} from './native-coding-task-context.mjs';

export const CODEX_EXECUTION_SCOPE_SCHEMA='metaengine.codex-cli.execution-scope.v2';
const fail=reason=>{throw Error('codex_cli_policy_'+reason);};
const check=signal=>{if(signal?.aborted)fail('request_cancelled');};
const same=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
const modeValid=mode=>['workspace-write','read-only'].includes(mode);
const absolute=value=>typeof value==='string'&&path.isAbsolute(value)&&value.length<2048
  &&!/[\x00-\x1f]/.test(value)&&!value.startsWith('\\\\')&&!value.startsWith('//')&&same(path.resolve(value),value);
const freeze=value=>{if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;};

// Shared explicit bounds only. These do not erase configuration layers or
// establish equivalence between `exec` and `sandbox` configuration loading.
export function codexCliPermissionOverrides(mode) {
  if(!modeValid(mode))fail('mode_invalid');
  return ['-c','windows.sandbox="elevated"','-c',`sandbox_mode="${mode}"`,
    '-c','sandbox_workspace_write.writable_roots=[]','-c','sandbox_workspace_write.network_access=false'];
}

// Bind the actual invocation without persisting environment values, which may
// include credentials. This digest is data, never an authorization capability.
export function codexCliInvocationFingerprint({args,env,cwd}={}) {
  if(!absolute(cwd)||!Array.isArray(args)||args.length>256
    ||args.some(value=>typeof value!=='string'||value.includes('\0'))
    ||!env||typeof env!=='object'||Array.isArray(env))fail('invocation_invalid');
  const environment={};
  for(const [key,value]of Object.entries(env)){
    if(!key||/[\x00-\x1f=]/.test(key)||typeof value!=='string'||value.includes('\0'))fail('environment_invalid');
    const name=key.toUpperCase();
    if(Object.hasOwn(environment,name)&&environment[name]!==value)fail('environment_case_collision');
    environment[name]=value;
  }
  return digest({schema:'metaengine.codex-cli.invocation-fingerprint.v1',args,cwd,environment});
}

const fileInventory=stat=>['dev','ino','birthtimeNs','ctimeNs','mtimeNs','size','nlink'].map(key=>String(stat[key]));
async function sourceDirectoryIdentity(directory,signal) {
  // Some Linux overlay filesystems expose high-bit inode numbers through
  // signed bigint stats. Their exact nonzero value is still an identity. The
  // chosen writable roots retain the stricter shared Windows identity reader.
  check(signal);if(!absolute(directory))fail('path_unverified');
  const before=await fs.lstat(directory,{bigint:true});
  if(!before.isDirectory()||before.isSymbolicLink()||before.ino===0n||before.birthtimeNs<=0n)fail('path_unverified');
  for(let current=directory;;current=path.dirname(current)){
    check(signal);const stat=await fs.lstat(current);
    if(!stat.isDirectory()||stat.isSymbolicLink()||!same(await fs.realpath(current),current))fail('path_unverified');
    if(path.dirname(current)===current)break;
  }
  const after=await fs.lstat(directory,{bigint:true});
  if(!after.isDirectory()||after.isSymbolicLink()||before.dev!==after.dev||before.ino!==after.ino||before.birthtimeNs!==after.birthtimeNs)fail('path_changed');
  return digest(['configuration-directory',String(before.dev),String(before.ino),String(before.birthtimeNs)]);
}
async function fileIdentity(file,maximumBytes,signal) {
  check(signal);if(!absolute(file))fail('path_unverified');
  await sourceDirectoryIdentity(path.dirname(file),signal);check(signal);
  const stat=await fs.lstat(file,{bigint:true});
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1n||stat.ino===0n||stat.dev<0n
    ||stat.birthtimeNs<0n||stat.size>BigInt(maximumBytes)||!same(await fs.realpath(file),file))fail('file_unverified');
  check(signal);return {identity_sha256:digest(fileInventory(stat)),stat};
}
async function readPinnedFile(file,maximumBytes,signal,{allowEmpty=false}={}) {
  const before=await fileIdentity(file,maximumBytes,signal);
  if(!allowEmpty&&before.stat.size===0n)fail('file_unverified');
  const handle=await fs.open(file,'r');
  try{
    if(digest(fileInventory(await handle.stat({bigint:true})))!==before.identity_sha256)fail('file_changed');
    const hash=createHash('sha256');let size=0;
    for await(const bytes of handle.createReadStream({autoClose:false,...(signal?{signal}:{})})){
      check(signal);size+=bytes.length;if(size>maximumBytes)fail('file_budget');hash.update(bytes);
    }
    if(BigInt(size)!==before.stat.size||(await fileIdentity(file,maximumBytes,signal)).identity_sha256!==before.identity_sha256)fail('file_changed');
    return {path:file,identity_sha256:before.identity_sha256,sha256:hash.digest('hex')};
  }finally{await handle.close();}
}

async function directory(file,signal,{allowMissing=false}={}) {
  check(signal);if(!absolute(file))fail('path_unverified');
  try{return {path:file,exists:true,identity_sha256:await readDirectoryIdentity(file)};}
  catch(error){
    if(!allowMissing||error.code!=='ENOENT')throw error;
    let parent=path.dirname(file);
    for(;;){
      check(signal);
      try{return {path:file,exists:false,parent_path:parent,parent_identity_sha256:await readDirectoryIdentity(parent)};}
      catch(parentError){if(parentError.code!=='ENOENT')throw parentError;}
      const next=path.dirname(parent);if(next===parent)fail('missing_parent');parent=next;
    }
  }
}

async function localConfiguration({codexHome,workspaceRoot,environment,signal}) {
  // Inventory known local sources, including absent paths. Profiles may be
  // selected indirectly by a configuration layer, so hash every local profile.
  // Cloud/default/managed layers still require an authentic CLI observation.
  const candidates=new Set([path.join(codexHome,'config.toml'),path.join(workspaceRoot,'config.toml')]);
  for(let current=workspaceRoot;;current=path.dirname(current)){
    candidates.add(path.join(current,'.codex','config.toml'));
    if(path.dirname(current)===current)break;
  }
  check(signal);
  for(const name of await fs.readdir(codexHome))if(name.endsWith('.config.toml'))candidates.add(path.join(codexHome,name));
  const programDataKeys=Object.entries(environment).filter(([key])=>key.toUpperCase()==='PROGRAMDATA');
  if(new Set(programDataKeys.map(([,value])=>value)).size>1)fail('environment_case_collision');
  const system=process.platform==='win32'
    ?path.join(programDataKeys[0]?.[1]||String.raw`C:\ProgramData`,'OpenAI','Codex'):'/etc/codex';
  if(!absolute(system))fail('system_config_path_invalid');
  for(const name of ['config.toml','requirements.toml','managed_config.toml'])candidates.add(path.join(system,name));
  if(candidates.size>128)fail('configuration_budget');
  const inventory=[];
  for(const file of [...candidates].sort()){
    check(signal);
    try{inventory.push({state:'PRESENT',...await readPinnedFile(file,1024*1024,signal,{allowEmpty:true})});}
    catch(error){
      if(error.code!=='ENOENT')throw error;
      // Even absent config paths must not hide a link in an existing ancestor.
      let parent=path.dirname(file),identity;
      for(;;){
        try{identity=await sourceDirectoryIdentity(parent,signal);break;}
        catch(parentError){if(parentError.code!=='ENOENT')throw parentError;}
        const next=path.dirname(parent);if(next===parent)fail('missing_parent');parent=next;
      }
      inventory.push({path:file,state:'ABSENT',parent:{path:parent,identity_sha256:identity}});
    }
  }
  check(signal);return {inventory,sha256:digest(inventory),exhaustive:false};
}

/**
 * Read-only physical/config-source snapshot. It deliberately cannot attest the
 * CLI's effective configuration: cloud-managed layers and the differing CLI
 * loaders are not recoverable from hashes of local files. A private native CLI
 * producer must bind actual resolved layers/policy to CLI identity, boot and
 * operator choices before these observations can support execution. Never
 * promote this snapshot, an injected test reader or a JSON flag to that role.
 */
export async function captureCodexCliPhysicalScope({cliPath,codexHome,scratchRoot,workspaceRoot,mode,
  environment=process.env,verifyStorage=verifyOwnerOnlyWindowsStorage,signal,allowMissingScratchRoot=false}={}) {
  check(signal);
  if(!modeValid(mode)||![cliPath,codexHome,scratchRoot,workspaceRoot].every(absolute)
    ||typeof verifyStorage!=='function'||!environment||typeof environment!=='object'||Array.isArray(environment)
    ||typeof allowMissingScratchRoot!=='boolean')fail('scope_arguments_invalid');
  const home=await directory(codexHome,signal),scratch=await directory(scratchRoot,signal,{allowMissing:allowMissingScratchRoot}),
    workspace=await directory(workspaceRoot,signal);
  for(const target of [home,scratch].filter(item=>item.exists)){
    check(signal);const acl=await verifyStorage(target.path,{operation:'VERIFY_DIRECTORY',...(signal?{signal}:{})});
    check(signal);if(acl?.owner_dacl_verified!==true)fail('storage_unverified');
  }
  const cli=await readPinnedFile(cliPath,512*1024*1024,signal);
  const local_configuration=await localConfiguration({codexHome,workspaceRoot,environment,signal});
  const after={home:await directory(codexHome,signal),scratch:await directory(scratchRoot,signal,{allowMissing:allowMissingScratchRoot}),
    workspace:await directory(workspaceRoot,signal)};
  if(digest({home,scratch,workspace})!==digest(after)
    ||(await fileIdentity(cliPath,512*1024*1024,signal)).identity_sha256!==cli.identity_sha256
    ||(await localConfiguration({codexHome,workspaceRoot,environment,signal})).sha256!==local_configuration.sha256)fail('scope_changed');
  check(signal);
  return freeze({schema:CODEX_EXECUTION_SCOPE_SCHEMA,mode,home,scratch,workspace,cli,
    operator_choices_sha256:digest({cliPath,codexHome,scratchRoot,workspaceRoot,mode}),
    permission_overrides:codexCliPermissionOverrides(mode),local_configuration,
    configuration_semantics:{runner:'IGNORE_USER_CONFIG',probe:'INCLUDE_USER_AND_MANAGED_CONFIG',equivalent:false},
    configuration_attestation:'UNAVAILABLE',authority_effect:false});
}

const POLICY_HASH=/^[a-f0-9]{64}$/;
const POLICY_CONTEXT=/^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const POLICY_RUN=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const POLICY_UPSTREAM='3b01b36fa5eb96ba82a776bd3c2fc57f8969181f';
const POLICY_REQUIREMENT_KEYS=['allowed_approval_policies','allowed_approvals_reviewers','allowed_sandbox_modes',
  'allowed_permission_profiles','default_permissions','allow_login_shell','windows.allowed_sandbox_implementations',
  'permission_profile','permissions.filesystem','experimental_network'];
const POLICY_LAYER_KINDS=new Set(['packaged_defaults','mdm','system','enterprise_managed','user','project',
  'session_flags','legacy_managed_file','legacy_managed_mdm']);
const policySha=bytes=>createHash('sha256').update(bytes).digest('hex');
const policyHashMatches=(value,expected)=>value===`sha256:${expected}`;
const policyObject=(value,keys)=>{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length
    ||keys.some(key=>!Object.hasOwn(value,key)))fail('packet_keys');
};
const policyUnicode=value=>{
  for(let i=0;i<value.length;i++){
    const code=value.charCodeAt(i);
    if(code>=0xd800&&code<=0xdbff){const next=value.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))return false;}
    else if(code>=0xdc00&&code<=0xdfff)return false;
  }
  return true;
};

// JSON.parse/reviver cannot observe overwritten keys. Parse the bounded record
// first, decoding every key before checking duplicates, including nested aliases.
function parseEffectivePolicyRecord(raw){
  if(!Buffer.isBuffer(raw)||raw.length<1||raw.length>65536)fail('packet_bytes');
  if(raw.includes(10)||raw.includes(13))fail('packet_framing');
  let text;
  try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);}catch{fail('packet_utf8');}
  if(text[0]==='\uFEFF')fail('packet_framing');
  let at=0,nodes=0;
  const space=()=>{while(text[at]===' '||text[at]==='\t')at++;};
  const string=()=>{
    if(text[at]!== '"')fail('packet_json');
    const start=at++;
    while(at<text.length){
      if(text[at]==='\\'){at+=2;continue;}
      if(text[at++]==='"'){
        let result;try{result=JSON.parse(text.slice(start,at));}catch{fail('packet_json');}
        if(!policyUnicode(result))fail('packet_unicode');
        return result;
      }
    }
    fail('packet_json');
  };
  const value=depth=>{
    if(depth>32||++nodes>8192)fail('packet_complexity');
    space();const first=text[at];
    if(first==='{'){
      at++;space();const result=Object.create(null),keys=new Set();
      if(text[at]==='}'){at++;return result;}
      for(;;){
        space();const key=string();if(++nodes>8192)fail('packet_complexity');
        if(keys.has(key))fail('packet_duplicate_key');keys.add(key);
        space();if(text[at++]!==':')fail('packet_json');
        result[key]=value(depth+1);space();const end=text[at++];
        if(end==='}')return result;if(end!==',')fail('packet_json');
      }
    }
    if(first==='['){
      at++;space();const result=[];if(text[at]===']'){at++;return result;}
      for(;;){result.push(value(depth+1));space();const end=text[at++];
        if(end===']')return result;if(end!==',')fail('packet_json');}
    }
    if(first==='"')return string();
    if(text.startsWith('true',at)){at+=4;return true;}
    if(text.startsWith('false',at)){at+=5;return false;}
    if(text.startsWith('null',at)){at+=4;return null;}
    const number=/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(at));
    if(!number)fail('packet_json');at+=number[0].length;
    const result=Number(number[0]);if(!Number.isSafeInteger(result))fail('packet_number');return result;
  };
  const result=value(0);space();if(at!==text.length)fail('packet_json');return result;
}

// Requirement generations use UTF-8 BYTE ordering, not UTF-16 ordering or the
// unrelated native task-context canonicalizer. Construct object text directly
// so JavaScript's integer-property enumeration cannot reorder sorted keys.
function policyCanonical(value){
  if(Array.isArray(value))return '['+value.map(policyCanonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value)
    .sort((a,b)=>Buffer.compare(Buffer.from(a,'utf8'),Buffer.from(b,'utf8')))
    .map(key=>JSON.stringify(key)+':'+policyCanonical(value[key])).join(',')+'}';
  return JSON.stringify(value);
}

export function assertCodexCliPolicyBindings({args,inputProtocol,policyNonce,promptSha256}={}){
  if(inputProtocol!=='EFFECTIVE_POLICY_ACK_V1'||typeof policyNonce!=='string'||!POLICY_HASH.test(policyNonce)
    ||typeof promptSha256!=='string'||!POLICY_HASH.test(promptSha256)||!Array.isArray(args)||args.length>256
    ||args.some(arg=>typeof arg!=='string'||arg.includes('\0')))fail('invocation_binding');
  for(const flag of ['--metaengine-effective-policy','--metaengine-prompt-sha256'])
    if(args.filter(arg=>arg===flag||arg.startsWith(flag+'=')).length!==1)fail('invocation_binding');
  if(JSON.stringify(args.slice(-5))!==JSON.stringify(['--metaengine-effective-policy',policyNonce,
    '--metaengine-prompt-sha256',promptSha256,'-']))fail('invocation_binding');
}

// Root arg0 can load this file before flag parsing. Never read its contents or
// put it in the configuration-content inventory; even a dangling link refuses.
export async function assertCodexCliHomeEnvAbsent(codexHome,{signal}={}){
  check(signal);if(!absolute(codexHome))fail('home_path');
  try{await fs.lstat(path.join(codexHome,'.env'));}
  catch(error){if(error.code!=='ENOENT')throw error;check(signal);return;}
  fail('home_dotenv_not_permitted');
}

/**
 * Deny-only data, not an admission capability or native/environment attestation.
 * Supported subset: no normalized managed constraints/sources, selected profile
 * or login shell; restricted network; root read plus exact workspace/private-temp
 * writes. Unknown roots, globs, denies and unresolved special paths refuse.
 */
export function validateCodexCliEffectivePolicy(raw,context={}){
  const event=parseEffectivePolicyRecord(raw);
  assertCodexCliPolicyBindings(context);
  const {role,cwd,temporaryPath,scratchRoot,codexHome,journalRoot,executablePath,args}=context;
  if(!['IMPLEMENTER','CRITIC'].includes(role))fail('role');
  const mode=role==='CRITIC'?'read-only':'workspace-write';
  const windows=typeof cwd==='string'&&/^[A-Za-z]:\\/.test(cwd),paths=windows?path.win32:path.posix;
  const validPath=value=>{
    if(typeof value!=='string'||value.length<1||value.length>=2048||/[\x00-\x1f\x7f]/.test(value)
      ||!paths.isAbsolute(value)||paths.resolve(value)!==value
      ||(windows?!/^[A-Za-z]:\\/.test(value):value.startsWith('//')||value.includes('\\')))fail('scope_paths');
    if(windows&&value.slice(3).split('\\').some(part=>!part||/[. ]$/.test(part)||/[:*?"<>|]/.test(part)
      ||/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part)))fail('scope_paths');
  };
  for(const value of [cwd,temporaryPath,scratchRoot,codexHome,journalRoot,executablePath])validPath(value);
  const equal=(a,b)=>windows?a.toLowerCase()===b.toLowerCase():a===b;
  const within=(root,target)=>{const rel=paths.relative(root,target);return rel!==''&&rel!=='..'
    &&!rel.startsWith('..'+paths.sep)&&!paths.isAbsolute(rel);};
  const overlaps=(a,b)=>equal(a,b)||within(a,b)||within(b,a);
  if(!POLICY_RUN.test(context.runId||'')||paths.basename(temporaryPath)!==context.runId
    ||paths.dirname(temporaryPath)!==scratchRoot||overlaps(cwd,scratchRoot)
    ||[codexHome,journalRoot,paths.dirname(executablePath)].some(root=>overlaps(root,cwd)||overlaps(root,temporaryPath)))fail('scope_paths');
  if(!context.env||typeof context.env!=='object'||Array.isArray(context.env))fail('environment_binding');
  const environment=Object.create(null);
  for(const [key,value]of Object.entries(context.env)){
    const name=key.toUpperCase();if(!['CODEX_HOME','TEMP','TMP','TMPDIR'].includes(name))continue;
    if(Object.hasOwn(environment,name))fail('environment_binding');environment[name]=value;
  }
  if(environment.CODEX_HOME!==codexHome||['TEMP','TMP','TMPDIR'].some(key=>environment[key]!==temporaryPath))fail('environment_binding');

  // Match this runner's real fixed argv, not the producer's weaker probe argv.
  const rootArgs=['-a','never','--no-daemon',...codexCliPermissionOverrides(mode)],exec=args.indexOf('exec');
  if(exec<rootArgs.length||args.lastIndexOf('exec')!==exec
    ||JSON.stringify(args.slice(exec-rootArgs.length,exec))!==JSON.stringify(rootArgs))fail('invocation_flags');
  const prefix=args.slice(0,exec-rootArgs.length),approvedPrefix=context.agentMcpArgv??[];
  // The runner obtains this exact prefix from the existing private, registered
  // MCP launch. Preserve its shell-environment exclusions; do not approximate
  // its contract with a looser config-key regexp or drop its second argument.
  if(!Array.isArray(approvedPrefix)||approvedPrefix.some(arg=>typeof arg!=='string'||arg.includes('\0'))
    ||JSON.stringify(prefix)!==JSON.stringify(approvedPrefix))fail('invocation_flags');
  const tail=args.slice(exec+1,-5),start=['--ignore-user-config','--sandbox',mode,'--json','--color','never'];
  if(JSON.stringify(tail.slice(0,start.length))!==JSON.stringify(start))fail('invocation_flags');
  let offset=start.length;
  if(tail[offset]==='--model'){
    if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(tail[offset+1]||''))fail('invocation_flags');offset+=2;
  }
  if(tail.length!==offset+6||tail[offset]!=='--output-schema'||tail[offset+2]!=='--output-last-message'
    ||tail[offset+4]!=='-C'||tail[offset+5]!==cwd)fail('invocation_flags');
  for(const file of [tail[offset+1],tail[offset+3]]){validPath(file);if(!within(journalRoot,file))fail('invocation_flags');}

  policyObject(event,['type','nonce','context_id','mode','strict_config','thread_start_overrides','policy']);
  if(event.type!=='metaengine.effective_policy.v1'||event.nonce!==context.policyNonce||!POLICY_CONTEXT.test(event.context_id||'')
    ||event.mode!=='execute'||typeof event.strict_config!=='boolean')fail('envelope');
  const policy=event.policy;
  policyObject(policy,['schema','upstream_commit','stage','cwd','load_mode','effective','requirements','layers','origins','origins_scope']);
  if(policy.schema!=='metaengine.codex.effective-policy.v1'||policy.upstream_commit!==POLICY_UPSTREAM
    ||policy.stage!=='THREAD_START_RESOLVED_BEFORE_SPAWN'||policy.cwd!==cwd)fail('policy_identity');
  const load=policy.load_mode;
  policyObject(load,['ignore_user_config','ignore_project_config','ignore_managed_requirements','ignore_login_requirements',
    'ignore_user_and_project_exec_policy_rules','user_config_profile','user_config_path_override']);
  if(load.ignore_user_config!==true||load.ignore_project_config!==false||load.ignore_managed_requirements!==false
    ||load.ignore_login_requirements!==false||load.ignore_user_and_project_exec_policy_rules!==false
    ||load.user_config_profile!==null||load.user_config_path_override!==false)fail('load_mode');
  const overrides=event.thread_start_overrides;
  policyObject(overrides,['scope','approval_policy','approvals_reviewer','sandbox_mode','permission_profile',
    'default_permissions','persisted_permission_profile_id','cwd','workspace_roots','additional_writable_roots']);
  const roots=(value,required=false)=>{
    if(!Array.isArray(value)||value.length>1||required&&value.length!==1||value.some(root=>root!==cwd))fail('roots');
  };
  if(overrides.scope!=='TYPED_THREAD_START_OVERRIDES'||![null,'never'].includes(overrides.approval_policy)
    ||![null,'user'].includes(overrides.approvals_reviewer)||![null,mode].includes(overrides.sandbox_mode)
    ||overrides.permission_profile!==null||overrides.default_permissions!==null||overrides.persisted_permission_profile_id!==null
    ||![null,cwd].includes(overrides.cwd))fail('thread_overrides');
  roots(overrides.workspace_roots);
  if(!Array.isArray(overrides.additional_writable_roots)||overrides.additional_writable_roots.length)fail('thread_overrides');
  const effective=policy.effective;
  policyObject(effective,['permission_profile','active_permission_profile','explicit_permission_profile_mode','approval_policy',
    'approvals_reviewer','allow_login_shell','workspace_roots','permission_workspace_roots','profile_workspace_roots','windows']);
  if(effective.active_permission_profile!==null||effective.explicit_permission_profile_mode!==false||effective.approval_policy!=='never'
    ||effective.approvals_reviewer!=='user'||effective.allow_login_shell!==false)fail('effective_selection');
  policyObject(effective.windows,['configured_mode','configured_backend','effective_local_backend']);
  if(effective.windows.configured_mode!=='elevated'||effective.windows.configured_backend!=='windowsRestrictedToken'
    ||effective.windows.effective_local_backend!=='windowsRestrictedToken')fail('windows_backend');
  roots(effective.workspace_roots,true);roots(effective.permission_workspace_roots);
  if(!Array.isArray(effective.profile_workspace_roots)||effective.profile_workspace_roots.length>1)fail('roots');
  for(const value of effective.profile_workspace_roots){
    try{
      if(typeof value!=='string'||/%(?:2f|5c|00)/i.test(value))fail('roots');
      const uri=new URL(value);
      if(uri.protocol!=='file:'||uri.hostname||uri.username||uri.password||uri.search||uri.hash||uri.href!==value)fail('roots');
      const decoded=decodeURIComponent(uri.pathname);
      const target=windows?decoded.slice(1).replaceAll('/','\\'):decoded;
      if(windows&&!/^\/[A-Za-z]:\//.test(decoded)||target!==cwd)fail('roots');
    }catch{fail('roots');}
  }
  const profile=effective.permission_profile;
  policyObject(profile,['type','file_system','network']);
  if(profile.type!=='managed'||profile.network!=='restricted')fail('permission_profile');
  const filesystem=profile.file_system,hasDepth=filesystem&&typeof filesystem==='object'&&Object.hasOwn(filesystem,'glob_scan_max_depth');
  policyObject(filesystem,['type','entries',...(hasDepth?['glob_scan_max_depth']:[])]);
  if(filesystem.type!=='restricted'||!Array.isArray(filesystem.entries)||filesystem.entries.length<1||filesystem.entries.length>3
    ||hasDepth&&(!Number.isSafeInteger(filesystem.glob_scan_max_depth)||filesystem.glob_scan_max_depth<1||filesystem.glob_scan_max_depth>64))fail('filesystem');
  let rootRead=false;const writes=new Set();
  for(const entry of filesystem.entries){
    const optional=entry&&typeof entry==='object'&&Object.hasOwn(entry,'missing_path_behavior');
    policyObject(entry,['path','access',...(optional?['missing_path_behavior']:[])]);
    if(optional&&entry.missing_path_behavior!=='skip')fail('filesystem');
    const selected=entry.path;let target;
    if(selected?.type==='special'){
      policyObject(selected,['type','value']);policyObject(selected.value,['kind']);
      if(selected.value.kind==='root'){
        if(entry.access!=='read'||rootRead)fail('filesystem');rootRead=true;continue;
      }
      if(selected.value.kind==='project_roots'&&effective.permission_workspace_roots.length===1
        &&effective.profile_workspace_roots.length===1)target=cwd;
      else if(selected.value.kind==='tmpdir')target=temporaryPath;
      else fail('filesystem');
    }else if(selected?.type==='path'){
      policyObject(selected,['type','path']);target=selected.path;
      if(target!==cwd&&target!==temporaryPath)fail('filesystem');
    }else fail('filesystem');
    if(entry.access!=='write'||role==='CRITIC'||writes.has(target))fail('filesystem');writes.add(target);
  }
  if(!rootRead||role==='IMPLEMENTER'&&!writes.has(cwd))fail('filesystem');

  const requirements=policy.requirements;
  policyObject(requirements,['values','sources','source_scope','generation']);
  policyObject(requirements.values,POLICY_REQUIREMENT_KEYS);policyObject(requirements.sources,POLICY_REQUIREMENT_KEYS);
  if(requirements.source_scope!=='NORMALIZED_CONSTRAINT')fail('requirements_scope');
  const generation=policySha(policyCanonical({values:requirements.values,sources:requirements.sources}));
  if(!policyHashMatches(requirements.generation,generation))fail('requirements_generation');
  // Do not clear, normalize away or pretend to implement any real constraint.
  if(POLICY_REQUIREMENT_KEYS.some(key=>requirements.values[key]!==null||requirements.sources[key]!==null))fail('requirements_unsupported');
  if(!Array.isArray(policy.layers)||policy.layers.length>128)fail('layers');
  const source=value=>{
    policyObject(value,['kind','identity_generation']);
    if(!POLICY_LAYER_KINDS.has(value.kind)||typeof value.identity_generation!=='string'
      ||!/^sha256:[a-f0-9]{64}$/.test(value.identity_generation))fail('layer_source');
  };
  const metadata=value=>{
    source(value.source);
    if(value.name!==value.source.kind||typeof value.version!=='string'||!/^sha256:[a-f0-9]{64}$/.test(value.version))fail('layer_metadata');
  };
  for(const layer of policy.layers){
    policyObject(layer,['name','source','version','enabled','loader_ignored','content_scope']);metadata(layer);
    if(typeof layer.enabled!=='boolean'||typeof layer.loader_ignored!=='boolean'
      ||layer.loader_ignored!==(layer.name==='user')
      ||layer.content_scope!==(layer.loader_ignored?'IGNORED_EMPTY_PLACEHOLDER':'RESOLVED_LAYER_CONTENT')
      ||layer.loader_ignored&&!policyHashMatches(layer.version,policySha('')))fail('layer_loader');
  }
  if(policy.origins_scope!=='CONFIG_LAYER_MERGE_EXCLUDING_REQUIREMENTS_AND_HARNESS_OVERRIDES'
    ||!policy.origins||typeof policy.origins!=='object'||Array.isArray(policy.origins)||Object.keys(policy.origins).length>1024)fail('origins');
  for(const [key,origin]of Object.entries(policy.origins)){
    if(!key||Buffer.byteLength(key)>2048||/[\x00-\x1f\x7f]/.test(key))fail('origins');
    policyObject(origin,['name','source','version']);metadata(origin);
    if(!policy.layers.some(layer=>layer.enabled&&!layer.loader_ignored&&layer.name===origin.name&&layer.version===origin.version
      &&layer.source.kind===origin.source.kind&&layer.source.identity_generation===origin.source.identity_generation))fail('origin_layer');
  }
  // Origins are merge metadata, not proof of a final constrained value.
  const ack=JSON.stringify({type:'metaengine.effective_policy.accept.v1',nonce:event.nonce,context_id:event.context_id})+'\n';
  if(Buffer.byteLength(ack)>512)fail('ack_budget');
  return freeze({schema:'metaengine.codex-cli.effective-policy-observation.v1',raw_sha256:policySha(raw),raw_bytes:raw.length,
    nonce:event.nonce,context_id:event.context_id,prompt_sha256:context.promptSha256,upstream_commit:POLICY_UPSTREAM,
    ack,authority_effect:false});
}
