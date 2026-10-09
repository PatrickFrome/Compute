import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { createManagedTaskProjectSqliteJournal } from '../src/managed-task-project-sqlite-journal.mjs';
import { createManagedTaskProjectRuntime, createShellFreeGitExecutor } from '../src/managed-task-project-runtime.mjs';
import { recordWorkspaceMaterializationReadback } from '../src/workspace-manager.mjs';

const exec = promisify(execFile);
const journalURL = pathToFileURL(fileURLToPath(new URL('../src/managed-task-project-sqlite-journal.mjs', import.meta.url))).href;
const runtimeURL = new URL('../src/managed-task-project-runtime.mjs', import.meta.url).href;
const childSource = `
  import fs from 'node:fs/promises';
  import { createManagedTaskProjectSqliteJournal } from ${JSON.stringify(journalURL)};
  import { createManagedTaskProjectRuntime, createShellFreeGitExecutor } from ${JSON.stringify(runtimeURL)};
  const {mode, filePath, entry, request, logPath} = JSON.parse(process.argv[1]);
  const journal = createManagedTaskProjectSqliteJournal({filePath});
  if (mode === 'compete') {
    process.send({ready:true});
    await new Promise(resolve => process.once('message', resolve));
    try { await journal.append(entry); process.send({result:'WON'}); }
    catch(error) { process.send({result:'REJECTED', error:error.message}); }
    await journal.close(); process.disconnect();
  } else {
    const git = createShellFreeGitExecutor();
    const runtime = createManagedTaskProjectRuntime({journal, validateClaim:async () => true,
      executePlan:async plan => {
        const result = await git.execute(plan);
        if (plan.effect === 'WORKTREE_CREATE_LOCKED') {
          await fs.appendFile(logPath,'add\\n');
          process.exit(73);
        }
        return result;
      }
    });
    await runtime.create(request);
    throw new Error('child_did_not_crash');
  }
`;

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-sqlite-journal-')));
  const repo = path.join(root, 'repo'); const projects = path.join(root, 'projects');
  await fs.mkdir(repo); await fs.mkdir(projects);
  const git = args => exec('git', args, { cwd: repo, windowsHide: true });
  await git(['init', '-q']);
  await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-qm', 'seed']);
  const { stdout } = await git(['rev-parse', 'HEAD']);
  const request = {
    idempotency_key: 'task-project:sqlite:v1',
    trusted_repo: { repo_id: 'github:test/repo', repo_root: await fs.realpath(repo) },
    workspace_root: await fs.realpath(projects),
    claim: { coordination_workspace_id: '2de9f84b-7c0a-4091-911c-894ff1d6eaf4',
      task_id: 'cc891801-2adf-4561-8f7a-8091162032ff', claim_id: 46,
      point_id: 'task.project.v1', claim_class: 'MUTATING', base_sha: stdout.trim(),
      branch_name: 'work/task-project-sqlite', agent_id: 'agent_a2bf77e6-66d3-4f10-9c9c-683df36f4510',
      tab_id: 'tab_dcfb4a80-ca6d-4614-ad5f-4877391ab12d', target_id: 'webcontents:7',
      agent_generation_epoch: 9, lease_generation: 1,
      lease_expires_at: new Date(Date.now() + 600000).toISOString() },
  };
  let reserved;
  const executor = createShellFreeGitExecutor();
  await assert.rejects(createManagedTaskProjectRuntime({ validateClaim: async () => true,
    executePlan: plan => executor.execute(plan), journal: { find: async () => null,
      append: async entry => { reserved = structuredClone(entry); throw new Error('capture_intent'); } },
  }).create(request), /capture_intent/);
  const journals = []; const children = [];
  t.after(async () => {
    // Kill/await owned children before removing their open SQLite files, even if
    // a READY barrier fails. Cleanup hooks must not leave an IPC child alive.
    for (const { child } of children) { if (child.exitCode === null) child.kill(); }
    await Promise.all(children.map(child => child.exited));
    for (const journal of journals) await journal.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const filePath = path.join(root, 'effects.sqlite');
  const open = options => { const journal = createManagedTaskProjectSqliteJournal({ filePath, ...options }); journals.push(journal); return journal; };
  const child = data => { const result = startChild(data); children.push(result); return result; };
  return { root, request, reserved, filePath, open, executor, child };
}

function terminal(reserved) {
  const base = reserved.reservation;
  const proof = { schema: 'metaengine.devos.workspace-git-inventory-proof.v1',
    workspace_id: base.workspace_id, workspace_generation: base.workspace_generation,
    task_id: base.task_id, lease_generation: base.lease_generation, worktree_path: base.worktree_path,
    head_sha: base.base_sha, branch_ref: `refs/heads/${base.branch_name}`, locked: true,
    prunable: false, automatic_retry_allowed: false, authority_effect: false };
  return { ...structuredClone(reserved), state: 'PROVEN', proof,
    reservation: structuredClone(recordWorkspaceMaterializationReadback(base, {effect_state:'PROVEN',initial_head_sha:base.base_sha,worktree_realpath:base.worktree_path})),
    recorded_at: new Date(Date.parse(reserved.recorded_at) + 1).toISOString() };
}
function startChild(data) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', childSource, JSON.stringify(data)],
    { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const messages = [];
  const ready = new Promise((resolve, reject) => {
    child.on('message', message => { messages.push(message); if (message.ready) resolve(); });
    child.once('error', reject);
    child.once('exit', code => { if (!messages.some(message => message.ready)) reject(new Error(`child_not_ready:${code}:${stderr}`)); });
  });
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal, messages, stderr }));
  });
  // Crash children do not send READY; avoid an unused rejected promise.
  ready.catch(() => {});
  return { child, ready, exited };
}

