import assert from 'node:assert/strict';
import test from 'node:test';

import { answer } from './answer.mjs';

test('live C5 bounded repair sets answer to 42', () => {
  assert.equal(answer, 42);
});
