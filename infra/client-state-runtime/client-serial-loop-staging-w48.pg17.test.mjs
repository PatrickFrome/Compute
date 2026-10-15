// Real PG17 integration: ephemeral self-owned cluster and generated checkpoint only.
// Not an installed Owner database, migration, or LIVE task acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
import { sealStagingCheckpoint, inspectStagingRestart } from './client-serial-loop-staging-w48.mjs';

const BIN = process.env.W48_PG17_BIN;
const ID = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const sha40 = 'a'.repeat(40), sha64 = 'b'.repeat(64);
const envForPg = (root, port) => ({
  ...process.env, PGHOST: '127.0.0.1', PGPORT: String(port),
  PGUSER: 'w48_temp', PGDATABASE: 'postgres', PGSSLMODE: 'disable',
  PGCONNECT_TIMEOUT: '3', HOME: root,
});
const fixture = () => {
  const lease = { schema:'metaengine.client.serial-loop-staging-w48.v1',
    state:'STAGING_LEASE_OBSERVED', workspace_id:ID(11), task_id:ID(12),
    agent_id:'agent_implementer0001', lease_generation:3, owner_generation:8 };
  const effect = { effect_id:randomUUID(), operation:'FIXED_SANDBOX_SOURCE_EDIT',
    task_id:lease.task_id, lease_generation:3, state:'ACKED', ack_durable:true };
  const checkpoint = sealStagingCheckpoint({
    lease,effect, source:{repo_scope:'UNIQUE_TEMP_GIT',
      base_sha:sha40,head_sha:'c'.repeat(40)},
    tests:{before_exit_code:1,after_exit_code:0,build_exit_code:0,working_tree_clean:true},
    artifact:{origin:'SYNTHETIC/STAGING',file_sha256:sha64,
      manifest_sha256:'d'.repeat(64),source_head_sha:'c'.repeat(40)},
    critic:{source:'INDEPENDENT_DISPOSABLE_PROCESS',agent_id:'agent_critic000001',
      verdict:'ACCEPT',artifact_sha256:'d'.repeat(64),source_head_sha:'c'.repeat(40)},
    ready_at_ms:Date.now()-5000,completed_at_ms:Date.now()-2000,
  });
  assert.equal(checkpoint.state,'STAGING_REVIEW_REQUIRED');
  return {checkpoint,effect};
};
async function freePort() {
  const s = net.createServer();
  await new Promise((resolve,reject) => {s.once('error',reject); s.listen(0,'127.0.0.1',resolve);});
  const port = s.address().port;
  await new Promise(resolve => s.close(resolve));
  return port;
}
test('W48 real disposable PG17: write, crash-restart, exact digest readback, next task eligibility', {
  skip: !BIN ? 'W48_PG17_BIN absent: real disposable PG17 is UNPROVEN on this runner' : false,
  timeout: 90_000,
}, async () => {
  const clusterId = randomUUID();
  const base = await realpath(os.tmpdir());
  const root = await mkdtemp(path.join(base,'metaengine-w48-pg17-'));
  const data = path.join(root,'cluster');
  const marker = path.join(root,'w48-owned-marker.json');
  let started = false;
  const exe = name => path.join(BIN,name + (process.platform==='win32'?'.exe':''));
  const run = (name,args,env) => execFileSync(exe(name),args,{
    env,encoding:'utf8',timeout:30_000,stdio:['ignore','pipe','pipe'] }).trim();
  const safeSql = (sql,env) => run('psql',['-X','-v','ON_ERROR_STOP=1','-A','-t','-c',sql],env);
  const port = await freePort();
  const env = envForPg(root,port);
  const {checkpoint:c,effect:e} = fixture();
  try {
    // Never touch a caller-provided PGDATA/port: this directory is freshly generated.
    await mkdir(data);
    await writeFile(marker,JSON.stringify({schema:'metaengine.w48.owned-pg17-fixture.v1',clusterId}));
    assert.match(run('initdb',['--version'],env),/PostgreSQL\) 17\./);
    run('initdb',['-D',data,'-A','trust','--no-instructions','-U','w48_temp'],env);
    const opts = '-h 127.0.0.1 -p '+port+' -k '+root;
    run('pg_ctl',['-D',data,'-w','-o',opts,'start'],env); started=true;
    // Fixed SQL only; names/identities below originate from the generated test.
    safeSql('CREATE TABLE w48_staging_checkpoint(task_id uuid PRIMARY KEY, lease_generation integer NOT NULL, effect_id uuid NOT NULL, source_sha char(40) NOT NULL, artifact_sha256 char(64) NOT NULL, checkpoint_sha256 char(64) NOT NULL, origin text NOT NULL CHECK (origin = \'SYNTHETIC/STAGING\'))',env);
    safeSql(`INSERT INTO w48_staging_checkpoint VALUES ('${c.task_id}',${c.lease_generation},'${c.effect_id}','${c.source_sha}','${c.artifact_sha256}','${c.checkpoint_sha256}','SYNTHETIC/STAGING')`,env);
    // A crash/Owner restart cannot make an effect replayable.
    run('pg_ctl',['-D',data,'-w','-m','immediate','stop'],env); started=false;
    run('pg_ctl',['-D',data,'-w','-o',opts,'start'],env); started=true;
    const row=safeSql(`SELECT task_id::text || '|' || lease_generation::text || '|' || effect_id::text || '|' || trim(source_sha) || '|' || trim(artifact_sha256) || '|' || trim(checkpoint_sha256) || '|' || origin FROM w48_staging_checkpoint WHERE task_id = '${c.task_id}'`,env);
    const [task_id,lease_gen,effect_id,source_sha,artifact_sha256,checkpoint_sha256,origin]=row.split('|');
    const pgReadback={backend:'OWN_PG17_DISPOSABLE',task_id,lease_generation:Number(lease_gen),
      effect_id,source_sha,artifact_sha256,checkpoint_sha256,origin};
    assert.equal(checkpoint_sha256,c.checkpoint_sha256);
    const next=inspectStagingRestart({checkpoint:c,pgReadback,effect:e,
      requested_task_id:ID(13),requested_lease_generation:1});
    assert.equal(next.state,'NEXT_TASK_ELIGIBLE_STAGING_ONLY');
    assert.equal(next.permission_to_claim,false);
    assert.equal(inspectStagingRestart({checkpoint:c,pgReadback,effect:e,
      requested_task_id:c.task_id,requested_lease_generation:3}).reason,'COMPLETED_TASK_REPLAY_FORBIDDEN');
    assert.equal(inspectStagingRestart({checkpoint:c,
      pgReadback:{...pgReadback,checkpoint_sha256:'e'.repeat(64)},effect:e,
      requested_task_id:ID(13),requested_lease_generation:1}).state,'UNKNOWN');
    assert.equal(inspectStagingRestart({checkpoint:c,pgReadback,
      effect:{...e,state:'AMBIGUOUS'},requested_task_id:ID(13),
      requested_lease_generation:1}).state,'AMBIGUOUS');
  } finally {
    if(started) {
      try {run('pg_ctl',['-D',data,'-w','-m','immediate','stop'],env);} catch {}
    }
    const recorded=JSON.parse(await readFile(marker,'utf8').catch(()=>'{ }'));
    if(recorded.schema==='metaengine.w48.owned-pg17-fixture.v1'&&recorded.clusterId===clusterId
      &&path.dirname(root)===base) await rm(root,{recursive:true,force:true});
  }
});
