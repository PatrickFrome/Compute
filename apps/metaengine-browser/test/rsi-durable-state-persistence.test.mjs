import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  persistRsiDurableJsonState,
  reconcileRsiDurableJsonState,
  qualifyRsiDurableJsonState,
  RsiDurableStatePersistenceError,
  rsiDurableStatePersistenceTrustRootSnapshot,
} from '../src/rsi-durable-state-persistence.mjs';

function sha256Bytes(value){
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}
function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map((key)=>[key,stable(value[key])]));
}
function stateDigest(value){
  return sha256Bytes(Buffer.from(JSON.stringify(stable(value)),'utf8'));
}

function fakeIo({failAt=null}={}){
  const files=new Map();
  const operations=[];
  let sequence=0;

  const fail=(stage)=>{
    sequence+=1;
    operations.push(stage);
    if(failAt===stage){
      const error=new Error(`injected:${stage}`);
      error.code='EINJECT';
      throw error;
    }
  };

  const api={
    operations,
    files,
    async open(filePath,flags){
      const normalized=path.resolve(filePath);
      const kind=flags==='w'?'temp':flags==='r+'?'final':'dir';
      fail(`open:${kind}`);
      if(kind==='temp')files.set(normalized,Buffer.alloc(0));
      return {
        async writeFile(bytes){
          fail(`write:${kind}`);
          files.set(normalized,Buffer.isBuffer(bytes)?Buffer.from(bytes):Buffer.from(String(bytes)));
        },
        async sync(){fail(`sync:${kind}`);},
        async close(){fail(`close:${kind}`);},
      };
    },
    async rename(from,to){
      fail('rename');
      const source=path.resolve(from);
      const target=path.resolve(to);
      if(!files.has(source)){
        const error=new Error('missing_source');
        error.code='ENOENT';
        throw error;
      }
      files.set(target,Buffer.from(files.get(source)));
      files.delete(source);
    },
    async readFile(filePath){
      fail('readback');
      const target=path.resolve(filePath);
      if(!files.has(target)){
        const error=new Error('missing');
        error.code='ENOENT';
        throw error;
      }
      return Buffer.from(files.get(target));
    },
  };
  return api;
}

test('R9 durable persistence orders temp sync, rename, final sync, parent-directory sync, then exact readback on POSIX',async()=>{
  const io=fakeIo();
  const state={schema:'fixture.v1',version:1,value:'durable'};
  const receipt=await persistRsiDurableJsonState({
    file_path:'/tmp/rsi-durable-state.json',
    state,
    io,
    platform:'linux',
  });

  assert.deepEqual(io.operations,[
    'open:temp','write:temp','sync:temp','close:temp',
    'rename',
    'open:final','sync:final','close:final',
    'open:dir','sync:dir','close:dir',
    'readback',
  ]);
  assert.equal(receipt.temp_file_sync_completed,true);
  assert.equal(receipt.rename_completed,true);
  assert.equal(receipt.final_file_sync_completed,true);
  assert.equal(receipt.parent_directory_sync_required,true);
  assert.equal(receipt.parent_directory_sync_completed,true);
  assert.equal(receipt.readback_digest_verified,true);
  assert.equal(receipt.durability_barriers_completed,true);
  assert.equal(receipt.power_loss_durability_claimed,false);
  assert.equal(receipt.authority_effect,false);
});

test('R9 Windows path syncs the final file but explicitly does not claim rename-metadata or power-loss durability',async()=>{
  const io=fakeIo();
  const receipt=await persistRsiDurableJsonState({
    file_path:'C:/rsi/state.json',
    state:{schema:'fixture.v1',value:'windows'},
    io,
    platform:'win32',
  });

  assert.equal(receipt.final_file_sync_completed,true);
  assert.equal(receipt.parent_directory_sync_required,false);
  assert.equal(receipt.parent_directory_sync_completed,false);
  assert.equal(receipt.windows_write_through_rename_used,false);
  assert.equal(receipt.windows_rename_metadata_durability_claimed,false);
  assert.equal(receipt.power_loss_durability_claimed,false);
  assert.equal(receipt.platform_power_loss_qualification_required,true);
  assert.ok(!io.operations.includes('open:dir'));
});

test('R9 pre-rename failure proves no rename and allows only a new persistence attempt',async()=>{
  const io=fakeIo({failAt:'sync:temp'});
  await assert.rejects(
    persistRsiDurableJsonState({
      file_path:'/tmp/rsi-pre-rename.json',
      state:{schema:'fixture.v1',value:'pre'},
      io,
      platform:'linux',
    }),
    (error)=>{
      assert.ok(error instanceof RsiDurableStatePersistenceError);
      assert.equal(error.rename_completed,false);
      assert.equal(error.no_rename_proven,true);
      assert.equal(error.reconciliation_required,false);
      assert.equal(error.new_attempt_allowed,true);
      assert.equal(error.same_attempt_retry_allowed,false);
      assert.equal(error.automatic_retry_allowed,false);
      return true;
    },
  );
  assert.ok(!io.operations.includes('rename'));
});

