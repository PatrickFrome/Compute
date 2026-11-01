import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const native=fileURLToPath(new URL('../native/browser-guardian-scm/',import.meta.url));
const probe=fileURLToPath(new URL('native/browser-guardian-scm-status-runtime-probe.cpp',import.meta.url));
const source=readFileSync(path.join(native,'browser-guardian-scm-service.cpp'),'utf8');

function proof(output,name,windows){
 const row=JSON.parse(output);
 assert.equal(row.schema,'metaengine.browser-guardian.scm-status-runtime-proof.v1');
 assert.equal(row.ok,true);assert.equal(row.case,name);
 assert.equal(row.windows_kernel_exercised,windows);
 assert.equal(row.scm_rpc_instrumented,true);
 for(const key of ['production_worker_exercised','scm_installation_exercised','installer_dispatch_exercised','authority_effect'])assert.equal(row[key],false);
}

test('portable actual SCM status functions serialize terminal RPC and stop latch without claiming Windows qualification',{
 skip:process.platform==='win32'?'use compiled native Windows probe':false,timeout:20000,
},t=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'guardian-status-runtime-'));
 try {
  const owner=source.slice(source.indexOf('namespace metaengine::guardian {'),source.indexOf('\nnamespace {'));
  const status=source.slice(source.indexOf('SERVICE_STATUS_HANDLE g_status_handle'),source.indexOf('\nbool waitOverlapped('));
  assert.ok(owner.includes('class GuardianScmEffectOwner'));
  assert.ok(status.includes('serviceControlHandler('));
  writeFileSync(path.join(dir,'guardian-status-extracted.hpp'),owner+'\nnamespace {\nmetaengine::guardian::GuardianScmEffectOwner g_effect_owner;\n'+status+'\n}\n');
  const binary=path.join(dir,'status-probe');
  const build=spawnSync(process.env.CXX||'g++',['-std=c++20','-Wall','-Wextra','-Werror','-pedantic','-pthread','-DGUARDIAN_STATUS_PORTABLE','-I',dir,'-I',native,probe,'-o',binary],{encoding:'utf8',timeout:15000});
  if(build.error?.code==='ENOENT'){t.skip('portable C++ compiler unavailable');return;}
  assert.equal(build.status,0,build.error?.message||build.stderr);
  for(const name of ['status','checkpoint'])proof(execFileSync(binary,[name],{encoding:'utf8',timeout:8000}),name,false);
 } finally {rmSync(dir,{recursive:true,force:true});}
});

const binary=process.env.METAENGINE_GUARDIAN_SCM_STATUS_TEST_BINARY;
for(const name of ['status','checkpoint','before-start','start-pending','worker-join','teardown','worker-failure','worker-readback-failure','worker-readback-zero'])test('Windows native SCM status lifecycle: '+name,{
 skip:process.platform!=='win32'?'Windows kernel qualification unavailable':!binary?'compiled Windows status probe missing':false,timeout:20000,
},()=>proof(execFileSync(binary,[name],{encoding:'utf8',timeout:15000,maxBuffer:8192}),name,true));
