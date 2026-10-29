import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../../.github/workflows/client-checkpoint-reconciliation-qualification.yml',import.meta.url),'utf8');
const pr=source.slice(source.indexOf('  pull_request:'),source.indexOf('  push:'));
const paths=[...pr.matchAll(/^\s+- '([^']+)'$/gm)].map(m=>m[1]);
// The registered paths use only literal characters, * and **.
const matches=(file,pattern)=>new RegExp('^'+pattern.split('**').map(p=>p.split('*').map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('[^/]*')).join('.*')+'$').test(file);
test('Windows qualification is triggered by every new messaging, wake and fixture entry path',()=>{
 for(const file of [
  'apps/metaengine-browser/src/devos-native-task-cycle-core.mjs',
  'apps/metaengine-browser/src/agent-tool-protocol.mjs',
  'apps/metaengine-browser/src/agent-toolbelt-core.mjs',
  'infra/client-state-runtime/browser-project-messages-v1.sql',
  'infra/client-state-runtime/project-message-ack-v1.sql',
  'infra/client-state-runtime/project-message-wake-v1.sql',
  'infra/client-state-runtime/browser-parent-message-wake.pg17.test.mjs',
  'infra/client-state-runtime/test/browser-parent-suspension-fixture.mjs',
  'infra/client-state-runtime/test/fresh-schema-disposable.mjs',
  'infra/client-state-runtime/canonical-empty-schema-contract.mjs',
  'infra/client-state-runtime/windows-qualification-registration.test.mjs',
 ])assert(paths.some(pattern=>matches(file,pattern)),file+' must trigger Windows source qualification');
 assert.equal(paths.some(pattern=>matches('docs/unrelated.md',pattern)),false);
});
test('Windows qualification retains required native wake, rejected-pair and cancellation gates without skip relaxation',()=>{
 const native=source.slice(source.indexOf('          const native=['),source.indexOf('          const componentRequired=['));
 for(const file of ['native-coding-initial-goal-seed.integration.test.mjs','native-coding-checkpoint.integration.test.mjs','browser-parent-message-wake.pg17.test.mjs'])assert(native.includes(file));
 for(const name of ['native PG17 resumes a message-addressed parent while child work is still open',
  'rejected pair is verified through actual Host SQL without creating a checkpoint',
  'cancelled Git proof launches no new read and an in-flight Git child is joined before rejection'])assert(source.includes(name));
 assert.match(source,/counts\.skipped!==0\|\|skipped\.length/);
 assert.match(source,/source_sha:expected/);assert.match(source,/installed_autonomy_proven:false/);
});
