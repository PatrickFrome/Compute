import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewW81WindowsNativeAclTap,W81_REQUIRED_WINDOWS_ACL_CASES as REQUIRED}
  from './client-current-acl-critic-w81.mjs';
const sha='a'.repeat(40);
const goodTap=()=>Object.values(REQUIRED).map((name,i)=>`ok ${i+1} - ${name}`).join('\n')+'\n';
const witness=()=>({platform:'win32',expected_sha:sha,checked_out_sha:sha,
  clean_checkout:true,tap:goodTap()});
test('a fully executed native TAP stays REVIEW_REQUIRED, never installed proof',()=>{
  const r=reviewW81WindowsNativeAclTap(witness());
  assert.equal(r.state,'REVIEW_REQUIRED');
  assert.equal(Object.keys(r.gates).length,Object.keys(REQUIRED).length);
  for(const gate of Object.values(r.gates))assert.equal(gate,'PASS');
  for(const k of ['original_report_verified','source_accepted','installed_owner_proven',
    'physical_pg_restore_proven','can_merge','can_install','live_accepted',
    'authority_effect','automatic_retry_allowed','hosted_fallback_allowed'])
    assert.equal(r[k],false,k);
});
test('privilege skip is explicitly UNKNOWN even if hardlink and junction physically PASS',()=>{
  const x=witness();
  x.tap=x.tap.replace('ok 6 - '+REQUIRED.file_symlink,
    'ok 6 - '+REQUIRED.file_symlink+' # SKIP No symlink privilege');
  const r=reviewW81WindowsNativeAclTap(x);
  assert.equal(r.state,'BLOCKED');
  assert.equal(r.gates.file_symlink,'SKIPPED');
  assert.equal(r.gates.hardlink_file_id,'PASS');
  assert.equal(r.gates.junction_root,'PASS');
  assert.ok(r.reasons.includes('PRIVILEGED_SYMLINK_PROOF_UNKNOWN'));
});
test('unrelated Linux green, mismatched source, duplicate/missing/failed negative block',()=>{
  for(const mutate of [
    x=>x.platform='linux',
    x=>x.checked_out_sha='b'.repeat(40),
    x=>x.clean_checkout=false,
    x=>x.tap=x.tap.replace('ok 3 - ','not ok 3 - '),
    x=>x.tap=x.tap.replace('ok 1 - '+REQUIRED.positive_ntfs+'\n',''),
    x=>x.tap+=`ok 99 - ${REQUIRED.hardlink_file_id}\n`,
  ]){
    const x=witness();mutate(x);
    const r=reviewW81WindowsNativeAclTap(x);
    assert.equal(r.state,'BLOCKED',JSON.stringify(r));
    assert.equal(r.source_accepted,false);
  }
});
test('fabricated PASS strings, oversized evidence and malformed input cannot attest',()=>{
  for(const x of [null,'PASS',{},[],{...witness(),tap:'PASS'},{
    ...witness(),tap:'x'.repeat(2_000_001)
  }]){
    const r=reviewW81WindowsNativeAclTap(x);
    assert.equal(r.state,'BLOCKED');
    assert.equal(r.installed_owner_proven,false);
  }
});
