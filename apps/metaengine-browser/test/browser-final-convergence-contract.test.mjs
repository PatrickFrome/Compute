import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  BROWSER_FINAL_CONVERGENCE_REQUIRED_PROOFS,
  evaluateBrowserFinalConvergence,
} from '../src/browser-final-convergence-contract.mjs';
import { hostAgentProtocolManifest } from '../src/host-agent-protocol.mjs';
import { LEASED_BROWSER_PLAN_SCHEMA } from '../src/leased-browser-plan.mjs';
import {
  classifyVerifiedExecutionOutcome,
  VERIFIED_EXECUTION_OUTCOME_SCHEMA,
} from '../src/verified-execution-outcome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const repoRoot = path.resolve(appRoot, '../..');
const readApp = (relativePath) => fs.readFileSync(path.join(appRoot, relativePath), 'utf8');
const readRepo = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
const existsApp = (relativePath) => fs.existsSync(path.join(appRoot, relativePath));

function sourceProofs() {
  const hostProtocol = hostAgentProtocolManifest();
  const hostComposition = readApp('src/host-agent-remote-composition.mjs');
  const leasedPlan = readApp('src/leased-browser-plan.mjs');
  const sentinel = readApp('src/browser-sentinel-action-journal.cjs');
  const fastRouter = readApp('src/fast-control-mcp-stateless-router.mjs');
  const worktreeReadModel = readApp('src/devos-worktree-repo-search.cjs');
  const issueBatch = readApp('supabase/command-fabric-issue-batch-v2.sql');
  const releaseGateTest = readApp('test/release-physical-gate-chain.test.mjs');
  const bootstrapWorkflow = readRepo('.github/workflows/metaengine-browser-bootstrap-autostart-e2e.yml');
  const fastUpdateWorkflow = readRepo('.github/workflows/metaengine-browser-self-update-fast-e2e.yml');

  const ambiguous = classifyVerifiedExecutionOutcome({ dispatch_started: true });

  return Object.freeze({
    COMMAND_FABRIC_V2:
      /begin;/i.test(issueBatch)
      && /rollback;/i.test(issueBatch)
      && /issue_batch_v2/i.test(issueBatch),
    FAST_CONTROL_STATELESS:
      /Mcp-Method/i.test(fastRouter)
      && /Mcp-Name/i.test(fastRouter)
      && /stateless/i.test(fastRouter),
    WORKTREE_AWARE_READ_MODEL:
      /worktree/i.test(worktreeReadModel)
      && /increment/i.test(worktreeReadModel),
    HOST_AGENT_REPLAY_FENCE_V2:
      hostProtocol.replay_protection === 'SEQUENCED_EPOCH_HIGH_WATER_NO_EVICTION'
      && hostProtocol.session_key_rotation === 'REQUIRED_ON_SERVER_PROCESS_RESTART',
    HOST_AGENT_ONE_SHOT_SESSION_KEYS:
      /session_keys_one_shot:\s*true/.test(hostComposition)
      && /restart_requires_new_session_keys:\s*true/.test(hostComposition)
      && /private_key_exported:\s*false/.test(hostComposition),
    LEASED_BROWSER_PLAN_V1:
      LEASED_BROWSER_PLAN_SCHEMA === 'metaengine.leased-browser-plan.v1'
      && /automatic_retry_allowed/.test(leasedPlan)
      && /effect_binding/.test(leasedPlan),
    VERIFIED_EXECUTION_FABRIC_V1:
      ambiguous.schema === VERIFIED_EXECUTION_OUTCOME_SCHEMA
      && ambiguous.state === 'AMBIGUOUS'
      && ambiguous.automatic_retry_allowed === false
      && ambiguous.authority_effect === false,
    SENTINEL_SUCCESSOR_FENCE:
      /SUCCESSOR_BOUND/.test(sentinel)
      && /predecessor_evidence_archived:\s*true/.test(sentinel)
      && /automatic_retry_allowed:\s*false/.test(sentinel),
    EXACT_SHA_PHYSICAL_RELEASE_GATE:
      /exact-SHA bootstrap autostart physical proof/.test(releaseGateTest)
      && /ref:\s*\$\{\{\s*github\.sha\s*\}\}/.test(bootstrapWorkflow)
      && /EXPECTED_SHA:\s*\$\{\{\s*github\.sha\s*\}\}/.test(fastUpdateWorkflow)
      && /head_sha="\$EXPECTED_SHA"/.test(fastUpdateWorkflow),
  });
}

test('final convergence contract fails closed when any proof is absent', () => {
  const result = evaluateBrowserFinalConvergence({});
  assert.equal(result.state, 'BLOCKED');
  assert.deepEqual(result.missing_proofs, [...BROWSER_FINAL_CONVERGENCE_REQUIRED_PROOFS]);
  assert.equal(result.production_promotion_authorized, false);
  assert.equal(result.automatic_effect_retry_allowed, false);
});

test('current source tree satisfies the final convergence architecture contract without granting release authority', () => {
  assert.equal(existsApp('src/browser-final-convergence-contract.mjs'), true);
  const proofs = sourceProofs();
  assert.deepEqual(Object.keys(proofs), [...BROWSER_FINAL_CONVERGENCE_REQUIRED_PROOFS]);
  assert.deepEqual(Object.entries(proofs).filter(([, value]) => value !== true), []);

  const result = evaluateBrowserFinalConvergence(proofs);
  assert.equal(result.state, 'SOURCE_READY');
  assert.equal(result.source_ready, true);
  assert.deepEqual(result.missing_proofs, []);
  assert.equal(result.exact_release_sha_still_required, true);
  assert.equal(result.physical_release_qualification_still_required, true);
  assert.equal(result.production_promotion_authorized, false);
  assert.equal(result.authority_effect, false);
});

test('final convergence contract rejects invented proof names instead of silently widening release criteria', () => {
  assert.throws(
    () => evaluateBrowserFinalConvergence({ UNREVIEWED_OVERRIDE: true }),
    /browser_final_convergence_proof_unknown:UNREVIEWED_OVERRIDE/,
  );
});
