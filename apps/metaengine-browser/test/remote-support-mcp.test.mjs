import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRemoteSupportMcp as createRawRemoteSupportMcp, readBoundedCapture, discoverLocalPostgresFiles, listReadyFixedWindowsDrives } from '../src/remote-support-mcp.mjs';

// Existing behavioral tests model the trusted host integration explicitly.
// The production default remains fail-closed; the resolver below is only a
// deterministic test double and never reads a database.
const trustedTestContext = {command_id:'11111111-1111-4111-8111-111111111111',effect_binding:{trusted_test_fixture:true}};
const trustedResolver = async ({ request }) => ({
  schema:'metaengine.remote-support-control-lease.v1',verified:true,
  context:trustedTestContext,
  request_binding:request,
});
const createRemoteSupportMcp = options => {
  // Keep transport validation tests on the raw constructor.
  if ((options?.input && !options?.output) || (!options?.input && options?.output))
    return createRawRemoteSupportMcp(options);
  return createRawRemoteSupportMcp({resolveControlLease:trustedResolver,...options});
};

const rpc = (service,name,args={}) => service.request({jsonrpc:'2.0',id:3,method:'tools/call',params:{name,arguments:args}});
const denied = x => x.result.isError && x.result.content[0].text.startsWith('remote_support_');
const mock = () => {
  const calls=[];
  return {calls,
    observe:async value=>{calls.push({kind:'view',value});return {result:{windows:[],ok:true}};},
    act:async (value,context)=>{calls.push({kind:'effect',value,context});return {outcome:'NO_EFFECT_PROVEN',authority_effect:false};},
  };
};
const act={action:'UIA_INVOKE',target:{process_id:42},args:{runtime_id:[9]},context:{command_id:'bound-to-real-lease'},agent_id:'agent_demo-v1',task_id:'task_demo-v1'};

test('MCP discovery, status and session closure do not start Browser or remote control',async()=>{
  const s=createRemoteSupportMcp({executor:mock(),approve:async()=>{throw Error('approval unexpectedly requested')},platform:'win32'});
  const init=await s.request({jsonrpc:'2.0',id:1,method:'initialize'});
  assert.equal(init.result.serverInfo.name,'metaengine-remote-support');
  const list=await s.request({jsonrpc:'2.0',id:2,method:'tools/list'});
  assert.deepEqual(list.result.tools.map(x=>x.name),['support_status','support_start_session','support_discover_postgres','support_connect_restored_postgres','support_observe','support_control','support_stop']);
  const row=JSON.parse((await rpc(s,'support_status')).result.content[0].text);
  assert.equal(row.unattended_access,false);
  assert.equal(row.active_view_grant,false);
  assert.equal(row.active_control_grant,false);
  assert.equal(row.arbitrary_shell,false);
  s.close();
  await assert.rejects(s.request({jsonrpc:'2.0',id:4,method:'ping'}),/session_closed/);
});

test('without first-session local approval, VIEW and CONTROL never reach executor',async()=>{
  const ex=mock(),scopes=[];
  const s=createRemoteSupportMcp({executor:ex,approve:async({scope})=>{scopes.push(scope);return false;},platform:'win32'});
  assert(denied(await rpc(s,'support_observe',{action:'OBSERVE_WINDOWS'})));
  assert(denied(await rpc(s,'support_control',act)));
  assert.deepEqual(scopes,[]);
  assert(denied(await rpc(s,'support_start_session',{scope:'CONTROL'})));
  assert.deepEqual(scopes,['CONTROL']);
  assert(denied(await rpc(s,'support_control',act)));
  assert.equal(ex.calls.length,0);
  s.close();
});

test('one explicit CONTROL grant allows many actions without repeated local permission dialogs',async()=>{
  const ex=mock(),scopes=[];let clock=Date.parse('2026-10-08T00:00:00Z');
  const s=createRemoteSupportMcp({executor:ex,now:()=>clock,platform:'win32',approve:async({scope})=>{scopes.push(scope);return true;}});
  const approved=await rpc(s,'support_start_session',{scope:'CONTROL'});
  const grant=JSON.parse(approved.result.content[0].text);
  assert.equal(grant.scope,'CONTROL');
  assert.equal(grant.approved_locally,true);
  assert.equal(grant.further_action_prompts,false);
  assert.match(grant.session_id,/^[0-9a-f-]{36}$/);
  for (let i=0;i<25;i++) {
    assert.equal((await rpc(s,'support_observe',{action:'OBSERVE_WINDOWS'})).result.isError,false);
    assert.equal((await rpc(s,'support_control',act)).result.isError,false);
  }
  assert.deepEqual(scopes,['CONTROL']);
  assert.equal(ex.calls.length,50);
  assert.deepEqual(ex.calls[1].context,trustedTestContext);
  assert(denied(await rpc(s,'support_start_session',{scope:'CONTROL'})), 'remote caller may not silently extend session');
  assert.deepEqual(scopes,['CONTROL']);
  clock+=3600000;
  assert(denied(await rpc(s,'support_control',act)));
  assert(denied(await rpc(s,'support_observe',{action:'OBSERVE_WINDOWS'})));
  assert.equal(ex.calls.length,50);
  s.close();
});

