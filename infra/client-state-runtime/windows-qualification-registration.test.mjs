import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
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


test('W74 pre-seal lifetime has real PostgreSQL coverage in Windows qualification',()=>{
 const file='infra/client-state-runtime/host-owner-preseal-w74.pg17.test.mjs';
 assert.ok(source.includes("'"+file+"',"));assert.ok(paths.some(pattern=>matches(file,pattern)));
 assert.ok(paths.some(pattern=>matches('apps/metaengine-browser/src/host-owner-genesis-custody-w74.mjs',pattern)));
});


test('typed pending Owner phase, real IPC and integration fixtures stay qualified',()=>{
 for(const file of ['apps/metaengine-browser/test/native-coding-pending-owner-phase.test.mjs','apps/metaengine-browser/test/native-coding-host-ipc.test.mjs'])assert.ok(source.includes("'"+file+"',"));
 for(const file of ['apps/metaengine-browser/src/native-coding-pending-owner-phase.mjs','infra/client-state-runtime/native-coding-pending-owner-custody.mjs','infra/client-state-runtime/test/pending-owner-phase-fixture.mjs'])assert.ok(paths.some(pattern=>matches(file,pattern)),file);
 assert.ok(source.includes("'infra/client-state-runtime/native-coding-pending-goal.pg17.test.mjs',"));
});

test('reconstructed same-root activation suites are mandatory qualified source, not native execution claims',()=>{
 for(const file of ['apps/metaengine-browser/test/client-prepared-goal-activation.test.mjs','apps/metaengine-browser/test/native-coding-pending-activation-phase.test.mjs','infra/client-state-runtime/native-coding-pending-activation-profile.test.mjs']){
  assert.ok(source.includes("'"+file+"',"),file);assert.ok(paths.some(pattern=>matches(file,pattern)),file);
 }
 for(const file of ['apps/metaengine-browser/src/client-prepared-goal-activation.mjs','infra/client-state-runtime/native-coding-pending-activation-v1.sql'])assert.ok(paths.some(pattern=>matches(file,pattern)),file);
});

test('physical settlement, exact Host shutdown and retained Main custody remain mandatory component gates',()=>{
 for(const file of ['apps/metaengine-browser/test/native-host-scope-cleanup.test.mjs','apps/metaengine-browser/test/local-runtime-host-controller.test.mjs',
  'apps/metaengine-browser/test/local-runtime-host-terminal.test.mjs','apps/metaengine-browser/test/managed-runtime-drain.test.mjs',
  'infra/client-state-runtime/native-host-startup-lifecycle.test.mjs','infra/client-state-runtime/native-coding-preparation-transaction.test.mjs']){
  assert.ok(source.includes("'"+file+"',"),file);assert.ok(paths.some(pattern=>matches(file,pattern)),file);
 }
 const facts=source.slice(source.indexOf('          const sourcePaths='));
 for(const file of ['apps/metaengine-browser/src/native-coding-host-settlement.mjs','apps/metaengine-browser/src/native-host-scope-cleanup.mjs',
  'infra/client-state-runtime/native-coding-preparation-transaction.mjs','infra/client-state-runtime/runtime-host.mjs',
  'infra/client-state-runtime/test/native-host-startup-lifecycle-loader.mjs']){
  assert.ok(paths.some(pattern=>matches(file,pattern)),file);assert.ok(facts.includes("'"+file+"'"),file);
 }
});

