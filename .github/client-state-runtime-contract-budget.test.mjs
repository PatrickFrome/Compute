import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {WINDOWS_NATIVE_GUARDS, assertWindowsNativeGuardProof} from './prepare-runtime-contract-pg17.mjs';

const workflow = readFileSync(new URL('workflows/client-state-runtime-contract.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const self = '.github/client-state-runtime-contract-budget.test.mjs';
const compatibility = ['client-local-contracts-w38', 'explicit-local-supervisor-provider', 'native-supervisor-local-provider-pin',
  'local-provider-recovery-environment', 'persistent-local-provider-boot', 'local-provider-singleton-admission',
  'local-runtime-host-controller', 'browser-sentinel', 'host-resilience-runtime', 'agent-access-capsule',
  'self-hosted-supervisor-config', 'runtime-capability-health-route-contract', 'native-supervisor-realtime-command-wake-migration',
  'r83-edge-v14-canary-source-binding', 'me2-ui-local-profile-outbound-guard', 'client-owned-state-hosted-workflow-guard',
  'package-build-reservation-workflow'].map(name => 'test/' + name + '.test.mjs');
const listener = ['test/me2-ui-loopback-host.test.mjs', 'test/verify-windows-tcp-listener.test.mjs'];
const disposableGuards = ['native-coding-git-commit-operator.test.mjs',
  'pg17-backup-effect-barrier.test.mjs', 'pg17-one-shot-disposable-dump-executor.test.mjs'];

function contracts(source) {
  const start = source.indexOf('\n  contracts:\n');
  assert.ok(start >= 0, 'existing contracts matrix job must remain');
  return source.slice(start);
}
function step(source, name) {
  const start = source.indexOf('      - name: ' + name + '\n');
  assert.ok(start >= 0, 'qualification step must remain: ' + name);
  const end = source.indexOf('\n      - name:', start + 1);
  return source.slice(start, end < 0 ? source.length : end);
}
function assertBudgets(source) {
  const job = contracts(source);
  assert.match(job, /^    timeout-minutes: \$\{\{ matrix\.os == 'windows-2025' && 30 \|\| 10 \}\}$/m);
  assert.equal((job.match(/^    timeout-minutes:/gm) || []).length, 1);
}
function assertFullCoverage(source) {
  const job = contracts(source);
  assert.doesNotMatch(job, /continue-on-error|--test-(?:name|skip)-pattern|--test-only|--test-shard|\|\|\s*(?:true|:)/);
  assert.doesNotMatch(job, /^\s+if:/m, 'qualification steps must not be conditionally skipped');
  assert.match(step(job, 'Verify API, owned processes and private archive'), /^        run: npm test$/m);
  for (const [name, files] of [
    ['Verify selected client provider and supervisor compatibility', compatibility],
    ['Verify normal UI host pins its child listener to loopback', listener],
  ]) assert.match(step(job, name), new RegExp('^        run: node --test ' + files.join(' ').replaceAll('.', '\\.') + '$', 'm'));
}
function assertDisposablePreflight(source, script) {
  const job = contracts(source);
  const name = 'Verify disposable operator and backup guards before the full suite';
  const command = 'node ../../apps/metaengine-browser/scripts/run-isolated-tests.mjs --test-reporter=tap --test-concurrency=1 ' + disposableGuards.join(' ');
  const preflight = step(job, name);
  assert.ok(preflight.includes('          ' + command + ' | tee "$proof"\n'));
  assert.ok(preflight.includes('          set -euo pipefail\n'));
  assert.ok(preflight.includes('          node ../../.github/prepare-runtime-contract-pg17.mjs verify "$proof"\n'));
  const setup = 'Prepare pinned PostgreSQL 17 binaries for disposable guards';
  assert.match(step(job, setup), /^        run: node \.github\/prepare-runtime-contract-pg17\.mjs prepare$/m);
  assert.ok(job.indexOf('- name: ' + setup) < job.indexOf('- name: ' + name));
  assert.ok(job.indexOf('- name: ' + name) < job.indexOf('run: npm test'));
  for (const file of disposableGuards) assert.equal(script.split(' ').filter(value => value === file).length, 1,
    file + ' must remain in the full suite as well as the early preflight');
}

test('cheap disposable guards run early without removing their full-suite coverage', () => {
  const script = JSON.parse(readFileSync(new URL('../infra/client-state-runtime/package.json', import.meta.url), 'utf8')).scripts.test;
  assertDisposablePreflight(workflow, script);
  for (const file of disposableGuards) {
    assert.throws(() => assertDisposablePreflight(workflow.replace(' ' + file, ''), script), {code:'ERR_ASSERTION'});
    assert.throws(() => assertDisposablePreflight(workflow, script.replace(' ' + file, '')), {code:'ERR_ASSERTION'});
  }
});

test('StateContracts budgets only Windows physical qualification at 30 minutes and retains Linux at 10', () => assertBudgets(workflow));
test('StateContracts retains the two-platform fail-fast and workflow concurrency strategy', () => {
  const job = contracts(workflow);
  const jobs = workflow.split('\njobs:\n')[1];
  assert.ok(jobs);
  assert.deepEqual([...jobs.matchAll(/^  ([a-z][\w-]*):$/gm)].map(match => match[1]), ['checkpoint-postgres', 'contracts']);
  assert.match(job, /strategy:\n      fail-fast: false\n      matrix:\n        os: \[ubuntu-24\.04, windows-2025\]/);
  assert.match(job, /^    runs-on: \$\{\{ matrix\.os \}\}$/m);
  assert.doesNotMatch(job, /max-parallel|\n        (?:include|exclude):/);
  assert.match(workflow, /group: client-state-contract-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}\n  cancel-in-progress: true/);
});
test('StateContracts retains full runtime and both complete Browser compatibility commands without suppression', () => assertFullCoverage(workflow));
test('runtime npm test retains serial native ACL and authenticated IPC qualification', () => {
  const script = JSON.parse(readFileSync(new URL('../infra/client-state-runtime/package.json', import.meta.url), 'utf8')).scripts.test;
  assert.match(script, /^node --test --test-concurrency=1 /);
  for (const file of ['client-backup-acl-native-w58.test.mjs', 'client-backup-acl-native-w58.ipc.test.mjs'])
    assert.equal(script.split(' ').filter(value => value === file).length, 1, file + ' must still execute once');
});
test('the budget regression runs before the expensive runtime suite and triggers on push and PR', () => {
  const job = contracts(workflow);
  const guard = job.indexOf('run: node --test ' + self);
  assert.ok(guard >= 0 && guard < job.indexOf('run: npm test'), 'budget guard must run before expensive qualification');
  for (const event of ['pull_request', 'push']) {
    const start = workflow.indexOf('  ' + event + ':\n');
    assert.ok(start >= 0);
    const tail = workflow.slice(start), end = tail.search(/\n {2}\S/);
    assert.ok(tail.slice(0, end < 0 ? tail.length : end).includes("      - '" + self + "'"), event + ' must include the budget guard');
  }
});
test('StateContracts guard rejects a narrowed budget, removed compatibility target or suppressed failure', () => {
  const budget = workflow.replace("matrix.os == 'windows-2025' && 30 || 10", "matrix.os == 'windows-2025' && 10 || 10");
  assert.notEqual(budget, workflow); assert.throws(() => assertBudgets(budget), { code: 'ERR_ASSERTION' });
  const removed = workflow.replace(' test/local-runtime-host-controller.test.mjs', '');
  assert.notEqual(removed, workflow); assert.throws(() => assertFullCoverage(removed), { code: 'ERR_ASSERTION' });
  const suppressed = workflow.replace('run: npm test', 'continue-on-error: true\n        run: npm test');
  assert.notEqual(suppressed, workflow); assert.throws(() => assertFullCoverage(suppressed), { code: 'ERR_ASSERTION' });
});

test('Windows guard proof rejects absent, failed, duplicated or skipped native outcomes', () => {
  const pass = WINDOWS_NATIVE_GUARDS.map((name,index) => 'ok '+(index+1)+' - '+name).join('\n');
  assert.equal(assertWindowsNativeGuardProof(pass).windows_native_guards_qualified,true);
  for(const [index,name] of WINDOWS_NATIVE_GUARDS.entries()) {
    const row='ok '+(index+1)+' - '+name;
    for(const replacement of ['', 'not '+row, row+' # SKIP no native binary',
      row+' # TODO qualification pending', row+'\n'+row]) {
      assert.throws(()=>assertWindowsNativeGuardProof(pass.replace(row,replacement)),
        {code:'ERR_ASSERTION'});
    }
  }
});

test('PG17 binary producer shares package pins and remains registered for push and PR', () => {
  const setup = readFileSync(new URL('prepare-runtime-contract-pg17.mjs',import.meta.url),'utf8');
  assert.match(setup,/from '\.\.\/apps\/metaengine-browser\/scripts\/stage-client-state-runtime\.mjs'/);
  assert.match(setup,/const origin=RUNTIME_ORIGINS\.postgresql/);
  assert.match(setup,/obtainRuntimeArchive\(archives,origin\)/);
  assert.match(setup,/unpackRuntimeArchive\(archive,destination,\{postgresOnly:true\}\)/);
  assert.match(setup,/LOCAL_STATE_TEST_PG_BIN_DIR=/);
  assert.doesNotMatch(setup,/\binitdb\b|\bpg_ctl\b/);
  for(const event of ['pull_request','push']) {
    const start=workflow.indexOf('  '+event+':\n');
    const tail=workflow.slice(start),end=tail.search(/\n {2}\S/);
    const paths=tail.slice(0,end<0?tail.length:end);
    for(const file of ['.github/prepare-runtime-contract-pg17.mjs',
      'apps/metaengine-browser/scripts/stage-client-state-runtime.mjs']) {
      assert.ok(paths.includes("      - '"+file+"'"),event+' must include '+file);
    }
  }
});

test('chat-to-CLI integration is mandatory in the hosted Windows native PG17 qualification',()=>{
 const candidate=readFileSync(new URL('workflows/client-checkpoint-reconciliation-qualification.yml',import.meta.url),'utf8');
 const file='infra/client-state-runtime/native-coding-initial-goal-seed.integration.test.mjs';
 assert.match(candidate,/const native=\[[\s\S]*?native-coding-initial-goal-seed\.integration\.test\.mjs[\s\S]*?\];/);
 for(const name of [
  'protected chat-led profile admits a browser planner and native permits, never a CLI planner',
  'real browser-parent claim hands IMPLEMENTER children to protected native permits without fallback',
  'chat profile revocation cannot downgrade native handoff to a browser implementation',
 ])assert(candidate.includes("            '"+name+"',"));
 assert(candidate.includes("if(name==='native-pg17'&&checked.counts.tests<37)"));
 assert(candidate.includes("await runSuite('native-pg17',native,nativeRequired,await createSuiteEnvironment('native-pg17',true),false)"));
 assert(candidate.includes("      - 'work/chat-cli-critic-integration-20261029'"));
 assert(candidate.includes("'refs/heads/work/chat-cli-critic-integration-20261029'"));
 assert(candidate.includes("      - 'infra/client-state-runtime/native-coding-*.sql'"));
 const pkg=JSON.parse(readFileSync(new URL('../infra/client-state-runtime/package.json',import.meta.url),'utf8'));
 assert.equal(pkg.scripts['test:chat-cli:pg17'],'node --test --test-concurrency=1 '+file.split('/').at(-1));
});