test('VIEW session cannot mutate or upgrade its privileges without restarting local helper',async()=>{
  const ex=mock(),scopes=[];
  const s=createRemoteSupportMcp({executor:ex,platform:'win32',approve:async({scope})=>{scopes.push(scope);return true;}});
  await rpc(s,'support_start_session',{scope:'VIEW'});
  assert.equal((await rpc(s,'support_observe',{action:'FOREGROUND_STATUS'})).result.isError,false);
  assert(denied(await rpc(s,'support_control',act)));
  assert(denied(await rpc(s,'support_start_session',{scope:'CONTROL'})));
  assert.deepEqual(scopes,['VIEW']);
  assert.deepEqual(ex.calls.map(x=>x.kind),['view']);
  await rpc(s,'support_stop');
  assert(denied(await rpc(s,'support_observe',{action:'OBSERVE_WINDOWS'})));
  assert(denied(await rpc(s,'support_start_session',{scope:'CONTROL'})));
  assert.equal(JSON.parse((await rpc(s,'support_status')).result.content[0].text).session_revoked,true);
  s.close();
});

test('non-Windows and arbitrary remote execution are never authorized',async()=>{
  const ex=mock();let approved=0;
  const s=createRemoteSupportMcp({executor:ex,platform:'linux',approve:async()=>{approved++;return true;}});
  assert(denied(await rpc(s,'support_start_session',{scope:'CONTROL'})));
  assert(denied(await rpc(s,'support_observe',{action:'CAPTURE_DESKTOP',args:{monitor:0}})));
  assert(denied(await rpc(s,'support_control',{action:'RUN_SHELL',args:{command:'whoami'}})));
  assert.equal(ex.calls.length,0);
  assert.equal(approved,0);
  s.close();
});

test('approved screenshot returns a bounded image under the existing MCP session',async()=>{
  const png=Buffer.from('89504e470d0a1a0a000000000000000000000000','hex');
  let approvals=0;
  const s=createRemoteSupportMcp({platform:'win32',approve:async()=>{approvals++;return true;},
    executor:{observe:async()=>({result:{png_path:'synthetic',png_sha256:'f'.repeat(64)}})},
    imageLoader:async()=>png});
  await rpc(s,'support_start_session',{scope:'VIEW'});
  const r=await rpc(s,'support_observe',{action:'CAPTURE_DESKTOP',args:{monitor:0}});
  assert.equal(r.result.content[1].type,'image');
  assert.equal(r.result.content[1].data,png.toString('base64'));
  assert.equal(approvals,1);
  s.close();
});

test('image loader only reads hashed, owned temporary PNG files',async t=>{
  const root=path.join(os.tmpdir(),'metaengine-computer-captures');
  await fs.mkdir(root,{recursive:true});
  const file=path.join(root,'window-'+randomUUID()+'.png');
  const png=Buffer.from('89504e470d0a1a0a000000000000000000000000','hex');
  const sha=createHash('sha256').update(png).digest('hex');
  await fs.writeFile(file,png,{flag:'wx',mode:0o600});
  t.after(()=>fs.rm(file,{force:true}));
  await assert.rejects(readBoundedCapture(file,'0'.repeat(64)),/capture_unverified/);
  assert.deepEqual(await readBoundedCapture(file,sha),png);
  await assert.rejects(fs.lstat(file),{code:'ENOENT'});
  await assert.rejects(readBoundedCapture(path.join(os.tmpdir(),'other.png'),sha));
});

test('stdio JSON-RPC framing sends no unsolicited private data',async()=>{
  const input=new PassThrough(),output=new PassThrough();
  const seen=[];output.on('data',value=>seen.push(String(value)));
  const support=createRemoteSupportMcp({input,output,platform:'win32',executor:mock(),approve:async()=>false});
  input.write(JSON.stringify({jsonrpc:'2.0',id:5,method:'tools/list'})+'\n');
  input.write('invalid-json\n');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(seen.length,2);
  assert.equal(JSON.parse(seen[0]).id,5);
  assert.equal(JSON.parse(seen[1]).error.code,-32700);
  support.close();input.destroy();output.destroy();
});