test('reservation and publication cancellation retain mandatory source and real PG17 qualification',async()=>{
 const pkg=JSON.parse(await readFile(new URL('./package.json',import.meta.url),'utf8'));
 for(const name of ['native-coding-callback-publication-source.test.mjs','native-coding-callback-publication-lifetime.test.mjs']){
  assert.ok(pkg.scripts.test.split(/\s+/).includes(name));
  assert.ok(source.includes("'infra/client-state-runtime/"+name+"',"));
 }
 assert.ok(source.includes("'infra/client-state-runtime/native-coding-callback-publication.pg17.test.mjs',"));
 for(const name of ['publication cancellation reaches a started native read and still joins its original completion',
  'cancellation during Owner role validation starts no later native scope read',
  'already cancelled reservation opens no new transaction or native read',
  'already deadline reservation opens no new transaction or native read',
  'cancellation during reservation observation creates no execution row',
  'all publication native reads retain the original request and their actual PG transaction'])
  assert.ok(source.includes("'"+name+"',"),name);
 for(const file of ['infra/client-state-runtime/native-coding-callback-publication-lifetime.test.mjs',
  'infra/client-state-runtime/native-coding-callback-publication.pg17.test.mjs'])
  assert(paths.some(pattern=>matches(file,pattern)),file+' must trigger the same Windows qualification');
});

test('prepared custody, atomic agent effects and actual monitored PG pool remain mandatory Windows cases',()=>{
 const native=source.slice(source.indexOf('          const native=['),source.indexOf('          const componentRequired=['));
 for(const file of ['infra/client-state-runtime/native-coding-preparation-transaction.pg17.test.mjs',
  'infra/client-state-runtime/native-coding-initial-anchor-task-fence.pg17.test.mjs',
  'infra/client-state-runtime/native-coding-callback-publication-api-acl.pg17.test.mjs',
  'infra/client-state-runtime/native-coding-publication-registration.pg17.test.mjs',
  'infra/client-state-runtime/native-coding-installed-publication-schema.pg17.test.mjs',
  'infra/client-state-runtime/native-coding-host-schema-diagnosis.pg17.test.mjs',
  'infra/client-state-runtime/native-coding-agent-host-tools.integration.test.mjs']){
  assert.ok(native.includes("'"+file+"'"),file);assert.ok(paths.some(pattern=>matches(file,pattern)),file);
 }
 for(const name of ['original RESERVED, six actual Owner cycles and exact terminal permit a single private facet take',
  'status-retry confirms exact status readback and retries sharing failures only on Windows',
  'status-ack-loss confirms exact status readback and retries sharing failures only on Windows',
  'status-persistent retains bounded storage HOLD rather than a false schema verdict or unsafe rename retry',
  'status-temp-replaced retains bounded storage HOLD rather than a false schema verdict or unsafe rename retry',
  'status-target-replaced retains bounded storage HOLD rather than a false schema verdict or unsafe rename retry',
  'pre-runtime FAILED persistence failure retains ownership and emits no cleanup receipt',
  'Host schema-only diagnosis with actual registered disposable PG17 preserves minimum service and owned cleanup',
  'wrong original PG birth within the same millisecond is refused without changing the recovery wire',
  'attached API client timeout with genuine driver error cannot claim server-query settlement or release Host lock',
  'attached API client timeout with test-only sanitized ordinary-error ACK loss cannot claim server-query settlement or release Host lock',
  'same-byte pathname replacement at wx handle close is not adopted as original Host lock',
  'foreign physical UNKNOWN remains marked without poisoning confirmed rollback of this owner',
  'default CLOSED publication refuses IMPLEMENTER before provider admission or lease preparation',
  'default CLOSED publication refuses CRITIC before provider admission or lease preparation',
  'default CLOSED publication leaves historical readback and rejection reconciliation available',
  'default CLOSED publication also refuses private prepared adapter before claim/reserve',
  'installed publication verifier on registered disposable PG17: read-only attest, exact transaction recheck and catalog fences',
  'attest uses one monitored REPEATABLE READ READ ONLY and returns no transferable readiness marker',
  'regular lost BEGIN acknowledgement requires same-reservation rollback before release',
  'publication lost BEGIN acknowledgement requires same-reservation rollback before release',
  'lost genuine BEGIN acknowledgement requires rollback before publication unlock/release: isolation level serializable',
  'lost genuine BEGIN acknowledgement and ROLLBACK acknowledgement quarantine original session: isolation level serializable',
  'registered publication schema fresh/attached/replay/rollback on disposable PG17',
  'fresh registry applies both protections in reviewed order inside baseline transaction',
  'canonical OWNER_ONLY schema permits NEW onboarding registry before API provisioning without granting access',
  'authenticated API evidence cannot downgrade to OWNER_ONLY after its grant is revoked',
  'duplicate historical generations roll back callback DDL and preserve both evidence rows',
  'lost COMMIT ACK remains an error; installed evidence is read back and token is not replayable',
  'authenticated direct API compatibility on actual disposable PG17',
  'genuine authenticated provisioning permits replay without ACL mutation',
  'attached existing direct-login predecessor upgrades with the same exact ACL',
  'authenticated direct grant cannot be replaced by service_role grant',
  'API role cannot delegate authenticated grant through inbound membership',
  'one authenticated SQL evidence row cannot authorize two preflights',
  'actual client original reservation and six direct Main reads yield one retained facet without nested IPC/drain',
  'actual client cancel after reservation but before bridge fences original BOUND without a new claim',
  'actual held Main Owner callback remains joined after local close until original native read returns',
  'actual default bridge remains closed even after adapter receives original verified reservation',
  'mandatory initial anchor and retained native task identity on actual PG17; all custody GENERATED',
  'duplicate legacy generations reject migration atomically without deleting history',
  'IMPLEMENTER absent anchor forbids job and ATTEMPTED without partial registration',
  'CRITIC absent anchor forbids job and ATTEMPTED without partial registration',
  'IMPLEMENTER inert original anchor permits signed association and W30 RUNNING',
  'CRITIC inert original anchor permits signed association and W30 RUNNING',
  'legacy unanchored ATTEMPTED cannot newly enter RUNNING',
  'concurrent same task reserve keeps one durable identity and no automatic retry',
  'new task continuation remains admissible after retained CHECKPOINTED predecessor',
  'joined actual composition and AgentTools commit one fixed message in the same monitored Owner transaction',
  'joined Owner after actual AgentTools SQL rolls back both message and intent without replay',
  'joined cancellation after actual AgentTools SQL rolls back both message and intent without replay',
  'joined effect rejection after actual AgentTools SQL rolls back both message and intent without replay',
  'joined second effect after actual AgentTools SQL rolls back both message and intent without replay',
  'joined cancellation retains the actual post-effect Owner callback and transaction until that original callback joins',
  'joined effect rejects substituted context rather than adopting a matching object',
  'joined effect rejects substituted transaction rather than adopting a matching object',
  'joined lost COMMIT ACK retains exactly one real message and receipt but no replay ticket',
  'actual terminal transition retires composed routing before an unused AgentTools effect ticket can run',
  'promoted facet carries actual original publication six and effect three Owner cycles on unchanged IPC frames',
  'actual PG17 monitored Host transactions preserve settlement, quarantine and independent scope',
  'late Owner phase malformed before COMMIT aborts original request and rolls back actual SQL',
  'Owner phase failure after COMMIT cannot relabel a durable effect as absent or permit replay',
  'private transaction invocation uses exact existing tx and original context without nested begin',
  'same-transaction Owner after generated SQL effect rolls back before any COMMIT',
  'advance ATTEMPTED cancelled during native observation rolls back job and execution writes',
  'advance RESULT_READY cancelled during native observation rolls back job and execution writes'])
  assert.ok(source.includes("'"+name+"',"),name);
});


