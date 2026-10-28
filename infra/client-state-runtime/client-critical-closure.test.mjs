import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync,spawnSync} from 'node:child_process';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
const read=p=>fs.readFileSync(new URL(p,new URL('../../',import.meta.url)),'utf8');
const manifest=JSON.parse(read('coordination/operator-control/client-critical-closure.manifest.json'));

function assertCommittedAuditPrefix(repository,parent,current,file) {
 // Compare entire canonical Git blobs, including trailing whitespace/newlines.
 // Checkout EOL conversion is handled by Git, never by normalizing proof bytes.
 const bytes=revision=>execFileSync('git',['-C',repository,'show',revision+':'+file]);
 const previous=bytes(parent),next=bytes(current);
 assert.ok(next.length>=previous.length&&next.subarray(0,previous.length).equals(previous),
  'all dated predecessor audit records remain byte-exact in committed history');
}

test('real autocrlf checkout preserves canonical append-only history and rejects committed prior-record mutations',()=>{
 const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'metaengine-audit-history-'));
 const run=(...args)=>execFileSync('git',['-C',fixture,...args],{stdio:['ignore','pipe','pipe']});
 const text=(...args)=>run(...args).toString('utf8').trim();
 const auditPath='audit.md';
 const evidencePath='evidence/audits/metaengine-20261026-package-source-successor/live-artifact-observation.json';
 const previous='# Dated record\n\nRetained record.  \n\n';
 const suffix='## Prepared successor\n\nNew record.\n';
 const commit=message=>{run('add','--all');run('-c','user.name=Source contract fixture',
  '-c','user.email=source-contract-fixture@invalid','commit','--quiet','--no-gpg-sign','-m',message);return text('rev-parse','HEAD');};
 try {
  run('init','--quiet');
  run('config','core.autocrlf','true');
  fs.mkdirSync(path.join(fixture,'empty-hooks'));
  run('config','core.hooksPath',path.join(fixture,'empty-hooks'));
  fs.writeFileSync(path.join(fixture,'.gitattributes'),read('.gitattributes'));
  fs.writeFileSync(path.join(fixture,auditPath),previous);
  fs.mkdirSync(path.dirname(path.join(fixture,evidencePath)),{recursive:true});
  const observation=fs.readFileSync(path.join(root,evidencePath));
  fs.writeFileSync(path.join(fixture,evidencePath),observation);
  const parent=commit('retain exact dated record');
  fs.writeFileSync(path.join(fixture,auditPath),previous+suffix);
  const successor=commit('append successor record');
  fs.unlinkSync(path.join(fixture,auditPath));
  fs.unlinkSync(path.join(fixture,evidencePath));
  run('checkout','HEAD','--',auditPath,evidencePath);
  const checkedOut=fs.readFileSync(path.join(fixture,auditPath));
  const canonical=run('show','HEAD:'+auditPath);
  assert.ok(checkedOut.includes(Buffer.from('\r\n')),'positive control: Git actually materialized CRLF');
  assert.ok(!canonical.includes(Buffer.from('\r\n')),'Git blob retains canonical LF');
  assert.notDeepEqual(checkedOut,canonical,'the test must exercise real checkout conversion');
  assertCommittedAuditPrefix(fixture,parent,'HEAD',auditPath);
  assert.equal(text('hash-object',auditPath),text('rev-parse','HEAD:'+auditPath),'Git-filtered worktree seal stays exact');
  const observedCheckout=fs.readFileSync(path.join(fixture,evidencePath));
  assert.ok(!observedCheckout.includes(Buffer.from('\r\n')),'only byte-hashed observation is explicitly LF-pinned');
  assert.deepEqual(observedCheckout,observation,'raw evidence hash must survive checkout without proof-byte normalization');

  fs.writeFileSync(path.join(fixture,auditPath),previous+suffix.replace('New record.','Uncommitted mutation.'));
  assertCommittedAuditPrefix(fixture,parent,'HEAD',auditPath);
  assert.throws(()=>assert.equal(text('hash-object',auditPath),text('rev-parse','HEAD:'+auditPath)),
   {code:'ERR_ASSERTION'},'the separate worktree seal still rejects uncommitted mutation');
  run('checkout',successor,'--',auditPath);

  for(const mutated of [
   previous.replace('Retained record.','Changed record.')+suffix,
   previous.replace('record.  \n','record.\n')+suffix,
   previous.slice(0,-1)+suffix,
  ]) {
   fs.writeFileSync(path.join(fixture,auditPath),mutated);
   commit('negative prior-record mutation');
   assert.throws(()=>assertCommittedAuditPrefix(fixture,parent,'HEAD',auditPath),
    {code:'ERR_ASSERTION'},'committed record content, trailing whitespace and final newline must remain exact');
  }
 } finally {
  fs.rmSync(fixture,{recursive:true,force:true});
 }
});

