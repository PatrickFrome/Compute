import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import {
  projectRsiBrainObservation,
  RsiBrowserObservationFeed,
} from '../src/rsi-browser-observation-feed.mjs';

function brain(overrides = {}) {
  return {
    schema: 'metaengine.browser-brain.working-memory.v1',
    cells: [{
      status: 'READY',
      tab_id: 'tab_private_should_not_cross_boundary',
      page_text: 'secret page text',
      last_command: { status: 'COMPLETED', effect_outcome: 'CONFIRMED', payload: { secret: true } },
    }],
    global: { process_revision: 4, cognitive_sequence: 7, dropped_events: 0 },
    raw_dom_stored: false,
    raw_network_stored: false,
    page_text_stored: false,
    input_values_stored: false,
    command_payload_stored: false,
    execution_authority: false,
    authority_effect: false,
    ...overrides,
  };
}

test('RSI Brain observation projection is a strict zero-authority privacy boundary', () => {
  const projected = projectRsiBrainObservation(brain());
  assert.equal(projected.schema, 'metaengine.browser-brain.working-memory.v1');
  assert.equal(projected.cells.length, 1);
  assert.deepEqual(projected.cells[0], {
    status: 'READY',
    last_command: { status: 'COMPLETED', effect_outcome: 'CONFIRMED' },
  });
  assert.equal(JSON.stringify(projected).includes('secret page text'), false);
  assert.equal(JSON.stringify(projected).includes('tab_private_should_not_cross_boundary'), false);
  assert.equal(projected.execution_authority, false);
  assert.equal(projected.authority_effect, false);
});

test('observation feed keeps one in-flight and one latest pending observation', async () => {
  let releaseFirst;
  const delivered = [];
  const feed = new RsiBrowserObservationFeed({
    observe: async (snapshot) => {
      delivered.push(snapshot.global.cognitive_sequence);
      if (delivered.length === 1) await new Promise((resolve) => { releaseFirst = resolve; });
    },
  });

  const first = feed.offer(brain({ global: { process_revision: 1, cognitive_sequence: 1, dropped_events: 0 } }));
  assert.equal(first.accepted, true);
  feed.offer(brain({ global: { process_revision: 1, cognitive_sequence: 2, dropped_events: 0 } }));
  const third = feed.offer(brain({ global: { process_revision: 1, cognitive_sequence: 3, dropped_events: 0 } }));
  assert.equal(third.coalesced, true);
  assert.equal(feed.snapshot().max_pending_observations, 1);
  assert.equal(feed.snapshot().pending_latest, true);

  releaseFirst();
  await feed.flush();

  assert.deepEqual(delivered, [1, 3]);
  assert.equal(feed.snapshot().delivered_count, 2);
  assert.equal(feed.snapshot().coalesced_count, 1);
  assert.equal(feed.snapshot().pending_latest, false);
});

test('authority-bearing or privacy-bearing Brain snapshots are rejected without throwing into Browser hot path', () => {
  const feed = new RsiBrowserObservationFeed({ observe: async () => {} });
  const authority = feed.offer(brain({ authority_effect: true }));
  const privacy = feed.offer(brain({ page_text_stored: true }));
  assert.equal(authority.accepted, false);
  assert.equal(privacy.accepted, false);
  assert.equal(feed.snapshot().rejected_count, 2);
  assert.equal(feed.snapshot().authority_effect, false);
});

test('feed implementation has no dedicated timer, scheduler, lease, or retry loop', async () => {
  const source = await fs.readFile(new URL('../src/rsi-browser-observation-feed.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /setInterval\(|setTimeout\(/);
  assert.match(source, /max_pending_observations: 1/);
  assert.match(source, /second_scheduler: false/);
  assert.match(source, /command_leasing: false/);
  assert.match(source, /automatic_retry_allowed: false/);
});
