import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const workflow=fs.readFileSync(new URL('../../../.github/workflows/metaengine-client-w23-me2-typecheck.yml',import.meta.url),'utf8');
test('UI qualification covers integration pushes and pins both push and PR source identity',()=>{
 assert.match(workflow,/push:\s+branches:\s+- 'work\/chat-cli-critic-integration-20261029'/);
 assert.match(workflow,/pull_request:\s+paths:/);
 assert.match(workflow,/ME2_BUILD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
 assert.match(workflow,/ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
 assert.match(workflow,/persist-credentials: false/);assert.match(workflow,/contents: read/);
 assert.match(workflow,/test "\$\(git rev-parse HEAD\)" = "\$ME2_BUILD_SHA"/);
 for(const script of ['test:operator-observatory','lint','typecheck','test:goal-admission','test:project-history','test:recovery','build','pack'])assert.ok(workflow.includes('run: bun run '+script),script);
 assert.match(workflow,/bun install --frozen-lockfile/);assert.match(workflow,/m\.git_sha!==process\.env\.ME2_BUILD_SHA/);
});


test('UI qualification retains actual browser acceptance, source immutability and evidence',()=>{
 assert.match(workflow,/node-version: '24\.21\.0'/);
 assert.match(workflow,/playwright@1\.62\.1/);
 assert.match(workflow,/node apps\/me2-ui\/scripts\/ui-source-acceptance\.mjs --root/);
 assert.match(workflow,/--expected-sha "\$ME2_BUILD_SHA"/);
 assert.match(workflow,/git diff --exit-code/);assert.match(workflow,/git diff --cached --exit-code/);
 assert.match(workflow,/source-acceptance\.json/);assert.match(workflow,/renderer-\*\.png/);
 assert.match(workflow,/if-no-files-found: error/);
});

test('W73 Windows TAP accounting requires 34 unique results and the unskipped metadata-alias regression',()=>{
 const source=fs.readFileSync(new URL('../../../.github/workflows/client-source-candidate-w73.yml',import.meta.url),'utf8');
 const start=source.indexOf('      - name: Windows UI physical roots, inert harness and actual W73 registration');
 const end=source.indexOf('\n      - name:',start+1);
 assert.ok(start>=0&&end>start);
 const step=source.slice(start,end);
 assert.match(step,/if: runner\.os == 'Windows'/);
 assert.match(step,/RUNNER_ENVIRONMENT -ne 'github-hosted'/);
 assert.match(step,/run-isolated-tests\.mjs --test-concurrency=1 --test-reporter=tap scripts\/ui-runtime-inventory\.test\.mjs scripts\/ui-source-acceptance\.test\.mjs/);
 const extracted=/          @'\r?\n([\s\S]*?)\r?\n          '@ \| node --input-type=module - \$tap/.exec(step);
 assert.ok(extracted,'execute the actual workflow validator, not a copied implementation');
 const code=extracted[1].replace(/\r\n/g,'\n').split('\n').map(line=>line.replace(/^ {10}/,'')).join('\n');
 assert.match(code,/^import assert from 'node:assert\/strict';\nimport fs from 'node:fs';/);
 const executable=code.replace(/^import assert from 'node:assert\/strict';\nimport fs from 'node:fs';\n/,'');
 const metadataCase='the final sweep rejects earlier content even when file-time observations alias';
 const required=[
  'an initially supplied root symlink or Windows junction is refused',
  'root rename followed by a symlink or Windows junction cannot retain a PASS',
  'a byte-identical replacement directory cannot reuse the original physical binding',
  'a root reached through a symlink or Windows junction ancestor is refused',
  'a legacy content-only snapshot cannot establish physical-root immutability',
  'the harness refuses an original root symlink or Windows junction before creating evidence or launching children',
  'W73 invoked package scripts execute all new UI acceptance regressions',
  'renderer evidence finishes finite transitions and cannot escape its output directory',
  metadataCase,
 ];
 const skipped=[
  'runtime inventory rejects . mode changes',
  'runtime inventory rejects empty mode changes',
  'runtime inventory rejects server.js mode changes',
  'same-byte link retargeting and file-to-link replacement are detected',
  'internal absolute links retain relocatable identity without executor paths',
  'escaping links, directory cycles and dangling links cannot qualify a snapshot',
  'a running owned server may exit 0 after the harness requests SIGTERM',
  'a running owned server may exit 143 after the harness requests SIGTERM',
  'an ordinary owned SIGTERM signal exit is accepted',
  'a nonzero failure after the owned SIGTERM request is rejected',
  'SIGKILL cleanup of an unresponsive owned child never qualifies as graceful acceptance',
 ];
 // Synthetic TAP tests accounting only: it is never native Windows evidence.
 const names=[...required,...Array.from({length:14},(_,i)=>'generated non-required UI case '+i),...skipped];
 const rows=names.map((name,i)=>`ok ${i+1} - ${name}${skipped.includes(name)?' # SKIP existing POSIX-only contract':''}`);
 const valid=['TAP version 13',...rows,'1..34','# tests 34','# suites 0','# pass 23','# fail 0','# cancelled 0','# skipped 11','# todo 0',''].join('\n');
 const validate=tap=>{
  const messages=[];
  vm.runInNewContext(executable,{assert,fs:{readFileSync(file,encoding){
   assert.equal(file,'synthetic-windows-tap');assert.equal(encoding,'utf8');return tap;
  }},process:{argv:['node','-','synthetic-windows-tap']},console:{log:message=>messages.push(message)}});
  return messages;
 };
 assert.match(validate(valid).join('\n'),/23 PASS, 11 explicitly allowed POSIX skips; all 9 /);
 assert.match(validate(valid.replace(/\n/g,'\r\n')).join('\n'),/23 PASS, 11 explicitly allowed POSIX skips; all 9 /);
 for(const name of required){
  assert.throws(()=>validate(valid.replace(' - '+name+'\n',' - generated replacement for required case\n')),/missing required Windows case/);
  assert.throws(()=>validate(valid.replace(' - '+name+'\n',' - '+name+' # SKIP injected\n')),/required Windows case was skipped/);
 }
 const metadataRow=rows[required.indexOf(metadataCase)];
 assert.throws(()=>validate(valid.replace(metadataRow+'\n','')),/both complete UI fixture files/);
 assert.throws(()=>validate(valid.replace(' - generated non-required UI case 0\n',' - '+metadataCase+'\n')),/duplicate test result/);
 assert.throws(()=>validate(valid.replace(metadataRow,metadataRow.replace(/^ok /,'not ok '))),/failed or TODO test/);
 assert.throws(()=>validate(valid.replace(metadataRow,metadataRow+' # TODO injected')),/failed or TODO test/);
 assert.throws(()=>validate(valid.replace(' # SKIP existing POSIX-only contract','')),/unexpected Windows skip count/);
 assert.throws(()=>validate(valid.replace(skipped[0],'generated unapproved skip')),/unexpected skipped Windows case/);
 for(const [summary,replacement] of [['tests 34','tests 33'],['pass 23','pass 22'],['fail 0','fail 1'],['cancelled 0','cancelled 1'],['skipped 11','skipped 12'],['todo 0','todo 1']]){
  assert.throws(()=>validate(valid.replace('# '+summary,'# '+replacement)),/TAP summary/);
 }
 assert.throws(()=>validate(valid.replace('# pass 23\n','')),/TAP summary pass/);
 assert.throws(()=>validate(valid.replace('1..34','1..33')),/TAP plan/);
 assert.throws(()=>validate(valid+'Bail out! injected\n'),/TAP bailout/);
});
