import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  DevOsEffectDeliveryJournal,
  DEVOS_EFFECT_DELIVERY_JOURNAL_SCHEMA,
  DEVOS_EFFECT_DELIVERY_JOURNAL_VERSION,
} from '../src/devos-effect-delivery-journal.mjs';

const TASK_A = '11111111-1111-4111-8111-111111111111';
const TASK_B = '22222222-2222-4222-8222-222222222222';
const TAB_A = 'tab_11111111-1111-4111-8111-111111111111';
const TAB_B = 'tab_22222222-2222-4222-8222-222222222222';

function binding(overrides = {}) {
  return {
    task_id: TASK_A,
    lease_generation: 7,
    agent_id: 'agent_11111111-1111-4111-8111-111111111111',
    tab_id: TAB_A,
    target_id: 'webcontents:12',
    agent_generation_epoch: 9,
    prompt_sha256: 'a'.repeat(64),
    ...overrides,
  };
}

async function fixture(maxEntries = 256) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-devos-effect-journal-'));
  const statePath = path.join(dir, 'journal.json');
  const journal = new DevOsEffectDeliveryJournal({ statePath, maxEntries });
  await journal.init();
  return { dir, statePath, journal };
}

test('durably records execution -> delivery pending -> confirmed with retry disabled', async () => {
  const { statePath, journal } = await fixture();
  const b = binding();
  await journal.beginExecution(b, { phase: 'before_type' });
  await journal.markDeliveryPending(b, { send_click_attempted: true });
  const confirmed = await journal.markConfirmed(b, { db_state: 'RUNNING' });
  assert.equal(confirmed.state, 'CONFIRMED');
  assert.equal(confirmed.automatic_retry_allowed, false);
  assert.equal(confirmed.authority_effect, false);

  const persisted = JSON.parse(await fs.readFile(statePath, 'utf8'));
  assert.equal(persisted.schema, DEVOS_EFFECT_DELIVERY_JOURNAL_SCHEMA);
  assert.equal(persisted.version, DEVOS_EFFECT_DELIVERY_JOURNAL_VERSION);
  assert.equal(persisted.entries.length, 1);
  assert.equal(persisted.entries[0].state, 'CONFIRMED');
});

test('restart restores DELIVERY_PENDING and forbids a second execution start', async () => {
  const { statePath, journal } = await fixture();
  const b = binding();
  await journal.beginExecution(b);
  await journal.markDeliveryPending(b, { send_click_attempted: true });

  const restarted = new DevOsEffectDeliveryJournal({ statePath });
  await restarted.init();
  assert.equal(restarted.find(b).state, 'DELIVERY_PENDING');
  await assert.rejects(() => restarted.beginExecution(b), /transition_invalid:DELIVERY_PENDING:EXECUTION_STARTED/);
});

test('AMBIGUOUS can only converge to CONFIRMED and never back to execution', async () => {
  const { journal } = await fixture();
  const b = binding();
  await journal.beginExecution(b);
  await journal.markAmbiguous(b, { reason: 'db_receipt_unknown' });
  await assert.rejects(() => journal.beginExecution(b), /transition_invalid:AMBIGUOUS:EXECUTION_STARTED/);
  const confirmed = await journal.markConfirmed(b, { reconciled: true });
  assert.equal(confirmed.state, 'CONFIRMED');
});

test('same task lease with changed physical incarnation fails closed as binding drift', async () => {
  const { journal } = await fixture();
  await journal.beginExecution(binding());
  await assert.rejects(
    () => journal.beginExecution(binding({ tab_id: TAB_B, target_id: 'webcontents:13' })),
    /binding_drift/,
  );
});

test('corrupt persisted journal fails closed instead of starting empty', async () => {
  const { statePath } = await fixture();
  await fs.writeFile(statePath, '{broken-json', 'utf8');
  const restarted = new DevOsEffectDeliveryJournal({ statePath });
  await assert.rejects(() => restarted.init(), /json_invalid/);
});

test('compaction never drops unresolved effect tails', async () => {
  const { journal } = await fixture(32);
  const pending = binding();
  await journal.beginExecution(pending);
  await journal.markDeliveryPending(pending);

  for (let i = 0; i < 40; i += 1) {
    const hex = (i + 10).toString(16).padStart(12, '0');
    const task = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4000-8000-${(i + 100).toString(16).padStart(12, '0')}`;
    const tab = `tab_${task}`;
    const b = binding({
      task_id: task,
      lease_generation: 1,
      agent_id: `agent_${task}`,
      tab_id: tab,
      target_id: `webcontents:${100 + i}`,
      agent_generation_epoch: 1,
      prompt_sha256: (i % 16).toString(16).repeat(64),
    });
    await journal.beginExecution(b);
    await journal.markConfirmed(b);
  }

  const snapshot = journal.snapshot();
  assert.equal(snapshot.entries.some((entry) => entry.task_id === TASK_A && entry.state === 'DELIVERY_PENDING'), true);
  assert.equal(snapshot.entries.filter((entry) => entry.state === 'CONFIRMED').length <= 31, true);
});

test('different task remains independent while exact lease identity remains unique', async () => {
  const { journal } = await fixture();
  await journal.beginExecution(binding());
  const other = binding({
    task_id: TASK_B,
    lease_generation: 1,
    agent_id: 'agent_22222222-2222-4222-8222-222222222222',
    tab_id: TAB_B,
    target_id: 'webcontents:22',
    agent_generation_epoch: 2,
    prompt_sha256: 'b'.repeat(64),
  });
  await journal.beginExecution(other);
  assert.equal(journal.snapshot().entries.length, 2);
});
