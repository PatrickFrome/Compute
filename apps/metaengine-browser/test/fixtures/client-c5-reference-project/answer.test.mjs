import assert from 'node:assert/strict';
import test from 'node:test';

import { answer } from './answer.mjs';

test('reference useful-work fixture repairs answer to 42', () => {
  assert.equal(answer, 42);
});
