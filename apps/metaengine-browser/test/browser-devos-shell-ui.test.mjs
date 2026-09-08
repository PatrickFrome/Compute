import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const css = await readFile(new URL('../ui/app.css', import.meta.url), 'utf8');
const html = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');
const preload = await readFile(new URL('../src/preload-shell.cjs', import.meta.url), 'utf8');

test('DevOS migration never renames interactive controls through CSS generated content', () => {
  const source = `${css}\n${html}`;
  assert.doesNotMatch(source, /\.operationsToggle[^}]*font-size\s*:\s*0[\s\S]{0,240}::after\s*\{[^}]*content\s*:\s*["']Inspector["']/i);
  assert.doesNotMatch(source, /\.primaryLabel[^}]*font-size\s*:\s*0[\s\S]{0,240}::after\s*\{[^}]*content\s*:\s*["']New Session["']/i);
  assert.match(html, /id="operationsToggle"[^>]+aria-label="Open Brain"[^>]*>[\s\S]*?<span>Brain<\/span>/);
  assert.match(html, /id="newChat"[^>]+aria-label="New ChatGPT tab"[^>]*>[\s\S]*?<span class="primaryLabel">New Chat<\/span>/);
});

test('DevOS read model is promoted as session-first data without changing the command bridge', () => {
  assert.match(preload, /const candidate = value\?\.workspaces\?\.devos/);
  assert.match(preload, /schema === 'metaengine\.devos\.projection\.v1'/);
  assert.match(preload, /primary_object: 'SESSION'/);
  assert.match(preload, /browser_is_shell: false/);
  assert.match(preload, /browser_is_surface: true/);
  assert.match(preload, /command: \(command, payload\) => ipcRenderer\.invoke\('metaengine:shell:command'/);
  assert.doesNotMatch(preload, /devos[^\n]{0,120}(?:api\.command|SELF_UPDATE_APPLY|TYPED_CLICK|SEMANTIC_TYPE)/i);
});

test('DevOS presentation migration preserves explicit focus and minimum pointer target contracts', () => {
  assert.match(css, /button:focus-visible,input:focus-visible\{outline:2px solid #1767dc/);
  assert.match(css, /@media\(forced-colors:active\)/);
  assert.match(css, /outline:2px solid Highlight/);
  assert.match(css, /\.miniButton\{width:28px;height:28px/);
  assert.match(css, /\.tabClose\{width:26px;height:26px/);
  assert.match(css, /\.goButton\{width:28px;height:28px/);
  assert.match(css, /\.iconButton\{width:30px;height:30px/);
});

test('canonical shell remains the only presentation surface until pinned DevOS HTML migration lands', () => {
  assert.equal((html.match(/<script\b/g) || []).length, 2);
  assert.equal((html.match(/<style\b/g) || []).length, 1);
  assert.match(html, /data-adaptive-context-rail/);
  assert.doesNotMatch(html, /data-devos-overlay|devos-shadow-root|unsafe-inline|unsafe-eval/i);
});
