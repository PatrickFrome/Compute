import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// D-U1 (2026-09-19, live recon): TYPED_CLICK / PRESS_KEY receipts carry the
// effect-runtime-bound target they dispatched to; without a classifier every
// operator recon click/keypress landed in the AMBIGUOUS quarantine
// (postcondition_not_confirmed:AMBIGUOUS) even when the effect ran.

const base = fileURLToPath(new URL('../src/native-supervisor-client-base.mjs', import.meta.url));
const source = readFileSync(base, 'utf8');

test('D-U1: TYPED_CLICK and PRESS_KEY have honest effect-outcome classifiers', () => {
  assert.match(source, /action === 'TYPED_CLICK' \|\| action === 'PRESS_KEY'/);
  assert.match(source, /result\?\.target && \(result\?\.point \|\| result\?\.key\)\) return 'CONFIRMED'/);
});

// D-C2: the server cycle route leases one task per idle agent and returns the
// batch alongside the legacy single-lease field.

const routes = readFileSync(fileURLToPath(new URL('../supabase/a2-browser-native-supervisor-v1/devos-routes.mjs', import.meta.url)), 'utf8');

test('D-C2: server cycle collects a lease batch (leases[]) with the single lease kept for compatibility', () => {
  assert.match(routes, /leases\.push\(result\)/);
  assert.match(routes, /lease=leases\[0\]\|\|null/);
  assert.match(routes, /,leases,/);
  // Backpressure and transport fences still stop the scan.
  assert.match(routes, /if\(backpressure\)break;/);
  // The fenced response carries the empty batch for shape consistency.
  assert.match(routes, /lease:null,leases:\[\]/);
});

// D-U1 companion: the KEY_ATOMIC Ctrl+A dispatch carries windowsVirtualKeyCode
// (the missing keyCode made select-all a non-event for keyCode-keyed editors).

const control = readFileSync(fileURLToPath(new URL('../src/native-browser-control.mjs', import.meta.url)), 'utf8');

test('D-U1: every Ctrl+A dispatch carries windowsVirtualKeyCode 65', () => {
  const ctrlADispatches = control.match(/Input\.dispatchKeyEvent[^}]*key:'a'[^}]*}/g) || [];
  assert.ok(ctrlADispatches.length >= 2, 'both the verified and the legacy replace lane dispatch Ctrl+A');
  for (const dispatch of ctrlADispatches) {
    assert.match(dispatch, /windowsVirtualKeyCode:65/, `Ctrl+A dispatch must carry the keyCode: ${dispatch.slice(0, 120)}`);
  }
});
