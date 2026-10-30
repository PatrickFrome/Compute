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


test('native observation and Main wiring are mandatory Windows component checks',()=>{
 const workflow=source;
 for(const path of ['apps/metaengine-browser/src/client-native-*.mjs','apps/metaengine-browser/src/main.mjs','apps/metaengine-browser/test/client-native-*.test.mjs'])assert.ok(workflow.includes(path),path);
 for(const name of ['client-native-runtime-observation.test.mjs','client-native-trust-boundary.test.mjs'])assert.ok(workflow.includes("'apps/metaengine-browser/test/"+name+"',"),name);
});

test('sandbox probe lifetime and actual Windows boot observation remain in the component lane',()=>{
 for(const name of ['codex-cli-sandbox-probe.test.mjs','codex-cli-sandbox-probe-lifetime.test.mjs'])assert.ok(source.includes("'apps/metaengine-browser/test/"+name+"',"),name);
 assert.ok(source.includes("'apps/metaengine-browser/src/codex-cli-sandbox-probe.mjs'"));
 assert.ok(source.includes("'apps/metaengine-browser/test/codex-cli-sandbox-probe*.test.mjs'"));
});


test('workspace preparation caller, native PG locking and generated scope fixtures are registered',()=>{
 for(const file of ['infra/client-state-runtime/native-coding-workspace-preparation.pg17.test.mjs',
  'infra/client-state-runtime/native-coding-workspace-preparation.test.mjs','apps/metaengine-browser/test/native-coding-workspace-preparation.test.mjs',
  'infra/client-state-runtime/test/native-workspace-preparation-fixture.mjs'])assert(paths.some(pattern=>matches(file,pattern)),file);
 for(const file of ['infra/client-state-runtime/native-coding-workspace-preparation.pg17.test.mjs',
  'infra/client-state-runtime/native-coding-workspace-preparation.test.mjs','apps/metaengine-browser/test/native-coding-workspace-preparation.test.mjs'])assert.ok(source.includes("'"+file+"',"));
});


test('pending goal actual caller and native PG anti-execution guards are mandatory',()=>{
 for(const file of ['apps/metaengine-browser/src/client-prepared-goal.mjs','apps/metaengine-browser/test/client-prepared-goal.test.mjs','apps/metaengine-browser/src/client-goal-journal.mjs','infra/client-state-runtime/native-coding-pending-goal-v1.sql'])assert.ok(paths.some(pattern=>matches(file,pattern)),file);
 for(const name of ['apps/metaengine-browser/test/client-prepared-goal.test.mjs','infra/client-state-runtime/native-coding-pending-goal.pg17.test.mjs'])assert.ok(source.includes("'"+name+"',"),name);
});


test('Windows suites isolate file-owned identity and journal singletons without removing cases',()=>{
 assert.ok(source.includes("'--test-isolation=process'"));
 assert.ok(!source.includes("'--test-isolation=none'"));
 assert.ok(source.includes("'--test-concurrency=1'"));
 assert.ok(source.includes("'apps/metaengine-browser/test/client-prepared-goal.test.mjs'"));
 assert.ok(source.includes("'apps/metaengine-browser/test/devos-native-task-cycle.test.mjs'"));
});


test('identity persistence and sealed Owner races remain in Windows qualification',()=>{
 for(const file of ['supervisor-device-identity-concurrency.test.mjs','host-owner-protected-identity-w74.test.mjs','host-owner-genesis-custody-w74.test.mjs']){
  const full='apps/metaengine-browser/test/'+file;assert.ok(source.includes("'"+full+"',"));assert.ok(paths.some(pattern=>matches(full,pattern)));
 }
 assert.ok(paths.some(pattern=>matches('apps/metaengine-browser/src/supervisor-device-identity.mjs',pattern)));
});
