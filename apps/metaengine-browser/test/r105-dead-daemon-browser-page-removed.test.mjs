import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const deadBrowserPage = new URL('../../me2-ui/src/components/me2/pages/browser.tsx', import.meta.url);
const shell = await readFile(new URL('../../me2-ui/src/components/me2/shell/me2-shell.tsx', import.meta.url), 'utf8');
const store = await readFile(new URL('../../me2-ui/src/components/me2/store.tsx', import.meta.url), 'utf8');

test('R105 legacy daemon Browser page is physically removed after consumer migration', () => {
  assert.equal(fs.existsSync(deadBrowserPage), false);
  assert.doesNotMatch(shell, /BrowserPage|pages\/browser/);
  assert.doesNotMatch(store, /BrowserPage|pages\/browser/);
});

test('R105 Browser workspace remains the canonical native selected-agent surface', () => {
  assert.match(shell, /const mainWorkspace = page === "browser"/);
  assert.match(shell, /data-main-workspace=\{mainWorkspace \? "chat-fleet" : "advanced"\}/);
  assert.match(shell, /primaryChatFleetRoster/);
  assert.match(shell, /selectPrimaryChatActor/);
  assert.match(store, /\{ key: "browser", label: "BROWSER", num: "1" \}/);
});

test('R105 removed page cannot retain daemon browser-effect authority', () => {
  assert.doesNotMatch(shell, /\/browser\/effect|\/browser\/sense|\/browser\/obsv/);
  assert.doesNotMatch(store, /\/browser\/effect|\/browser\/sense|\/browser\/obsv/);
});