test('SQLite FULL journal persists immutable intent/receipt across close and restart', async t => {
  const f = await fixture(t); let journal = f.open();
  assert.equal(await journal.find(f.request.idempotency_key), null);
  await journal.append(f.reserved); await journal.close();
  journal = f.open();
  assert.deepEqual(await journal.find(f.request.idempotency_key), f.reserved);
  const ready = terminal(f.reserved); await journal.append(ready); await journal.close();
  journal = f.open();
  const found = await journal.find(f.request.idempotency_key);
  assert.deepEqual(found, ready); found.reservation.repo_id = 'changed';
  assert.deepEqual(await journal.find(f.request.idempotency_key), ready);
  const database = new DatabaseSync(f.filePath);
  assert.equal(database.prepare('PRAGMA journal_mode').get().journal_mode, 'delete');
  assert.equal(database.prepare('SELECT count(*) count FROM effect_entries').get().count, 2);
  assert.throws(() => database.exec("UPDATE effect_entries SET state='FAILED' WHERE sequence=2"), /immutable/);
  assert.throws(() => database.exec('DELETE FROM effect_entries'), /immutable/);
  database.close();
  await journal.close(); await journal.close();
  await assert.rejects(journal.find(f.request.idempotency_key), /closed/);
});

test('real child crash after locked Git add reopens intent and reconciles without a second add', { timeout: 30000 }, async t => {
  const f = await fixture(t); await f.open().close();
  const logPath = path.join(f.root, 'git-adds.txt');
  const child = f.child({ mode: 'crash', filePath: f.filePath, request: f.request, logPath });
  const result = await child.exited;
  assert.equal(result.code, 73, result.stderr);
  const journal = f.open();
  assert.equal((await journal.find(f.request.idempotency_key)).state, 'RESERVED');
  let additionalAdds = 0;
  const recovered = await createManagedTaskProjectRuntime({ journal, validateClaim: async () => true,
    executePlan: plan => { if (plan.effect === 'WORKTREE_CREATE_LOCKED') additionalAdds++; return f.executor.execute(plan); },
  }).create({...f.request, claim: {...f.request.claim, lease_expires_at:new Date(Date.parse(f.request.claim.lease_expires_at) + 60000).toISOString()}});
  assert.equal(recovered.state, 'PROVEN'); assert.equal(recovered.replayed, true);
  assert.equal(additionalAdds, 0); assert.equal(await fs.readFile(logPath, 'utf8'), 'add\n');
  await journal.close();
  assert.equal((await f.open().find(f.request.idempotency_key)).state, 'PROVEN');
});

