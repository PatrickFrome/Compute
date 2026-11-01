import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {captureCodexCliPhysicalScope,codexCliInvocationFingerprint,codexCliPermissionOverrides,assertCodexCliPolicyBindings,assertCodexCliHomeEnvAbsent,validateCodexCliEffectivePolicy} from '../src/codex-cli-execution-policy.mjs';

async function fixture(t) {
  const parent=await fs.realpath(os.tmpdir());
  const directory=await fs.mkdtemp(path.join(parent,'codex-policy-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const cliPath=path.join(directory,'cli.exe'),codexHome=path.join(directory,'home'),scratchRoot=path.join(directory,'scratch'),workspaceRoot=path.join(directory,'work');
  for(const target of [codexHome,scratchRoot,workspaceRoot])await fs.mkdir(target);
  await fs.writeFile(cliPath,'test-only-cli');
  const calls=[];
  const options={cliPath,codexHome,scratchRoot,workspaceRoot,mode:'workspace-write',environment:{},
    verifyStorage:async(target,options)=>{calls.push({target,options});return {owner_dacl_verified:true};}};
  return {directory,options,calls,read:extra=>captureCodexCliPhysicalScope({...options,...extra})};
}

test('scope hashes physical choices and known local config but never labels it effective policy',async t=>{
  const f=await fixture(t),first=await f.read(),second=await f.read();
  assert.deepEqual(first,second);
  assert.equal(first.schema,'metaengine.codex-cli.execution-scope.v2');
  assert.equal(first.configuration_attestation,'UNAVAILABLE');
  assert.equal(first.local_configuration.exhaustive,false);
  assert.equal(first.authority_effect,false);
  assert.equal(first.configuration_semantics.equivalent,false);
  for(const object of [first.home,first.scratch,first.workspace,first.cli])assert.match(object.identity_sha256,/^[a-f0-9]{64}$/);
  assert.match(first.cli.sha256,/^[a-f0-9]{64}$/);
  assert.equal(f.calls.length,4);assert(f.calls.every(call=>call.options.operation==='VERIFY_DIRECTORY'));
  assert.equal(JSON.stringify(first).includes('test-only-cli'),false);
});

test('replacing a same-named root is distinguishable even with unchanged contents',async t=>{
  for(const [argument,field] of [['codexHome','home'],['scratchRoot','scratch'],['workspaceRoot','workspace']]){
    const f=await fixture(t),before=await f.read(),target=f.options[argument];
    await fs.rename(target,target+'-retired');await fs.mkdir(target);
    const after=await f.read();assert.equal(after[field].path,before[field].path);
    assert.notEqual(after[field].identity_sha256,before[field].identity_sha256);
  }
});

test('new and changed configuration bytes invalidate scope without changing directory identity',async t=>{
  const f=await fixture(t),before=await f.read(),file=path.join(f.options.codexHome,'config.toml');
  await fs.writeFile(file,'model="first"\n');const added=await f.read();
  assert.equal(before.home.identity_sha256,added.home.identity_sha256);
  assert.notEqual(before.local_configuration.sha256,added.local_configuration.sha256);
  await fs.writeFile(file,'model="other"\n');const changed=await f.read();
  assert.notEqual(added.local_configuration.sha256,changed.local_configuration.sha256);
  assert.equal(JSON.stringify(changed).includes('model='),false);
  await fs.mkdir(path.join(f.options.workspaceRoot,'.codex'));
  await fs.writeFile(path.join(f.options.workspaceRoot,'.codex','config.toml'),'sandbox_mode="read-only"\n');
  assert.notEqual(changed.local_configuration.sha256,(await f.read()).local_configuration.sha256);
});

test('CLI bytes and same-byte file replacement invalidate scope',async t=>{
  const f=await fixture(t),before=await f.read();await fs.writeFile(f.options.cliPath,'different-cli');
  const mutated=await f.read();assert.notEqual(before.cli.sha256,mutated.cli.sha256);
  await fs.rename(f.options.cliPath,f.options.cliPath+'.old');await fs.writeFile(f.options.cliPath,'different-cli');
  const replaced=await f.read();assert.equal(mutated.cli.sha256,replaced.cli.sha256);
  assert.notEqual(mutated.cli.identity_sha256,replaced.cli.identity_sha256);
});

test('broadened ACL, alias and hardlink targets fail physical capture',async t=>{
  const f=await fixture(t);
  await assert.rejects(f.read({verifyStorage:async()=>({owner_dacl_verified:false})}),/storage_unverified/);
  const linked=path.join(f.directory,'linked-cli');await fs.link(f.options.cliPath,linked);
  await assert.rejects(f.read(),/file_unverified/);await fs.unlink(linked);
  if(process.platform!=='win32'){
    const alias=path.join(f.directory,'alias');await fs.symlink(f.options.codexHome,alias);
    await assert.rejects(f.read({codexHome:alias}),/identity_unverified|path_unverified/);
  }
});

test('cancelled capture cannot start ACL readers or report late success',async t=>{
  const f=await fixture(t),controller=new AbortController();controller.abort();
  await assert.rejects(f.read({signal:controller.signal}),/request_cancelled/);assert.equal(f.calls.length,0);
  const other=new AbortController();
  await assert.rejects(f.read({signal:other.signal,verifyStorage:async()=>{other.abort();return {owner_dacl_verified:true};}}),/request_cancelled/);
});

test('inert preparation can pin a missing scratch root without creating it',async t=>{
  const f=await fixture(t);await fs.rmdir(f.options.scratchRoot);
  await assert.rejects(f.read(),{code:'ENOENT'});
  const first=await f.read({allowMissingScratchRoot:true});
  assert.equal(first.scratch.exists,false);assert.equal(first.scratch.parent_path,f.directory);
  assert.match(first.scratch.parent_identity_sha256,/^[a-f0-9]{64}$/);
  await assert.rejects(fs.stat(f.options.scratchRoot),{code:'ENOENT'});
  await fs.mkdir(f.options.scratchRoot);
  const second=await f.read();assert.equal(second.scratch.exists,true);
  assert.deepEqual(second.home,first.home);assert.deepEqual(second.workspace,first.workspace);
  assert.equal(second.local_configuration.sha256,first.local_configuration.sha256);
});

test('a configuration mutation during native ACL read is reflected in the captured source generation',async t=>{
  const f=await fixture(t),file=path.join(f.options.codexHome,'config.toml');await fs.writeFile(file,'model="before"\n');
  const before=await f.read();let changed=false;
  const after=await f.read({verifyStorage:async()=>{
    if(!changed){changed=true;await fs.writeFile(file,'model="after"\n');}
    return {owner_dacl_verified:true};
  }});
  assert.notEqual(after.local_configuration.sha256,before.local_configuration.sha256);
});

test('invocation digest binds actual argv, cwd and canonical Windows environment without exposing values',()=>{
  const cwd=path.resolve('fixture'),args=['exec','--ignore-user-config'];
  const initial=codexCliInvocationFingerprint({args,cwd,env:{Path:'safe',CODEX_HOME:cwd,TEMP:cwd}});
  assert.equal(initial,codexCliInvocationFingerprint({args,cwd,env:{TEMP:cwd,PATH:'safe',CODEX_HOME:cwd}}));
  assert.notEqual(initial,codexCliInvocationFingerprint({args:['sandbox','--include-managed-config'],cwd,env:{PATH:'safe',CODEX_HOME:cwd,TEMP:cwd}}));
  assert.notEqual(initial,codexCliInvocationFingerprint({args,cwd,env:{PATH:'safe',CODEX_HOME:cwd,TEMP:cwd+'-changed'}}));
  assert.throws(()=>codexCliInvocationFingerprint({args,cwd,env:{PATH:'one',Path:'two'}}),/environment_case_collision/);
});

test('common explicit permission overrides are bounded and role-specific',()=>{
  for(const mode of ['read-only','workspace-write']){
    const args=codexCliPermissionOverrides(mode);
    assert(args.includes(`sandbox_mode="${mode}"`));assert(args.includes('sandbox_workspace_write.writable_roots=[]'));
    assert(args.includes('sandbox_workspace_write.network_access=false'));
    assert(!args.some(value=>/ignore|dangerously|include-managed/.test(value)));
  }
  assert.throws(()=>codexCliPermissionOverrides('danger-full-access'),/mode_invalid/);
});

const wireSha=value=>createHash('sha256').update(value).digest('hex');
const wireRequirementKeys=['allowed_approval_policies','allowed_approvals_reviewers','allowed_sandbox_modes','allowed_permission_profiles',
  'default_permissions','allow_login_shell','windows.allowed_sandbox_implementations','permission_profile','permissions.filesystem','experimental_network'];
const generatedWireCanonical=value=>Array.isArray(value)?'['+value.map(generatedWireCanonical).join(',')+']'
  :value&&typeof value==='object'?'{'+Object.keys(value).sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)))
    .map(key=>JSON.stringify(key)+':'+generatedWireCanonical(value[key])).join(',')+'}':JSON.stringify(value);