test('R9 post-rename sync failure is ambiguous and requires readback-only reconciliation, never same-attempt retry',async()=>{
  const io=fakeIo({failAt:'sync:final'});
  const state={schema:'fixture.v1',value:'post-rename'};
  let snapshot=null;

  await assert.rejects(
    persistRsiDurableJsonState({
      file_path:'/tmp/rsi-post-rename.json',
      state,
      io,
      platform:'linux',
    }),
    (error)=>{
      assert.ok(error instanceof RsiDurableStatePersistenceError);
      assert.equal(error.rename_completed,true);
      assert.equal(error.no_rename_proven,false);
      assert.equal(error.reconciliation_required,true);
      assert.equal(error.new_attempt_allowed,false);
      assert.equal(error.same_attempt_retry_allowed,false);
      snapshot=error.snapshot();
      return true;
    },
  );

  assert.equal(snapshot.reconciliation_required,true);
  assert.equal(snapshot.authority_effect,false);

  io.operations.length=0;
  const reconcile=await reconcileRsiDurableJsonState({
    file_path:'/tmp/rsi-post-rename.json',
    expected_state_digest:stateDigest(state),
    expected_file_digest:sha256Bytes(Buffer.from(`${JSON.stringify(state)}\n`,'utf8')),
    io,
  });
  assert.equal(reconcile.state,'CONFIRMED_EXACT_READBACK');
  assert.equal(reconcile.exact_readback_match,true);
  assert.equal(reconcile.new_attempt_allowed,false);
  assert.equal(reconcile.authority_effect,false);
});

test('R9 parent-directory sync failure remains ambiguous even when final-file sync completed',async()=>{
  const io=fakeIo({failAt:'sync:dir'});
  await assert.rejects(
    persistRsiDurableJsonState({
      file_path:'/tmp/rsi-dir-sync.json',
      state:{schema:'fixture.v1',value:'dir-sync'},
      io,
      platform:'linux',
    }),
    (error)=>{
      assert.equal(error.rename_completed,true);
      assert.equal(error.final_file_sync_completed,true);
      assert.equal(error.parent_directory_sync_completed,false);
      assert.equal(error.reconciliation_required,true);
      assert.equal(error.same_attempt_retry_allowed,false);
      return true;
    },
  );
});

test('R9 reconciliation distinguishes missing, exact and divergent final state without inventing effect certainty',async()=>{
  const file='/tmp/rsi-reconcile.json';
  const state={schema:'fixture.v1',value:'exact'};
  const bytes=Buffer.from(`${JSON.stringify(state)}\n`,'utf8');
  const expectedState=stateDigest(state);
  const expectedFile=sha256Bytes(bytes);

  const missing=fakeIo();
  const ambiguousMissing=await reconcileRsiDurableJsonState({
    file_path:file,
    expected_state_digest:expectedState,
    expected_file_digest:expectedFile,
    io:missing,
  });
  assert.equal(ambiguousMissing.state,'AMBIGUOUS_MISSING_FINAL');
  assert.equal(ambiguousMissing.rename_may_have_completed,true);
  assert.equal(ambiguousMissing.no_effect_proven,false);
  assert.equal(ambiguousMissing.reconciliation_required,true);
  assert.equal(ambiguousMissing.new_attempt_allowed,false);

  const preRenameButUnknownAbsence=await reconcileRsiDurableJsonState({
    file_path:file,
    expected_state_digest:expectedState,
    expected_file_digest:expectedFile,
    rename_may_have_completed:false,
    io:missing,
  });
  assert.equal(preRenameButUnknownAbsence.state,'AMBIGUOUS_MISSING_FINAL');
  assert.equal(preRenameButUnknownAbsence.no_effect_proven,false);
  assert.equal(preRenameButUnknownAbsence.new_attempt_allowed,false);

  const none=await reconcileRsiDurableJsonState({
    file_path:file,
    expected_state_digest:expectedState,
    expected_file_digest:expectedFile,
    rename_may_have_completed:false,
    missing_final_proves_no_effect:true,
    io:missing,
  });
  assert.equal(none.state,'NO_EFFECT_PROVEN');
  assert.equal(none.missing_final_proves_no_effect,true);
  assert.equal(none.no_effect_proven,true);
  assert.equal(none.new_attempt_allowed,true);

  const exact=fakeIo();
  exact.files.set(path.resolve(file),bytes);
  const confirmed=await reconcileRsiDurableJsonState({
    file_path:file,
    expected_state_digest:expectedState,
    expected_file_digest:expectedFile,
    io:exact,
  });
  assert.equal(confirmed.state,'CONFIRMED_EXACT_READBACK');
  assert.equal(confirmed.exact_readback_match,true);

  const drift=fakeIo();
  drift.files.set(path.resolve(file),Buffer.from('{"schema":"fixture.v1","value":"drift"}\n','utf8'));
  const ambiguous=await reconcileRsiDurableJsonState({
    file_path:file,
    expected_state_digest:expectedState,
    expected_file_digest:expectedFile,
    io:drift,
  });
  assert.equal(ambiguous.state,'AMBIGUOUS_READBACK');
  assert.equal(ambiguous.reconciliation_required,true);
  assert.equal(ambiguous.new_attempt_allowed,false);
});

