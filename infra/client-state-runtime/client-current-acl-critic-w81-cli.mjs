// Workflow-only parser; reads the uniquely disposable TAP captured by the
// current job. A local report cannot self-authenticate GitHub PUSH/PR/job IDs.
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {reviewW81WindowsNativeAclTap} from './client-current-acl-critic-w81.mjs';
const file=process.argv[2];
if(!file||process.argv.length!==3)throw Error('w81_tap_file_required');
const tap=await fs.readFile(file,'utf8');
const expected=process.env.EXPECTED_HEAD||'';
const checked=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',timeout:10000}).trim();
const clean=execFileSync('git',['status','--porcelain'],{encoding:'utf8',timeout:10000}).trim()==='';
const r=reviewW81WindowsNativeAclTap({platform:process.platform,
  expected_sha:expected,checked_out_sha:checked,clean_checkout:clean,tap});
console.log(JSON.stringify({schema:r.schema,state:r.state,reasons:r.reasons,
  gates:r.gates,evidence_class:r.evidence_class,installed_owner_proven:false,
  source_accepted:false,live_accepted:false}));
if(r.state!=='REVIEW_REQUIRED')process.exitCode=1;
