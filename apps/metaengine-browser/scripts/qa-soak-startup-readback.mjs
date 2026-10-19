#!/usr/bin/env node
// Read-only, fail-closed startup diagnostics for disposable Windows CI soak.
// Never print journal contents, userData paths, network endpoints or exceptions.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SOAK_READBACK_SCHEMA='metaengine.browser.qa-soak-startup-readback.v1';
const STAGES=Object.freeze(['SOAK_NORMAL_UI_NOT_STABLE_VISIBLE','SOAK_RUNTIME_IMPORT_FAILED','SOAK_OTHER_FAILURE']);
const STATES=Object.freeze([
  'RUNTIME_IMPORT_OK','RUNTIME_IMPORT_FAILED','RUNTIME_HOLD_NO_WINDOW',
  'PRIMARY_WINDOW_STABLE','PRIMARY_WINDOW_STABLE_TIMEOUT','PRIMARY_WINDOW_OBSERVER_FAILED',
  'RUNTIME_FAILURE_PRESENTED','RUNTIME_FAILURE_PRESENTATION_FAILED'
]);
const counter=n=>Number.isSafeInteger(n)&&n>=0&&n<=100000?n:null;
const bounded=n=>Number.isSafeInteger(n)&&n>=0&&n<=180000?n:null;
const fail=x=>{throw new Error('qa_soak_readback_'+x);};
export function summarizeSoakStartup(journal,stage){
  if(!STAGES.includes(stage))fail('stage_invalid');
  const events=Array.isArray(journal?.events)&&journal.events.length<=100000&&
    typeof journal?.current_boot_id==='string'&&journal.current_boot_id.length>=1
    ?journal.events.filter(x=>x?.boot_id===journal.current_boot_id):null;
  const flags=Object.fromEntries(STATES.map(state=>[state,false]));
  if(events)for(const e of events)if(e&&STATES.includes(e.state))flags[e.state]=true;
  const lastWindow=events?.filter(x=>x&&
    (x.state==='PRIMARY_WINDOW_STABLE'||x.state==='PRIMARY_WINDOW_STABLE_TIMEOUT')).at(-1);
  const detail=lastWindow?.details;
  return Object.freeze({
    schema:SOAK_READBACK_SCHEMA,state:'UNQUALIFIED',
    failure_code:stage,journal_parseable:!!events,
    boot_event_count:events?counter(events.length):null,
    event_flags:flags,
    last_window_observation:STATES.includes(lastWindow?.state)?lastWindow.state:null,
    window_visible:typeof detail?.visible==='boolean'?detail.visible:null,
    window_count:counter(detail?.window_count),
    elapsed_ms:bounded(detail?.elapsed_ms),timeout_ms:bounded(detail?.timeout_ms),
    installed_mutated:false,production_authorized:false,authority_effect:false,
    automatic_retry_allowed:false,
  });
}
async function cli(){
  const [journalFile,outputFile,stage,...rest]=process.argv.slice(2);
  const outputRoot=process.env.RUNNER_TEMP;
  if(rest.length||typeof journalFile!=='string'||!path.isAbsolute(journalFile)
    ||typeof outputRoot!=='string'||!path.isAbsolute(outputRoot)
    ||typeof outputFile!=='string'
    ||path.resolve(outputFile)!==path.join(path.resolve(outputRoot),'soak-normal-ui-readback.json')
    ||!STAGES.includes(stage))fail('output_boundary_invalid');
  let data=null;
  try{
    const s=await fs.lstat(journalFile);
    if(s.isFile()&&!s.isSymbolicLink()&&s.size>0&&s.size<=4*1024*1024)
      data=JSON.parse(await fs.readFile(journalFile,'utf8'));
  }catch{}
  const summarized=summarizeSoakStartup(data,stage);
  const file=await fs.open(outputFile,'wx',0o600);
  try{await file.writeFile(JSON.stringify(summarized)+'\n');await file.sync();}
  finally{await file.close();}
  console.log('qa_soak_startup_readback_captured');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  await cli().catch(()=>{console.error('qa_soak_startup_readback_unavailable');process.exitCode=1;});