function updateWireGeneration(packet){const r=packet.policy.requirements;r.generation='sha256:'+wireSha(generatedWireCanonical({values:r.values,sources:r.sources}));}

// Generated Windows-shaped contract data only: no native Windows observation,
// source/image qualification, authentication or sandbox proof is asserted.
function generatedWireFixture(role='IMPLEMENTER'){
  const base=String.raw`C:\metaengine-policy`,join=path.win32.join;
  const cwd=join(base,'work'),scratchRoot=join(base,'scratch'),runId='11111111-1111-4111-8111-111111111111';
  const temporaryPath=join(scratchRoot,runId),codexHome=join(base,'home'),journalRoot=join(base,'journal');
  const policyNonce='a'.repeat(64),promptSha256=wireSha('\uFEFForiginal\r\n task  '),mode=role==='CRITIC'?'read-only':'workspace-write';
  const context={role,cwd,scratchRoot,temporaryPath,codexHome,journalRoot,runId,executablePath:join(base,'bin','codex.exe'),
    policyNonce,promptSha256,inputProtocol:'EFFECTIVE_POLICY_ACK_V1',env:{CODEX_HOME:codexHome,TEMP:temporaryPath,TMP:temporaryPath,TMPDIR:temporaryPath},
    args:['-a','never','--no-daemon',...codexCliPermissionOverrides(mode),'exec','--ignore-user-config','--sandbox',mode,'--json','--color','never',
      '--output-schema',join(journalRoot,'run','result-schema.json'),'--output-last-message',join(journalRoot,'run','result.json'),'-C',cwd,
      '--metaengine-effective-policy',policyNonce,'--metaengine-prompt-sha256',promptSha256,'-']};
  const source={kind:'session_flags',identity_generation:'sha256:'+wireSha('generated session identity')},version='sha256:'+wireSha('generated canonical TOML');
  const packet={type:'metaengine.effective_policy.v1',nonce:policyNonce,context_id:'018f0000-0000-7000-8000-000000000001',mode:'execute',strict_config:false,
    thread_start_overrides:{scope:'TYPED_THREAD_START_OVERRIDES',approval_policy:'never',approvals_reviewer:null,sandbox_mode:mode,
      permission_profile:null,default_permissions:null,persisted_permission_profile_id:null,cwd,workspace_roots:[],additional_writable_roots:[]},
    policy:{schema:'metaengine.codex.effective-policy.v1',upstream_commit:'3b01b36fa5eb96ba82a776bd3c2fc57f8969181f',
      stage:'THREAD_START_RESOLVED_BEFORE_SPAWN',cwd,
      load_mode:{ignore_user_config:true,ignore_project_config:false,ignore_managed_requirements:false,ignore_login_requirements:false,
        ignore_user_and_project_exec_policy_rules:false,user_config_profile:null,user_config_path_override:false},
      effective:{permission_profile:{type:'managed',file_system:{type:'restricted',entries:[
        {path:{type:'special',value:{kind:'root'}},access:'read'},
        ...(role==='IMPLEMENTER'?[{path:{type:'special',value:{kind:'project_roots'}},access:'write'},
          {path:{type:'special',value:{kind:'tmpdir'}},access:'write'}]:[])]},network:'restricted'},
        active_permission_profile:null,explicit_permission_profile_mode:false,approval_policy:'never',approvals_reviewer:'user',allow_login_shell:false,
        workspace_roots:[cwd],permission_workspace_roots:[cwd],profile_workspace_roots:['file:///'+cwd.replaceAll('\\','/')],
        windows:{configured_mode:'elevated',configured_backend:'windowsRestrictedToken',effective_local_backend:'windowsRestrictedToken'}},
      requirements:{values:Object.fromEntries(wireRequirementKeys.map(key=>[key,null])),sources:Object.fromEntries(wireRequirementKeys.map(key=>[key,null])),
        source_scope:'NORMALIZED_CONSTRAINT',generation:''},
      layers:[{name:'session_flags',source:{...source},version,enabled:true,loader_ignored:false,content_scope:'RESOLVED_LAYER_CONTENT'},
        {name:'user',source:{kind:'user',identity_generation:'sha256:'+wireSha('generated ignored identity')},version:'sha256:'+wireSha(''),
          enabled:true,loader_ignored:true,content_scope:'IGNORED_EMPTY_PLACEHOLDER'}],
      origins:{sandbox_mode:{name:'session_flags',source:{...source},version}},
      origins_scope:'CONFIG_LAYER_MERGE_EXCLUDING_REQUIREMENTS_AND_HARNESS_OVERRIDES'}};
  updateWireGeneration(packet);
  return {packet,context,raw:()=>Buffer.from(JSON.stringify(packet)),read:raw=>validateCodexCliEffectivePolicy(raw??Buffer.from(JSON.stringify(packet)),context)};
}

