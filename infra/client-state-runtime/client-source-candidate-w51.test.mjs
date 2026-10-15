import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOperatorCanonicalNativeBindingReadback } from '../../apps/metaengine-browser/src/operator-canonical-native-w44.mjs';
import { readClientSourceSyncPreflightW50 } from '../../apps/metaengine-browser/src/client-source-sync-preflight-w50.mjs';
import { auditClientCandidateAcceptanceW49 } from './client-candidate-acceptance-w49.mjs';
import { readClientBackupRestoreStagingW47 } from './client-backup-restore-staging-w47.mjs';
import { inspectStagingRestart } from './client-serial-loop-staging-w48.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const originalW51Candidate='42f81c858b9c18e163d2dfac6db79de076f5699d';
const m=JSON.parse(fs.readFileSync(path.join(root,'coordination/operator-control/client-source-candidate-w51.manifest.json'),'utf8'));
const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
const source=p=>fs.readFileSync(path.join(root,p),'utf8');

test('W51 one source includes W43, six Wave8 and four reviewed Wave9 sibling ancestors',()=>{
 assert.equal(m.schema,'metaengine.client.source-candidate-w51.v1');
 assert.equal(m.classification,'SOURCE_ONLY_STAGING_REVIEW_REQUIRED');
 assert.equal(m.branch,'work/metaengine-client-wave9-w51-20261015');
 assert.deepEqual(m.parent_heads.map(x=>x.pr),[1273,1275,1272,1276,1269,1271,1274,1278,1282,1281,1280]);
 assert.equal(new Set(m.parent_heads.map(x=>x.sha)).size,11);
 for(const parent of m.parent_heads){
  assert.match(parent.sha,/^[0-9a-f]{40}$/);
  assert.equal(spawnSync('git',['-C',root,'merge-base','--is-ancestor',parent.sha,'HEAD']).status,0,'missing real parent '+parent.pr);
 }
 assert.equal(spawnSync('git',['-C',root,'merge-base','--is-ancestor',m.merged_source_head_before_w51_tests,'HEAD']).status,0);
 assert.equal(spawnSync('git',['-C',root,'merge-base','--is-ancestor',m.wave9_sibling_integrated_head_before_manifest_refresh,'HEAD']).status,0);
 assert.equal(m.evidence_status.CI,'UNKNOWN_PENDING');
 assert.equal(m.authority_effect,false);
 assert.equal(m.automatic_retry_allowed,false);
 assert.equal(m.promotion_authorized,false);
});

test('historical W51 frozen source blob ledger remains exact in its immutable ancestor',()=>{
 assert.equal(spawnSync('git',['-C',root,'merge-base','--is-ancestor',originalW51Candidate,'HEAD']).status,0);
 assert.ok(Object.keys(m.protected_git_blobs).length>=38);
 for(const [p,sha] of Object.entries(m.protected_git_blobs)){
  assert.match(sha,/^[0-9a-f]{40}$/);
  assert.equal(git('rev-parse','HEAD:'+p),sha,'wrong frozen tree: '+p);
  assert.equal(git('hash-object',p),sha,'dirty protected source: '+p);
 }
 const sparse=spawnSync('git',['-C',root,'config','--bool','core.sparseCheckout'],{encoding:'utf8'});
 assert.ok(sparse.status!==0 || sparse.stdout.trim()==='false','sparse checkout forbidden');
});

test('W51 retains W43 strict missing-Owner tests, W44 context and W41 native observer',()=>{
 const main=source('apps/metaengine-browser/src/main.mjs');
 const native=source('apps/metaengine-browser/src/native-supervisor-client.mjs');
 assert.match(main,/explicitLocalSupervisorBase/);
 assert.match(main,/createOperatorCanonicalNativeBindingReadback/);
 assert.match(main,/createOperatorNativeContextReader/);
 assert.match(native,/BrowserCellContinuityIntegrationW41/);
 const w38='apps/metaengine-browser/test/client-local-contracts-w38.test.mjs';
 assert.equal(git('rev-parse','HEAD:'+w38),git('rev-parse',m.base_w43+':'+w38));
 assert.equal(JSON.parse(git('show',originalW51Candidate+':apps/metaengine-browser/package.json')).version,'0.7.0-dev.37781000062.1');
 assert.equal(m.package_freeze_owner,'W54');
 assert.match(native,/getTrustedOperatorOwnerVerifier/);
 assert.match(source('apps/metaengine-browser/src/client-source-sync-native-w55.mjs'),/GITHUB_REFS_API/);
 assert.match(source('apps/me2-ui/src/lib/client-work-badge-text.mjs'),/Recovery required/);
 assert.match(source('infra/client-state-runtime/client-serial-loop-staging-w56.mjs'),/SYNTHETIC\/STAGING/);
});

test('W51 unioned W37 W39 W42 W44 W49 W47 and PG17 test registrations',()=>{
 const p=JSON.parse(source('infra/client-state-runtime/package.json'));
 for(const name of [
  'operator-context-convergence-w37.test.mjs','operator-agent-completion-evidence.test.mjs',
  'operator-agent-completion-bound-w39.test.mjs','operator-cross-plane-integration-critic.test.mjs',
  'client-source-convergence-falsifier-w42.test.mjs','operator-canonical-native-w44.test.mjs',
  'client-candidate-acceptance-w49.test.mjs','client-backup-restore-staging-w47.test.mjs'
 ]){
  assert.ok(p.scripts.test.split(/\s+/).includes(name),'lost unit registration: '+name);
  assert.ok(fs.existsSync(path.join(root,'infra/client-state-runtime',name)));
 }
 assert.ok(p.scripts['test:integration'].includes('disposable-pg17-logical-restore.integration.test.mjs'));
 assert.ok(p.scripts['test:w47:staging']);
 assert.ok(p.scripts['test:w47:pg17']);
 assert.ok(fs.existsSync(path.join(root,'infra/client-state-runtime/client-pg17-qualification-w45.integration.test.mjs')));
 assert.ok(fs.existsSync(path.join(root,'infra/client-state-runtime/client-serial-loop-staging-w48.pg17.test.mjs')));
});

test('W51 cannot bootstrap Owner, source sync, backup, or LIVE effect from absent proof',async()=>{
 assert.equal(await createOperatorCanonicalNativeBindingReadback()(),null);
 const sync=await readClientSourceSyncPreflightW50();
 assert.equal(sync.state,'UNKNOWN');assert.equal(sync.installed_healthy,false);
 assert.equal(sync.authority_effect,false);assert.equal(sync.automatic_retry_allowed,false);
 const critic=auditClientCandidateAcceptanceW49({});
 assert.equal(critic.promotion_authority,false);assert.equal(critic.effect_authority,false);
 const backup=await readClientBackupRestoreStagingW47({});
 assert.equal(backup.upgrade_authorized,false);assert.equal(backup.automatic_retry_allowed,false);
 const restart=inspectStagingRestart({effect:{state:'AMBIGUOUS',ack_durable:false}});
 assert.equal(restart.state,'AMBIGUOUS');assert.equal(restart.automatic_retry_allowed,false);
});

test('W51 preserves both parent roadmap entries without self-declared READY',()=>{
 const text=source('coordination/operator-control/ROADMAP_UNIFIED_COMMAND_CONTINUITY_V1.md');
 assert.match(text,/W43 one-source Client convergence checkpoint/);
 assert.match(text,/Independent W49 outcome: BLOCKED/);
 assert.doesNotMatch(text,/^<<<<<<< |^=======|^>>>>>>> /m);
 assert.deepEqual(m.wave9_repairs_not_present_at_generation,['W53']);
});
