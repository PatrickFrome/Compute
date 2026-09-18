import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

test('runtime fences reserved coordination before typing and before send click', async () => {
  const runtime = await fs.readFile(new URL('../src/supervisor-mesh-runtime.mjs', import.meta.url), 'utf8');

  assert.match(runtime, /fenceReservedCoordination\(reservation, this\.#mesh\.snapshot\(\)\)/);
  assert.match(runtime, /assertFencedReservationCurrent\(fencedReservation, this\.#mesh\.snapshot\(\)\)/);
  assert.match(runtime, /#assertDeliveryFenceCurrent\(delivery\)/);

  const typeIndex = runtime.indexOf("action: 'SEMANTIC_TYPE'");
  const clickIndex = runtime.indexOf("action: 'TYPED_CLICK'");
  assert.ok(typeIndex > 0, 'typed input actuation must exist');
  assert.ok(clickIndex > typeIndex, 'send click must occur after typed input');

  const beforeType = runtime.lastIndexOf('this.#assertDeliveryFenceCurrent(delivery);', typeIndex);
  const beforeClick = runtime.lastIndexOf('this.#assertDeliveryFenceCurrent(delivery);', clickIndex);
  assert.ok(beforeType > 0 && beforeType < typeIndex, 'fence must be revalidated immediately before typing');
  assert.ok(beforeClick > typeIndex && beforeClick < clickIndex, 'fence must be revalidated again before send click');

  assert.match(runtime, /FENCE_REJECTED_NO_SEND/);
  assert.match(runtime, /NO_SEND_EFFECT:/);
  assert.match(runtime, /authority_effect: false/);
});
