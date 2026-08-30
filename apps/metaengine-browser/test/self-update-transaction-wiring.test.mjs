import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

test('handoff is durably wired to transaction journal and startup ambiguity', async () => {
  const source = await fs.readFile(new URL('../src/self-update-handoff.mjs', import.meta.url), 'utf8');
  assert.match(source, /beginSelfUpdateTransaction/);
  assert.match(source, /transitionIfPresent\(app, 'AMBIGUOUS_INSTALL'/);
  assert.match(source, /transitionIfPresent\(app, 'SUCCESSOR_BOOTED'/);
  assert.match(source, /qualifyUpdatedSuccessor/);
});
