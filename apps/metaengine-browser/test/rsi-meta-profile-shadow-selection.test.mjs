import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { RSI_META_PROFILE_QUALIFICATION_SCHEMA } from '../src/rsi-meta-profile-qualification.mjs';
import { rsiPromotionGateTrustRootSnapshot } from '../src/rsi-promotion-admission-gate.mjs';
import { rsiTournamentTrustRootSnapshot } from '../src/rsi-shadow-tournament.mjs';
import {
  RsiMetaProfileShadowSelectionLedger,
  createRsiMetaProfileShadowSelection,
  rsiMetaProfileShadowSelectionTrustRootSnapshot,
  verifyRsiMetaProfileShadowSelection,
} from '../src/rsi-meta-profile-shadow-selection.mjs';

const SOURCE = 'a'.repeat(40);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function dg(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex')}`;
}

function tagged(label) {
  return dg({ label });
}

function qualification({
  id,
  parent,
  successor,
  confirmationIndex,
  source = SOURCE,
} = {}) {
  const core = {
    schema: RSI_META_PROFILE_QUALIFICATION_SCHEMA,
    version: 1,
    source_sha: source,
    qualification_id: id,
    meta_record_digest: tagged(`${id}:meta`),
    parent_profile_digest: tagged(parent),
    successor_profile_digest: tagged(successor),
    shadow_plan_digest: tagged(`${id}:plan`),
    shadow_result_digest: tagged(`${id}:result`),
    certificate_digest: tagged(`${id}:certificate`),
    risk_budget_digest: tagged('fixed-risk-budget'),
    confirmation_index: confirmationIndex,
    allocated_alpha: 0.01,
    alpha_used: 0.005,
    global_alpha: 0.05,
    state: 'QUALIFIED_FOR_SHADOW_PROFILE_SELECTION',
    qualified_for_shadow_profile_selection: true,
    live_profile_activation_authorized: false,
    profile_replacement_authorized: false,
    canary_activation_authorized: false,
    external_activation_gate_still_required: true,
    execution_authority: false,
    production_mutation_authority: false,
    promotion_authority: false,
    self_update_authority: false,
    scheduler_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
  return Object.freeze({ ...core, qualification_digest: dg(core) });
}

function selectionArgs(profiles, history = [], overrides = {}) {
  return {
    source_sha: SOURCE,
    selection_id: overrides.selection_id || 'selection.one',
    context_class: overrides.context_class || 'CODING',
    context_digest: overrides.context_digest || tagged('context:one'),
    qualified_profiles: profiles,
    selection_history: history,
    external_context_owner: true,
    authored_by_candidate: false,
  };
}

test('selection preserves qualified set and explores an unseen lineage before replaying a used family', () => {
  const profiles = [
    qualification({ id: 'qual.a1', parent: 'parent-a', successor: 'successor-a1', confirmationIndex: 1 }),
    qualification({ id: 'qual.a2', parent: 'parent-a', successor: 'successor-a2', confirmationIndex: 2 }),
    qualification({ id: 'qual.b1', parent: 'parent-b', successor: 'successor-b1', confirmationIndex: 3 }),
  ];

  const first = createRsiMetaProfileShadowSelection(selectionArgs(profiles));
  assert.equal(first.selection_reason, 'UNSEEN_QUALIFIED_PROFILE_IN_CONTEXT');
  assert.equal(first.candidate_count, 3);
  assert.equal(first.scalar_winner, null);
  assert.equal(first.selection_is_profile_activation, false);

  const second = createRsiMetaProfileShadowSelection(selectionArgs(profiles, [first], {
    selection_id: 'selection.two',
  }));
  assert.notEqual(second.selected.family_digest, first.selected.family_digest);
  assert.equal(second.selected.context_selection_count, 0);

  const third = createRsiMetaProfileShadowSelection(selectionArgs(profiles, [first, second], {
    selection_id: 'selection.three',
  }));
  assert.equal(third.selected.context_selection_count, 0);
  assert.equal(new Set([first.selected.qualification_digest, second.selected.qualification_digest, third.selected.qualification_digest]).size, 3);
});

test('selection history is context scoped and never turns repeated selection into activation authority', () => {
  const profiles = [
    qualification({ id: 'qual.a1', parent: 'parent-a', successor: 'successor-a1', confirmationIndex: 1 }),
    qualification({ id: 'qual.b1', parent: 'parent-b', successor: 'successor-b1', confirmationIndex: 2 }),
  ];
  const contextOne = tagged('context:one');
  const contextTwo = tagged('context:two');
  const first = createRsiMetaProfileShadowSelection(selectionArgs(profiles, [], {
    context_digest: contextOne,
  }));
  const freshContext = createRsiMetaProfileShadowSelection(selectionArgs(profiles, [first], {
    selection_id: 'selection.fresh-context',
    context_digest: contextTwo,
  }));

  assert.equal(freshContext.selected.context_selection_count, 0);
  assert.equal(freshContext.selection_reason, 'UNSEEN_QUALIFIED_PROFILE_IN_CONTEXT');
  for (const field of [
    'execution_authority',
    'production_mutation_authority',
    'promotion_authority',
    'self_update_authority',
    'scheduler_authority',
    'automatic_retry_allowed',
    'authority_effect',
    'shadow_trial_activation_authorized',
    'live_profile_activation_authorized',
    'profile_replacement_authorized',
  ]) {
    assert.equal(freshContext[field], false, field);
  }
});

test('unqualified, source-drifted, duplicate and tampered qualifications fail closed', () => {
  const good = qualification({ id: 'qual.good', parent: 'parent-a', successor: 'successor-a1', confirmationIndex: 1 });
  const notQualifiedCore = { ...good, state: 'STATISTICAL_CONFIRMATION_REJECTED', qualified_for_shadow_profile_selection: false };
  delete notQualifiedCore.qualification_digest;
  const notQualified = { ...notQualifiedCore, qualification_digest: dg(notQualifiedCore) };
  assert.throws(
    () => createRsiMetaProfileShadowSelection(selectionArgs([notQualified])),
    /qualification_policy_invalid/,
  );

  const drifted = qualification({
    id: 'qual.drift',
    parent: 'parent-a',
    successor: 'successor-a2',
    confirmationIndex: 2,
    source: 'b'.repeat(40),
  });
  assert.throws(
    () => createRsiMetaProfileShadowSelection(selectionArgs([drifted])),
    /qualification_source_mismatch/,
  );

  assert.throws(
    () => createRsiMetaProfileShadowSelection(selectionArgs([good, good])),
    /candidate_duplicate/,
  );

  const tampered = { ...good, alpha_used: good.alpha_used / 2 };
  assert.throws(
    () => createRsiMetaProfileShadowSelection(selectionArgs([tampered])),
    /qualification_digest_mismatch/,
  );
});

test('selection digest detects candidate-set or selected-profile tampering', () => {
  const profiles = [
    qualification({ id: 'qual.a1', parent: 'parent-a', successor: 'successor-a1', confirmationIndex: 1 }),
    qualification({ id: 'qual.b1', parent: 'parent-b', successor: 'successor-b1', confirmationIndex: 2 }),
  ];
  const row = createRsiMetaProfileShadowSelection(selectionArgs(profiles));
  assert.equal(verifyRsiMetaProfileShadowSelection(row).selection_digest, row.selection_digest);

  const tampered = structuredClone(row);
  tampered.selected.context_selection_count += 1;
  assert.throws(() => verifyRsiMetaProfileShadowSelection(tampered), /selection_digest_mismatch/);
});

test('append-only ledger is restart-safe, source-fenced and identity-conflict safe', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'meta-profile-selection-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const statePath = path.join(dir, 'selection.json');
  const profiles = [
    qualification({ id: 'qual.a1', parent: 'parent-a', successor: 'successor-a1', confirmationIndex: 1 }),
    qualification({ id: 'qual.b1', parent: 'parent-b', successor: 'successor-b1', confirmationIndex: 2 }),
  ];

  const ledger = new RsiMetaProfileShadowSelectionLedger({ statePath, source_sha: SOURCE });
  await ledger.init();
  const first = createRsiMetaProfileShadowSelection(selectionArgs(profiles));
  const stored = await ledger.add(first);
  assert.equal(stored.state, 'RECORDED');
  assert.equal(ledger.snapshot().row_count, 1);
  assert.equal(ledger.snapshot().active_profile_digest, null);
  assert.equal(ledger.snapshot().shadow_profile_digest, null);

  const restarted = new RsiMetaProfileShadowSelectionLedger({ statePath, source_sha: SOURCE });
  await restarted.init();
  assert.equal(restarted.history().length, 1);
  assert.equal(restarted.history()[0].selection_digest, first.selection_digest);

  const same = await restarted.add(first);
  assert.equal(same.state, 'IDEMPOTENT');

  const conflict = createRsiMetaProfileShadowSelection(selectionArgs(profiles, restarted.history(), {
    selection_id: first.selection_id,
    context_digest: tagged('context:conflict'),
  }));
  await assert.rejects(() => restarted.add(conflict), /identity_conflict/);
});

test('trust root freezes quality-diversity selection as advisory-only', () => {
  const root = rsiMetaProfileShadowSelectionTrustRootSnapshot();
  assert.equal(root.phase17_risk_qualification_required, true);
  assert.equal(root.pareto_qualified_set_preserved, true);
  assert.equal(root.scalar_winner_authoritative, false);
  assert.equal(root.selection_is_profile_activation, false);
  assert.equal(root.external_shadow_trial_handoff_required, true);
  assert.equal(root.candidate_can_choose_context, false);
  assert.equal(root.live_profile_activation_authorized, false);
  assert.equal(root.authority_effect, false);
  assert.match(root.selection_root_digest, /^sha256:[0-9a-f]{64}$/);

  for (const trustRoot of [rsiPromotionGateTrustRootSnapshot(), rsiTournamentTrustRootSnapshot()]) {
    for (const path of [
      'apps/metaengine-browser/src/rsi-runtime-meta-skill-archive.mjs',
      'apps/metaengine-browser/src/rsi-meta-profile-qualification.mjs',
      'apps/metaengine-browser/src/rsi-meta-profile-shadow-selection.mjs',
    ]) {
      assert.equal(trustRoot.immutable_component_paths.includes(path), true, path);
    }
  }
});
