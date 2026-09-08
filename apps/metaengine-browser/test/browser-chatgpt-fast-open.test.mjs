import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const main = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');

test('ChatGPT interactive open preconnects the persistent authenticated session', () => {
  assert.match(main, /userSession\.preconnect\(\{ url: 'https:\/\/chatgpt\.com\/', numSockets: 2 \}\)/);
  assert.match(main, /user_space_partition/);
  assert.doesNotMatch(main, /preconnect[\s\S]{0,220}(setInterval|setTimeout|retry)/i);
});

test('New Chat selects and exposes the exact WebContents before network completion without retry authority', () => {
  assert.match(main, /NEW_CHATGPT'\) return createTab\('https:\/\/chatgpt\.com\/', \{ select: true, load: true, awaitLoad: false \}\)/);
  const start = main.indexOf('async function createTab(');
  const end = main.indexOf('async function loadTab(', start);
  const fn = main.slice(start, end);
  assert.ok(fn.indexOf('registry.select(tab.tab_id)') < fn.indexOf('view.webContents.loadURL(d.normalized_url)'));
  assert.ok(fn.indexOf('attachSelected()') < fn.indexOf('view.webContents.loadURL(d.normalized_url)'));
  assert.match(fn, /if \(awaitLoad\) await pendingLoad/);
  assert.match(fn, /load_pending: load && !awaitLoad/);
  assert.doesNotMatch(fn, /retry|setTimeout|setInterval/i);
});

test('native Electron chrome is dark but remote content policy is unchanged', () => {
  assert.match(main, /nativeTheme\.themeSource = 'dark'/);
  assert.match(main, /REMOTE_WEB_PREFERENCES/);
  assert.doesNotMatch(main, /nodeIntegration:\s*true/);
});