function assertCurrentSourceCandidate(candidate, observedVersion, parentVersion) {
 const fixed={
  classification:'SOURCE_ONLY_NO_CURRENT_PACKAGE',
  branch:'work/autonomy-continuation-20261026',
  source_parent:'ea405d926568508eac53ebb408e941c94faeadcf',
  package_version:'0.7.0-dev.2257027431866.1',
  historical_package_version:'0.7.0-dev.202610152359.1',
  package_build_authorized:false,
  package_version_reuse_authorized:false,
  prior_artifacts_qualify_current_source:false,
  ci_qualification:false,
  installed_qualification:'NOT_QUALIFIED',
  production_ready:false,
  installed_mutation_authorized:false,
  promotion_authorized:false,
  automatic_effect_retry_allowed:false,
  authority_effect:false,
 };
 assert.deepEqual(candidate,fixed,'current source identity and qualification boundary');
 assert.equal(observedVersion,candidate.package_version,'current package identity drift');
 const previous=manifest.previous_package_transitions;
 assert.deepEqual(previous,[
  {
    "schema": "metaengine.client.package-version-successor.v1",
    "source_parent": "104d4b0a0d5e0bc1dce0eefcad9f75a81214974f",
    "baseline_source_parent": "ea405d926568508eac53ebb408e941c94faeadcf",
    "prior_version": "0.7.0-dev.876000886467.1",
    "distinct_version": "0.7.0-dev.875758155169.1",
    "preceding_version_burned": true,
    "production_ready": false,
    "promotion_authorized": false,
    "authority_effect": false
  },
  {
    "schema": "metaengine.client.package-version-successor.v1",
    "source_parent": "314c2a15bbb092864550500974b5134a7940c34a",
    "baseline_source_parent": "ea405d926568508eac53ebb408e941c94faeadcf",
    "prior_version": "0.7.0-dev.875758155169.1",
    "distinct_version": "0.7.0-dev.870171998070.1",
    "preceding_version_burned": true,
    "production_ready": false,
    "promotion_authorized": false,
    "authority_effect": false
  },
  {
    "schema": "metaengine.client.package-version-successor.v1",
    "source_parent": "234d3a9e1ed7b139ed229fa5cf998678a76607b7",
    "baseline_source_parent": "ea405d926568508eac53ebb408e941c94faeadcf",
    "prior_version": "0.7.0-dev.870171998070.1",
    "distinct_version": "0.7.0-dev.864629885843.1",
    "preceding_version_burned": true,
    "production_ready": false,
    "promotion_authorized": false,
    "authority_effect": false
  },
  {
    "schema": "metaengine.client.package-version-successor.v1",
    "source_parent": "adcd58073377fa4276330c5046b42458116e4dac",
    "baseline_source_parent": "ea405d926568508eac53ebb408e941c94faeadcf",
    "prior_version": "0.7.0-dev.864629885843.1",
    "distinct_version": "0.7.0-dev.1107139874568.1",
    "preceding_version_burned": true,
    "production_ready": false,
    "promotion_authorized": false,
    "authority_effect": false
  },
  {
    "schema": "metaengine.client.package-version-successor.v1",
    "source_parent": "980bd4bff7aa016c738dac9ce52269e3a1e36830",
    "baseline_source_parent": "ea405d926568508eac53ebb408e941c94faeadcf",
    "prior_version": "0.7.0-dev.1107139874568.1",
    "distinct_version": "0.7.0-dev.1107139874569.1",
    "preceding_version_burned": true,
    "production_ready": false,
    "promotion_authorized": false,
    "authority_effect": false
  },
  {
    "schema": "metaengine.client.package-version-successor.v1",
    "source_parent": "231fcf02e5c51fb1d22fd98b2deb05df4b934009",
    "baseline_source_parent": "ea405d926568508eac53ebb408e941c94faeadcf",
    "prior_version": "0.7.0-dev.1107139874569.1",
    "distinct_version": "0.7.0-dev.1107139874570.1",
    "preceding_version_burned": true,
    "production_ready": false,
    "promotion_authorized": false,
    "authority_effect": false
  },
  {
    "schema": "metaengine.client.package-version-successor.v1",
    "source_parent": "a9c863b82535e39ed60db85227ccca57658fcf7e",
    "baseline_source_parent": "ea405d926568508eac53ebb408e941c94faeadcf",
    "prior_version": "0.7.0-dev.1107139874570.1",
    "distinct_version": "0.7.0-dev.1107139874571.1",
    "preceding_version_burned": true,
    "production_ready": false,
    "promotion_authorized": false,
    "authority_effect": false
  },
  {
    "schema": "metaengine.client.package-version-successor.v1",
    "source_parent": "b18054e1489af8c433692533dd1e87fde7c8a49c",
    "baseline_source_parent": "ea405d926568508eac53ebb408e941c94faeadcf",
    "prior_version": "0.7.0-dev.1107139874571.1",
    "distinct_version": "0.7.0-dev.1107139874572.1",
    "preceding_version_burned": true,
    "production_ready": false,
    "promotion_authorized": false,
    "authority_effect": false
  },
  {
    "schema": "metaengine.client.package-version-successor.v1",
    "source_parent": "6809eff4d8428274b72309b90aaac742ca19f134",
    "baseline_source_parent": "ea405d926568508eac53ebb408e941c94faeadcf",
    "prior_version": "0.7.0-dev.1107139874572.1",
    "distinct_version": "0.7.0-dev.1107139874573.1",
    "preceding_version_burned": true,
    "production_ready": false,
    "promotion_authorized": false,
    "authority_effect": false
  },
  {
    "schema": "metaengine.client.package-version-successor.v1",
    "source_parent": "dbff3714d22761d4a8a849317ef37db25e73be97",
    "baseline_source_parent": "ea405d926568508eac53ebb408e941c94faeadcf",
    "prior_version": "0.7.0-dev.1107139874573.1",
    "distinct_version": "0.7.0-dev.1107139874574.1",
    "preceding_version_burned": true,
    "production_ready": false,
    "promotion_authorized": false,
    "authority_effect": false
  },
  {
    "schema": "metaengine.client.package-version-successor.v1",
    "source_parent": "ea400b9fdac32b328a64f53f6b0b351b04d930b2",
    "baseline_source_parent": "ea405d926568508eac53ebb408e941c94faeadcf",
    "prior_version": "0.7.0-dev.1107139874574.1",
    "distinct_version": "0.7.0-dev.1107139874575.1",
    "preceding_version_burned": true,
    "production_ready": false,
    "promotion_authorized": false,
    "authority_effect": false
  },
  {
    "schema": "metaengine.client.package-version-successor.v1",
    "source_parent": "fac1b07f600ff1bcaf17bb0c6d2ecd64bd7eac4f",
    "baseline_source_parent": "ea405d926568508eac53ebb408e941c94faeadcf",
    "prior_version": "0.7.0-dev.1107139874575.1",
    "distinct_version": "0.7.0-dev.1107139874576.1",
    "preceding_version_burned": true,
    "production_ready": false,
    "promotion_authorized": false,
    "authority_effect": false
  },
  {
    "schema": "metaengine.client.package-version-successor.v1",
    "source_parent": "04ace552bcde49d0d720038e82ef81d97ca10333",
    "baseline_source_parent": "ea405d926568508eac53ebb408e941c94faeadcf",
    "prior_version": "0.7.0-dev.1107139874576.1",
    "distinct_version": "0.7.0-dev.1107139874577.1",
    "preceding_version_burned": true,
    "production_ready": false,
    "promotion_authorized": false,
    "authority_effect": false
  },
  {
    "schema": "metaengine.client.package-version-successor.v1",
    "source_parent": "6d138c8a8e07ffef7e67f33eb3e0a175631d41a9",
    "baseline_source_parent": "ea405d926568508eac53ebb408e941c94faeadcf",
    "prior_version": "0.7.0-dev.1107139874577.1",
    "distinct_version": "0.7.0-dev.1107139874578.1",
    "preceding_version_burned": true,
    "production_ready": false,
    "promotion_authorized": false,
    "authority_effect": false
  },
  {
    "schema": "metaengine.client.package-version-successor.v1",
    "source_parent": "59808ca48ee0d832baf39d64fff48216f1742873",
    "baseline_source_parent": "ea405d926568508eac53ebb408e941c94faeadcf",
    "prior_version": "0.7.0-dev.1107139874578.1",
    "distinct_version": "0.7.0-dev.1107139874579.1",
    "preceding_version_burned": true,
    "production_ready": false,
    "promotion_authorized": false,
    "authority_effect": false
  },
  {
    "schema": "metaengine.client.package-version-successor.v1",
    "source_parent": "e5f081ba724ffe7dc33bf4ab97f15b4375bbe526",
    "baseline_source_parent": "ea405d926568508eac53ebb408e941c94faeadcf",
    "prior_version": "0.7.0-dev.1107139874579.1",
    "distinct_version": "0.7.0-dev.1107139874580.1",
    "preceding_version_burned": true,
    "production_ready": false,
    "promotion_authorized": false,
    "authority_effect": false
  },
  {
    "schema": "metaengine.client.package-version-successor.v1",
    "source_parent": "7abe627b12c2c2054d51980b0524239fcc25d8a8",
    "baseline_source_parent": "ea405d926568508eac53ebb408e941c94faeadcf",
    "prior_version": "0.7.0-dev.1107139874580.1",
    "distinct_version": "0.7.0-dev.1107139874581.1",
    "preceding_version_burned": true,
    "production_ready": false,
    "promotion_authorized": false,
    "authority_effect": false
  },
  {
    "schema": "metaengine.client.package-version-successor.v1",
    "source_parent": "40c1aa85a007d13127a05db21f5f6947253ac40d",
    "baseline_source_parent": "ea405d926568508eac53ebb408e941c94faeadcf",
    "prior_version": "0.7.0-dev.1107139874581.1",
    "distinct_version": "0.7.0-dev.1107139874582.1",
    "preceding_version_burned": true,
    "production_ready": false,
    "promotion_authorized": false,
    "authority_effect": false
  },
  {
    "schema": "metaengine.client.package-version-successor.v1",
    "source_parent": "c2a45d82fecab447c318b4dca027c16d5970f997",
    "baseline_source_parent": "ea405d926568508eac53ebb408e941c94faeadcf",
    "prior_version": "0.7.0-dev.1107139874582.1",
    "distinct_version": "0.7.0-dev.1107139874583.1",
    "preceding_version_burned": true,
    "production_ready": false,
    "promotion_authorized": false,
    "authority_effect": false
  },
  {
    "schema": "metaengine.client.package-version-successor.v1",
    "source_parent": "421bfce64d71ffbc5a916b22c89eae86a2a7a538",
    "baseline_source_parent": "ea405d926568508eac53ebb408e941c94faeadcf",
    "prior_version": "0.7.0-dev.1107139874583.1",
    "distinct_version": "0.7.0-dev.1107139874584.1",
    "preceding_version_burned": true,
    "production_ready": false,
    "promotion_authorized": false,
    "authority_effect": false
  },
  {
    "schema": "metaengine.client.package-version-successor.v1",
    "source_parent": "c5f3f7d3416b6e599829911c8c19923ccc3a2c7e",
    "baseline_source_parent": "ea405d926568508eac53ebb408e941c94faeadcf",
    "prior_version": "0.7.0-dev.1107139874584.1",
    "distinct_version": "0.7.0-dev.1107139874585.1",
    "preceding_version_burned": true,
    "production_ready": false,
    "promotion_authorized": false,
    "authority_effect": false
  },
  {
    "schema": "metaengine.client.package-version-successor.v1",
    "source_parent": "179df86c8e882d2866a2fcdb3bcae1158b12951e",
    "baseline_source_parent": "ea405d926568508eac53ebb408e941c94faeadcf",
    "prior_version": "0.7.0-dev.1107139874585.1",
    "distinct_version": "0.7.0-dev.1107139874586.1",
    "preceding_version_burned": true,
    "production_ready": false,
    "promotion_authorized": false,
    "authority_effect": false
  },
  {
    "schema": "metaengine.client.package-version-successor.v1",
    "source_parent": "56a745dcc4c38ac072b25740c43530931e1ee1c0",
    "baseline_source_parent": "ea405d926568508eac53ebb408e941c94faeadcf",
    "prior_version": "0.7.0-dev.1107139874586.1",
    "distinct_version": "0.7.0-dev.1107139874587.1",
    "preceding_version_burned": true,
    "production_ready": false,
    "promotion_authorized": false,
    "authority_effect": false
  },
  {
    "schema": "metaengine.client.package-version-successor.v1",
    "source_parent": "72e66165f6f8a59196371ba1ff16feaecbb7a521",
    "baseline_source_parent": "ea405d926568508eac53ebb408e941c94faeadcf",
    "prior_version": "0.7.0-dev.1107139874587.1",
    "distinct_version": "0.7.0-dev.1107139874588.1",
    "preceding_version_burned": true,
    "production_ready": false,
    "promotion_authorized": false,
    "authority_effect": false
  },
  {
    "schema": "metaengine.client.package-version-successor.v1",
    "source_parent": "ef9266faee3eaf3151af203b7bf48c0d85abbdd3",
    "baseline_source_parent": "ea405d926568508eac53ebb408e941c94faeadcf",
    "prior_version": "0.7.0-dev.1107139874588.1",
    "distinct_version": "0.7.0-dev.1107139874590.1",
    "preceding_version_burned": true,
    "production_ready": false,
    "promotion_authorized": false,
    "authority_effect": false
  },
  {
    "schema": "metaengine.client.package-version-successor.v1",
    "source_parent": "04bffffb1b7f2950d61ae3a15de7d7bc5886fd6b",
    "baseline_source_parent": "ea405d926568508eac53ebb408e941c94faeadcf",
    "prior_version": "0.7.0-dev.1107139874590.1",
    "distinct_version": "0.7.0-dev.1107139874591.1",
    "preceding_version_burned": true,
    "production_ready": false,
    "promotion_authorized": false,
    "authority_effect": false
  },
  {
    "schema": "metaengine.client.package-version-successor.v1",
    "source_parent": "a32b2134d44453112046bc721dd0f8f132ad7b67",
    "baseline_source_parent": "ea405d926568508eac53ebb408e941c94faeadcf",
    "prior_version": "0.7.0-dev.1107139874591.1",
    "distinct_version": "0.7.0-dev.1107139874592.1",
    "preceding_version_burned": true,
    "production_ready": false,
    "promotion_authorized": false,
    "authority_effect": false
  },
  {
    "schema": "metaengine.client.package-version-successor.v1",
    "source_parent": "c701285db0b2650d5b53d327c1e728753af52214",
    "baseline_source_parent": "ea405d926568508eac53ebb408e941c94faeadcf",
    "prior_version": "0.7.0-dev.1107139874592.1",
    "distinct_version": "0.7.0-dev.1107139874593.1",
    "preceding_version_burned": true,
    "production_ready": false,
    "promotion_authorized": false,
    "authority_effect": false
  },
  {
    "schema": "metaengine.client.package-version-successor.v1",
    "source_parent": "f952ea2cc9ac355459f8afc95d1e30f0e72ff720",
    "baseline_source_parent": "ea405d926568508eac53ebb408e941c94faeadcf",
    "prior_version": "0.7.0-dev.1107139874593.1",
    "distinct_version": "0.7.0-dev.1107139874594.1",
    "preceding_version_burned": true,
    "production_ready": false,
    "promotion_authorized": false,
    "authority_effect": false
  },
  {
    "schema": "metaengine.client.package-version-successor.v1",
    "source_parent": "88eb062b09bd456d430bd0da37cb21baaddcee6d",
    "baseline_source_parent": "ea405d926568508eac53ebb408e941c94faeadcf",
    "prior_version": "0.7.0-dev.1107139874594.1",
    "distinct_version": "0.7.0-dev.1359740117434.1",
    "preceding_version_burned": true,
    "production_ready": false,
    "promotion_authorized": false,
    "authority_effect": false
  },
  {
    "schema": "metaengine.client.package-version-successor.v1",
    "source_parent": "4b1b0854f918e42494e073f36d96307422617643",
    "baseline_source_parent": "ea405d926568508eac53ebb408e941c94faeadcf",
    "prior_version": "0.7.0-dev.1359740117434.1",
    "distinct_version": "0.7.0-dev.1485366478478.1",
    "preceding_version_burned": true,
    "production_ready": false,
    "promotion_authorized": false,
    "authority_effect": false
  },
  {
    "schema": "metaengine.client.package-version-successor.v1",
    "source_parent": "c784151343015a1d93f84ac8a8eae8a4b453a0bb",
    "baseline_source_parent": "ea405d926568508eac53ebb408e941c94faeadcf",
    "prior_version": "0.7.0-dev.1485366478478.1",
    "distinct_version": "0.7.0-dev.1508254192075.1",
    "preceding_version_burned": true,
    "production_ready": false,
    "promotion_authorized": false,
    "authority_effect": false
  },
  {
    "schema": "metaengine.client.package-version-successor.v1",
    "source_parent": "e22178b058065a96d76a76f2c7d29db0a0c87196",
    "baseline_source_parent": "ea405d926568508eac53ebb408e941c94faeadcf",
    "prior_version": "0.7.0-dev.1508254192075.1",
    "distinct_version": "0.7.0-dev.1643171572592.1",
    "preceding_version_burned": true,
    "production_ready": false,
    "promotion_authorized": false,
    "authority_effect": false
  },
  {
    "schema": "metaengine.client.package-version-successor.v1",
    "source_parent": "61e27840c13dda1d3757da603ffb03f20804dd14",
    "baseline_source_parent": "ea405d926568508eac53ebb408e941c94faeadcf",
    "prior_version": "0.7.0-dev.1643171572592.1",
    "distinct_version": "0.7.0-dev.1784381341133.1",
    "preceding_version_burned": true,
    "production_ready": false,
    "promotion_authorized": false,
    "authority_effect": false
  },
  {
    "schema": "metaengine.client.package-version-successor.v1",
    "source_parent": "1da1a74b0e451143da64e2e0e63647ac87212ce5",
    "baseline_source_parent": "ea405d926568508eac53ebb408e941c94faeadcf",
    "prior_version": "0.7.0-dev.1784381341133.1",
    "distinct_version": "0.7.0-dev.1848773682936.1",
    "preceding_version_burned": true,
    "production_ready": false,
    "promotion_authorized": false,
    "authority_effect": false
  },
  {
    "schema": "metaengine.client.package-version-successor.v1",
    "source_parent": "3d6e3b9a5bf4e7ddb5c9dd9cc0fc3d41d73ef320",
    "baseline_source_parent": "ea405d926568508eac53ebb408e941c94faeadcf",
    "prior_version": "0.7.0-dev.1848773682936.1",
    "distinct_version": "0.7.0-dev.1955970210787.1",
    "preceding_version_burned": true,
    "production_ready": false,
    "promotion_authorized": false,
    "authority_effect": false
  },
  {
    "schema": "metaengine.client.package-version-successor.v1",
    "source_parent": "be11be66853c822f0138cbaf899aa203f1312016",
    "baseline_source_parent": "ea405d926568508eac53ebb408e941c94faeadcf",
    "prior_version": "0.7.0-dev.1955970210787.1",
    "distinct_version": "0.7.0-dev.2070820686579.1",
    "preceding_version_burned": true,
    "production_ready": false,
    "promotion_authorized": false,
    "authority_effect": false
  },
  {
    "schema": "metaengine.client.package-version-successor.v1",
    "source_parent": "91a680d813a5bb44c6ab4438fec2ba1bcbe23ee0",
    "baseline_source_parent": "ea405d926568508eac53ebb408e941c94faeadcf",
    "prior_version": "0.7.0-dev.2070820686579.1",
    "distinct_version": "0.7.0-dev.2179244300106.1",
    "preceding_version_burned": true,
    "production_ready": false,
    "promotion_authorized": false,
    "authority_effect": false
  }
]);
 const successor=manifest.current_package_transition;
 assert.deepEqual(successor,{
  "schema": "metaengine.client.package-version-successor.v1",
  "source_parent": "21e439a082d214bb7601d5b43d53bc520058517e",
  "baseline_source_parent": "ea405d926568508eac53ebb408e941c94faeadcf",
  "prior_version": "0.7.0-dev.2179244300106.1",
  "distinct_version": "0.7.0-dev.2257027431866.1",
  "preceding_version_burned": true,
  "production_ready": false,
  "promotion_authorized": false,
  "authority_effect": false
});
 assert.equal(parentVersion,previous[0].prior_version,'baseline source package identity drift');
 for(let index=1;index<previous.length;index++)
  assert.equal(previous[index-1].distinct_version,previous[index].prior_version,'historical successor chain');
 assert.equal(previous.at(-1).distinct_version,successor.prior_version,'current successor chain');
 for(const item of [...previous,successor]) {
  assert.equal(item.baseline_source_parent,'ea405d926568508eac53ebb408e941c94faeadcf','immutable transition baseline');
  assert.equal(JSON.parse(git('show',item.source_parent+':apps/metaengine-browser/package.json')).version,item.prior_version,
   'transition predecessor must contain its asserted package identity');
  assert.equal(spawnSync('git',['-C',root,'merge-base','--is-ancestor',item.source_parent,'HEAD']).status,0,
   'transition predecessor must be a real Git ancestor');
 }
 const lock=JSON.parse(read('apps/metaengine-browser/package-lock.json'));
 assert.equal(lock.version,observedVersion,'lockfile package identity drift');
 assert.equal(lock.packages[''].version,observedVersion,'root lockfile package identity drift');
 assert.equal(candidate.package_version,successor.distinct_version,'new source version drift');
 assert.ok(manifest.burned_versions.includes(parentVersion),'previous physical version must stay burned');
 assert.equal(candidate.historical_package_version,manifest.test_candidate.version);
 assert.notEqual(candidate.package_version,candidate.historical_package_version);
}

