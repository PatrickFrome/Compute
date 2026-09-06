import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const css = await readFile(new URL('../ui/app.css', import.meta.url), 'utf8');

test('health labels remain available to assistive technology while staying visually compact', () => {
  const hardening = css.lastIndexOf('.systemChip b,.systemChip .systemValue{');
  assert.notEqual(hardening, -1);
  const rule = css.slice(hardening, css.indexOf('}', hardening) + 1);
  assert.match(rule, /display:block!important/);
  assert.match(rule, /position:absolute!important/);
  assert.match(rule, /clip-path:inset\(50%\)!important/);
  assert.doesNotMatch(rule, /display:none/);
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