test('generated writer and critic projections validate as frozen deny-only data and preserve exact raw hashes',()=>{
  for(const role of ['IMPLEMENTER','CRITIC']){
    const f=generatedWireFixture(role),raw=Buffer.from(' \t'+JSON.stringify(f.packet)+'\t'),before=Buffer.from(raw),value=f.read(raw);
    assert(raw.equals(before));assert.equal(value.raw_sha256,wireSha(raw));assert.equal(value.raw_bytes,raw.length);
    assert.equal(value.prompt_sha256,f.context.promptSha256);assert.equal(value.authority_effect,false);assert(Object.isFrozen(value));
    assert.equal(value.ack,JSON.stringify({type:'metaengine.effective_policy.accept.v1',nonce:f.context.policyNonce,context_id:f.packet.context_id})+'\n');
    assert(Buffer.byteLength(value.ack)<=512);assert.equal(value.ack.split('\n').length,2);
  }
});

test('no-login-shell bounds reject effective true and missing, duplicate or contradictory argv',()=>{
  for(const role of ['IMPLEMENTER','CRITIC']){
    const enabled=generatedWireFixture(role);
    assert.doesNotThrow(()=>enabled.read());
    enabled.packet.policy.effective.allow_login_shell=true;
    assert.throws(()=>enabled.read(),/codex_cli_policy_effective_selection/);
    for(const mutate of [
      (args,index)=>{args.splice(index-1,2);},
      (args,index)=>{args[index]='allow_login_shell=true';},
      (args,index)=>{args[index]='allow_login_shell="false"';},
      (args,index)=>{args.splice(index-1,0,'-c','allow_login_shell=true');},
      args=>{args.splice(args.indexOf('exec'),0,'-c','allow_login_shell=true');},
      args=>{args.splice(args.indexOf('exec'),0,'-c','allow_login_shell=false');},
      args=>{args.splice(args.indexOf('exec')+1,0,'-c','allow_login_shell=true');}
    ]){
      const f=generatedWireFixture(role),args=f.context.args,index=args.indexOf('allow_login_shell=false');
      assert(index>0);assert.equal(args[index-1],'-c');
      mutate(args,index);
      assert.throws(()=>f.read(),/codex_cli_policy_invocation_flags/);
    }
  }
});

