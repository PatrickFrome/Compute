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

test('R98 fleet and DevOS task dispatch advertise geometry-independent effects only', () => {
  const fleet = source('fleet-task-dispatcher.mjs');
  const cycle = source('devos-native-task-cycle-core.mjs');

  assert.match(fleet, /mouse_geometry_required:\s*false/);
  assert.match(fleet, /viewport_geometry_required:\s*false/);
  assert.match(cycle, /mouse_geometry_required:\s*false/);
  assert.match(cycle, /viewport_geometry_required:\s*false/);

  assert.equal(fleet.includes('Input.dispatchMouseEvent'), false);
  assert.equal(cycle.includes('Input.dispatchMouseEvent'), false);
});
