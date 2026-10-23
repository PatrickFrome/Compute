import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { NativeCodingPgLedger } from '../src/native-coding-pg-ledger.mjs';

const run = promisify(execFile), bin = process.env.METAENGINE_PG_TEST_BIN;
const driver = process.env.METAENGINE_PG_TEST_DRIVER;
const workspace = '11111111-1111-4111-8111-111111111111';
const host = 'pid:123:created_100ns:134054310000000000';
const sha = 'a'.repeat(64);

test('own-PG execution barrier: real disposable PostgreSQL, never the installed Keeper',
  {skip:!bin || !driver,timeout:240000},async t => {
  const root = await fs.realpath(process.env.METAENGINE_PG_TEST_BASE || os.tmpdir());
  const directory = await fs.mkdtemp(path.join(root,'native-coding-ledger-'));
  const data = path.join(directory,'pgdata'), log = path.join(directory,'postgres.log');
  const postgres = (await import(pathToFileURL(driver))).default;
  const server = net.createServer();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port = server.address().port;
  await new Promise(resolve=>server.close(resolve));
  let started = false, sql;
  const exe = name => path.join(bin,name+(process.platform==='win32'?'.exe':''));
  const execute = (name,args) => run(exe(name),args,{windowsHide:true,timeout:90000,maxBuffer:1048576});
  try {
    // Disposable fixture initialization only. Server fsync and synchronous
    // execution barriers retain their PostgreSQL defaults during the tests.
    await execute('initdb',['-D',data,'--username=qa_ledger','--auth=trust','--no-locale','--encoding=UTF8','--no-sync']);
    await execute('pg_ctl',['-D',data,'-l',log,'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);
    started = true;
    sql = postgres({host:'127.0.0.1',port,user:'qa_ledger',database:'postgres',max:4,
      onnotice:()=>{},connection:{application_name:'METAENGINE_NATIVE_LEDGER_DISPOSABLE_QA'}});
    await sql.unsafe(`create role anon; create role authenticated; create role service_role;
      create schema destruktion_meta;
      create table destruktion_meta.devos_fleet_task_h205f22(
        task_id uuid primary key,workspace_id uuid,state text,lease_generation bigint,
        lease_agent_id text,lease_target_id text,lease_agent_generation_epoch bigint,lease_expires_at timestamptz);
      create table destruktion_meta.devos_fleet_claim_h205f22(
        task_id uuid,workspace_id uuid,lease_generation bigint,agent_id text,target_id text,
        agent_generation_epoch bigint,state text,expires_at timestamptz);
      grant usage on schema destruktion_meta to service_role,anon,authenticated;`);
    const migration = fileURLToPath(new URL('../../../supabase/migrations/20261022070000_native_coding_execution_ledger_v1.sql',import.meta.url));
    await sql.unsafe(await fs.readFile(migration,'utf8'));
    const transaction = (callback,options={}) => sql.begin(options.readOnly?'read only':'isolation level serializable',callback);
    const ledger = new NativeCodingPgLedger({transaction});
    async function lease() {
      const scope = {workspace_id:workspace,task_id:randomUUID(),lease_generation:1,
        agent_id:'agent_11111111-1111-4111-8111-111111111111',target_id:'codex-cli:'+randomUUID(),
        agent_generation_epoch:1,host_incarnation:host,scope_sha256:sha};
      await sql.unsafe(`insert into destruktion_meta.devos_fleet_task_h205f22 values
        ($1,$2,'LEASED',1,$3,$4,1,clock_timestamp()+interval '5 minutes')`,
      [scope.task_id,workspace,scope.agent_id,scope.target_id]);
      await sql.unsafe(`insert into destruktion_meta.devos_fleet_claim_h205f22 values
        ($1,$2,1,$3,$4,1,'ACTIVE',clock_timestamp()+interval '5 minutes')`,
      [scope.task_id,workspace,scope.agent_id,scope.target_id]);
      return scope;
    }
    await t.test('reserve consumes an existing exact live claim and restart is readback only',async()=>{
      const scope = await lease(), first = await ledger.reserve(scope);
      assert.equal(first.state,'RESERVED');
      const restarted = new NativeCodingPgLedger({transaction});
      const second = await restarted.reserve(scope);
      assert.equal(second.state,'READBACK_ONLY');
      assert.equal(second.execution.reservation_id,first.scope.reservation_id);
      assert.equal((await restarted.read(scope)).state,'RESERVED');
    });
    await t.test('parallel reservation has one winner, never two runnable jobs',async()=>{
      const scope = await lease();
      const results = await Promise.allSettled([ledger.reserve(scope),ledger.reserve(scope)]);
      assert.equal(results.filter(x=>x.status==='fulfilled'&&x.value.state==='RESERVED').length,1);
      const count = await sql.unsafe('select count(*)::int as n from destruktion_meta.native_coding_execution_h205f22 where task_id=$1',[scope.task_id]);
      assert.equal(count[0].n,1);
    });
    await t.test('wrong generation or absent/expired claim cannot create a reservation',async()=>{
      const scope = await lease();
      await assert.rejects(ledger.reserve({...scope,lease_generation:2}),/write_unconfirmed/);
      await sql.unsafe("update destruktion_meta.devos_fleet_claim_h205f22 set expires_at=clock_timestamp()-interval '1 second' where task_id=$1",[scope.task_id]);
      await assert.rejects(ledger.reserve(scope),/write_unconfirmed/);
      assert.equal(await ledger.read(scope),null);
    });
    await t.test('claim must still be live at the durable attempt barrier',async()=>{
      const scope = await lease(), reserved = await ledger.reserve(scope);
      await sql.unsafe("update destruktion_meta.devos_fleet_claim_h205f22 set state='FENCED' where task_id=$1",[scope.task_id]);
      await assert.rejects(ledger.advance(reserved.scope,{from:'RESERVED',to:'ATTEMPTED',evidence_sha256:sha}),/write_unconfirmed/);
      assert.equal((await ledger.read(scope)).state,'RESERVED');
    });
    await t.test('an unknown commit result is read back, never retried as a new attempt',async()=>{
      const scope = await lease(), reserved = await ledger.reserve(scope);
      const lostAck = new NativeCodingPgLedger({transaction:async(...args)=>{
        await transaction(...args); throw new Error('simulated_commit_ack_loss');
      }});
      await assert.rejects(lostAck.advance(reserved.scope,{from:'RESERVED',to:'ATTEMPTED',evidence_sha256:sha}),error=>error.effect_outcome==='UNKNOWN'&&error.automatic_retry_allowed===false);
      assert.equal((await ledger.read(scope)).state,'ATTEMPTED');
      assert.equal((await ledger.reserve(scope)).state,'READBACK_ONLY');
    });
    await t.test('same-generation task and claim rebind cannot borrow an old execution reservation',async()=>{
      const scope=await lease(),reserved=await ledger.reserve(scope),changedTarget='codex-cli:'+randomUUID();
      await sql.unsafe('update destruktion_meta.devos_fleet_task_h205f22 set lease_target_id=$2 where task_id=$1',[scope.task_id,changedTarget]);
      await sql.unsafe('update destruktion_meta.devos_fleet_claim_h205f22 set target_id=$2 where task_id=$1',[scope.task_id,changedTarget]);
      await assert.rejects(ledger.advance(reserved.scope,{from:'RESERVED',to:'ATTEMPTED',evidence_sha256:sha}),/write_unconfirmed/);
      assert.equal((await ledger.read(scope)).state,'RESERVED');
    });
    await t.test('native host and reservation CAS cannot be borrowed by a successor',async()=>{
      const scope = await lease(), reserved = await ledger.reserve(scope);
      for (const changed of [{host_incarnation:'pid:124:created_100ns:134054310000000000'},
        {reservation_id:randomUUID()},{scope_sha256:'b'.repeat(64)}]) {
        await assert.rejects(ledger.advance({...reserved.scope,...changed},{from:'RESERVED',to:'ATTEMPTED',evidence_sha256:sha}),/write_unconfirmed/);
      }
      assert.equal((await ledger.read(scope)).state,'RESERVED');
    });
    await t.test('checkpoint requires a result and Critic/checkpoint digests (proof verification belongs to the host)',async()=>{
      const scope = await lease(), reserved = await ledger.reserve(scope);
      await ledger.advance(reserved.scope,{from:'RESERVED',to:'ATTEMPTED',evidence_sha256:sha});
      await ledger.advance(reserved.scope,{from:'ATTEMPTED',to:'RESULT_READY',evidence_sha256:'b'.repeat(64)});
      await assert.rejects(ledger.advance(reserved.scope,{from:'RESULT_READY',to:'CHECKPOINTED',evidence_sha256:sha}),/checkpoint_proof_missing/);
      const final = await ledger.advance(reserved.scope,{from:'RESULT_READY',to:'CHECKPOINTED',evidence_sha256:sha,
        critic_proof_sha256:'c'.repeat(64),checkpoint_sha256:'d'.repeat(64)});
      assert.equal(final.state,'CHECKPOINTED');
      await assert.rejects(ledger.advance(reserved.scope,{from:'RESULT_READY',to:'CHECKPOINTED',evidence_sha256:sha,
        critic_proof_sha256:'c'.repeat(64),checkpoint_sha256:'d'.repeat(64)}),/write_unconfirmed/);
    });
    await t.test('ambiguous attempts have no execution transition or automatic replay',async()=>{
      const scope = await lease(), reserved = await ledger.reserve(scope);
      await ledger.advance(reserved.scope,{from:'RESERVED',to:'ATTEMPTED',evidence_sha256:sha});
      await ledger.advance(reserved.scope,{from:'ATTEMPTED',to:'AMBIGUOUS',evidence_sha256:sha});
      await assert.rejects(ledger.advance(reserved.scope,{from:'AMBIGUOUS',to:'ATTEMPTED',evidence_sha256:sha}),/transition_invalid/);
      assert.equal((await ledger.reserve(scope)).state,'READBACK_ONLY');
    });
    await t.test('public callers cannot mutate the table or call private functions',async()=>{
      await assert.rejects(sql.begin(async tx=>{
        await tx.unsafe('set local role anon');
        await tx.unsafe('select destruktion_meta.native_coding_read_v1($1,$2,1)',[workspace,randomUUID()]);
      }),error=>error.code==='42501');
      await assert.rejects(sql.begin(async tx=>{
        await tx.unsafe('set local role service_role');
        await tx.unsafe('delete from destruktion_meta.native_coding_execution_h205f22');
      }),error=>error.code==='42501');
    });
    await fs.writeFile(path.join(directory,'receipt.json'),JSON.stringify({schema:'metaengine.native-coding-ledger.disposable-qa.v1',
      state:'PASS',port,installed_keeper_used:false,authority_effect:false,production_ready:false},null,2));
  } finally {
    if (sql) await sql.end({timeout:5});
    // The unique initdb path is owned by this test. Never stop the live Keeper.
    if (started) await execute('pg_ctl',['-D',data,'-m','fast','-w','stop']);
  }
});
