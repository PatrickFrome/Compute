import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entryPath = path.resolve(__dirname, '../src/main-entry.mjs');

async function source() {
  return fs.readFile(entryPath, 'utf8');
}

function branchBody(text, marker, nextMarker) {
  const start = text.indexOf(marker);
  assert.notEqual(start, -1, `missing marker: ${marker}`);
  const end = nextMarker ? text.indexOf(nextMarker, start + marker.length) : text.length;
  assert.ok(end > start, `missing next marker: ${nextMarker}`);
  return text.slice(start, end);
}

test('AMBIGUOUS_INSTALL bootstrap hold never globally disables the self-update control plane', async () => {
  const text = await source();
  const body = branchBody(
    text,
    "if (startupUpdateInspection?.state === 'AMBIGUOUS_INSTALL')",
    '\n  let updateHandoff = null;',
  );
  assert.match(body, /METAENGINE_SELF_UPDATE_HOLD_REASON\s*=\s*'AMBIGUOUS_INSTALL'/);
  assert.match(body, /METAENGINE_SELF_UPDATE_HOLD_TARGET/);
  assert.doesNotMatch(body, /METAENGINE_DISABLE_SELF_UPDATE/);
  // The hold log spreads the already fail-closed startup inspection rather than
  // manufacturing a second retry policy in the bootstrap layer.
  assert.match(body, /\.\.\.startupUpdateInspection/);
  assert.match(text, /automatic_retry_allowed:\s*false/);
});

test('SUCCESSOR_RECEIPT_AMBIGUOUS bootstrap hold never globally disables the self-update control plane', async () => {
  const text = await source();
  const body = branchBody(
    text,
    "METAENGINE_SELF_UPDATE_HOLD_REASON = 'SUCCESSOR_RECEIPT_AMBIGUOUS'",
    '\n  const resumeSuccessorQualification',
  );
  assert.doesNotMatch(body, /METAENGINE_DISABLE_SELF_UPDATE/);
  assert.match(body, /automatic_retry_allowed:\s*false/);
  assert.match(body, /recovery_state:\s*'LIVE_HOLD'/);
});

test('bootstrap entrypoint does not translate recoverable self-update ambiguity into the global kill switch', async () => {
  const text = await source();
  assert.match(text, /METAENGINE_SELF_UPDATE_HOLD_REASON/);
  assert.doesNotMatch(text, /METAENGINE_DISABLE_SELF_UPDATE\s*=\s*'1'/);
});