function assertFreshVersion(version, burned) {
 const parse=value=>{
  assert.match(value,/^0\.7\.0-dev\.\d+\.1$/);
  return BigInt(value.split('.')[3]);
 };
 const current=parse(version);
 assert.ok(burned.length>0);
 for(const previous of burned) assert.ok(current>parse(previous),'candidate must exceed every consumed reservation');
}

test('prepared source package identity is monotonic across known consumed candidates, not a reservation',()=>{
 const current=manifest.current_source_candidate.package_version;
 assertFreshVersion(current,manifest.burned_versions);
 for(const value of ['0.7.0-dev.1.1','0.7.0-dev.864629885843.1','0.7.0-dev.1107139874567.1',
  '0.7.0-dev.1107139874594.1','0.7.0-dev.1269944506140.1',current]) {
  assert.throws(()=>assertFreshVersion(value,[...manifest.burned_versions,current]),{code:'ERR_ASSERTION'});
 }
});

test('prepared successor burns consumed predecessor and sibling without fabricated sibling ancestry',()=>{
 const predecessor='0.7.0-dev.1359740117434.1';
 const sibling='0.7.0-dev.1269944506140.1';
 const candidate=manifest.current_source_candidate.package_version;
 assert.ok(manifest.burned_versions.includes(predecessor));
 assert.ok(manifest.burned_versions.includes(sibling));
 assert.equal(new Set(manifest.burned_versions).size,manifest.burned_versions.length);
 assert.equal(manifest.burned_versions.includes(candidate),false,'prepared identity is not a consumed reservation');
 assertFreshVersion(candidate,[predecessor,sibling]);
 for(const version of [predecessor,sibling,'0.7.0-dev.1225141128021.1']) {
  assert.throws(()=>assertFreshVersion(version,[predecessor,sibling]),{code:'ERR_ASSERTION'},'reuse or sibling downgrade must fail');
 }
 const transitions=[...manifest.previous_package_transitions,manifest.current_package_transition];
 assert.ok(transitions.every(item=>item.prior_version!==sibling&&item.distinct_version!==sibling),
  'the consumed sibling is not a fictitious source-line transition');
 assert.equal(transitions.find(item=>item.distinct_version==='0.7.0-dev.1485366478478.1').source_parent,'4b1b0854f918e42494e073f36d96307422617643');
 assert.equal(transitions.find(item=>item.distinct_version==='0.7.0-dev.1485366478478.1').prior_version,predecessor);
});