test('policy input bindings reject absent, malformed, misplaced and duplicate producer flags',()=>{
  const f=generatedWireFixture();assert.doesNotThrow(()=>assertCodexCliPolicyBindings(f.context));
  for(const patch of [{inputProtocol:undefined},{policyNonce:'bad'},{promptSha256:'A'.repeat(64)},
    {args:f.context.args.slice(0,-1)},
    {args:['--metaengine-effective-policy',f.context.policyNonce,...f.context.args]},
    {args:['--metaengine-prompt-sha256='+f.context.promptSha256,...f.context.args]}])
    assert.throws(()=>assertCodexCliPolicyBindings({...f.context,...patch}),/invocation_binding/);
});

test('closed policy identities, invocation choices and each root representation reject mismatches',()=>{
  const mutations=[
    p=>{p.type='other';},p=>{p.nonce='b'.repeat(64);},p=>{p.context_id='11111111-1111-4111-8111-111111111111';},
    p=>{p.mode='inspect';},p=>{p.strict_config='false';},p=>{p.policy.upstream_commit='0'.repeat(40);},
    p=>{p.policy.stage='AFTER_SPAWN';},p=>{p.policy.schema='other';},p=>{p.policy.cwd+='-other';},
    p=>{p.thread_start_overrides.sandbox_mode='read-only';},p=>{p.thread_start_overrides.cwd+='-other';},
    p=>{p.thread_start_overrides.approval_policy='on-request';},p=>{p.thread_start_overrides.approvals_reviewer='auto_review';},
    p=>{p.thread_start_overrides.default_permissions='selected';},p=>{p.thread_start_overrides.persisted_permission_profile_id='selected';},
    p=>{p.thread_start_overrides.permission_profile={type:'disabled'};},
    p=>{p.thread_start_overrides.additional_writable_roots=[p.policy.cwd];},
    p=>{p.thread_start_overrides.workspace_roots=[p.policy.cwd+'-other'];},
    p=>{p.policy.effective.windows.configured_mode='unelevated';},
    p=>{p.policy.effective.windows.configured_backend='none';},p=>{p.policy.effective.windows.effective_local_backend='linuxSeccomp';},
    p=>{p.policy.effective.approval_policy='untrusted';},p=>{p.policy.effective.approvals_reviewer='auto_review';},
    p=>{p.policy.effective.allow_login_shell=true;},p=>{p.policy.effective.active_permission_profile={id:'selected'};},
    p=>{p.policy.effective.explicit_permission_profile_mode=true;},
    p=>{p.policy.effective.workspace_roots.push(p.policy.cwd+'-other');},
    p=>{p.policy.effective.permission_workspace_roots=[p.policy.cwd+'-other'];},
    p=>{p.policy.effective.profile_workspace_roots=['file:///C:/elsewhere'];},
    p=>{p.policy.effective.profile_workspace_roots=[p.policy.cwd];},
    p=>{p.policy.load_mode.ignore_user_config=false;},p=>{p.policy.load_mode.ignore_project_config=true;},
    p=>{p.policy.load_mode.ignore_managed_requirements=true;},p=>{p.policy.load_mode.ignore_login_requirements=true;},
    p=>{p.policy.load_mode.ignore_user_and_project_exec_policy_rules=true;},
    p=>{p.policy.load_mode.user_config_profile='selected';},p=>{p.policy.load_mode.user_config_path_override=true;}
  ];
  for(const mutate of mutations){const f=generatedWireFixture();mutate(f.packet);assert.throws(()=>f.read(),/codex_cli_policy_/);}
  const f=generatedWireFixture();f.context.args.splice(f.context.args.indexOf('exec')+1,0,'--ignore-rules');
  assert.throws(()=>f.read(),/invocation_flags/);
});

