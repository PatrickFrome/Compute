import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const path = fileURLToPath(new URL('../components/me2/pages/operator-observatory.tsx', import.meta.url));
const page = readFileSync(path, 'utf8');

test('Now/Missions/Fleet project ONE seven-view resync state, with no secondary native reads', () => {
  assert.match(page, /const projection = resync\.projection/);
  assert.match(page, /projectPrimaryOperatorView\(resync, view, \{ delivery, firstTruthMs \}\)/);
  assert.match(page, /view === "Now" \|\| view === "Missions" \|\| view === "Fleet"/);
  assert.equal((page.match(/bridge\.readContext\(/g) ?? []).length, 1);
  assert.match(page, /const checkpoint = useRef<[^\n]+>\(emptyOperatorObservatoryResync\(\)\)/);
});
test('first source-bound cursor is measured after a tracking frame, not at mount or HTTP success', () => {
  assert.match(page, /firstReadStart\.current \?\?= performance\.now\(\)/);
  assert.match(page, /next\.mode === "TRACKING" && firstReadStart\.current !== null/);
  assert.match(page, /setFirstTruthMs\(previous => previous \?\? elapsed\)/);
  assert.match(page, /data-testid="operator-primary-ttft"/);
});
test('bounded initial loading, native reader unbound, timeout and opaque error each have explicit boundaries', () => {
  assert.match(page, /useState<PrimaryDelivery>\("LOADING"\)/);
  assert.match(page, /setDelivery\("UNBOUND"\)/);
  assert.match(page, /setDelivery\(checkpoint\.current\.mode === "TRACKING" \? "READING" : "LOADING"\)/);
  assert.match(page, /"TIMED_OUT" : "FAILED"/);
  assert.match(page, /data-testid="operator-primary-boundary"/);
  assert.match(page, /data-testid="operator-primary-missing"/);
});
test('no daemon, legacy workspace, hosted fallback, local storage, or independent HTTP authority', () => {
  for (const forbidden of [
    /(?:window\.)?fetch\s*\(/, /XMLHttpRequest/, /localStorage/, /sessionStorage/,
    /axios/, /supabase/i, /submitGoal\s*\(/, /sendCommand\s*\(/,
    /legacyWorkspace/, /daemonSnapshot/, /primaryChatFleetRoster\s*\(/,
  ]) assert.doesNotMatch(page, forbidden);
  assert.match(page, /data-authority-effect="false"/);
  assert.match(page, /expireOperatorObservatoryResync\(checkpoint\.current\)/);
});