test('programmatic MCP requests never attach to host stdio',async()=>{
  const listeners=process.stdin.listenerCount('data');
  const flowing=process.stdin.readableFlowing;
  const service=createRemoteSupportMcp({platform:'win32',executor:mock(),approve:async()=>false});
  try {
    assert.equal((await rpc(service,'support_status')).result.isError,false);
    assert.equal(process.stdin.listenerCount('data'),listeners);
    assert.equal(process.stdin.readableFlowing,flowing);
    assert.throws(()=>createRemoteSupportMcp({input:new PassThrough()}),/transport_invalid/);
    assert.throws(()=>createRemoteSupportMcp({output:new PassThrough()}),/transport_invalid/);
  } finally { service.close(); }
});

test('explicit MCP CLI answers over stdio and exits when the transport ends',{timeout:10000},async t=>{
  const child=spawn(process.execPath,[fileURLToPath(new URL('../src/remote-support-mcp.mjs',import.meta.url))],
    {cwd:new URL('..',import.meta.url),stdio:['pipe','pipe','pipe'],windowsHide:true,shell:false});
  t.after(()=>{if(child.exitCode===null) child.kill();});
  let stdout='',stderr='';
  child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.includes('\n')) child.stdin.end();});
  child.stderr.on('data',chunk=>{stderr+=chunk;});
  const closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:42,method:'ping'})+'\n');
  assert.deepEqual(await closed,{code:0,signal:null});
  assert.equal(stderr,'');
  assert.deepEqual(JSON.parse(stdout),{jsonrpc:'2.0',id:42,result:{}});
});

test('closing MCP releases its transport without pausing another reader',async t=>{
  const input=new PassThrough(),output=new PassThrough();
  const service=createRemoteSupportMcp({input,output,executor:mock()});
  t.after(()=>{service.close();input.destroy();output.destroy();});
  await new Promise(resolve=>setImmediate(resolve));
  service.close();service.close();
  assert.equal(input.isPaused(),true);
  for(const event of ['data','end','close','error']) assert.equal(input.listenerCount(event),0);
  await assert.rejects(rpc(service,'support_status'),/session_closed/);

  const shared=new PassThrough();
  const reader=()=>{};
  shared.on('data',reader);
  const second=createRemoteSupportMcp({input:shared,output,executor:mock()});
  t.after(()=>{second.close();shared.destroy();});
  await new Promise(resolve=>setImmediate(resolve));
  second.close();
  assert.equal(shared.listenerCount('data'),1);
  assert.equal(shared.isPaused(),false);
});

test('transport disconnect revokes grants and drops queued effects and late observations',async t=>{
  for(const ending of ['end','close','error']) {
    const input=new PassThrough(),output=new PassThrough();
    let finish,observations=0,effects=0;
    const pending=new Promise(resolve=>{finish=resolve;});
    const replies=[];output.on('data',value=>replies.push(String(value)));
    const service=createRemoteSupportMcp({input,output,platform:'win32',approve:async()=>true,
      executor:{observe:async()=>{observations++;return pending;},act:async()=>{effects++;return {};}}});
    t.after(()=>{finish({result:{}});service.close();input.destroy();output.destroy();});
    await rpc(service,'support_start_session',{scope:'CONTROL'});
    const wire=(id,name,args)=>input.write(JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}})+'\n');
    wire(1,'support_observe',{action:'OBSERVE_WINDOWS'});
    wire(2,'support_control',act);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(observations,1);
    if(ending==='end') input.end();
    else input.destroy(ending==='error'?new Error('transport_lost'):undefined);
    await new Promise(resolve=>setImmediate(resolve));
    await assert.rejects(rpc(service,'support_status'),/session_closed/);
    finish({result:{private_content:'must_not_publish'}});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(effects,0);
    assert.deepEqual(replies,[]);
  }
});

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

