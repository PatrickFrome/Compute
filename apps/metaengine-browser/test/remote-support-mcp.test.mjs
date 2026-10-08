import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { createRemoteSupportMcp, readBoundedCapture, discoverLocalPostgresFiles, listReadyFixedWindowsDrives } from '../src/remote-support-mcp.mjs';

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
  assert.deepEqual(list.result.tools.map(x=>x.name),['support_status','support_start_session','support_discover_postgres','support_observe','support_control','support_stop']);
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
  assert.deepEqual(ex.calls[1].context,act.context);
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