test('R9 durability-only qualification never replays the rename or logical write',async()=>{
  const file='/tmp/rsi-qualify-existing.json';
  const state={schema:'fixture.v1',value:'qualify'};
  const bytes=Buffer.from(`${JSON.stringify(state)}\n`,'utf8');
  const io=fakeIo();
  io.files.set(path.resolve(file),bytes);

  const receipt=await qualifyRsiDurableJsonState({
    file_path:file,
    expected_state_digest:stateDigest(state),
    expected_file_digest:sha256Bytes(bytes),
    io,
    platform:'linux',
  });

  assert.equal(receipt.state,'DURABILITY_QUALIFIED_EXISTING_FINAL');
  assert.equal(receipt.exact_readback_match,true);
  assert.equal(receipt.logical_write_performed,false);
  assert.equal(receipt.rename_replayed,false);
  assert.equal(receipt.final_file_sync_completed,true);
  assert.equal(receipt.parent_directory_sync_completed,true);
  assert.equal(receipt.power_loss_durability_claimed,false);
  assert.ok(!io.operations.includes('rename'));
  assert.ok(!io.operations.includes('open:temp'));
  assert.ok(!io.operations.includes('write:temp'));
});

test('R9 durability-only qualification blocks without exact predecessor readback',async()=>{
  const file='/tmp/rsi-qualify-drift.json';
  const expected={schema:'fixture.v1',value:'expected'};
  const io=fakeIo();
  io.files.set(path.resolve(file),Buffer.from('{"schema":"fixture.v1","value":"drift"}\n','utf8'));

  const receipt=await qualifyRsiDurableJsonState({
    file_path:file,
    expected_state_digest:stateDigest(expected),
    expected_file_digest:sha256Bytes(Buffer.from(`${JSON.stringify(expected)}\n`,'utf8')),
    io,
    platform:'linux',
  });

  assert.equal(receipt.state,'DURABILITY_QUALIFICATION_BLOCKED');
  assert.equal(receipt.prerequisite_state,'AMBIGUOUS_READBACK');
  assert.equal(receipt.logical_write_performed,false);
  assert.equal(receipt.rename_replayed,false);
  assert.equal(receipt.new_attempt_allowed,false);
  assert.equal(receipt.reconciliation_required,true);
  assert.ok(!io.operations.includes('rename'));
});

test('R9 actual filesystem persistence survives close and reload while keeping power-loss claims conservative',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-durable-state-'));
  const file=path.join(root,'state.json');
  try{
    const state={schema:'fixture.v1',version:1,value:'actual-fs'};
    const receipt=await persistRsiDurableJsonState({
      file_path:file,
      state,
      platform:process.platform,
    });
    const parsed=JSON.parse(await fs.readFile(file,'utf8'));
    assert.deepEqual(parsed,state);
    assert.equal(receipt.readback_digest_verified,true);
    assert.equal(receipt.power_loss_durability_claimed,false);
  }finally{
    await fs.rm(root,{recursive:true,force:true});
  }
});

test('R9 durable persistence trust root encodes crash ambiguity and refuses unsupported durability claims',()=>{
  const root=rsiDurableStatePersistenceTrustRootSnapshot();
  assert.equal(root.temp_and_final_same_directory_required,true);
  assert.equal(root.temp_file_sync_before_rename_required,true);
  assert.equal(root.final_file_sync_after_rename_required,true);
  assert.equal(root.posix_parent_directory_sync_required,true);
  assert.equal(root.exact_final_readback_required,true);
  assert.equal(root.post_rename_failure_is_ambiguous,true);
  assert.equal(root.post_rename_failure_reconciliation_only,true);
  assert.equal(root.missing_final_after_possible_rename_is_ambiguous,true);
  assert.equal(root.missing_final_alone_never_proves_no_effect,true);
  assert.equal(root.no_effect_requires_explicit_pre_rename_and_absence_semantics,true);
  assert.equal(root.durability_only_qualification_requires_exact_readback,true);
  assert.equal(root.durability_only_qualification_replays_rename,false);
  assert.equal(root.same_attempt_retry_allowed,false);
  assert.equal(root.windows_write_through_rename_claimed,false);
  assert.equal(root.windows_rename_metadata_durability_claimed,false);
  assert.equal(root.power_loss_durability_claimed,false);
  assert.equal(root.second_lifecycle_authority_created,false);
  assert.equal(root.authority_effect,false);
});