test('stop during a pending local approval irrevocably fences that approval', async () => {
  const consent = deferred();
  let requests = 0;
  const service = createRemoteSupportMcp({platform:'win32',executor:mock(),
    approve:async()=>{requests++;return consent.promise;}});
  const pending = rpc(service,'support_start_session',{scope:'CONTROL'});
  assert(denied(await rpc(service,'support_start_session',{scope:'VIEW'})));
  assert.equal(requests,1);
  await rpc(service,'support_stop');
  consent.resolve(true);
  assert(denied(await pending));
  const status = JSON.parse((await rpc(service,'support_status')).result.content[0].text);
  assert.equal(status.session_revoked,true);
  assert.equal(status.active_control_grant,false);
  assert(denied(await rpc(service,'support_start_session',{scope:'CONTROL'})));
  service.close();
});

test('revoked or expired grants cannot return in-flight private observations', async () => {
  const waiting = deferred();
  let clock = 10000;
  const executor = {...mock(),observe:async()=>waiting.promise};
  const service = createRemoteSupportMcp({platform:'win32',executor,approve:async()=>true,now:()=>clock});
  await rpc(service,'support_start_session',{scope:'VIEW'});
  const pending = rpc(service,'support_observe',{action:'UIA_SNAPSHOT'});
  await rpc(service,'support_stop');
  waiting.resolve({result:{private_control_value:'secret'}});
  const response = await pending;
  assert(denied(response));
  assert.equal(JSON.stringify(response).includes('secret'),false);
  service.close();

  const image = deferred();
  const second = createRemoteSupportMcp({platform:'win32',executor:{
    observe:async()=>({result:{png_path:'synthetic',png_sha256:'f'.repeat(64)}}),
  },approve:async()=>true,now:()=>clock,imageLoader:async()=>image.promise});
  await rpc(second,'support_start_session',{scope:'VIEW'});
  const capture = rpc(second,'support_observe',{action:'CAPTURE_DESKTOP'});
  await new Promise(resolve=>setImmediate(resolve));
  clock += 3600000;
  image.resolve(Buffer.from('private-pixels'));
  const blocked = await capture;
  assert(denied(blocked));
  assert.equal(JSON.stringify(blocked).includes('private-pixels'),false);
  second.close();
});

test('stop during an in-flight mutation yields AMBIGUOUS and forbids retry', async () => {
  const waiting = deferred(), calls = [];
  const service = createRemoteSupportMcp({platform:'win32',approve:async()=>true,executor:{
    observe:async()=>({result:{}}),
    act:async(input)=>{calls.push(input);return waiting.promise;},
  }});
  await rpc(service,'support_start_session',{scope:'CONTROL'});
  const pending = rpc(service,'support_control',act);
  await new Promise(resolve=>setImmediate(resolve));
  await rpc(service,'support_stop');
  waiting.resolve({outcome:'NO_EFFECT_PROVEN',authority_effect:false});
  const reply = await pending;
  assert.equal(reply.result.isError,true);
  const result = JSON.parse(reply.result.content[0].text);
  assert.equal(result.outcome,'AMBIGUOUS');
  assert.equal(result.automatic_retry_allowed,false);
  assert.equal(calls.length,1);
  assert(denied(await rpc(service,'support_control',act)));
  service.close();
});

test('stdio stop preempts an unresolved control request without waiting for its response', async () => {
  const input = new PassThrough(), output = new PassThrough();
  const replies = [];output.on('data',value=>replies.push(...String(value).trim().split('\n').filter(Boolean).map(JSON.parse)));
  const waiting = deferred();
  const service = createRemoteSupportMcp({input,output,platform:'win32',approve:async()=>true,executor:{
    observe:async()=>({result:{}}),
    act:async()=>waiting.promise,
  }});
  const wire=(id,name,args={})=>input.write(JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}})+'\n');
  wire(1,'support_start_session',{scope:'CONTROL'});
  await new Promise(resolve=>setImmediate(resolve));
  wire(2,'support_control',act);
  await new Promise(resolve=>setImmediate(resolve));
  wire(3,'support_stop');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(replies.some(x=>x.id===3 && x.result.content[0].text.includes('SESSION_REVOKED')),true);
  assert.equal(replies.some(x=>x.id===2),false);
  waiting.resolve({outcome:'NO_EFFECT_PROVEN'});
  await new Promise(resolve=>setImmediate(resolve));
  const done = replies.find(x=>x.id===2);
  assert.equal(JSON.parse(done.result.content[0].text).outcome,'AMBIGUOUS');
  service.close();input.destroy();output.destroy();
});


