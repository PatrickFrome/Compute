import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const css = await readFile(new URL('../ui/app.css', import.meta.url), 'utf8');
const dark = await readFile(new URL('../ui/dark-workspace.css', import.meta.url), 'utf8');
const html = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../ui/app.js', import.meta.url), 'utf8');

test('health labels remain assistive while compact dots stay visible in dark mode', () => {
  const hardening = css.lastIndexOf('.systemChip b,.systemChip .systemValue{');
  assert.notEqual(hardening, -1);
  const rule = css.slice(hardening, css.indexOf('}', hardening) + 1);
  assert.match(rule, /clip-path:inset\(50%\)!important/);
  assert.match(html, /id=\"systems\" class=\"systems\" aria-label=\"Browser health\" aria-live=\"off\"/);
  assert.match(dark, /@media\(max-width:1120px\)[\s\S]*\.systems\{display:flex!important/);
});

test('dark workspace keeps readable metadata and strong focus states', () => {
  for (const size of ['font-size:9px', 'font-size:9.5px', 'font-size:10px', 'font-size:10.5px']) assert.match(dark, new RegExp(size.replace('.', '\\.')));
  assert.match(dark, /outline:2px solid var\(--accent\)/);
  assert.match(dark, /@media\(forced-colors:active\)/);
  assert.match(dark, /outline:2px solid Highlight/);
});

test('pointer controls preserve the 24px target floor', () => {
  assert.match(dark, /\.miniButton\{width:28px;height:28px/);
  assert.match(dark, /\.tabClose\{width:26px;height:26px/);
  assert.match(dark, /\.goButton\{width:27px;height:27px/);
  assert.match(dark, /\.iconButton\{width:28px;height:28px/);
});

test('omnibox route mode still returns to selected Chat or Web surface', () => {
  const start = app.indexOf('function updateWorkbenchRouteKind()');
  const end = app.indexOf('installAgenticNav();', start);
  const fn = app.slice(start, end);
  assert.match(fn, /routeKind\.textContent = 'CMD'/);
  assert.match(fn, /routeKind\.textContent = 'TAB'/);
  assert.match(fn, /routeKind\.textContent = 'SKILL'/);
  assert.match(fn, /routeKind\.textContent = chat \? 'CHAT' : 'WEB'/);
});
