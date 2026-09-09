import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (name) => fs.readFileSync(path.join(here, '..', 'src', name), 'utf8');

test('self-update installer handoff has one lifecycle owner', () => {
  const runtime = src('self-update-runtime-v8.mjs');
  const supervisor = src('native-supervisor-client.mjs');

  assert.match(
    runtime,
    /await this\.#host\?\.prepareInstallerHandoff\?\.\('SELF_UPDATE'\);/,
    'SelfUpdateRuntime must own the host-resilience installer handoff before installer launch',
  );
  assert.doesNotMatch(
    supervisor,
    /prepareInstallerHandoff\s*\(\s*['"]SELF_UPDATE['"]\s*\)/,
    'NativeSupervisorClient pre-install wrapper must not repeat the already-completed handoff',
  );
  assert.match(
    supervisor,
    /realtimeProcessPlane\?\.stopAndWait/,
    'the wrapper must still durably stop the realtime process plane before installer launch',
  );
});