test('two independent processes can commit only one RESERVED for the same key', { timeout: 30000 }, async t => {
  const f = await fixture(t); await f.open().close();
  const children = [f.child({mode:'compete',filePath:f.filePath,entry:f.reserved})];
  // Open connections before racing the write-ahead transition. Opening a journal
  // also validates its schema under a lock and intentionally has no busy retry.
  await children[0].ready;
  children.push(f.child({mode:'compete',filePath:f.filePath,entry:f.reserved}));
  await children[1].ready;
  children.forEach(({child}) => child.send({append:true}));
  const results = await Promise.all(children.map(child => child.exited));
  results.forEach(result => assert.equal(result.code, 0, result.stderr));
  const outcomes = results.flatMap(result => result.messages.filter(message => message.result));
  assert.equal(outcomes.filter(result => result.result === 'WON').length, 1);
  assert.equal(outcomes.filter(result => result.result === 'REJECTED').length, 1);
  assert.deepEqual(await f.open().find(f.request.idempotency_key), f.reserved);
});

test('stale lease, binding/expiry drift and terminal rewrites are rejected without changing intent', async t => {
  const f = await fixture(t); const journal = f.open();
  const stale = structuredClone(f.reserved); stale.reservation.lease_expires_at = '2020-01-01T00:00:00.000Z';
  await assert.rejects(journal.append(stale), /lease_stale/);
  assert.equal(await journal.find(stale.idempotency_key), null);
  await journal.append(f.reserved);
  const drift = terminal(f.reserved); drift.reservation.lease_expires_at = new Date(Date.parse(f.reserved.reservation.lease_expires_at) - 1000).toISOString();
  await assert.rejects(journal.append(drift), /append_conflict/);
  const digestDrift = terminal(f.reserved); digestDrift.reservation.agent_generation_epoch++;
  await assert.rejects(journal.append(digestDrift), /binding_digest_invalid/);
  const backdated = terminal(f.reserved); backdated.recorded_at = new Date(Date.parse(f.reserved.recorded_at) - 1).toISOString();
  await assert.rejects(journal.append(backdated), /append_conflict/);
  assert.deepEqual(await journal.find(f.reserved.idempotency_key), f.reserved);
  const ready = terminal(f.reserved); await journal.append(ready);
  await assert.rejects(journal.append(ready), /append_conflict/);
  await assert.rejects(journal.append(f.reserved), /append_conflict/);
  assert.deepEqual(await journal.find(f.reserved.idempotency_key), ready);
});

test('malformed proof, caller authority, unknown fields and invalid paths fail closed', async t => {
  const f = await fixture(t); const journal = f.open(); await journal.append(f.reserved);
  for (const alter of [value => {value.proof.locked=false;}, value => {value.proof.head_sha='0'.repeat(40);},
    value => {value.proof.task_id='cc891801-2adf-4561-8f7a-8091162032fe';}, value => {value.authority_effect=true;},
    value => {value.reservation.automatic_retry_allowed=true;}, value => {value.proof={};},
    value => {value.extra='untrusted';}, value => {value.reservation.extra={deep:{nested:true}};},
    value => {value.reason='x'.repeat(241);}, value => {value.reservation.repo_root='relative';}]) {
    const altered = terminal(f.reserved); alter(altered);
    await assert.rejects(journal.append(altered));
    assert.deepEqual(await journal.find(f.reserved.idempotency_key), f.reserved);
  }
  assert.throws(() => createManagedTaskProjectSqliteJournal({filePath:':memory:'}), /path_invalid/);
  assert.throws(() => createManagedTaskProjectSqliteJournal({filePath:f.filePath,maxEntries:Infinity}), /capacity_invalid/);
});