test('restricted filesystem subset never admits root/network/home/journal/image or extra temporary writes',()=>{
  const mutations=[
    p=>{p.policy.effective.permission_profile.type='disabled';},p=>{p.policy.effective.permission_profile.type='external';},
    p=>{p.policy.effective.permission_profile.network='enabled';},p=>{p.policy.effective.permission_profile.file_system.type='unrestricted';},
    p=>{p.policy.effective.permission_profile.file_system.entries[0].access='write';},
    p=>{p.policy.effective.permission_profile.file_system.entries[1].path={type:'glob_pattern',pattern:'**'};},
    p=>{p.policy.effective.permission_profile.file_system.entries[1].path.value={kind:'project_roots',subpath:'..'};},
    p=>{p.policy.effective.permission_profile.file_system.entries[2].path.value.kind='slash_tmp';},
    p=>{p.policy.effective.permission_profile.file_system.entries[2].path.value={kind:'unknown',path:'elsewhere'};},
    p=>{p.policy.effective.permission_profile.file_system.entries[1].access='deny';},
    (p,c)=>{p.policy.effective.permission_profile.file_system.entries[2].path={type:'path',path:c.codexHome};},
    (p,c)=>{p.policy.effective.permission_profile.file_system.entries[2].path={type:'path',path:c.journalRoot};},
    (p,c)=>{p.policy.effective.permission_profile.file_system.entries[2].path={type:'path',path:c.executablePath};},
    (p,c)=>{p.policy.effective.permission_profile.file_system.entries[2].path={type:'path',path:c.scratchRoot};},
    (p,c)=>{p.policy.effective.permission_profile.file_system.entries[2].path={type:'path',path:c.temporaryPath+'-extra'};}
  ];
  for(const mutate of mutations){const f=generatedWireFixture();mutate(f.packet,f.context);assert.throws(()=>f.read(),/codex_cli_policy_/);}
  const critic=generatedWireFixture('CRITIC');critic.packet.policy.effective.permission_profile.file_system.entries.push(
    {path:{type:'path',path:critic.context.cwd},access:'write'});
  assert.throws(()=>critic.read(),/filesystem/);
  const writer=generatedWireFixture();writer.context.role='CRITIC';assert.throws(()=>writer.read(),/invocation_flags|thread_overrides|filesystem/);
});

