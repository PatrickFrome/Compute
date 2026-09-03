import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourceUrl = new URL('../ui/app.js', import.meta.url);
const source = await readFile(sourceUrl, 'utf8');

function functionSlice(name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = nextName ? source.indexOf(`function ${nextName}(`, start + 1) : source.length;
  assert.notEqual(end, -1, `${nextName} must exist after ${name}`);
  return source.slice(start, end);
}

test('Agentic Workbench exposes keyboard-first routing without replacing normal URL navigation', () => {
  assert.match(source, /AGENTIC_CONTEXT_STORAGE_KEY/);
  assert.match(source, /AGENTIC_CONTEXT_MAX_TABS = 8/);
  assert.match(source, /event\.key\.toLowerCase\(\) === 'k'/);
  assert.match(source, /address\.value = '>'/);
  assert.match(source, /\^\[>@\/\]/);
  assert.match(source, /api\.command\('NAVIGATE', \{ url: address\.value \}\)/);
});

test('tab routing is ambiguity-safe: only one match selects a tab', () => {
  const route = functionSlice('executeWorkbenchAddress', 'updateWorkbenchRouteKind');
  assert.match(route, /matches\.length === 1/);
  assert.match(route, /api\.command\('SELECT_TAB'/);
  assert.match(route, /tabFilter = query/);
  assert.match(route, /renderContextRail\(snapshot\)/);
  assert.doesNotMatch(route, /matches\[0\].*matches\.length > 1/s);
});

test('Attention derives only from trusted shell projections and has no actuator', () => {
  const attention = functionSlice('attentionQueue', 'installAgenticNav');
  assert.match(attention, /fleet/);
  assert.match(attention, /workspaceProjection/);
  assert.match(attention, /supervisor/);
  assert.match(attention, /self_update/);
  assert.doesNotMatch(attention, /perception|text_excerpt|semantic_targets|page_content/i);
  assert.doesNotMatch(attention, /api\.command|executeSemantic|TYPED_CLICK|SEMANTIC_TYPE|STOP_GENERATION/);
});

test('Workbench Skills remain bounded and do not create a page/model authority path', () => {
  const skills = functionSlice('renderSkills', 'renderAgenticSection');
  assert.match(skills, /Research Focus/);
  assert.match(skills, /Triage Attention/);
  assert.match(skills, /Authority Review/);
  assert.match(skills, /New ChatGPT tab/);
  assert.doesNotMatch(skills, /SEMANTIC_TYPE|TYPED_CLICK|STOP_GENERATION|GATE_DISABLE|SELF_UPDATE_APPLY|DOWNLOAD_FILE/);
  assert.match(skills, /Arbitrary eval', 'FORBIDDEN'/);
  assert.match(skills, /Automatic effect retry', 'NONE'/);
});

test('Context Set stores bounded tab identities rather than page content', () => {
  const load = functionSlice('loadAgenticContextTabIds', 'persistAgenticContextTabIds');
  const rows = functionSlice('agenticContextRows', 'attentionQueue');
  assert.match(load, /slice\(0, AGENTIC_CONTEXT_MAX_TABS\)/);
  assert.match(rows, /tab_id/);
  assert.doesNotMatch(rows, /text_excerpt|semantic_targets|page_content|document\.body/i);
  assert.match(source, /Page text persistence', 'NONE'/);
  assert.match(source, /Scheduler authority', 'NONE'/);
  assert.match(source, /Browser actuation authority', 'NONE'/);
});

test('Agentic workbench source contains no arbitrary evaluation primitive', () => {
  assert.doesNotMatch(source, /\beval\s*\(/);
  assert.doesNotMatch(source, /new\s+Function\s*\(/);
  assert.doesNotMatch(source, /child_process|execSync|spawnSync/);
});
