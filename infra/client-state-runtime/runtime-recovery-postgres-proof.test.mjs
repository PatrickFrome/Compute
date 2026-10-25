import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import {runtimeRecoveryPostgresProof} from './runtime-recovery-postgres-proof.mjs';

async function fixture(t){
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-pg-continuity-')));
  t.after(async()=>{assert.ok(root.startsWith(await fs.realpath(os.tmpdir())));await fs.rm(root,{recursive:true,force:true});});
  const identity={pid:42,version:170007,system_identifier:'7654321098765432100',started_at:'2026-10-25T00:00:00.000Z',data_directory:root,port:25434};
  await fs.writeFile(path.join(root,'PG_VERSION'),'17\n');
  await fs.writeFile(path.join(root,'postmaster.pid'),`42\n${root}\n1792886400\n25434\n\n127.0.0.1\nready\n`);
  return {root,identity,options:{identity,pgDataDirectory:root,expectedClusterSystemIdentifier:identity.system_identifier}};
}
test('Host produces a stable SQL+postmaster-file continuity digest without private paths or URLs',async t=>{
  const f=await fixture(t),proof=await runtimeRecoveryPostgresProof(f.options),{sha256,...value}=proof;
  assert.equal(sha256,createHash('sha256').update(JSON.stringify(value)).digest('hex'));
  assert.equal(proof.pid,42);assert.equal(proof.authority_effect,false);
  assert.ok(!JSON.stringify(proof).includes(f.root));assert.ok(!JSON.stringify(proof).includes('postgresql://'));
  assert.deepEqual(await runtimeRecoveryPostgresProof(f.options),proof);
});
test('Host refuses another cluster, PID, port or PG major before READY',async t=>{
  const f=await fixture(t);
  for(const identity of [{...f.identity,pid:43},{...f.identity,port:25435},{...f.identity,version:160007},{...f.identity,system_identifier:'8654321098765432100'}])
    await assert.rejects(runtimeRecoveryPostgresProof({...f.options,identity}),/identity_unproven/);
  await fs.writeFile(path.join(f.root,'PG_VERSION'),'18\n');
  await assert.rejects(runtimeRecoveryPostgresProof(f.options),/identity_unproven/);
});
test('Host refuses replaced pid bytes and hardlinked identity files',async t=>{
  const f=await fixture(t);await fs.link(path.join(f.root,'postmaster.pid'),path.join(f.root,'alias.pid'));
  await assert.rejects(runtimeRecoveryPostgresProof(f.options),/identity_unproven/);
});