test('Host status fixture-only changes trigger the same mandatory Windows component lane',()=>{
 const component=source.slice(source.indexOf('          const component=['),source.indexOf('          const native=['));
 for(const file of ['infra/client-state-runtime/native-host-schema-diagnosis.test.mjs',
  'infra/client-state-runtime/runtime-host-lifecycle.test.mjs']){
  assert.ok(paths.some(pattern=>matches(file,pattern)),file+' must trigger Windows qualification');
  assert.ok(component.includes("'"+file+"',"),file+' must run in the component lane');
 }
});

test('exact status bytes and substituted directory alias remain mandatory named Windows cases',()=>{
 const required=source.slice(source.indexOf('          const componentRequired=['),source.indexOf('          const nativeRequired=['));
 for(const name of ['lock diagnosis retains canonical ancestry and refuses a newly substituted directory alias',
  'committed status with intended U+FFFD cannot accept same-inode malformed UTF8 after lost rename acknowledgement',
  'distinct malformed UTF8 preimage bytes cannot authorize a status rename even when both decode to U+FFFD'])
  assert.ok(required.includes("'"+name+"',"),name+' must remain a required non-skipped case');
 // The sole existing counterfactual baseline skip is not broadened for aliases.
 assert.match(source,/skipped\.length!==1\|\|skipped\[0\]\.name!==baseline/);
});

