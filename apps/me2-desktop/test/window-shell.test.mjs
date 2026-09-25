import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createWindowShell } from '../src/core/window-shell.mjs';
class Window extends EventEmitter {
  constructor(opts) { super(); this.opts = opts; this.children = new Set(); this.contentView = {
    addChildView: v => this.children.add(v), removeChildView: v => this.children.delete(v) }; }
  getContentBounds() { return { width: 100, height: 100 }; }
}
class View {
  constructor(opts) {
    this.opts = opts; const wc = this.webContents = new EventEmitter();
    wc.dead = false; wc.isDestroyed = () => wc.dead;
    wc.focus = () => {}; wc.close = () => { wc.dead = true; wc.emit('destroyed'); };
    wc.session = {}; wc.setWindowOpenHandler = h => { wc.popup = h; };
    wc.mainFrame = { url: 'http://127.0.0.1:8137/' };
  }
  setBounds() {}
}
function setup() { return createWindowShell({ BrowserWindow: Window, WebContentsView: View, journal: { record() {} } }); }
test('multiple fleet views; preload only on control; sender and frame identity fenced', () => {
  const shell = setup();
  const main = shell.addView({ role: 'MAIN', url: 'http://127.0.0.1:8137/' }).view;
  const a = shell.addView({ role: 'FLEET', id: 'a' }).view;
  const b = shell.addView({ role: 'FLEET', id: 'b' }).view;
  assert.ok(main.opts.webPreferences.preload); assert.equal(a.opts.webPreferences.preload, undefined);
  assert.notEqual(main.opts.webPreferences.partition, a.opts.webPreferences.partition);
  assert.equal(shell.win.opts.webPreferences.preload, undefined);
  const event = { sender: main.webContents, senderFrame: main.webContents.mainFrame };
  assert.equal(shell.trustedSender(event), true);
  assert.equal(shell.trustedSender({ ...event, sender: a.webContents }), false);
  assert.equal(shell.trustedSender({ ...event, senderFrame: { url: event.senderFrame.url } }), false);
  main.webContents.mainFrame.url = 'https://chat.z.ai/'; assert.equal(shell.trustedSender(event), false);
  shell.activate('a'); shell.activate('b'); assert.deepEqual([...shell.win.children], [b]);
  shell.win.emit('closed'); assert.equal(a.webContents.dead, true); assert.equal(main.webContents.dead, true);
});
test('remote popups denied and control redirect cannot leave origin', () => {
  const shell = setup(); const main = shell.addView({ role: 'MAIN', url: 'http://127.0.0.1:8137/' }).view;
  let blocked = false;
  main.webContents.emit('will-redirect', { preventDefault: () => { blocked = true; } }, 'https://chat.z.ai/');
  assert.equal(blocked, true);
  assert.deepEqual(main.webContents.popup({ url: 'http://127.0.0.1:8137/' }), { action: 'deny' });
});