test('raw parser refuses framing, invalid UTF-8, duplicate escaped nested keys and bounded complexity',()=>{
  const f=generatedWireFixture(),text=JSON.stringify(f.packet),raw=f.raw();
  for(const invalid of [text,Buffer.alloc(0),Buffer.alloc(65537,32),Buffer.from([0xff]),
    Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),raw]),Buffer.from(text+'\n'),Buffer.from(text+'\r\n'),
    Buffer.from(text+'\n'+text),Buffer.from(text+text),Buffer.from(text.slice(0,-1)),
    Buffer.from(text.replace('"strict_config":false','"strict_config":false,"strict_config":false')),
    Buffer.from(text.replace('"network":"restricted"','"network":"restricted","\\u006eetwork":"restricted"')),
    Buffer.from(text.replace('"strict_config":false','"strict_config":false,"\\u0073trict_config":false')),
    Buffer.from(text.replace('"strict_config":false','"strict_config":9007199254740993')),
    Buffer.from(text.replace('"strict_config":false','"strict_config":1e400'))])
    assert.throws(()=>f.read(invalid),/codex_cli_policy_/);
  let nested=null;for(let i=0;i<40;i++)nested={nested};
  f.packet.extra=nested;assert.throws(()=>f.read(),/packet_complexity/);
  f.packet.extra=Array(9000).fill(null);assert.throws(()=>f.read(),/packet_complexity/);
});