test('terminal receipt permits monotonic lease renewal without granting authority', async t => {
  const f = await fixture(t); const journal = f.open(); await journal.append(f.reserved);
  const renewed = terminal(f.reserved);
  renewed.reservation.lease_expires_at = new Date(Date.parse(f.reserved.reservation.lease_expires_at) + 60000).toISOString();
  await journal.append(renewed); await journal.close();
  assert.deepEqual(await f.open().find(renewed.idempotency_key), renewed);
  assert.equal(renewed.authority_effect, false);
  assert.equal(renewed.reservation.authority_effect, false);
  assert.equal(renewed.binding_digest, f.reserved.binding_digest);
});

test('physical corruption, truncation and wrong SQLite schema never recreate a journal', async t => {
  const f = await fixture(t); const journal = f.open(); await journal.append(f.reserved); await journal.close();
  const corrupted = path.join(f.root, 'corrupted.sqlite'); await fs.writeFile(corrupted, 'not a sqlite journal');
  assert.throws(() => f.open({filePath:corrupted}), /open_failed/);
  assert.equal(await fs.readFile(corrupted, 'utf8'), 'not a sqlite journal');
  const truncated = path.join(f.root, 'truncated.sqlite'); await fs.writeFile(truncated, '');
  assert.throws(() => f.open({filePath:truncated}), /open_failed/);
  assert.equal((await fs.stat(truncated)).size, 0);
  const wrong = path.join(f.root, 'wrong.sqlite'); const database = new DatabaseSync(wrong);
  database.exec('CREATE TABLE unrelated (text TEXT)'); database.close();
  assert.throws(() => f.open({filePath:wrong}), /open_failed/);
});

test('tampered payload/hash is rejected both live and on reopening', async t => {
  const f = await fixture(t); const journal = f.open(); await journal.append(f.reserved);
  const database = new DatabaseSync(f.filePath);
  database.exec('DROP TRIGGER effect_entries_no_update');
  database.prepare('UPDATE effect_entries SET payload=?').run('{"invalid":true}'); database.close();
  await assert.rejects(journal.find(f.reserved.idempotency_key), /read_failed/);
  await journal.close(); assert.throws(() => f.open(), /open_failed/);
});

test('refusing a foreign WAL database preserves its mode and original bytes', async t => {
  const f = await fixture(t); const filePath = path.join(f.root, 'foreign-wal.sqlite');
  const database = new DatabaseSync(filePath);
  database.exec("PRAGMA journal_mode=WAL; CREATE TABLE unrelated (text TEXT); INSERT INTO unrelated VALUES ('keep')");
  database.close();
  const before = await fs.readFile(filePath);
  assert.throws(() => f.open({filePath}), /open_failed/);
  assert.deepEqual(await fs.readFile(filePath), before);
  const probe = new DatabaseSync(filePath, {readOnly:true});
  assert.equal(probe.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  assert.equal(probe.prepare('SELECT text FROM unrelated').get().text, 'keep');
  probe.close();
});

test('capacity rejects a new key and contention does not retry or overwrite existing intent', async t => {
  const f = await fixture(t); const journal = f.open({maxEntries:1}); await journal.append(f.reserved);
  await assert.rejects(journal.append({...f.reserved,idempotency_key:'other:key:v1'}), /capacity_exceeded/);
  const database = new DatabaseSync(f.filePath); database.exec('BEGIN IMMEDIATE');
  try { await assert.rejects(journal.append(terminal(f.reserved)), /locked|busy/i); }
  finally { database.exec('ROLLBACK'); database.close(); }
  assert.deepEqual(await journal.find(f.reserved.idempotency_key), f.reserved);
  await journal.append(terminal(f.reserved));
  assert.equal((await journal.find(f.reserved.idempotency_key)).state, 'PROVEN');
});