const diskDir = (name, type='directory') => ({
  name, isDirectory:()=>type==='directory', isFile:()=>type==='file',
  isSymbolicLink:()=>type==='link',
});
function fakeWindowsDisk() {
  const dirs = new Map([
    ['C:\\', [diskDir('ProgramData'),diskDir('Users'),diskDir('SecretJunction','link')]],
    ['C:\\ProgramData',[diskDir('PostgreSQL')]],
    ['C:\\ProgramData\\PostgreSQL',[diskDir('17')]],
    ['C:\\ProgramData\\PostgreSQL\\17',[diskDir('data')]],
    ['C:\\ProgramData\\PostgreSQL\\17\\data',[
      diskDir('PG_VERSION','file'),diskDir('postgresql.conf','file'),
      diskDir('postmaster.pid','file'),diskDir('global'),
      diskDir('secret.key','file'),
    ]],
    ['C:\\ProgramData\\PostgreSQL\\17\\data\\global',[diskDir('pg_control','file')]],
    ['C:\\Users',[diskDir('PrivatePhotos')]],
    ['C:\\Users\\PrivatePhotos',[diskDir('vacation.jpg','file')]],
    ['D:\\',[diskDir('Archives')]],
    ['D:\\Archives',[diskDir('PostgresBackups')]],
    ['D:\\Archives\\PostgresBackups',[diskDir('PG_VERSION','file'),diskDir('global')]],
    ['D:\\Archives\\PostgresBackups\\global',[diskDir('pg_control','file')]],
  ]);
  const fileSet = new Set([...dirs].flatMap(([dir,children])=>
    children.filter(row=>row.isFile()).map(row=>path.win32.join(dir,row.name))));
  const calls = [];
  const fsImpl = {
    async lstat(filename) {
      calls.push({op:'lstat',filename});
      if (dirs.has(filename)) return {isDirectory:()=>true,isFile:()=>false,isSymbolicLink:()=>false};
      if (fileSet.has(filename)) return {isDirectory:()=>false,isFile:()=>true,isSymbolicLink:()=>false};
      throw Object.assign(new Error('not found'),{code:'ENOENT'});
    },
    async readdir(filename) {
      calls.push({op:'readdir',filename});
      if (!dirs.has(filename)) throw Object.assign(new Error('not found'),{code:'ENOENT'});
      return dirs.get(filename);
    },
    async readFile() { throw Error('filesystem_contents_must_not_be_read'); },
    async writeFile() { throw Error('filesystem_mutation_must_not_be_attempted'); },
  };
  return {fsImpl,calls};
}

test('read-only discovery scans all supplied fixed drives for real PGDATA markers, never contents',async()=>{
  const {fsImpl,calls}=fakeWindowsDisk();
  const outcome=await discoverLocalPostgresFiles({roots:['C:\\','D:\\'],fsImpl});
  assert.equal(outcome.search_scope,'ALL_READY_FIXED_LOCAL_DRIVES');
  assert.equal(outcome.file_contents_read,false);
  assert.equal(outcome.vault_key_read,false);
  assert.equal(outcome.database_opened,false);
  assert.equal(outcome.truncated,false);
  assert.equal(outcome.candidates.length,2);
  const byPath = new Map(outcome.candidates.map(row=>[row.directory,row]));
  assert.equal(byPath.get('C:\\ProgramData\\PostgreSQL\\17\\data').postgresql_conf_present,true);
  assert.equal(byPath.get('D:\\Archives\\PostgresBackups').pg_control_present,true);
  assert.equal(calls.some(c=>c.filename?.includes('SecretJunction')),false);
  assert.equal(calls.some(c=>c.op==='readFile'||c.op==='writeFile'),false);
  assert.equal(JSON.stringify(outcome).includes('secret.key'),false);
  assert.equal(JSON.stringify(outcome).includes('vacation.jpg'),false);
});

test('fixed Windows drive enumeration uses a constant PowerShell command and excludes invalid roots',async()=>{
  const calls=[];
  const roots=await listReadyFixedWindowsDrives({platform:'win32',run:async (...args)=>{
    calls.push(args);
    return {stdout:'C:\\\r\nD:\\\r\nC:\\\r\n\\\\server\\share\r\n'};
  }});
  assert.deepEqual(roots,['C:\\','D:\\']);
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],'powershell.exe');
  assert.equal(calls[0][2].shell,false);
  assert.match(calls[0][1].at(-1),/DriveType/);
  await assert.rejects(listReadyFixedWindowsDrives({platform:'linux'}),/remote_support_windows_required/);
  await assert.rejects(discoverLocalPostgresFiles({roots:['\\\\server\\share']}),/remote_support_discovery_arguments_invalid/);
});

