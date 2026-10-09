import assert from 'node:assert/strict';
import test from 'node:test';
import { captureEventLogWindow, eventLogWindow } from '../../me2-ui/src/lib/event-log-window.ts';

test('paused inspection retains older events while fresh agent events arrive', () => {
  const original = [{ seq: 8, agent_id: 'implementer' }, { seq: 7, agent_id: 'critic' }];
  const paused = captureEventLogWindow(original);
  const incoming = [{ seq: 10 }, { seq: 9 }, ...original];
  const view = eventLogWindow(incoming, paused);
  assert.deepEqual(view.events.map((event) => event.seq), [8, 7]);
  assert.equal(view.newerBufferedCount, 2);
  assert.equal(view.paused, true);
});

test('bounded transport eviction and array mutation cannot erase a paused investigation', () => {
  const buffer = [{ seq: 4 }, { seq: 3 }];
  const paused = captureEventLogWindow(buffer);
  buffer.splice(0, buffer.length, { seq: 100 }, { seq: 99 });
  const view = eventLogWindow(buffer, paused);
  assert.deepEqual(view.events.map((event) => event.seq), [4, 3]);
  assert.equal(view.newerBufferedCount, 2); // Only retained events; not a fabricated total since pause.
  assert.ok(Object.isFrozen(paused));
});

test('pausing an empty log stays empty until explicitly resumed', () => {
  const paused = captureEventLogWindow([]);
  const current = [{ seq: 2 }, { seq: 1 }];
  assert.deepEqual(eventLogWindow(current, paused), { events: [], paused: true, newerBufferedCount: 2 });
  const live = eventLogWindow(current, null);
  assert.equal(live.events, current);
  assert.equal(live.paused, false);
  assert.equal(live.newerBufferedCount, 0);
});

test('pause watermark handles reordered input without counting existing events as new', () => {
  const paused = captureEventLogWindow([{ seq: 5 }, { seq: 9 }, { seq: 7 }]);
  assert.equal(eventLogWindow([{ seq: 7 }, { seq: 10 }, { seq: 9 }], paused).newerBufferedCount, 1);
});