test('directory alias negative runs on Windows with a real disposable junction, not a platform skip',async()=>{
 const fixture=await readFile(new URL('./native-host-schema-diagnosis.test.mjs',import.meta.url),'utf8');
 const name='lock diagnosis retains canonical ancestry and refuses a newly substituted directory alias';
 const block=fixture.slice(fixture.indexOf("test('"+name),fixture.indexOf("\ntest(",fixture.indexOf("test('"+name)+1));
 assert.ok(block.startsWith("test('"+name+"',async t=>{"));
 assert.ok(block.includes("process.platform==='win32'?'junction':'dir'"));
 assert.ok(block.includes('await fs.unlink(f.config.state_directory)'));
 assert.doesNotMatch(block,/\bskip\s*:/);
});

test('managed Git target envelope and exact invocation spelling remain required Windows outcomes',()=>{
 const component=source.slice(source.indexOf('          const component=['),source.indexOf('          const native=['));
 const required=source.slice(source.indexOf('          const componentRequired=['),source.indexOf('          const nativeRequired=['));
 const fixture='apps/metaengine-browser/test/managed-task-project-runtime.test.mjs';
 assert.ok(component.includes("'"+fixture+"',"));
 for(const file of [fixture,'apps/metaengine-browser/src/managed-task-project-runtime.mjs'])
  assert.ok(paths.some(pattern=>matches(file,pattern)),file+' must trigger the same Windows qualification');
 for(const name of ['validated Git plans receive only the fixed invocation-local Windows long-path option',
  'real Git long managed paths preserve exact locked creation and readback without persistent configuration',
  'unsupported new Windows target is refused before reservation or Git add',
  'derived Windows spelling refuses cross-volume, malformed and UTF8-overlimit creation plans before spawn',
  'derived target remains the same physical worktree from a nested Git executor cwd'])
  assert.ok(required.includes("'"+name+"',"),name+' must remain a required non-skipped case');
});

test('managed Git executor bytes are retained in the qualification source receipt',()=>{
 const start=source.indexOf('          const sourcePaths=[');
 const end=source.indexOf('          const sources=[];',start);
 assert.ok(start>=0&&end>start,'the actual receipt inventory must be present');
 const inventory=source.slice(start,end);
 const entry="'apps/metaengine-browser/src/managed-task-project-runtime.mjs'";
 assert.equal(inventory.split(entry).length-1,1,'the executed Git implementation must be hashed exactly once');
});