test('FILES approval permits disk metadata only; VIEW cannot search and FILES cannot control',async()=>{
  const scopes=[], ex=mock();
  const disk=fakeWindowsDisk();
  const discovery=options=>discoverLocalPostgresFiles({...options,fsImpl:disk.fsImpl});
  const deps={platform:'win32',executor:ex,approve:async({scope})=>{scopes.push(scope);return true;},
    driveEnumerator:async()=>['C:\\','D:\\'],postgresDiscoverer:discovery};
  const view=createRemoteSupportMcp(deps);
  assert(denied(await rpc(view,'support_discover_postgres')));
  await rpc(view,'support_start_session',{scope:'VIEW'});
  assert(denied(await rpc(view,'support_discover_postgres')));
  view.close();
  const files=createRemoteSupportMcp(deps);
  assert(denied(await rpc(files,'support_discover_postgres')));
  assert(denied(await rpc(files,'support_start_session',{scope:'ADMIN'})));
  const accepted=await rpc(files,'support_start_session',{scope:'FILES'});
  assert.equal(JSON.parse(accepted.result.content[0].text).scope,'FILES');
  assert(denied(await rpc(files,'support_observe',{action:'OBSERVE_WINDOWS'})));
  assert(denied(await rpc(files,'support_control',act)));
  assert(denied(await rpc(files,'support_discover_postgres',{path:'C:\\Users',recursive:true})));
  const found=await rpc(files,'support_discover_postgres');
  assert.equal(found.result.isError,false);
  assert.equal(JSON.parse(found.result.content[0].text).candidates.length,2);
  assert.equal(JSON.parse((await rpc(files,'support_status')).result.content[0].text).active_filesystem_grant,true);
  assert.deepEqual(ex.calls,[]);
  assert.deepEqual(scopes,['VIEW','FILES']);
  files.close();
});

test('CONTROL scope includes PostgreSQL metadata search with one local approval',async()=>{
  const approvals=[],disk=fakeWindowsDisk();
  const service=createRemoteSupportMcp({platform:'win32',executor:mock(),
    approve:async({scope})=>{approvals.push(scope);return true;},
    driveEnumerator:async()=>['C:\\'],
    postgresDiscoverer:options=>discoverLocalPostgresFiles({...options,fsImpl:disk.fsImpl})});
  await rpc(service,'support_start_session',{scope:'CONTROL'});
  assert.equal((await rpc(service,'support_discover_postgres')).result.isError,false);
  assert.equal((await rpc(service,'support_observe',{action:'OBSERVE_WINDOWS'})).result.isError,false);
  assert.deepEqual(approvals,['CONTROL']);
  service.close();
});

test('stop or expiry fences in-flight local-drive enumeration and database paths',async()=>{
  const pendingDrives=deferred(),pendingScan=deferred();
  const make=({driveEnumerator,postgresDiscoverer})=>createRemoteSupportMcp({
    platform:'win32',approve:async()=>true,executor:mock(),driveEnumerator,postgresDiscoverer,
  });
  const s=make({driveEnumerator:()=>pendingDrives.promise,
    postgresDiscoverer:()=>{throw Error('must_not_scan_after_stop');}});
  await rpc(s,'support_start_session',{scope:'FILES'});
  const result=rpc(s,'support_discover_postgres');
  await rpc(s,'support_stop');
  pendingDrives.resolve(['C:\\']);
  const refused=await result;
  assert(denied(refused));
  assert.equal(JSON.stringify(refused).includes('C:\\'),false);
  s.close();

  const second=make({driveEnumerator:async()=>['C:\\'],postgresDiscoverer:()=>pendingScan.promise});
  await rpc(second,'support_start_session',{scope:'FILES'});
  const searched=rpc(second,'support_discover_postgres');
  await new Promise(resolve=>setImmediate(resolve));
  await rpc(second,'support_stop');
  pendingScan.resolve({candidates:[{directory:'C:\\private\\pgdata'}]});
  const stopped=await searched;
  assert(denied(stopped));
  assert.equal(JSON.stringify(stopped).includes('private'),false);
  second.close();
});

test('discovery is bounded, fail-closed and stops when the active session is revoked',async()=>{
  const {fsImpl}=fakeWindowsDisk();
  const outcome=await discoverLocalPostgresFiles({roots:['C:\\'],fsImpl,maxDirectories:1});
  assert.equal(outcome.truncated,true);
  assert.equal(outcome.directories_inspected,1);
  let checks=0;
  await assert.rejects(discoverLocalPostgresFiles({roots:['C:\\'],fsImpl,
    shouldContinue:()=>++checks<3}),/remote_support_session_not_active/);
});


