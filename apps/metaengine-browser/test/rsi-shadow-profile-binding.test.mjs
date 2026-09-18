import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  RsiShadowProfileBindingLedger,
  createRsiShadowProfileBinding,
  verifyQualifiedMetaProfile,
  verifyRsiShadowProfileBinding,
  rsiShadowProfileBindingTrustRootSnapshot,
} from '../src/rsi-shadow-profile-binding.mjs';

const SOURCE = 'a'.repeat(40);
const d = (char) => `sha256:${char.repeat(64)}`;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex')}`;
}

function qualification(overrides = {}) {
  const core = {
    schema: 'metaengine.rsi.meta-profile-qualification.v1',
    version: 1,
    source_sha: SOURCE,
    qualification_id: 'shadow.profile.qualification.1',
    meta_record_digest: d('1'),
    parent_profile_digest: d('2'),
    successor_profile_digest: d('3'),
    shadow_plan_digest: d('4'),
    shadow_result_digest: d('5'),
    certificate_digest: d('6'),
    risk_budget_digest: d('7'),
    confirmation_index: 1,
    allocated_alpha: 0.01,
    alpha_used: 0.01,
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
    ...overrides,
  };
  return Object.freeze({ ...core, qualification_digest: digest(core) });
}

test('qualified meta-profile binds parent as champion and successor as challenger on one verified context', () => {
  const q = qualification();
  verifyQualifiedMetaProfile(q);
  const binding = createRsiShadowProfileBinding({
    binding_id: 'shadow.profile.binding.1',
    qualification: q,
    verified_context_digest: d('8'),
    comparator_root_digest: d('9'),
    external_shadow_owner: true,
    authored_by_candidate: false,
  });
  const checked = verifyRsiShadowProfileBinding(binding, q);

  assert.equal(checked.champion_profile_digest, q.parent_profile_digest);
  assert.equal(checked.challenger_profile_digest, q.successor_profile_digest);
  assert.equal(checked.comparison_mode, 'READ_ONLY_DUAL_PLAN');
  assert.equal(checked.same_verified_context_required, true);
  assert.equal(checked.browser_effects_allowed, false);
  assert.equal(checked.plan_execution_allowed, false);
  assert.equal(checked.active_profile_replaced, false);
  assert.equal(checked.canary_activation_authorized, false);
  assert.equal(checked.authority_effect, false);
});

test('candidate cannot author shadow binding or choose active roles', () => {
  const q = qualification();
  assert.throws(() => createRsiShadowProfileBinding({
    binding_id: 'shadow.profile.binding.candidate',
    qualification: q,
    verified_context_digest: d('8'),
    comparator_root_digest: d('9'),
    external_shadow_owner: false,
    authored_by_candidate: true,
  }), /external_owner_required/);

  const binding = createRsiShadowProfileBinding({
    binding_id: 'shadow.profile.binding.roles',
    qualification: q,
    verified_context_digest: d('8'),
    comparator_root_digest: d('9'),
    external_shadow_owner: true,
    authored_by_candidate: false,
  });
  const tampered = { ...binding, champion_profile_digest: q.successor_profile_digest, challenger_profile_digest: q.parent_profile_digest };
  assert.throws(() => verifyRsiShadowProfileBinding(tampered, q), /binding_digest_mismatch|binding_policy_invalid/);
});

test('only explicitly qualified zero-authority profile evidence is accepted', () => {
  const rejected = qualification({
    state: 'STATISTICAL_CONFIRMATION_REJECTED',
    qualified_for_shadow_profile_selection: false,
  });
  assert.throws(() => verifyQualifiedMetaProfile(rejected), /qualification_policy_invalid/);

  const canary = qualification({ canary_activation_authorized: true });
  assert.throws(() => verifyQualifiedMetaProfile(canary), /qualification_policy_invalid/);
});

test('shadow binding ledger is append-only, source-fenced and restart durable without active profile state', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-shadow-profile-binding-'));
  try {
    const q = qualification();
    const binding = createRsiShadowProfileBinding({
      binding_id: 'shadow.profile.binding.persist.1',
      qualification: q,
      verified_context_digest: d('8'),
      comparator_root_digest: d('9'),
      external_shadow_owner: true,
      authored_by_candidate: false,
    });

    const statePath = path.join(root, 'shadow-binding.json');
    const ledger = new RsiShadowProfileBindingLedger({ statePath, source_sha: SOURCE });
    await ledger.init();
    assert.equal((await ledger.add(binding, q)).state, 'SHADOW_BOUND');
    assert.equal((await ledger.add(binding, q)).state, 'IDEMPOTENT');
    assert.equal(ledger.snapshot().row_count, 1);
    assert.equal(ledger.snapshot().active_profile_digest, null);
    assert.equal(ledger.snapshot().canary_profile_digest, null);
    assert.equal(ledger.snapshot().ledger_can_activate_profile, false);

    const restored = new RsiShadowProfileBindingLedger({ statePath, source_sha: SOURCE });
    await restored.init();
    assert.equal(restored.snapshot().row_count, 1);
    assert.equal(restored.bindings()[0].binding_digest, binding.binding_digest);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});


test('failed durable shadow binding write does not advance in-memory ledger state', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-rsi-shadow-profile-binding-fail-'));
  try {
    const q = qualification();
    const binding = createRsiShadowProfileBinding({
      binding_id: 'shadow.profile.binding.persist.fail',
      qualification: q,
      verified_context_digest: d('8'),
      comparator_root_digest: d('9'),
      external_shadow_owner: true,
      authored_by_candidate: false,
    });

    const statePath = path.join(root, 'shadow-binding.json');
    const ledger = new RsiShadowProfileBindingLedger({ statePath, source_sha: SOURCE });
    await ledger.init();

    await fs.mkdir(statePath);
    await assert.rejects(() => ledger.add(binding, q));
    assert.equal(ledger.snapshot().row_count, 0);
    assert.deepEqual(ledger.bindings(), []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('shadow binding trust root freezes zero-authority champion/challenger semantics', () => {
  const root = rsiShadowProfileBindingTrustRootSnapshot();
  assert.equal(root.qualified_meta_profile_required, true);
  assert.equal(root.same_verified_context_required, true);
  assert.equal(root.champion_is_parent_profile, true);
  assert.equal(root.challenger_is_qualified_successor, true);
  assert.equal(root.comparison_mode, 'READ_ONLY_DUAL_PLAN');
  assert.equal(root.browser_effects_allowed, false);
  assert.equal(root.active_profile_replacement_authorized, false);
  assert.equal(root.canary_activation_authorized, false);
  assert.equal(root.external_canary_gate_still_required, true);
  assert.equal(root.authority_effect, false);
  assert.match(root.shadow_binding_root_digest, /^sha256:[0-9a-f]{64}$/);
});
