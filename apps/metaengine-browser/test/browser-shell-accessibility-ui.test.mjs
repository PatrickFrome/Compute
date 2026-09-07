import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const css = await readFile(new URL('../ui/app.css', import.meta.url), 'utf8');
const html = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../ui/app.js', import.meta.url), 'utf8');

test('health labels remain available to assistive technology while staying visually compact', () => {
  const hardening = css.lastIndexOf('.systemChip b,.systemChip .systemValue{');
  assert.notEqual(hardening, -1);
  const rule = css.slice(hardening, css.indexOf('}', hardening) + 1);
  assert.match(rule, /display:block!important/);
  assert.match(rule, /position:absolute!important/);
  assert.match(rule, /clip-path:inset\(50%\)!important/);
  assert.doesNotMatch(rule, /display:none/);
});

test('frequent health snapshots remain readable without becoming repetitive live announcements', () => {
  assert.match(html, /id="systems" class="systems" aria-label="Browser health" aria-live="off"/);
  assert.match(html, /id="fleetStatus"[\s\S]*?<b>Fleet<\/b><span class="systemValue">…<\/span>/);
  assert.match(html, /id="gateStatus"[\s\S]*?<b>Gates<\/b><span class="systemValue">…<\/span>/);
});

test('narrow final shell keeps compact health state visible instead of hiding it', () => {
  const hardening = css.indexOf('Accessibility/readability hardening');
  assert.notEqual(hardening, -1);
  const tail = css.slice(hardening);
  assert.match(tail, /@media\(max-width:1180px\)\{[\s\S]*?body\[data-final-shell="telegram-browser-v1"\] \.systems\{display:flex!important/);
});

test('omnibox route mode returns to the selected tab after command prefixes are removed', () => {
  const start = app.indexOf('function updateWorkbenchRouteKind()');
  assert.notEqual(start, -1);
  const end = app.indexOf('installAgenticNav();', start);
  assert.notEqual(end, -1);
  const fn = app.slice(start, end);
  assert.match(fn, /routeKind\.textContent = 'CMD'/);
  assert.match(fn, /routeKind\.textContent = 'TAB'/);
  assert.match(fn, /routeKind\.textContent = 'SKILL'/);
  assert.match(fn, /const tab = selectedTab\(snapshot\)/);
  assert.match(fn, /routeKind\.textContent = chat \? 'CHAT' : 'WEB'/);
  assert.match(fn, /routeKind\.classList\.toggle\('chat', chat\)/);
  assert.match(app, /address\.value = '>';[\s\S]*?routeKind\.classList\.remove\('chat'\)/);
});

test('Brain evidence is selectable without making command controls selectable text', () => {
  assert.match(css, /\.opsContent,\.activeContext,\.kvList,\.entityRow\{user-select:text\}/);
  assert.match(css, /\.opsContent button,\.activeContext button\{user-select:none\}/);
});

test('critical final-shell metadata no longer resolves to seven or eight pixel text', () => {
  const hardening = css.indexOf('Accessibility/readability hardening');
  assert.notEqual(hardening, -1);
  const tail = css.slice(hardening);
  for (const selector of ['.routeKind', '#activeMeta', '.tabCopy small', '.opsEyebrow', '.brainPresence', '.heroBadge', '.metricCard span', '.tinyTag', '.opsLegend']) {
    assert.match(tail, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(tail, /font-size:9px!important/);
  assert.match(tail, /font-size:10px!important/);
});

test('keyboard focus and forced-colors modes have explicit non-subtle indicators', () => {
  const hardening = css.indexOf('Accessibility/readability hardening');
  const tail = css.slice(hardening);
  assert.match(tail, /button:focus-visible,input:focus-visible\{outline:2px solid #1767dc/);
  assert.match(tail, /@media\(forced-colors:active\)/);
  assert.match(tail, /outline:2px solid Highlight/);
});

test('compact shell pointer controls keep at least the WCAG 2.2 AA 24px target floor', () => {
  assert.match(css, /\.miniButton\{width:28px;height:28px/);
  assert.match(css, /\.tabClose\{width:26px;height:26px/);
  assert.match(css, /\.goButton\{width:28px;height:28px/);
  assert.match(css, /\.iconButton\{width:30px;height:30px/);
});
