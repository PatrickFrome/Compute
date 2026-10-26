// Controlled source fixture. This independent process has Node's filesystem
// read permission only; it is not a native provider, approved capsule or OS ACL.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';

const [candidate,bindingText]=process.argv.slice(2),binding=JSON.parse(bindingText);
const bytes=readFileSync(candidate);
const artifactSha256=createHash('sha256').update(bytes).digest('hex');
assert.equal(binding.role,'CRITIC');
assert.notEqual(binding.task_id,binding.subject_task_id);
assert.equal(binding.subject_artifact_sha256,artifactSha256);
let denied=false;
try{writeFileSync(path.join(path.dirname(candidate),'critic-must-not-write.txt'),'forbidden');}
catch(error){if(error.code!=='ERR_ACCESS_DENIED')throw error;denied=true;}
assert.equal(denied,true,'the critic must execute without filesystem write permission');
const {invoiceTotal}=await import(pathToFileURL(candidate).href);
const cases=[
  {lines:[],expected:0},
  {lines:[{quantity:2,unitCents:199},{quantity:3,unitCents:100}],expected:698},
  {lines:[{quantity:0,unitCents:999},{quantity:5,unitCents:0}],expected:0},
  {lines:[{quantity:1,unitCents:125},{quantity:4,unitCents:250}],expected:1125},
];
const checks=cases.map(({lines,expected})=>({expected,actual:invoiceTotal(lines)}));
const accepted=checks.every(check=>check.expected===check.actual);
process.stdout.write(JSON.stringify({schema:'metaengine.continuation.fixture-critic.v1',
  evidence_class:'CONTROLLED_SOURCE_FIXTURE',binding,run_id:randomUUID(),subject_run_id:binding.subject_run_id,pid:process.pid,
  accepted,checks,write_denied:denied,artifact_sha256:artifactSha256,
  approved_capsule:false,evaluator_credit:false,authority_effect:false})+'\n');
process.exitCode=accepted?0:1;
