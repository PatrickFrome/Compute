import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

const execute = promisify(execFile);
const moduleUrl = new URL('../src/native-supervisor-endpoints.mjs', import.meta.url).href;
const instanceId = '28da46b7-6e1d-4c6a-b638-f4dc4bd8ee59';
const mount = '/a2-browser-native-supervisor-v1';

async function ownerFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'meta-native-owner-pin-'));
  t.after(() => fs.rm(root,{recursive:true,force:true}));
  const server = createServer((request,response)=>{
    if(request.method!=='GET'||request.url!==mount+'/health'){
      response.writeHead(404);response.end();return;
    }
    response.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
    response.end(JSON.stringify({ok:true,instance_id:instanceId,
      state_provider:'LOCAL_POSTGRES',hosted_supabase_required:false,
      runtime_ready:true,capability_health:{state:'ATTESTED',authority_effect:false}}));
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port+mount;
  const configRoot=path.join(root,'@metaengine','browser-shell');
  const identityFile=path.join(root,'runtime-status.json');
  await fs.mkdir(configRoot,{recursive:true});
  await fs.writeFile(identityFile,JSON.stringify({
    schema:'metaengine.client-state.runtime-status.v1',state:'READY',
    runtime_ready:true,state_provider:'LOCAL_POSTGRES',hosted_supabase_required:false,
    automatic_cloud_fallback:false,authority_effect:false,instance_id:instanceId,
    endpoint:base,capability_health:{state:'ATTESTED',authority_effect:false}
  }));
  await fs.writeFile(path.join(configRoot,'metaengine-state-provider-v1.json'),JSON.stringify({
    schema:'metaengine.browser.local-state-provider-config.v1',
    version:1,profile:'CLIENT_LOCAL_POSTGRES_V1',provider:'LOCAL_POSTGRES',
    base_url:base,runtime_identity_file:identityFile,authority_effect:false
  }));
  return {base,env:{APPDATA:root,XDG_CONFIG_HOME:root}};
}

async function inspect(extraEnv={},action='',owner=null) {
  const env={...process.env};
  // An absent Owner fixture must not read the machine's installed profile.
  if (!owner) { env.APPDATA=path.join(os.tmpdir(), `meta-w43-unbound-${process.pid}-${Date.now()}`); env.XDG_CONFIG_HOME=env.APPDATA; }
  for(const key of Object.keys(env)){
    if(/^METAENGINE_(STATE_PROVIDER|SUPERVISOR_BASE_URL|LOCAL_STATE_INSTANCE_ID|LOCAL_PROVIDER_)/.test(key))
      delete env[key];
  }
  const code = `try { const m=await import(${JSON.stringify(moduleUrl)}); ${action} console.log(JSON.stringify({ok:true,base:m.NATIVE_SUPERVISOR_BASE,provider:m.NATIVE_SUPERVISOR_STATE_PROVIDER})); } catch(error) { console.log(JSON.stringify({ok:false,error:error.message})); }`;
  const result = await execute(process.execPath,['--input-type=module','-e',code],
    {env:{...env,...(owner?.env||{}),...extraEnv},windowsHide:true,timeout:15000});
  return JSON.parse(result.stdout.trim());
}

test('real boot pins only an attested Owner file and current loopback instance',async t=>{
  const owner=await ownerFixture(t);
  assert.deepEqual(await inspect({},'',owner),{ok:true,base:owner.base,provider:'LOCAL_POSTGRES'});
  const matching={METAENGINE_STATE_PROVIDER:'LOCAL_POSTGRES',
    METAENGINE_SUPERVISOR_BASE_URL:owner.base,METAENGINE_LOCAL_STATE_INSTANCE_ID:instanceId};
  assert.deepEqual(await inspect(matching,'',owner),{ok:true,base:owner.base,provider:'LOCAL_POSTGRES'});
  for(const conflict of [
    {METAENGINE_STATE_PROVIDER:'UNKNOWN'},
    {METAENGINE_SUPERVISOR_BASE_URL:'https://hosted.invalid/remote'},
    {METAENGINE_SUPERVISOR_BASE_URL:owner.base.replace(mount,'/wrong')},
    {METAENGINE_SUPERVISOR_BASE_URL:owner.base+'?token=1'},
    {METAENGINE_SUPERVISOR_BASE_URL:owner.base.replace('127.0.0.1','user:secret@127.0.0.1')},
    {METAENGINE_LOCAL_STATE_INSTANCE_ID:'wrong'},
  ]){
    const result=await inspect({...matching,...conflict},'',owner);
    assert.equal(result.ok,false);
    assert.match(result.error,/^(local_state_provider_|native_supervisor_)/);
  }
});

test('an attested local endpoint cannot be swapped to hosted, another port or another mount',async t=>{
  const owner=await ownerFixture(t);
  const otherPort=owner.base.replace(/:\d+\//,':65534/');
  for(const target of ['https://hosted.invalid/functions/v1/command',otherPort,
    owner.base.replace(mount,'/other'+mount)]){
    const result=await inspect({},`m.setNativeSupervisorBase(${JSON.stringify(target)});`,owner);
    assert.equal(result.ok,false);
    assert.match(result.error,/^native_supervisor_(local_base_invalid|local_provider_endpoint_pinned)$/);
  }
  const unchanged=await inspect({},`m.setNativeSupervisorBase(${JSON.stringify(owner.base+'/')});`,owner);
  assert.deepEqual(unchanged,{ok:true,base:owner.base,provider:'LOCAL_POSTGRES'});
});

test('without a trusted Owner even an explicit loopback setter is fenced, with no cloud or reserve',async()=>{
  const result=await inspect({},`m.setNativeSupervisorBase('http://127.0.0.1:15433/a2-browser-native-supervisor-v1');`);
  assert.deepEqual(result,{ok:false,error:'native_supervisor_local_provider_endpoint_pinned'});
});