test('critical closure retains all reviewed source parents and the immutable W73 base',()=>{
 assert.equal(manifest.schema,'metaengine.client.critical-closure.v1');
 assert.equal(manifest.repository,'PatrickFrome/Compute');
 assert.equal(manifest.base_w73,'9e8ebcd09b46d0e8f5a09e9a0471d15a190baeea');
 assert.ok(manifest.parent_heads.length>=37);
 assert.equal(new Set(manifest.parent_heads.map(p=>p.pr)).size,manifest.parent_heads.length);
 for(const parent of manifest.parent_heads){
  assert.match(parent.sha,/^[a-f0-9]{40}$/);
  assert.equal(spawnSync('git',['-C',root,'merge-base','--is-ancestor',parent.sha,'HEAD']).status,0,
    'unmerged source parent #'+parent.pr);
 }
});

test('critical closure seals the actual committed source and local worktree bytes',()=>{
 const entries=Object.entries(manifest.current_tree_blobs);
 assert.ok(entries.length>=150);
 for(const [file,blob] of entries){
  assert.ok(!file.startsWith('/')&&!file.includes('..')&&!file.includes('\\'));
  assert.match(blob,/^[a-f0-9]{40}$/);
  assert.equal(git('rev-parse','HEAD:'+file),blob,'stale current commit: '+file);
  assert.equal(git('hash-object',file),blob,'changed local bytes: '+file);
 }
 if(process.env.EXPECTED_SHA)assert.equal(git('rev-parse','HEAD'),process.env.EXPECTED_SHA);
});

test('source closure has no authority to promote installed state or replay historical effects',()=>{
 for(const key of ['authority_effect','promotion_authorized','automatic_retry_allowed','package_version_change_authorized'])
  assert.equal(manifest[key],false,key);
 assert.equal(manifest.no_supabase,true);
 assert.equal(manifest.parent_checks_not_transitive,true);
 for(const level of ['CI','INSTALLED','LIVE'])assert.match(manifest.proof_levels[level],/PENDING|UNKNOWN|NOT_QUALIFIED/);
 assert.deepEqual(manifest.unbound_historical_effects,['W53_AMBIGUOUS_UNKNOWN','HISTORICAL_59_AMBIGUOUS_UNKNOWN']);
 const observed=JSON.parse(read('apps/metaengine-browser/package.json')).version;
 const historical=JSON.parse(git('show',manifest.base_w73+':apps/metaengine-browser/package.json')).version;
 if(manifest.test_candidate){
  const c=manifest.test_candidate;
  assert.equal(c.classification,'ISOLATED_TEST_PACKAGE_ONLY');
  assert.equal(c.source_parent,'49d050ff127e22ca27fbe3514324ba99832afb24');
  assert.equal(c.branch,'work/client-operational-repair-20261015');
  assert.equal(c.version,'0.7.0-dev.202610152359.1');
  assert.equal(c.production_release_authorized,false);
  assert.equal(c.installed_mutation_authorized,false);
  assert.equal(spawnSync('git',['-C',root,'merge-base','--is-ancestor',c.source_parent,'HEAD']).status,0);
  if(!manifest.current_source_candidate)assert.equal(observed,c.version);
  assert.notEqual(c.version,historical);
 }else assert.equal(observed,historical);
 if(manifest.current_source_candidate){
  const c=manifest.current_source_candidate;
  const parentVersion=JSON.parse(git('show',c.source_parent+':apps/metaengine-browser/package.json')).version;
  assertCurrentSourceCandidate(c,observed,parentVersion);
  assert.equal(spawnSync('git',['-C',root,'merge-base','--is-ancestor',c.source_parent,'HEAD']).status,0,
    'current source parent must be a real Git ancestor');
 }
 if(manifest.source_followup){
  const f=manifest.source_followup;
  assert.equal(f.classification,'SOURCE_ONLY_NO_PACKAGE');
  assert.equal(f.package_build_authorized,false);
  assert.equal(f.installed_mutation_authorized,false);
  assert.equal(f.automatic_recovery_authorized,false);
  assert.match(f.source_parent,/^[a-f0-9]{40}$/);
  assert.equal(spawnSync('git',['-C',root,'merge-base','--is-ancestor',f.source_parent,'HEAD']).status,0);
  const predecessorVersion=JSON.parse(git('show',f.source_parent+':apps/metaengine-browser/package.json')).version;
  if(manifest.test_candidate){
   // A later distinct disposable physical candidate is allowed ONLY when the
   // original source-only version is burned, not silently rewritten/reused.
   assert.notEqual(observed,predecessorVersion);
   assert.ok(manifest.burned_versions.includes(predecessorVersion),'source-only parent package identity must be burned');
  }else assert.equal(observed,predecessorVersion);
 }
});

