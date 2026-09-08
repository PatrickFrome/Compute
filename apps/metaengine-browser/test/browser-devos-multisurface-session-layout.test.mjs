import test from 'node:test';
import assert from 'node:assert/strict';
import { createDevOSSessionLayoutRegistry } from '../src/metaengine-devos-session-layout.mjs';

test('per-session multi-surface layout is independent, revisioned and restored', () => {
  const registry = createDevOSSessionLayoutRegistry();
  registry.activate('session:a');
  const a = registry.setSurfaceLayout('session:a', 'GRID_2X2');
  registry.activate('session:b');
  const b = registry.setRequested('session:b', { surface_layout: 'SPLIT_HORIZONTAL' });
  assert.equal(a.requested_surface_layout, 'GRID_2X2');
  assert.equal(b.requested_surface_layout, 'SPLIT_HORIZONTAL');
  assert.equal(registry.get('session:a').requested_surface_layout, 'GRID_2X2');

  const restored = createDevOSSessionLayoutRegistry();
  restored.restore(registry.snapshot());
  assert.equal(restored.get('session:a').requested_surface_layout, 'GRID_2X2');
  assert.equal(restored.get('session:b').requested_surface_layout, 'SPLIT_HORIZONTAL');
});

test('legacy layout checkpoint without requested_surface_layout restores as AUTO', () => {
  const registry = createDevOSSessionLayoutRegistry();
  registry.activate('session:a');
  const legacy = structuredClone(registry.snapshot());
  delete legacy.entries[0].requested_surface_layout;
  const restored = createDevOSSessionLayoutRegistry();
  restored.restore(legacy);
  assert.equal(restored.get('session:a').requested_surface_layout, 'AUTO');
});

test('invalid surface layout is rejected before state mutation', () => {
  const registry = createDevOSSessionLayoutRegistry();
  const before = registry.ensure('session:a');
  assert.throws(() => registry.setSurfaceLayout('session:a', 'FLOATING_CANVAS'), /surface_layout_invalid/);
  const after = registry.get('session:a');
  assert.equal(after.requested_surface_layout, before.requested_surface_layout);
  assert.equal(after.revision, before.revision);
});