const validRestoreInput = Object.freeze({
  private_config_file:'C:\\METAENGINE\\private\\runtime-host.json',
  expected_bundle_sha256:'a'.repeat(64),
  restore_receipt_file:'C:\\METAENGINE\\private\\restore-report.json',
  expected_restore_receipt_sha256:'b'.repeat(64),
  appdata_directory:'C:\\Users\\Owner\\AppData\\Roaming',
  owner_action:'USE_EXISTING_RESTORED_POSTGRES_17',
});
const configuredReceipt = Object.freeze({
  schema:'compute.restored-client-provider-provisioning.v1',state:'CONFIGURED',
  provider:'LOCAL_POSTGRES',owner_profile_written:true,
  private_vault_key_preserved:true,cleanup_confirmed:true,runtime_ready:false,authority_effect:false,
  secret:'NEVER_LEAK',private_path:'C:\\hidden\\data',
});

test('DB_CONNECT is isolated and requires local approval twice before operator starts',async()=>{
  const scopes=[],effects=[];
  const s=createRemoteSupportMcp({platform:'win32',executor:mock(),
    approve:async ({scope,details})=>{scopes.push({scope,details});return true;},
    restoredProviderOperator:async argv=>{effects.push(argv);return configuredReceipt;}});
  assert(denied(await rpc(s,'support_connect_restored_postgres',validRestoreInput)));
  await rpc(s,'support_start_session',{scope:'FILES'});
  assert(denied(await rpc(s,'support_connect_restored_postgres',validRestoreInput)));
  s.close();
  const db=createRemoteSupportMcp({platform:'win32',executor:mock(),
    approve:async ({scope,details})=>{scopes.push({scope,details});return true;},
    restoredProviderOperator:async argv=>{effects.push(argv);return configuredReceipt;}});
  const connected=await rpc(db,'support_start_session',{scope:'DB_CONNECT'});
  assert.equal(connected.result.isError,false);
  assert.equal(JSON.parse(connected.result.content[0].text).scope,'DB_CONNECT');
  assert.equal(JSON.parse((await rpc(db,'support_status')).result.content[0].text).active_database_connect_grant,true);
  assert(denied(await rpc(db,'support_discover_postgres')));
  assert(denied(await rpc(db,'support_observe',{action:'OBSERVE_WINDOWS'})));
  assert(denied(await rpc(db,'support_control',act)));
  const result=await rpc(db,'support_connect_restored_postgres',validRestoreInput);
  assert.equal(result.result.isError,false);
  const receipt=JSON.parse(result.result.content[0].text);
  assert.equal(receipt.state,'CONFIGURED');
  assert.equal(receipt.installed_normal_boot_verified,false);
  assert.equal(JSON.stringify(receipt).includes('NEVER_LEAK'),false);
  assert.equal(JSON.stringify(receipt).includes('hidden'),false);
  assert.equal(effects.length,1);
  assert.deepEqual(effects[0],[
    '--config',validRestoreInput.private_config_file,'--bundle-sha256',validRestoreInput.expected_bundle_sha256,
    '--restore-receipt',validRestoreInput.restore_receipt_file,
    '--restore-receipt-sha256',validRestoreInput.expected_restore_receipt_sha256,
    '--appdata',validRestoreInput.appdata_directory,'--owner-action',validRestoreInput.owner_action,
  ]);
  assert.equal(scopes[1].scope,'DB_CONNECT');
  assert.equal(scopes[2].scope,'DB_CONNECT_COMMIT');
  assert.deepEqual(scopes[2].details,{configFile:validRestoreInput.private_config_file,appData:validRestoreInput.appdata_directory});
  assert(denied(await rpc(db,'support_connect_restored_postgres',validRestoreInput)));
  assert.equal(effects.length,1);
  db.close();
});

