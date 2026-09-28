import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// R98 product contract: screen/layout coordinates are evidence only.
// Canonical Browser mutation must resolve an exact semantic/backend-node
// identity and actuate it without x/y dispatch.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..', 'src');

function source(name) {
  return fs.readFileSync(path.join(SRC, name), 'utf8');
}

test('R98 native semantic actuation contains no mouse-coordinate dispatch path', () => {
  const native = source('native-browser-control.mjs');
  for (const forbidden of [
    'Input.dispatchMouseEvent',
    'DOM.getBoxModel',
    'DOM.getNodeForLocation',
    'getContentQuads',
  ]) {
    assert.equal(native.includes(forbidden), false, `geometry-based canonical actuation regressed: ${forbidden}`);
  }

  assert.match(native, /DOM\.resolveNode/);
  assert.match(native, /Runtime\.callFunctionOn/);
  assert.match(native, /mouse_geometry_required:\s*false/);
  assert.match(native, /viewport_geometry_required:\s*false/);
});

test('R100 canonical DevOS task dispatch is the only fleet effect path and stays geometry-independent', () => {
  const removedDispatcher = path.join(SRC, 'fleet-task-dispatcher.mjs');
  const cycle = source('devos-native-task-cycle-core.mjs');

  assert.equal(fs.existsSync(removedDispatcher), false, 'duplicate fleet dispatcher authority must stay removed');
  assert.match(cycle, /mouse_geometry_required:\s*false/);
  assert.match(cycle, /viewport_geometry_required:\s*false/);
  assert.equal(cycle.includes('Input.dispatchMouseEvent'), false);
  assert.equal(cycle.includes('DOM.getBoxModel'), false);
});
