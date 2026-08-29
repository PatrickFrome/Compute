import test from 'node:test';
import assert from 'node:assert/strict';
import { DiagnosticBuffer, sanitizeDiagnosticUrl } from '../src/test-console-diagnostics.mjs';

test('diagnostic URL strips credentials, query and hash', () => {
  assert.equal(
    sanitizeDiagnosticUrl('https://user:secret@example.com/path/to/page?token=abc#section'),
    'https://example.com/path/to/page',
  );
  assert.equal(sanitizeDiagnosticUrl('not a url'), null);
});

test('diagnostic buffer is bounded and authority-free', () => {
  let now = Date.parse('2026-08-29T12:00:00.000Z');
  const buffer = new DiagnosticBuffer({ limit: 20, clock: () => now++ });
  for (let i = 0; i < 25; i++) buffer.record(i === 24 ? 'ERROR' : 'INFO', `EVENT_${i}`, { index: i });
  const snap = buffer.snapshot();
  assert.equal(snap.event_count, 20);
  assert.equal(snap.events[0].detail.index, 5);
  assert.equal(snap.events.at(-1).detail.index, 24);
  assert.equal(snap.events.at(-1).level, 'ERROR');
  assert.equal(snap.authority_effect, false);
  assert.equal(snap.events.every((row) => row.authority_effect === false), true);
});

test('clear removes rows without resetting monotonic sequence', () => {
  const buffer = new DiagnosticBuffer({ limit: 20, clock: () => 0 });
  buffer.record('INFO', 'FIRST', {});
  buffer.clear();
  buffer.record('WARN', 'SECOND', {});
  const snap = buffer.snapshot();
  assert.equal(snap.event_count, 1);
  assert.equal(snap.events[0].sequence, 2);
});

test('invalid diagnostic inputs fail closed', () => {
  const buffer = new DiagnosticBuffer({ limit: 20 });
  assert.throws(() => buffer.record('DEBUG', 'NOPE', {}), /level_invalid/);
  assert.throws(() => buffer.record('INFO', 'x', {}), /code_invalid/);
  assert.throws(() => buffer.record('INFO', 'VALID_CODE', []), /detail_invalid/);
});