test('durable physical custody source and PG17 suites are mandatory Windows outcomes with exact producer/consumer source receipts',async()=>{
 const component=source.slice(source.indexOf('          const component=['),source.indexOf('          const native=['));
 const native=source.slice(source.indexOf('          const native=['),source.indexOf('          const componentRequired=['));
 const componentRequired=source.slice(source.indexOf('          const componentRequired=['),source.indexOf('          const nativeRequired=['));
 const nativeRequired=source.slice(source.indexOf('          const nativeRequired=['),source.indexOf('          const baseline='));
 const sourcePaths=source.slice(source.indexOf('          const sourcePaths=['),source.indexOf('          const sources=[];'));
 for(const [files,lane,required] of [
  [['native-coding-physical-task.test.mjs','native-coding-physical-ipc.test.mjs','native-coding-physical-authority.test.mjs','native-coding-setup-job-drain.test.mjs'],component,componentRequired],
  [['native-coding-physical-custody.pg17.test.mjs','native-coding-physical-restart.pg17.test.mjs','native-coding-setup.pg17.test.mjs'],native,nativeRequired],
 ])for(const file of files){
  const full='infra/client-state-runtime/'+file;
  assert.equal(lane.split("'"+full+"',").length-1,1,full+' must run exactly once in its mandatory Windows lane');
  assert.ok(paths.some(pattern=>matches(full,pattern)),full+' must trigger Windows qualification');
  const fixture=await readFile(new URL('./'+file,import.meta.url),'utf8');
  for(const match of fixture.matchAll(/(?:^|\n)\s*(?:await t\.)?test\('([^']+)'/g)){
   if(match[1].endsWith(' '))continue; // Generated parameter cases still run under the zero-SKIP gate.
   assert.ok(required.includes("'"+match[1]+"',"),match[1]+' must be a named mandatory outcome');
  }
 }
 for(const file of ['infra/client-state-runtime/native-coding-physical-custody.mjs',
  'infra/client-state-runtime/native-coding-physical-custody-v1.sql',
  'infra/client-state-runtime/native-coding-host-capacity.mjs',
  'infra/client-state-runtime/native-coding-capacity-v2.sql',
  'infra/client-state-runtime/native-coding-host-setup-service.mjs',
  'infra/client-state-runtime/native-coding-setup-job-drain.mjs',
  'infra/client-state-runtime/test/fixtures/native-coding-physical-task-fixture.mjs',
  'infra/client-state-runtime/test/run-physical-custody-pg17.mjs',
  'apps/metaengine-browser/src/native-coding-run-callback-journal.mjs',
  'infra/client-state-runtime/package.json']){
  assert.ok(paths.some(pattern=>matches(file,pattern)),file+' must trigger Windows qualification');
  assert.equal(sourcePaths.split("'"+file+"'").length-1,1,file+' must be hashed exactly once');
 }
 assert.match(source,/assert\.equal\(process\.platform,'win32'\)/);
 assert.match(source,/counts\.skipped!==0\|\|skipped\.length/);
 assert.match(source,/skipped\.length!==1\|\|skipped\[0\]\.name!==baseline/);
 assert.match(source,/scope:'SOURCE_COMPONENT_AND_DISPOSABLE_PG17_FIXTURES'/);
 assert.match(source,/installed_autonomy_proven:false,production_qualified:false/);
});

test('physical custody npm entrypoints require actual PG17 execution and cannot succeed by skipping missing inputs',async()=>{
 const pkg=JSON.parse(await readFile(new URL('./package.json',import.meta.url),'utf8'));
 for(const file of ['native-coding-physical-task.test.mjs','native-coding-physical-ipc.test.mjs','native-coding-physical-authority.test.mjs','native-coding-setup-job-drain.test.mjs'])assert.equal(pkg.scripts.test.split(' ').filter(value=>value===file).length,1,file);
 assert.equal(pkg.scripts['test:physical-custody:pg17'],'node test/run-physical-custody-pg17.mjs');
 const runner=await readFile(new URL('./test/run-physical-custody-pg17.mjs',import.meta.url),'utf8');
 for(const file of ['native-coding-physical-custody.pg17.test.mjs','native-coding-physical-restart.pg17.test.mjs','native-coding-setup.pg17.test.mjs'])assert.ok(runner.includes("'"+file+"'"),file);
 assert.ok(runner.includes("'--test-isolation=process'"));assert.ok(runner.includes("'--test-concurrency=1'"));
 assert.ok(runner.includes('physical_pg17_required_case_not_executed'));
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^METAENGINE_PG_TEST_(?:BIN|DRIVER|BASE)$/i.test(key)));
 const result=spawnSync(process.execPath,[fileURLToPath(new URL('./test/run-physical-custody-pg17.mjs',import.meta.url))],
  {env,encoding:'utf8',windowsHide:true,shell:false,timeout:5000});
 assert.equal(result.status,1);assert.equal(result.stdout,'');assert.equal(result.stderr.trim(),'physical_pg17_explicit_inputs_required');
});