test('current source candidate rejects identity drift and qualification promotion',()=>{
 const candidate=manifest.current_source_candidate;
 assert.ok(candidate,'current source candidate is required on this source line');
 const observed=JSON.parse(read('apps/metaengine-browser/package.json')).version;
 const parentVersion=JSON.parse(git('show',candidate.source_parent+':apps/metaengine-browser/package.json')).version;
 assertCurrentSourceCandidate(candidate,observed,parentVersion);
 for(const change of [
  {classification:'ISOLATED_TEST_PACKAGE_ONLY'},
  {branch:'work/client-operational-repair-20261015'},
  {source_parent:manifest.test_candidate.source_parent},
  {package_version:manifest.test_candidate.version},
  {historical_package_version:observed},
  {package_build_authorized:true},{package_version_reuse_authorized:true},
  {prior_artifacts_qualify_current_source:true},{ci_qualification:true},
  {installed_qualification:'PASS'},{production_ready:true},
  {installed_mutation_authorized:true},{promotion_authorized:true},
  {automatic_effect_retry_allowed:true},{authority_effect:true},
  {unsigned_package_is_trusted:true},
 ])assert.throws(()=>assertCurrentSourceCandidate({...candidate,...change},observed,parentVersion),
   {code:'ERR_ASSERTION'},'must reject '+JSON.stringify(change));
 assert.throws(()=>assertCurrentSourceCandidate(candidate,manifest.test_candidate.version,parentVersion),
   {code:'ERR_ASSERTION'},'historical package bytes cannot qualify current source');
 assert.throws(()=>assertCurrentSourceCandidate(candidate,observed,manifest.test_candidate.version),
   {code:'ERR_ASSERTION'},'source parent package identity must match current source');
});

test('current CI runs the complete Browser and Client suites and preserves physical qualification',()=>{
 const ci=read('.github/workflows/client-source-candidate-w73.yml');
 assert.match(ci,/ubuntu-24\.04, windows-2025/);
 assert.match(ci,/client-critical-closure\.test\.mjs/);
 assert.match(ci,/npm --prefix infra\/client-state-runtime test/);
 assert.match(ci,/--test-concurrency=4 'test\/\*\.test\.mjs'/);
 for(const gate of ['client-host-owner-w74','client-host-owner-w75','client-c2-worker-edit-w80','client-current-native-acl-w72'])
  assert.ok(fs.existsSync(root+'.github/workflows/'+gate+'.yml'));
 assert.match(read('.github/workflows/client-source-candidate-w59.yml'),/client-critical-closure\.manifest\.json/);
 const acl=read('.github/workflows/client-current-native-acl-w72.yml');
 assert.match(acl,/^  push:/m);assert.match(acl,/^  pull_request:/m);
 assert.match(acl,/work\/metaengine-critical-closure-20261015/);
 assert.match(read('.github/workflows/client-wave10-w62-source-r97.yml'),/client-critical-closure\.manifest\.json/);
 const selfUpdate=read('.github/workflows/metaengine-browser-self-update-e2e.yml');
 assert.match(selfUpdate,/if:.*github\.head_ref != 'work\/metaengine-critical-closure-20261015'/);
});


test('QA source sealing retains explicit timing blockers and no installed or promotion authority',()=>{
 const audit=read('coordination/operator-control/AUDIT_CLOSURE_EXECUTION_REGISTER_20261018.md');
 const parseBlocks=source=>{
  const current=source.replace(/\r\n/g,'\n').split('## QA source seal — 0.7.0-dev.1107139874594.1\n')[1];
  assert.ok(current,'current QA source record required');
  return [...current.matchAll(/```json\n([\s\S]*?)\n```/g)].map(match=>JSON.parse(match[1]));
 };
 const blocks=parseBlocks(audit);
 assert.deepEqual(parseBlocks(audit.replace(/\r?\n/g,'\r\n')),blocks,'Windows CRLF audit bytes preserve the same QA boundary');
 assert.deepEqual(blocks[0],{
  "schema": "metaengine.client.qa-source-seal.v1",
  "functional_source_parent": "f952ea2cc9ac355459f8afc95d1e30f0e72ff720",
  "package_version": "0.7.0-dev.1107139874594.1",
  "classification": "QA_SOURCE_PREPARED_NOT_INSTALLED_QUALIFIED",
  "global_version_absence": "UNKNOWN",
  "immutable_producer_preflight_required": true,
  "artifact_qualification": "NOT_ESTABLISHED",
  "known_blockers": [
    "WINDOWS_STATUS_OBSERVE_NATIVE_READ_TIMING",
    "WINDOWS_COLD_BOOT_FIRST_CONTROLLER_SERIAL_TIMING"
  ],
  "installed_qualification": "NOT_QUALIFIED",
  "live_qualification": "NOT_QUALIFIED",
  "continuous_autonomy_qualification": "NOT_QUALIFIED",
  "production_ready": false,
  "promotion_authorized": false,
  "automatic_effect_retry_allowed": false,
  "authority_effect": false
});
 assert.deepEqual(blocks[1],{
  "schema": "metaengine.client.current-seal-retirements.v1",
  "retirements": [
    {
      "path": "apps/metaengine-browser/test/r95-utility-panel-docking.test.mjs",
      "historical_blob": "41e89fbb2c6d453137471c2b9970095fdefbde07",
      "deleted_by": "774af98749338817bbd1b802be089ebc15071e44",
      "retired_scope": "UNMOUNTED_UTILITY_PANEL_DOCK_AND_SPLITTER_IMPLEMENTATION",
      "retained_guards": [
        "apps/metaengine-browser/test/r95c-run-inspector-breakpoint.test.mjs",
        "apps/metaengine-browser/test/r97-single-main-ui-contract.test.mjs",
        "apps/metaengine-browser/test/me2-primary-shell-runtime.test.mjs"
      ],
      "complete_behavioral_equivalence_claimed": false
    },
    {
      "path": "apps/metaengine-browser/test/r95e-command-palette-agent-binding.test.mjs",
      "historical_blob": "87ec8232e36627dfc1069e8560cc6df5629cf1ea",
      "deleted_by": "774af98749338817bbd1b802be089ebc15071e44",
      "retired_scope": "DAEMON_AGENTCHAT_HOOK_AND_OLD_PALETTE_IMPLEMENTATION",
      "retained_guards": [
        "apps/metaengine-browser/test/r97-single-main-ui-contract.test.mjs",
        "apps/metaengine-browser/test/r94-workflow-shell-ia.test.mjs",
        "apps/metaengine-browser/test/r104-tasks-agentchat-quarantine.test.mjs",
        "apps/metaengine-browser/test/browser-critical-audit-ui-coverage.test.mjs"
      ],
      "complete_behavioral_equivalence_claimed": false
    }
  ]
});
 for(const retired of blocks[1].retirements) {
  assert.equal(manifest.current_tree_blobs[retired.path],undefined,'retired test must not claim current bytes');
  assert.equal(fs.existsSync(new URL(retired.path,new URL('../../',import.meta.url))),false);
  assert.equal(git('rev-parse',retired.deleted_by+'^:'+retired.path),retired.historical_blob,'retired evidence must remain independently recoverable');
  for(const guard of retired.retained_guards) assert.match(manifest.current_tree_blobs[guard],/^[a-f0-9]{40}$/,'current replacement boundary must be sealed');
 }
});


test('QA successor preserves exact immutable W43-W73 manifest bytes',()=>{
 const frozen=[
  ['w43','484e9c6b7db6e0ed8abdd625446ee35b7e82e770'],
  ['w51','39252b584976a1a2308eb2868acaa0c4acab8f50'],
  ['w59','22337575525ab196a477abb5bc902709a1fd1437'],
  ['w66','8337b889acb89d6f652c65f1b1ef44d25b17a796'],
  ['w73','f135919d682552bc54f63de8ca392390bbc63557'],
 ];
 for(const [wave,blob] of frozen) {
  const file='coordination/operator-control/client-source-candidate-'+wave+'.manifest.json';
  assert.equal(git('rev-parse','HEAD:'+file),blob,'immutable historical commit bytes: '+wave);
  assert.equal(git('hash-object',file),blob,'immutable historical worktree bytes: '+wave);
 }
});