test('DB_CONNECT denies dangerous arguments and failed second consent never dispatches',async t=>{
  let invoked=0,commits=0;
  const db=createRemoteSupportMcp({platform:'win32',executor:mock(),
    approve:async ({scope})=>{if(scope==='DB_CONNECT_COMMIT') {commits++;return false;}return true;},
    restoredProviderOperator:async()=>{invoked++;return configuredReceipt;}});
  t.after(()=>db.close());
  assert.equal((await rpc(db,'support_start_session',{scope:'DB_CONNECT'})).result.isError,false);
  for(const invalid of [
    {...validRestoreInput,owner_action:'CREATE_NEW_DATABASE'},
    {...validRestoreInput,extra:'cmd'},
    {...validRestoreInput,expected_bundle_sha256:'invalid'},
    {...validRestoreInput,private_config_file:'\\\\host\\share\\evil.json'},
    {...validRestoreInput,private_config_file:'relative\\evil.json'},
  ])assert(denied(await rpc(db,'support_connect_restored_postgres',invalid)));
  for(const field of ['private_config_file','restore_receipt_file','appdata_directory']) {
    for(const invalid of [
      '\\\\host\\share\\private.json','//host/share/private.json',
      '\\\\?\\C:\\private.json','\\\\.\\C:\\private.json',
      '\\private.json','/private.json','C:private.json',
      'C:\\private.json:stream','C:/private.json:stream','C:\\private\n.json',
    ]) assert(denied(await rpc(db,'support_connect_restored_postgres',{...validRestoreInput,[field]:invalid})),field);
  }
  assert.equal(commits,0);
  assert(denied(await rpc(db,'support_connect_restored_postgres',validRestoreInput)));
  assert.equal(commits,1);
  assert.equal(invoked,0);
  db.close();
});

test('DB_CONNECT attempt is single-flight, failure claims attempt and keeps all errors redacted',async()=>{
  let complete,started=0;
  const pending=new Promise(resolve=>{complete=resolve;});
  const db=createRemoteSupportMcp({platform:'win32',executor:mock(),approve:async()=>true,
    restoredProviderOperator:async()=>{started++;await pending;throw new Error('private_password_do_not_leak');}});
  await rpc(db,'support_start_session',{scope:'DB_CONNECT'});
  const first=rpc(db,'support_connect_restored_postgres',validRestoreInput);
  await new Promise(resolve=>setImmediate(resolve));
  assert(denied(await rpc(db,'support_connect_restored_postgres',validRestoreInput)));
  complete();
  const result=await first;
  assert.equal(result.result.isError,true);
  assert.equal(result.result.content[0].text,'remote_support_restore_operator_failed');
  assert.equal(started,1);
  assert(denied(await rpc(db,'support_connect_restored_postgres',validRestoreInput)));
  db.close();
});

test('DB_CONNECT remote stop before second approval cannot dispatch, or disambiguate an in-flight effect',async()=>{
  let authorize,started=0;
  const waiting=new Promise(resolve=>{authorize=resolve;});
  const one=createRemoteSupportMcp({platform:'win32',executor:mock(),
    approve:async({scope})=>scope==='DB_CONNECT_COMMIT'?waiting:true,
    restoredProviderOperator:async()=>{started++;return configuredReceipt;}});
  await rpc(one,'support_start_session',{scope:'DB_CONNECT'});
  const pending=rpc(one,'support_connect_restored_postgres',validRestoreInput);
  await rpc(one,'support_stop');
  authorize(true);
  assert(denied(await pending));
  assert.equal(started,0);
  one.close();
  let finish;
  const effect=new Promise(resolve=>{finish=resolve;});
  const two=createRemoteSupportMcp({platform:'win32',executor:mock(),approve:async()=>true,
    restoredProviderOperator:async()=>{started++;await effect;return configuredReceipt;}});
  await rpc(two,'support_start_session',{scope:'DB_CONNECT'});
  const result=rpc(two,'support_connect_restored_postgres',validRestoreInput);
  await new Promise(resolve=>setImmediate(resolve));
  await rpc(two,'support_stop');
  finish();
  const report=await result;
  assert.equal(report.result.isError,true);
  assert.equal(JSON.parse(report.result.content[0].text).state,'AMBIGUOUS');
  assert.equal(started,1);
  two.close();
});

test('DB_CONNECT expires and is denied on other platforms',async()=>{
  let clock=0, count=0;
  const db=createRemoteSupportMcp({platform:'win32',executor:mock(),now:()=>clock,
    approve:async()=>true,restoredProviderOperator:async()=>{count++;return configuredReceipt;}});
  await rpc(db,'support_start_session',{scope:'DB_CONNECT'});
  clock+=10*60*1000;
  assert(denied(await rpc(db,'support_connect_restored_postgres',validRestoreInput)));
  assert.equal(count,0);
  db.close();
  const linux=createRemoteSupportMcp({platform:'linux',executor:mock(),approve:async()=>true,
    restoredProviderOperator:async()=>{count++;return configuredReceipt;}});
  assert(denied(await rpc(linux,'support_start_session',{scope:'DB_CONNECT'})));
  assert(denied(await rpc(linux,'support_connect_restored_postgres',validRestoreInput)));
  assert.equal(count,0);
  linux.close();
});
