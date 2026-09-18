import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { BrowserGuardianEffectJournal, journalPath } = require('../src/browser-guardian-effect-journal.cjs');

const binding = Object.freeze({
  guardian_instance_id: 'guardian-integrity-a',
  executable: 'C:\\Program Files\\METAENGINE Browser\\METAENGINE Browser.exe',
});

function processPlan() {
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
    target_release: { release_id: 'release-integrity', artifact_sha256: 'a'.repeat(64) },
    process_absence_proven: true,
  };
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guardian-journal-integrity-'));
  return { root, statePath: path.join(root, 'guardian-state.json') };
}

async function cleanup(root) {
  await fs.rm(root, { recursive: true, force: true });
}

test('restore rejects stored plan drift when durable plan_digest no longer matches exact stored identity', async () => {
  const f = await fixture();
  try {
    const first = new BrowserGuardianEffectJournal({ statePath: f.statePath });
    await first.init(binding);
    const intent = await first.beginEffect(binding, processPlan());

    const file = journalPath(f.statePath);
    const persisted = JSON.parse(await fs.readFile(file, 'utf8'));
    persisted.plan.target_release.artifact_sha256 = 'b'.repeat(64);
    await fs.writeFile(file, JSON.stringify(persisted), 'utf8');

    const restored = new BrowserGuardianEffectJournal({ statePath: f.statePath });
    await assert.rejects(() => restored.init(binding), /guardian_effect_plan_digest_drift/);
    assert.equal(intent.state, 'INTENT_RECORDED');
  } finally {
    await cleanup(f.root);
  }
});

test('legacy PROCESS row without effect_domain still restores when exact legacy plan digest matches', async () => {
  const f = await fixture();
  try {
    const first = new BrowserGuardianEffectJournal({ statePath: f.statePath });
    await first.init(binding);
    const intent = await first.beginEffect(binding, processPlan());

    const file = journalPath(f.statePath);
    const persisted = JSON.parse(await fs.readFile(file, 'utf8'));
    delete persisted.effect_domain;
    await fs.writeFile(file, JSON.stringify(persisted), 'utf8');

    const restored = new BrowserGuardianEffectJournal({ statePath: f.statePath });
    const snapshot = await restored.init(binding);
    assert.equal(snapshot.effect_domain, 'PROCESS');
    assert.equal(snapshot.plan_digest, intent.plan_digest);
    assert.equal(snapshot.effect_id, intent.effect_id);
  } finally {
    await cleanup(f.root);
  }
});
