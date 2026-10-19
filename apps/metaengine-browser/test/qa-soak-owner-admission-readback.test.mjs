import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {summarizePackagedOwnerAdmissionStderr,summarizeSoakStartup}
  from '../scripts/qa-soak-startup-readback.mjs';
const exec=promisify(execFile);
const privateText='private://Owner-secret-token-and-runtime-root';
const genuine=JSON.stringify({schema:'metaengine.browser.provider-startup.v1',
 state:'LOCAL_PROVIDER_STARTUP_BLOCKED',reason:'local_state_packaged_owner_not_ready',
 phase:'PACKAGED_OWNER_ADMISSION',bootstrap_state:'NO_OWNER_CONFIG',
 attachment_state:'NO_DESCRIPTOR',authority_effect:false,
 browser_runtime_started:false,automatic_cloud_fallback:false,details:privateText});
test('physical missing-Owner observation remains UNQUALIFIED, with exact safe cause',()=>{
 const proof=summarizeSoakStartup(null,'SOAK_NORMAL_UI_NOT_STABLE_VISIBLE',genuine+'\n');
 assert.equal(proof.state,'UNQUALIFIED');
 assert.equal(proof.journal_parseable,false);
 assert.equal(proof.owner_admission.state,'OBSERVED_DENIAL');
 assert.equal(proof.owner_admission.reason,'local_state_packaged_owner_not_ready');
 assert.equal(proof.owner_admission.phase,'PACKAGED_OWNER_ADMISSION');
 assert.equal(proof.owner_admission.bootstrap_state,'NO_OWNER_CONFIG');
 assert.equal(proof.owner_admission.attachment_state,'NO_DESCRIPTOR');
 assert.equal(proof.owner_admission.authority_effect,false);
 assert.equal(proof.production_authorized,false);
 assert.equal(proof.automatic_retry_allowed,false);
 assert.equal(JSON.stringify(proof).includes(privateText),false);
});
test('hostile stderr and missing native fields do not promote claims or disclose secrets',()=>{
 const all=[null,privateText,JSON.stringify({state:'LOCAL_PROVIDER_STARTUP_BLOCKED',reason:privateText}),
  JSON.stringify({...JSON.parse(genuine),browser_runtime_started:true}),
  JSON.stringify({...JSON.parse(genuine),automatic_cloud_fallback:true}),
  JSON.stringify({...JSON.parse(genuine),authority_effect:true})];
 for(const stderr of all){
  const proof=summarizePackagedOwnerAdmissionStderr(stderr);
  assert.equal(proof.state,'UNKNOWN');
  assert.equal(proof.authority_effect,false);
  assert.equal(JSON.stringify(proof).includes(privateText),false);
 }
 const weird=JSON.stringify({...JSON.parse(genuine),reason:privateText,
  phase:privateText,bootstrap_state:privateText,attachment_state:privateText});
 const proof=summarizePackagedOwnerAdmissionStderr(weird);
 assert.equal(proof.state,'OBSERVED_DENIAL');
 assert.equal(proof.reason,'UNKNOWN');
 assert.equal(proof.phase,'UNKNOWN');
 assert.equal(proof.bootstrap_state,'UNKNOWN');
 assert.equal(proof.attachment_state,'UNKNOWN');
 assert.equal(JSON.stringify(proof).includes(privateText),false);
});
test('CLI consumes only fixed CI stderr filename and writes bounded readback',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-owner-readback-'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const journal=path.join(dir,'startup.json'),stderr=path.join(dir,'soak-normal-ui.err'),
  output=path.join(dir,'soak-normal-ui-readback.json');
 await fs.writeFile(journal,JSON.stringify({current_boot_id:'b',events:[]}));
 await fs.writeFile(stderr,genuine+'\n');
 const script=fileURLToPath(new URL('../scripts/qa-soak-startup-readback.mjs',import.meta.url));
 const call=(file,err=stderr)=>exec(process.execPath,[script,journal,file,
   'SOAK_NORMAL_UI_NOT_STABLE_VISIBLE',err],{env:{...process.env,RUNNER_TEMP:dir},timeout:10000});
 await call(output);
 const result=JSON.parse(await fs.readFile(output,'utf8'));
 assert.equal(result.owner_admission.reason,'local_state_packaged_owner_not_ready');
 assert.equal(result.state,'UNQUALIFIED');
 assert.equal((await fs.readFile(output,'utf8')).includes(privateText),false);
 await assert.rejects(call(output),/qa_soak_startup_readback_unavailable/);
 await assert.rejects(call(path.join(dir,'unreviewed-file.json')));
 await assert.rejects(call(path.join(dir,'new.json'),path.join(dir,'host-secrets.err')));
});
test('the Windows soak harness forwards only captured stderr into diagnostic and rethrows',async()=>{
 const s=await fs.readFile(new URL('../scripts/windows-autonomous-session-soak.ps1',import.meta.url),'utf8');
 assert.match(s,/qa-soak-startup-readback\.mjs'\) \$journal \$readback \$failureCode \$normalErr/);
 assert.match(s,/\n\s*throw\s*\n\s*}\s*finally/);
 assert.match(s,/soak_normal_ui_not_stable_visible/);
});
