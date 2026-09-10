import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const mainPath = path.resolve('src/main.mjs');
const rawSource = fs.readFileSync(mainPath, 'utf8');
const source = rawSource.replace(/\r\n/g, '\n');

function exactFunction(name, nextName) {
  const pattern = new RegExp(`async function ${name}\\([^]*?\\n\\}\\n\\nasync function ${nextName}`);
  const match = source.match(pattern);
  assert.ok(match, `${name}_function_not_found`);
  return match[0];
}

test('runtime source normalization preserves semantic extraction across LF and CRLF checkouts', () => {
  const crlf = source.replace(/\n/g, '\r\n');
  assert.equal(crlf.replace(/\r\n/g, '\n'), source);
  assert.match(source, /async function createTab\(/);
  assert.match(source, /async function loadTab\(/);
});

test('runtime imports the bounded navigation primitive exactly once', () => {
  const needle = "import { boundedNavigation } from './bounded-navigation.mjs';";
  assert.equal(source.split(needle).length - 1, 1);
});

test('createTab bounds remote load while preserving confirmed tab-creation effect', () => {
  const body = exactFunction('createTab', 'loadTab');
  assert.match(body, /boundedNavigation\(view\.webContents, d\.normalized_url\)/);
  assert.doesNotMatch(body, /view\.webContents\.loadURL\(d\.normalized_url\)/);
  assert.match(body, /effect_outcome:\s*'CONFIRMED'/);
  assert.match(body, /automatic_retry_allowed:\s*false/);
});

test('loadTab maps every non-confirmed bounded navigation to ambiguous with no retry', () => {
  const body = exactFunction('loadTab', 'closeTab');
  assert.match(body, /const navigation = await boundedNavigation\(view\.webContents, d\.normalized_url\)/);
  assert.match(body, /navigation\.state === 'CONFIRMED'/);
  assert.match(body, /effect_outcome:\s*confirmed \? 'CONFIRMED' : 'AMBIGUOUS'/);
  assert.match(body, /automatic_retry_allowed:\s*false/);
  assert.doesNotMatch(body, /view\.webContents\.loadURL\(/);
});

test('selected NAVIGATE delegates to loadTab instead of owning another loadURL path', () => {
  const start = source.indexOf("  if (command === 'NAVIGATE') {");
  const end = source.indexOf("  if (command === 'BACK')", start);
  assert.ok(start >= 0 && end > start, 'navigate_command_block_not_found');
  const block = source.slice(start, end);
  assert.match(block, /return loadTab\(selected\.tab_id, payload\?\.url\)/);
  assert.doesNotMatch(block, /loadURL\(/);
  assert.doesNotMatch(source, /selectedView\.webContents\.loadURL/);
});

test('ambiguous post-navigation registry update accepts only policy-approved observed URL', () => {
  const body = exactFunction('loadTab', 'closeTab');
  assert.match(body, /else if \(navigation\.post_url\)/);
  assert.match(body, /const observed = navigationDecision\(navigation\.post_url\)/);
  assert.match(body, /if \(observed\.allow\) registry\.update/);
});
