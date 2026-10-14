import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ui = readFileSync(fileURLToPath(new URL('../components/me2/pages/operator-observatory.tsx', import.meta.url)), 'utf8');

test('all seven views use one reducer checkpoint and never independent side-channel state', () => {
  assert.match(ui, /const checkpoint = useRef<[^\n]+>\(emptyOperatorObservatoryResync\(\)\)/);
  assert.match(ui, /const projection = resync\.projection;/);
  assert.match(ui, /OBSERVATORY_VIEWS\[view\]/);
  assert.match(ui, /const names = OBSERVATORY_VIEWS\[view\]/);
  assert.equal((ui.match(/bridge\.readContext\(/g) ?? []).length, 1);
});

test('explicit resync button is never an implicit reset or automatic recovery', () => {
  assert.match(ui, /data-testid="operator-observatory-explicit-resync"/);
  assert.match(ui, /onClick=\{\(\) => void refresh\(true\)\}/);
  assert.match(ui, /intent: explicitResync \? "EXPLICIT_RESYNC" : "POLL"/);
  assert.match(ui, /checkpoint\.current\.requires_explicit_resync && !explicitResync/);
  assert.match(ui, /disabled=\{connection === "READING" \|\| resync\.requires_explicit_resync\}/);
});

test('clock expiry hides stale state and Owner/source are only projected from a verified identity', () => {
  assert.match(ui, /expireOperatorObservatoryResync\(checkpoint\.current\)/);
  assert.match(ui, /resync\.identity\?\.owner_epoch \?\? "UNKNOWN"/);
  assert.match(ui, /resync\.identity\?\.source_sha \?\? "UNKNOWN"/);
  assert.match(ui, /resync\.requires_explicit_resync[\s\S]*?AMBIGUOUS:/);
});

test('renderer does not gain HTTP, storage, token, SQL or scheduler authority', () => {
  for (const forbidden of [
    /(?:window\.)?fetch\s*\(/, /XMLHttpRequest/, /localStorage/, /sessionStorage/,
    /axios/, /sendCommand\s*\(/, /submitGoal\s*\(/, /webSocket/i,
    /query\s*\(/, /executeSql\s*\(/, /supabase/i, /apiKey\s*:/i,
  ]) assert.doesNotMatch(ui, forbidden);
  assert.match(ui, /data-authority-effect="false"/);
});
