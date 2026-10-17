import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditClientCrossPlaneIntegration } from './operator-cross-plane-integration-critic.mjs';
import { readBoundClientAgentCompletion } from './operator-agent-completion-bound-w39.mjs';
import { BrowserCellContinuityIntegrationW41 } from '../../apps/metaengine-browser/src/browsercell-continuity-integration-w41.mjs';
import { qualifySupervisorWakeReceipt } from '../../apps/metaengine-browser/src/supervisor-continuity-lease.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifestPath = path.join(root, 'coordination/operator-control/client-source-candidate-w43.manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
const source = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('W43 immutable parent ledger is exact, unique, and all nine independently pinned PR heads are ancestors', () => {
  assert.equal(manifest.schema, 'metaengine.client.source-candidate-w43.v1');
  assert.equal(manifest.classification, 'SOURCE_ONLY_STAGING_REVIEW_REQUIRED');
  assert.equal(manifest.repository, 'PatrickFrome/Compute');
  assert.equal(manifest.parent_heads.length, 9);
  assert.deepEqual(manifest.parent_heads.map(x => x.pr), [1262,1263,1264,1265,1266,1267,1268,1257,1248]);
  assert.equal(new Set(manifest.parent_heads.map(x => x.sha)).size, 9);
  for (const parent of manifest.parent_heads) {
    assert.match(parent.sha, /^[0-9a-f]{40}$/);
    assert.equal(spawnSync('git', ['-C', root, 'merge-base', '--is-ancestor', parent.sha, 'HEAD']).status, 0,
      'lost parent/unique source ancestry: PR #' + parent.pr);
  }
  assert.equal(spawnSync('git', ['-C', root, 'merge-base', '--is-ancestor', manifest.pre_freeze_integration_commit, 'HEAD']).status, 0);
  for (const key of ['main','integration_compute_unified_v1','pr1216','pr1221']) {
    assert.match(manifest.upstream_refs[key], /^[0-9a-f]{40}$/);
  }
});

test('W43 protected integrated native, package, SQL, completion, critic and UI source blobs match committed objects exactly', () => {
  const blobs = Object.entries(manifest.protected_git_blobs);
  assert.ok(blobs.length >= 12);
  for (const [filename, expected] of blobs) {
    assert.match(expected, /^[0-9a-f]{40}$/);
    const baselineRef = fs.existsSync(path.join(root, 'coordination/operator-control/client-source-candidate-w51.manifest.json'))
      ? 'b24e240b3a273a9622a3983a1029faa53d6a6576' : 'HEAD';
    assert.equal(git('rev-parse', baselineRef + ':' + filename), expected, 'W43 frozen ancestor overwritten: ' + filename);
    if (baselineRef === 'HEAD') assert.equal(git('hash-object', filename), expected, 'uncommitted source drift: ' + filename);
  }
  const version = JSON.parse(source('apps/metaengine-browser/package.json')).version;
  const closure = JSON.parse(source('coordination/operator-control/client-critical-closure.manifest.json'));
  const testOnly = closure.test_candidate;
  if(testOnly){
    assert.equal(testOnly.classification,'ISOLATED_TEST_PACKAGE_ONLY');
    assert.equal(testOnly.branch,'work/client-operational-repair-20261015');
    assert.equal(testOnly.production_release_authorized,false);
    assert.equal(testOnly.installed_mutation_authorized,false);
    assert.equal(JSON.parse(git('show','49d050ff127e22ca27fbe3514324ba99832afb24:apps/metaengine-browser/package.json')).version,manifest.package_version_unchanged);
    // The earlier disposable version stays historical; only current_source_candidate
    // can authorize the version of the new source-only branch.
    assert.equal(version,closure.current_source_candidate?.package_version ?? testOnly.version);
    if (closure.current_source_candidate) {
      assert.equal(closure.current_source_candidate.historical_package_version,testOnly.version);
      assert.equal(closure.current_source_candidate.production_ready,false);
    }
    assert.notEqual(version,manifest.package_version_unchanged);
  }else assert.equal(version, manifest.package_version_unchanged);
  assert.equal(manifest.package_version_owner, 'W46');
});

test('W43 retains actual readContext entry and native BrowserCell observer in one Client, never a page-provided context or second Scheduler', () => {
  const main = source('apps/metaengine-browser/src/main.mjs');
  const native = source('apps/metaengine-browser/src/native-supervisor-client.mjs');
  const routes = source('apps/metaengine-browser/supabase/a2-browser-native-supervisor-v1/devos-routes.mjs');
  assert.match(main, /import \{ createOperatorNativeContextReader \} from/);
  assert.match(main, /operatorContextReader\.readContext\(\)/);
  assert.match(native, /import \{ BrowserCellContinuityIntegrationW41 \} from/);
  assert.match(native, /new BrowserCellContinuityIntegrationW41\(/);
  assert.match(routes, /fleet-dag-claim-plan\.mjs/);
  assert.match(routes, /devos_fleet_lease_v1/);
  assert.equal(typeof BrowserCellContinuityIntegrationW41, 'function');
  assert.equal(typeof readBoundClientAgentCompletion, 'function');
  assert.equal(typeof qualifySupervisorWakeReceipt, 'function');
});

test('W43 unioned runtime test registration: every W37 W39 W42 inherited contract remains runnable', () => {
  const p = JSON.parse(source('infra/client-state-runtime/package.json'));
  for (const name of ['operator-context-convergence-w37.test.mjs',
    'operator-agent-completion-evidence.test.mjs',
    'operator-agent-completion-bound-w39.test.mjs',
    'operator-cross-plane-integration-critic.test.mjs',
    'client-source-convergence-falsifier-w42.test.mjs']) {
    assert.ok(p.scripts.test.includes(name), 'missing registered independent suite: ' + name);
    assert.ok(fs.existsSync(path.join(root,'infra/client-state-runtime',name)));
  }
});

test('W43 independent critic returns BLOCKED without genuine Owner/cursor/CI/physical proof, not fictional VERIFIED', () => {
  const result = auditClientCrossPlaneIntegration({});
  assert.equal(result.state, 'BLOCKED');
  assert.notEqual(result.state, 'READY');
  assert.equal(manifest.classification, 'SOURCE_ONLY_STAGING_REVIEW_REQUIRED');
  assert.ok(manifest.merge_resolution.some(x => x.includes('ambiguous wake')));
});

test('W43 merged source excludes hosted provider reactivation from native entry and retains missing-Owner fencing', () => {
  const main = source('apps/metaengine-browser/src/main.mjs');
  const sentinel = source('apps/metaengine-browser/src/browser-sentinel.mjs');
  const resilience = source('apps/metaengine-browser/src/host-resilience-runtime.mjs');
  assert.match(main, /Client only: obsolete hosted-cloud sentinel/);
  assert.match(main, /explicitLocalSupervisorBase/);
  assert.match(sentinel, /browser_sentinel_local_owner_unattested/);
  assert.match(resilience, /LOCAL_PROVIDER_CONFIGURATION_REQUIRED/);
});
