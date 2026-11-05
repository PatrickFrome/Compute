// INERT behavioral regression on an isolated synthetic userData directory.
// Run against the independently verified e30 Git tree (90fa5633d7926dd...).
// e30 already guards DP-01; precisely one winner must be observed.
// No production code or installed profile, DB, service, installer or listener is accessed.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const {beginSelfUpdateTransaction, readSelfUpdateTransaction} = await import(
  pathToFileURL(path.join(root, 'apps/metaengine-browser/src/self-update-transaction-journal.mjs')).href);

function fakeReceipt() {
  return {version:'0.0.0-fixture-next', available_version:'0.0.0-fixture-next',
    metadata_verified:true, restart_gate_safe:true, authority_effect:false};
}

test('concurrent first begins cannot both claim one durable PREPARED attempt', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'me-inert-begin-regression-'));
  t.after(() => fs.rm(temporary, {recursive:true,force:true}));
  // Multiple isolated rounds exercise the original begin under concurrent calls.
  // Never use the real Electron userData path.
  for (let i=0; i<16; i++) {
    const userData = path.join(temporary, 'case-'+i);
    await fs.mkdir(userData);
    const app={getPath(name) {assert.equal(name,'userData');return userData;},
      getVersion(){return '0.0.0-fixture-prev';}};
    const settled = await Promise.allSettled([
      beginSelfUpdateTransaction(app,fakeReceipt()),
      beginSelfUpdateTransaction(app,fakeReceipt()),
    ]);
    const fulfilled=settled.filter(x=>x.status==='fulfilled');
    const journal=await readSelfUpdateTransaction(app);
    assert.equal(journal?.state,'PREPARED');
    assert.equal(journal?.automatic_retry_allowed,false);
    assert.equal(fulfilled.length,1,
      'two begin calls both succeeded; a previously granted attempt can be lost');
    assert.equal(journal.transaction_id,fulfilled[0].value.transaction_id,
      'journal differs from the only granted transaction');
  }
});
