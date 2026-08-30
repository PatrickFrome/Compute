import assert from 'node:assert/strict';
import test from 'node:test';
import { executeTypedKeyPress, normalizeTypedKey, setIsolatedZoom } from '../src/browser-input-view-control.mjs';

test('typed key normalizes primary modifier per platform and emits exactly keyDown/keyUp', () => {
  const events = [];
  const webContents = {
    isDestroyed: () => false,
    sendInputEvent: (event) => events.push(structuredClone(event)),
  };
  const result = executeTypedKeyPress(webContents, { key: 'l', modifiers: ['PRIMARY', 'SHIFT'] }, { platform: 'win32' });
  assert.deepEqual(events, [
    { type: 'keyDown', keyCode: 'L', modifiers: ['control','shift'] },
    { type: 'keyUp', keyCode: 'L', modifiers: ['control','shift'] },
  ]);
  assert.equal(result.key_code, 'L');
  assert.deepEqual(result.modifiers, ['control','shift']);
  assert.equal(result.arbitrary_text, false);
  assert.equal(result.authority_effect, true);
});

test('typed key supports navigation/function keys but rejects arbitrary key strings and modifiers', () => {
  assert.deepEqual(normalizeTypedKey({ key:'Escape', modifiers:[] }), { key_code:'Escape', modifiers:[] });
  assert.deepEqual(normalizeTypedKey({ key:'F12', modifiers:['CTRL'] }, { platform:'linux' }), { key_code:'F12', modifiers:['control'] });
  assert.throws(() => normalizeTypedKey({ key:'javascript:alert(1)', modifiers:[] }), /browser_key_not_allowlisted|browser_key_invalid/);
  assert.throws(() => normalizeTypedKey({ key:'A', modifiers:['SUPERSECRET'] }), /browser_key_modifier_not_allowlisted/);
});

test('isolated zoom requires Electron 44 backend, bounds factor and verifies readback', () => {
  const calls = [];
  let zoom = 1;
  const webContents = {
    isDestroyed: () => false,
    setZoomMode: (mode) => calls.push(['mode', mode]),
    setZoomFactor: (factor) => { zoom = factor; calls.push(['factor', factor]); },
    getZoomFactor: () => zoom,
  };
  const result = setIsolatedZoom(webContents, { factor:1.25 });
  assert.deepEqual(calls, [['mode','isolated'], ['factor',1.25]]);
  assert.equal(result.mode, 'isolated');
  assert.equal(result.factor, 1.25);
  assert.equal(result.readback_factor, 1.25);
  assert.equal(result.authority_effect, true);
  assert.throws(() => setIsolatedZoom(webContents, { factor:0.49 }), /browser_zoom_factor_out_of_range/);
  assert.throws(() => setIsolatedZoom(webContents, { factor:3.01 }), /browser_zoom_factor_out_of_range/);
});

test('isolated zoom fails closed if readback disagrees', () => {
  const webContents = {
    isDestroyed: () => false,
    setZoomMode: () => {},
    setZoomFactor: () => {},
    getZoomFactor: () => 1,
  };
  assert.throws(() => setIsolatedZoom(webContents, { factor:1.5 }), /browser_zoom_readback_mismatch/);
});