test('fixed keysets, requirements generations and real nonempty requirements remain fail closed',()=>{
  for(const mutate of [p=>{delete p.policy.stage;},p=>{p.extra=true;},p=>{p.policy.effective.windows.extra=true;},
    p=>{delete p.policy.requirements.sources.allow_login_shell;},p=>{p.policy.requirements.values.extra=null;},
    p=>{p.policy.requirements.source_scope='RAW_SOURCE';},p=>{p.policy.requirements.generation='0'.repeat(64);}]){
    const f=generatedWireFixture();mutate(f.packet);assert.throws(()=>f.read(),/codex_cli_policy_/);
  }
  for(const mutate of [
    p=>{p.policy.requirements.values.allowed_sandbox_modes=['read-only'];},
    p=>{p.policy.requirements.values.allow_login_shell=true;},
    p=>{p.policy.requirements.values.allow_login_shell=false;},
    p=>{p.policy.requirements.values['permissions.filesystem']={deny_read:['private']};},
    p=>{p.policy.requirements.values.experimental_network={enabled:true};},
    p=>{p.policy.requirements.sources.allow_login_shell={kind:'system_requirements',identity_generation:'sha256:'+'1'.repeat(64)};},
    p=>{p.policy.requirements.sources.allow_login_shell={kind:'composite',sources:[{kind:'unknown'}]};}
  ]){
    const f=generatedWireFixture();mutate(f.packet);updateWireGeneration(f.packet);assert.throws(()=>f.read(),/requirements_unsupported/);
  }
});

test('producer SHA256 generations and layer versions require their authentic tagged representation',()=>{
  const requirements=generatedWireFixture();requirements.packet.policy.requirements.generation=requirements.packet.policy.requirements.generation.slice(7);
  assert.throws(()=>requirements.read(),/requirements_generation/);
  const layer=generatedWireFixture();layer.packet.policy.layers[0].version=layer.packet.policy.layers[0].version.slice(7);
  layer.packet.policy.origins.sandbox_mode.version=layer.packet.policy.layers[0].version;
  assert.throws(()=>layer.read(),/layer_metadata/);
});

test('loader metadata and origins must be closed and agree with a nonignored enabled layer',()=>{
  for(const mutate of [
    p=>{p.policy.layers[0].source.extra=true;},p=>{p.policy.layers[0].source.kind='unknown';},
    p=>{p.policy.layers[0].source.identity_generation='1'.repeat(64);},p=>{p.policy.layers[0].version='not-a-hash';},
    p=>{p.policy.layers[0].loader_ignored=true;},p=>{p.policy.layers[1].loader_ignored=false;},
    p=>{p.policy.layers[1].version='1'.repeat(64);},p=>{p.policy.layers[1].content_scope='RESOLVED_LAYER_CONTENT';},
    p=>{p.policy.layers[0].enabled=false;},p=>{p.policy.origins.sandbox_mode.version='1'.repeat(64);},
    p=>{p.policy.origins.sandbox_mode.extra=true;},p=>{p.policy.origins_scope='OTHER';},
    p=>{const l=p.policy.layers[1];p.policy.origins.sandbox_mode={name:l.name,source:{...l.source},version:l.version};},
    p=>{p.policy.layers=Array.from({length:129},()=>({...p.policy.layers[0]}));}
  ]){const f=generatedWireFixture();mutate(f.packet);assert.throws(()=>f.read(),/codex_cli_policy_/);}
});

test('home dotenv refusal uses lstat only, including dangling aliases, without inventorying contents',async t=>{
  const f=await fixture(t),file=path.join(f.options.codexHome,'.env');
  await assertCodexCliHomeEnvAbsent(f.options.codexHome);
  const open=fs.open.bind(fs),readFile=fs.readFile.bind(fs);let reads=0;
  const guard=file=>{if(path.basename(String(file)).toLowerCase()==='.env'){reads++;throw Error('dotenv_content_read_forbidden');}};
  t.mock.method(fs,'open',(file,...args)=>{guard(file);return open(file,...args);});
  t.mock.method(fs,'readFile',(file,...args)=>{guard(file);return readFile(file,...args);});
  await fs.writeFile(file,'generated fixture, not authentication material');
  await assert.rejects(assertCodexCliHomeEnvAbsent(f.options.codexHome),/home_dotenv_not_permitted/);
  assert.equal((await f.read()).local_configuration.inventory.some(item=>item.path===file),false);
  await fs.unlink(file);
  if(process.platform!=='win32'){
    await fs.symlink(path.join(f.directory,'absent-dotenv-target'),file);
    await assert.rejects(assertCodexCliHomeEnvAbsent(f.options.codexHome),/home_dotenv_not_permitted/);
  }
  assert.equal(reads,0);
});