test('new QA source seal retains time-bound planning evidence and pending exact-source qualification',()=>{
 const parent='88eb062b09bd456d430bd0da37cb21baaddcee6d';
 const auditPath='coordination/operator-control/AUDIT_CLOSURE_EXECUTION_REGISTER_20261018.md';
 const audit=read(auditPath);
 assertCommittedAuditPrefix(root,parent,'HEAD',auditPath);
 const parse=source=>{
  const section=source.replace(/\r\n/g,'\n').split('## QA source seal — 0.7.0-dev.1359740117434.1\n')[1]?.split('\n## ')[0];
  assert.ok(section,'new prepared QA source record required');
  const blocks=[...section.matchAll(/```json\n([\s\S]*?)\n```/g)].map(match=>JSON.parse(match[1]));
  assert.equal(blocks.length,1,'one current QA source record');
  return blocks[0];
 };
 const seal=parse(audit);
 assert.deepEqual(parse(audit.replace(/\r?\n/g,'\r\n')),seal,'new QA boundary also survives Windows CRLF');
 assert.deepEqual(seal,{
  "schema": "metaengine.client.qa-source-seal.v1",
  "functional_source_parent": "88eb062b09bd456d430bd0da37cb21baaddcee6d",
  "package_version": "0.7.0-dev.1359740117434.1",
  "classification": "QA_SOURCE_PREPARED_NOT_INSTALLED_QUALIFIED",
  "global_version_absence": "TIME_BOUND_API_OBSERVATION_ONLY",
  "reservation_state": "PENDING_IMMUTABLE_PRODUCER_PREFLIGHT",
  "metadata_observation_completed_at": "2026-10-26T12:14:11.276Z",
  "metadata_observation_source_head": "88eb062b09bd456d430bd0da37cb21baaddcee6d",
  "minimum_package_version": "0.7.0-dev.1269944506140.1",
  "minimum_package_version_exclusive": true,
  "metadata_observation_path": "evidence/audits/metaengine-20261026-package-source-successor/live-artifact-observation.json",
  "metadata_observation_sha256": "7e5c8c1a1c462fa483690ab7e334e7717dcd9270d52036efc0e8afb74df7a12a",
  "observation_does_not_reserve_version": true,
  "immutable_producer_preflight_required": true,
  "artifact_qualification": "NOT_ESTABLISHED",
  "known_blockers": [
    "EXACT_SUCCESSOR_SOURCE_CI_PENDING",
    "EXACT_WINDOWS_PACKAGE_AND_NATIVE_QUALIFICATION_PENDING",
    "LEGACY_INSTALLED_UPGRADE_QUALIFICATION_HOLD",
    "LIVE_NATIVE_AGENT_AND_CONTINUOUS_AUTONOMY_UNQUALIFIED",
    "PRODUCTION_RELEASE_SIGNING_AND_SIDECAR_PLACEMENT_UNQUALIFIED"
  ],
  "installed_qualification": "NOT_QUALIFIED",
  "live_qualification": "NOT_QUALIFIED",
  "continuous_autonomy_qualification": "NOT_QUALIFIED",
  "production_ready": false,
  "promotion_authorized": false,
  "automatic_effect_retry_allowed": false,
  "authority_effect": false
});
 assert.equal(seal.functional_source_parent,manifest.previous_package_transitions.find(item=>item.distinct_version===seal.package_version).source_parent);
 assert.ok(manifest.previous_package_transitions.some(item=>item.distinct_version===seal.package_version));
 const observedBytes=fs.readFileSync(new URL(seal.metadata_observation_path,new URL('../../',import.meta.url)));
 assert.equal(createHash('sha256').update(observedBytes).digest('hex'),seal.metadata_observation_sha256);
 assert.match(manifest.current_tree_blobs[seal.metadata_observation_path],/^[a-f0-9]{40}$/,'actual metadata evidence is source sealed');
});

function assertReadOnlyPackageObservation(evidence) {
 const source='88eb062b09bd456d430bd0da37cb21baaddcee6d';
 assert.equal(evidence.schema,'metaengine.package-planner-read-only-observation.v1');
 assert.equal(evidence.source_head,source);
 assert.equal(evidence.source_tree,'cc9db3282897bab4670f84e169e06f085a9cb45b');
 assert.equal(evidence.planner_git_blob,git('rev-parse',source+':apps/metaengine-browser/scripts/package-build-reservation.mjs'));
 assert.equal(evidence.observed_producer_run_id,40319327170);
 assert.equal(evidence.observed_producer_run_attempt,1);
 for(const key of ['selected_version','reservation_created','package_built','authority_effect'])assert.equal(evidence[key],false,key);
 assert.equal(evidence.started_at,'2026-10-26T12:14:07.017Z');
 assert.equal(evidence.completed_at,'2026-10-26T12:14:11.276Z');
 assert.deepEqual(evidence.plan,{
  schema:'metaengine.browser.package-identity-candidate-plan.v1',source_head:source,
  manifest_package_version:'0.7.0-dev.1107139874594.1',
  minimum_package_version:'0.7.0-dev.1269944506140.1',minimum_package_version_exclusive:true,
  candidate_package_version:'0.7.0-dev.1359740117434.1',candidate_slot:0,
  rejected_reserved_candidate_versions:[],manifest_update_required:true,
  physical_package_build_allowed:false,promotion_authorized:false,authority_effect:false,
 });
 const expected=[
  ['metaengine-browser-windows-candidate-'+source,0,null,null,null],
  ['metaengine-browser-package-version-0.7.0-dev.1107139874594.1',1,12604992808,40208669264,'602d4b07f755f7cd61a6da3af06985d4384b859a'],
  ['metaengine-browser-package-version-0.7.0-dev.1359740117434.1',0,null,null,null],
  ['metaengine-browser-package-version-0.7.0-dev.1269944506140.1',1,12608018072,40217087847,'cf547d7e5f973517fa9bd1e206892e3a108ad1ea'],
 ];
 assert.equal(evidence.queries.length,expected.length);
 for(let index=0;index<expected.length;index++) {
  const [name,count,id,run,head]=expected[index],query=evidence.queries[index];
  assert.equal(query.url,'https://api.github.com/repos/PatrickFrome/Compute/actions/artifacts?name='+name+'&per_page=100');
  assert.equal(query.method,'GET');assert.equal(query.status,200);assert.equal(query.headers.link,null);
  assert.ok(query.headers['x-github-request-id']);
  assert.ok(query.started_at>=evidence.started_at&&query.completed_at<=evidence.completed_at&&query.completed_at>=query.started_at);
  const body=JSON.parse(query.response_body);
  assert.equal(body.total_count,count);assert.equal(body.artifacts.length,count,'partial or failed response is not absence');
  if(count) {
   assert.equal(body.artifacts[0].name,name);assert.equal(body.artifacts[0].id,id);
   assert.equal(body.artifacts[0].workflow_run.id,run);assert.equal(body.artifacts[0].workflow_run.head_sha,head);
   assert.equal(body.artifacts[0].workflow_run.repository_id,1341371143);
  }
 }
}

test('retained real metadata is advisory only; error, incomplete list and authority laundering fail closed',()=>{
 const evidence=JSON.parse(read('evidence/audits/metaengine-20261026-package-source-successor/live-artifact-observation.json'));
 assertReadOnlyPackageObservation(evidence);
 for(const mutate of [
  e=>{e.queries[0].status=404;},
  e=>{e.queries[0].response_body=JSON.stringify({total_count:1,artifacts:[]});},
  e=>{e.queries[2].url=e.queries[0].url;},
  e=>{e.source_head='a'.repeat(40);},
  e=>{e.plan.physical_package_build_allowed=true;},
  e=>{e.plan.promotion_authorized=true;},
  e=>{e.reservation_created=true;},
  e=>{e.package_built=true;},
  e=>{e.selected_version=true;},
 ]) {
  const changed=structuredClone(evidence);mutate(changed);
  assert.throws(()=>assertReadOnlyPackageObservation(changed),{code:'ERR_ASSERTION'});
 }
});

