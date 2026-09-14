import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { BrowserGuardianEffectJournal } = require('../src/browser-guardian-effect-journal.cjs');
const { executeGuardianStartChild } = require('../src/browser-guardian-start-executor.cjs');

const release = Object.freeze({ release_id: 'release-dev-permit-1', artifact_sha256: 'd'.repeat(64) });
const binding = Object.freeze({ guardian_instance_id: 'guardian-permit-a', executable: 'C:\\Program Files\\METAENGINE Browser\\METAENGINE Browser.exe' });

function plan() {
  return {
    schema: 'metaengine.browser-guardian.plan.v1',
    action: 'START_CHILD',
    process_effect_candidate: true,
    requires_external_executor: true,
    actuation_eligible: false,
    automatic_retry_allowed: false,
    browser_authority: false,
    task_authority: false,
    scheduler_authority: false,
    page_model_text_authority: false,
    release_authority: false,
    authority_effect: false,
    target_release: release,
    process_absence_proven: true,
  };
}

test('START_CHILD crosses canonical durable permit before its only physical dispatch', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-guardian-permit-'));
  const journal = new BrowserGuardianEffectJournal({ statePath: path.join(root, 'guardian-state.json') });
  await journal.init(binding);
  let dispatchCalls = 0;
  try {
    const out = await executeGuardianStartChild({
      plan: plan(),
      journal,
      binding,
      revalidateChildAbsence: async () => ({ proven: true }),
      dispatchStart: async ({ effect_id, effect_generation, dispatch_permit }) => {
        dispatchCalls += 1;
        assert.equal(journal.snapshot().state, 'EFFECT_ATTEMPTED');
        assert.equal(dispatch_permit.schema, 'metaengine.browser-guardian.process-effect-dispatch-permit.v1');
        assert.equal(dispatch_permit.action, 'DISPATCH_EXACT_EFFECT_ONCE');
        assert.equal(dispatch_permit.effect_action, 'START_CHILD');
        assert.equal(dispatch_permit.effect_id, effect_id);
        assert.equal(dispatch_permit.effect_generation, effect_generation);
        assert.equal(dispatch_permit.durable_effect_barrier_crossed, true);
        assert.equal(dispatch_permit.single_dispatch_only, true);
        assert.equal(dispatch_permit.automatic_retry_allowed, false);
        assert.equal(dispatch_permit.authority_effect, false);
        return { state: 'DISPATCHED', pid: 8501, process_incarnation_id: 'permit-proc-1' };
      },
      observeDispatched: async ({ pid }) => ({
        state: 'READY', pid, process_incarnation_id: 'permit-proc-1', release, exact_ready_binding: true,
      }),
    });
    assert.equal(out.state, 'CONFIRMED');
    assert.equal(dispatchCalls, 1);
    assert.equal(journal.snapshot().state, 'CONFIRMED');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
