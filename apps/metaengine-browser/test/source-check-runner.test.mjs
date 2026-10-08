import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { SOURCE_CHECK_FILES,runSourceChecks } from '../scripts/check-source.mjs';

test('npm source check fits Windows cmd limits and checks the full catalog without a shell',async()=>{
  const pkg=JSON.parse(await fs.readFile(new URL('../package.json',import.meta.url),'utf8'));
  assert.equal(pkg.scripts.check,'node scripts/check-source.mjs');
  assert.ok(pkg.scripts.check.length<100);
  assert.equal(new Set(SOURCE_CHECK_FILES).size,SOURCE_CHECK_FILES.length);
  for(const file of ['src/main.mjs','src/preload-shell.cjs','src/github-chat-relay.mjs',
    'src/github-chat-setup.mjs','src/github-chat-setup-renderer.js',
    'supabase/a2-browser-native-supervisor-v1/chat-command-routes.mjs'])assert.ok(SOURCE_CHECK_FILES.includes(file));
  const calls=[];
  assert.equal(runSourceChecks({execute:(executable,args,options)=>{
    calls.push(args[1]);assert.equal(executable,process.execPath);
    assert.equal(args[0],'--check');assert.equal(args.length,2);assert.equal(options.shell,false);
    return {status:0};
  }}),0);
  assert.deepEqual(calls,SOURCE_CHECK_FILES);
});

test('one rejected parser check fails the whole source gate and never hides its status',()=>{
  let calls=0;
  assert.equal(runSourceChecks({execute:()=>{calls++;return{status:42};}}),42);
  assert.equal(calls,1);
});