test('sole-owner successor retains its functional parent and live version observation',()=>{
 const prior='4b1b0854f918e42494e073f36d96307422617643',version='0.7.0-dev.1485366478478.1';
 const evidence=JSON.parse(read('evidence/audits/metaengine-20261026-sole-owner-repair/live-artifact-observation.json'));
 assert.equal(evidence.source_head,prior);assert.equal(evidence.plan.candidate_package_version,version);
 assert.equal(evidence.plan.minimum_package_version,'0.7.0-dev.1359740117434.1');
 assert.equal(evidence.reservation_created,false);assert.equal(evidence.package_built,false);assert.equal(evidence.authority_effect,false);
 assert.equal(evidence.plan.physical_package_build_allowed,false);assert.equal(evidence.plan.promotion_authorized,false);
 for(const q of evidence.queries){assert.equal(q.status,200);const body=JSON.parse(q.response_body);assert.equal(body.total_count,body.artifacts.length);}
 assert.equal(JSON.parse(evidence.queries.at(-1).response_body).total_count,0);
 assert.equal(manifest.previous_package_transitions.find(item=>item.distinct_version===version).source_parent,prior);
 assertCommittedAuditPrefix(root,prior,'HEAD','coordination/operator-control/AUDIT_CLOSURE_EXECUTION_REGISTER_20261018.md');
});


test('seed recovery successor preserves installed predecessor and uses a fresh observed package identity',()=>{
 const prior='c784151343015a1d93f84ac8a8eae8a4b453a0bb',version='0.7.0-dev.1508254192075.1';
 const evidence=JSON.parse(read('evidence/audits/metaengine-20261026-seed-recovery/live-artifact-observation.json'));
 assert.equal(evidence.source_head,prior);assert.equal(evidence.plan.candidate_package_version,version);
 assert.equal(evidence.plan.minimum_package_version,'0.7.0-dev.1485366478478.1');
 assert.equal(evidence.reservation_created,false);assert.equal(evidence.package_built,false);assert.equal(evidence.authority_effect,false);
 assert.equal(evidence.plan.physical_package_build_allowed,false);assert.equal(evidence.plan.promotion_authorized,false);
 for(const q of evidence.queries){assert.equal(q.status,200);const body=JSON.parse(q.response_body);assert.equal(body.total_count,body.artifacts.length);}
 assert.equal(JSON.parse(evidence.queries.at(-1).response_body).total_count,0);
 assert.equal(manifest.previous_package_transitions.find(item=>item.distinct_version===version).source_parent,prior);
 assertCommittedAuditPrefix(root,prior,'HEAD','coordination/operator-control/AUDIT_CLOSURE_EXECUTION_REGISTER_20261018.md');
});


test('Edge health recovery successor binds fresh source and metadata without installed qualification',()=>{
 const prior='e22178b058065a96d76a76f2c7d29db0a0c87196',version='0.7.0-dev.1643171572592.1';
 const evidence=JSON.parse(read('evidence/audits/metaengine-20261026-edge-health-recovery/live-artifact-observation.json'));
 assert.equal(evidence.source_head,prior);assert.equal(evidence.plan.candidate_package_version,version);
 assert.equal(evidence.plan.minimum_package_version,'0.7.0-dev.1508254192075.1');
 assert.equal(evidence.reservation_created,false);assert.equal(evidence.package_built,false);assert.equal(evidence.authority_effect,false);
 assert.equal(evidence.plan.physical_package_build_allowed,false);assert.equal(evidence.plan.promotion_authorized,false);
 for(const q of evidence.queries){assert.equal(q.status,200);const body=JSON.parse(q.response_body);assert.equal(body.total_count,body.artifacts.length);}
 assert.equal(JSON.parse(evidence.queries.at(-1).response_body).total_count,0);
 assert.equal(manifest.previous_package_transitions.find(item=>item.distinct_version===version).source_parent,prior);
 assertCommittedAuditPrefix(root,prior,'HEAD','coordination/operator-control/AUDIT_CLOSURE_EXECUTION_REGISTER_20261018.md');
});


test('Concurrent health observer recovery successor binds fresh source and metadata without installed qualification',()=>{
 const prior='61e27840c13dda1d3757da603ffb03f20804dd14',version='0.7.0-dev.1784381341133.1';
 const evidence=JSON.parse(read('evidence/audits/metaengine-20261026-health-observer-recovery/live-artifact-observation.json'));
 assert.equal(evidence.source_head,prior);assert.equal(evidence.plan.candidate_package_version,version);
 assert.equal(evidence.plan.minimum_package_version,'0.7.0-dev.1643171572592.1');
 assert.equal(evidence.reservation_created,false);assert.equal(evidence.package_built,false);assert.equal(evidence.authority_effect,false);
 assert.equal(evidence.plan.physical_package_build_allowed,false);assert.equal(evidence.plan.promotion_authorized,false);
 for(const q of evidence.queries){assert.equal(q.status,200);const body=JSON.parse(q.response_body);assert.equal(body.total_count,body.artifacts.length);}
 assert.equal(JSON.parse(evidence.queries.at(-1).response_body).total_count,0);
 assert.equal(manifest.previous_package_transitions.find(item=>item.distinct_version===version).source_parent,prior);
 assertCommittedAuditPrefix(root,prior,'HEAD','coordination/operator-control/AUDIT_CLOSURE_EXECUTION_REGISTER_20261018.md');
});

test('pre-install repairs and five-stream task contracts are covered by the current source seal',()=>{
 const required=[
  ".github/prepare-runtime-contract-pg17.mjs",
  "apps/metaengine-browser/test/self-update-failure-readback.mjs",
  "apps/metaengine-browser/test/self-update-failure-readback.pure.test.mjs",
  "apps/metaengine-browser/test/self-update-failure-readback.test.mjs",
  "apps/metaengine-browser/test/self-update-fast-physical-ci.ps1",
  "docs/audits/preinstall-closure-20261027.md",
  "docs/audits/preinstall-devfleet-wave-20261027.json",
  "evidence/audits/metaengine-20261027-preinstall/observed-prior-qualification.json",
  "coordination/operator-control/preinstall-five-streams-20261027.md",
  "coordination/operator-control/preinstall-tasks/metaengine-stream-1-soak.md",
  "coordination/operator-control/preinstall-tasks/metaengine-stream-2-migration.md",
  "coordination/operator-control/preinstall-tasks/metaengine-stream-3-continuity.md",
  "coordination/operator-control/preinstall-tasks/metaengine-stream-4-ui.md"
];
 for(const file of required)assert.match(manifest.current_tree_blobs[file]??'',/^[0-9a-f]{40}$/,file+' must remain source-sealed');
});

function assertIntegratedHostedObservation(evidence) {
 const source='1da1a74b0e451143da64e2e0e63647ac87212ce5';
 const version='0.7.0-dev.1848773682936.1',floor='0.7.0-dev.1784381341133.1';
 assert.equal(evidence.schema,'metaengine.package-planner-retained-hosted-observation.v1');
 assert.equal(evidence.source_head,source);
 assert.equal(evidence.observing_run_id,40468962958);assert.equal(evidence.observing_run_attempt,1);
 assert.equal(evidence.source_ref,'refs/heads/work/integrated-installer-repair-20261027');
 assert.equal(evidence.source_tree,git('rev-parse',source+'^{tree}'));
 assert.equal(evidence.observer_git_blob,git('rev-parse',source+':apps/metaengine-browser/scripts/observe-package-identity.mjs'));
 assert.equal(evidence.planner_git_blob,git('rev-parse',source+':apps/metaengine-browser/scripts/package-build-reservation.mjs'));
 assert.deepEqual(evidence.artifact,{id:12718325310,bytes:1501760,
  sha256:'e4ebfe1ed30be73b5573b613d5e6873e5a73b3e4de04575c04442d0b80524c6c'});
 assert.deepEqual(evidence.catalog,{complete:true,pagination_complete:true,total_count:17944,pages:180,
  consistency:'STABLE_TOTAL_UNIQUE_IDS_AND_FIRST_PAGE_RECHECK',global_absence_claim:false,observation_is_time_bound:true});
 assert.deepEqual(evidence.independent_catalog_recheck,{pages:180,unique_artifacts:17944,
  first_page_equal:true,highest_observed_reserved_version:floor});
 assert.equal(evidence.catalog_payloads_retained_in_ci_artifact,true);
 assert.equal(evidence.post_plan_complete_name_readbacks,true);
 for(const key of ['selected_version','reservation_created','package_built','physical_package_build_allowed',
  'promotion_authorized','authority_effect','automatic_retry_allowed'])assert.equal(evidence[key],false);
 assert.deepEqual(evidence.plan,{schema:'metaengine.browser.package-identity-candidate-plan.v1',source_head:source,
  manifest_package_version:floor,minimum_package_version:floor,minimum_package_version_exclusive:true,
  candidate_package_version:version,candidate_slot:0,rejected_reserved_candidate_versions:[],
  manifest_update_required:true,physical_package_build_allowed:false,promotion_authorized:false,authority_effect:false});
 assert.equal(createHash('sha256').update(JSON.stringify(evidence.plan,null,2)+'\n').digest('hex'),evidence.plan_json_sha256);
 assert.equal(evidence.plan_json_sha256,'6cdc5934e8ef8fdd56d13d9ab1a5ab6ef6c1f8ef8a525a92c65217d2857c5fb0');
 const expected=[['metaengine-browser-windows-candidate-'+source,0],['metaengine-browser-package-version-'+floor,1],
  ['metaengine-browser-package-version-'+version,0]];
 assert.equal(evidence.exact_name_readbacks.length,expected.length);
 for(let i=0;i<expected.length;i++) {
  const [name,count]=expected[i],q=evidence.exact_name_readbacks[i];
  assert.equal(q.url,'https://api.github.com/repos/PatrickFrome/Compute/actions/artifacts?name='+name+'&per_page=100');
  assert.equal(q.method,'GET');assert.equal(q.status,200);assert.equal(q.headers.link,null);
  assert.ok(q.started_at>=evidence.started_at&&q.completed_at<=evidence.completed_at&&q.completed_at>=q.started_at);
  assert.equal(q.response.total_count,count);assert.equal(q.response.artifacts.length,count);
  if(count) {
   const artifact=q.response.artifacts[0];assert.equal(artifact.name,name);assert.equal(artifact.id,12678978941);
   assert.equal(artifact.workflow_run.id,40382079975);
   assert.equal(artifact.workflow_run.head_sha,'601532ca50db02aa9089783dde157a93f484adf2');
   assert.equal(artifact.workflow_run.repository_id,1341371143);
  }
 }
}

test('integrated installer successor retains complete hosted observation without promoting package authority',()=>{
 const file='evidence/audits/metaengine-20261027-integrated-installer/live-artifact-observation.json';
 const bytes=read(file),evidence=JSON.parse(bytes);assertIntegratedHostedObservation(evidence);
 assert.equal(createHash('sha256').update(bytes).digest('hex'),'c51ea81cba4148a7cd7a58669078ee38fcec0799f6af2c93d172dbb14a424550');
 assert.equal(manifest.previous_package_transitions.find(item=>item.distinct_version===evidence.plan.candidate_package_version).source_parent,evidence.source_head);
 assert.ok(manifest.burned_versions.includes(evidence.plan.manifest_package_version));
 assertCommittedAuditPrefix(root,evidence.source_head,'HEAD','coordination/operator-control/AUDIT_CLOSURE_EXECUTION_REGISTER_20261018.md');
 for(const mutate of [e=>{e.catalog.complete=false;},e=>{e.catalog.total_count--;},
  e=>{e.independent_catalog_recheck.unique_artifacts--;},e=>{e.source_head='a'.repeat(40);},
  e=>{e.plan.physical_package_build_allowed=true;},e=>{e.reservation_created=true;},
  e=>{e.exact_name_readbacks[2].response.total_count=1;},e=>{e.exact_name_readbacks[0].status=500;}]) {
  const changed=structuredClone(evidence);mutate(changed);
  assert.throws(()=>assertIntegratedHostedObservation(changed),{code:'ERR_ASSERTION'});
 }
});


test('Recovery fences successor binds fresh source and metadata without installed qualification',()=>{
 const prior='3d6e3b9a5bf4e7ddb5c9dd9cc0fc3d41d73ef320',version='0.7.0-dev.1955970210787.1';
 const evidence=JSON.parse(read('evidence/audits/metaengine-20261028-recovery-fences-package/live-artifact-observation.json'));
 assert.equal(evidence.source_head,prior);assert.equal(evidence.plan.candidate_package_version,version);
 assert.equal(evidence.plan.minimum_package_version,'0.7.0-dev.1848773682936.1');
 assert.equal(evidence.reservation_created,false);assert.equal(evidence.package_built,false);assert.equal(evidence.authority_effect,false);
 assert.equal(evidence.plan.physical_package_build_allowed,false);assert.equal(evidence.plan.promotion_authorized,false);
 for(const q of evidence.queries){assert.equal(q.status,200);const body=JSON.parse(q.response_body);assert.equal(body.total_count,body.artifacts.length);}
 assert.equal(JSON.parse(evidence.queries.at(-1).response_body).total_count,0);
 assert.equal(manifest.previous_package_transitions.find(item=>item.distinct_version===version).source_parent,prior);
 assertCommittedAuditPrefix(root,prior,'HEAD','coordination/operator-control/AUDIT_CLOSURE_EXECUTION_REGISTER_20261018.md');
});


test('Terminal goal and health diagnostics successor binds fresh source and metadata without installed qualification',()=>{
 const prior='be11be66853c822f0138cbaf899aa203f1312016',version='0.7.0-dev.2070820686579.1';
 const evidence=JSON.parse(read('evidence/audits/metaengine-20261028-terminal-goal-health/live-artifact-observation.json'));
 assert.equal(evidence.source_head,prior);assert.equal(evidence.plan.candidate_package_version,version);
 assert.equal(evidence.plan.minimum_package_version,'0.7.0-dev.1955970210787.1');
 assert.equal(evidence.reservation_created,false);assert.equal(evidence.package_built,false);assert.equal(evidence.authority_effect,false);
 assert.equal(evidence.plan.physical_package_build_allowed,false);assert.equal(evidence.plan.promotion_authorized,false);
 for(const q of evidence.queries){assert.equal(q.status,200);const body=JSON.parse(q.response_body);assert.equal(body.total_count,body.artifacts.length);}
 assert.equal(JSON.parse(evidence.queries.at(-1).response_body).total_count,0);
 assert.equal(manifest.previous_package_transitions.find(item=>item.distinct_version===version).source_parent,prior);
 assertCommittedAuditPrefix(root,prior,'HEAD','coordination/operator-control/AUDIT_CLOSURE_EXECUTION_REGISTER_20261018.md');
});


test('Postgres health contract successor binds fresh source and metadata without installed qualification',()=>{
 const prior='91a680d813a5bb44c6ab4438fec2ba1bcbe23ee0',version='0.7.0-dev.2179244300106.1';
 const evidence=JSON.parse(read('evidence/audits/metaengine-20261028-postgres-health-contract/live-artifact-observation.json'));
 assert.equal(evidence.source_head,prior);assert.equal(evidence.plan.candidate_package_version,version);
 assert.equal(evidence.plan.minimum_package_version,'0.7.0-dev.2070820686579.1');
 assert.equal(evidence.reservation_created,false);assert.equal(evidence.package_built,false);assert.equal(evidence.authority_effect,false);
 assert.equal(evidence.plan.physical_package_build_allowed,false);assert.equal(evidence.plan.promotion_authorized,false);
 for(const q of evidence.queries){assert.equal(q.status,200);const body=JSON.parse(q.response_body);assert.equal(body.total_count,body.artifacts.length);}
 assert.equal(JSON.parse(evidence.queries.at(-1).response_body).total_count,0);
 assert.equal(manifest.previous_package_transitions.find(item=>item.distinct_version===version).source_parent,prior);
 assertCommittedAuditPrefix(root,prior,'HEAD','coordination/operator-control/AUDIT_CLOSURE_EXECUTION_REGISTER_20261018.md');
});


test('Native seed observation successor binds fresh source and metadata without installed qualification',()=>{
 const prior='21e439a082d214bb7601d5b43d53bc520058517e',version='0.7.0-dev.2257027431866.1';
 const evidence=JSON.parse(read('evidence/audits/metaengine-20261029-native-seed-admission/live-artifact-observation.json'));
 assert.equal(evidence.source_head,prior);assert.equal(evidence.plan.candidate_package_version,version);
 assert.equal(evidence.plan.minimum_package_version,'0.7.0-dev.2179244300106.1');
 assert.equal(evidence.reservation_created,false);assert.equal(evidence.package_built,false);assert.equal(evidence.authority_effect,false);
 assert.equal(evidence.plan.physical_package_build_allowed,false);assert.equal(evidence.plan.promotion_authorized,false);
 for(const q of evidence.queries){assert.equal(q.status,200);const body=JSON.parse(q.response_body);assert.equal(body.total_count,body.artifacts.length);}
 assert.equal(JSON.parse(evidence.queries.at(-1).response_body).total_count,0);
 assert.equal(manifest.current_package_transition.source_parent,prior);assert.equal(manifest.current_source_candidate.package_version,version);
 assertCommittedAuditPrefix(root,prior,'HEAD','coordination/operator-control/AUDIT_CLOSURE_EXECUTION_REGISTER_20261018.md');
});
